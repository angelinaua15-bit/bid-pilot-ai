/**
 * services/campaign-dispatch.service.ts
 *
 * Join-then-send campaign dispatch via GramJS (MTProto).
 *
 * Flow per channel:
 *  1. Resolve entity (getInputEntity)
 *  2. Check membership (GetParticipant for channels, getMessages probe for groups)
 *  3. Join if not a member, wait 3-10 s, re-resolve entity
 *  4. Check broadcast rights (channels only — cannot post unless admin)
 *  5. Send message — sendMessage() high-level API with fresh resolved entity
 *  6. Save detailed log row for every step outcome
 *
 * Log phases visible in DB:
 *  join_started / join_success / join_failed / approval_pending
 *  send_started / send_success / send_failed
 *  CHAT_WRITE_FORBIDDEN → "Немає прав на відправку в канал"
 */

import {
  getCampaignById,
  getTelegramAccounts,
  getTelegramChannelsByIds,
  updateCampaignStatus,
  saveCampaignMessage,
  incrementCampaignCounters,
} from '../lib/db'
import { CAMPAIGN_ACCOUNT_LIMITS, type CampaignJoinStatus, type CampaignMembershipStatus } from '../types'
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { Api } from 'telegram/tl'
import { Logger, LogLevel } from 'telegram/extensions/Logger.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function randDelay(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs)
}

function extractFloodWaitSeconds(msg: string): number | null {
  const m = msg.match(/FLOOD_WAIT[_(](\d+)/i)
  return m ? Number(m[1]) : null
}

function extractErrorCode(msg: string): string {
  // Pull the first ALL_CAPS_WITH_UNDERSCORES token that looks like a Telegram error
  const m = msg.match(/([A-Z][A-Z0-9_]{4,})/)
  return m ? m[1] : 'UNKNOWN_ERROR'
}

/** Normalise a channel/group username or link to something getInputEntity() accepts. */
function normalisePeer(raw: string): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  if (s.includes('t.me/+') || s.includes('t.me/joinchat/')) return s
  const tme = s.match(/t\.me\/([A-Za-z0-9_]{3,})/)
  if (tme) return `@${tme[1]}`
  if (s.startsWith('@')) return s
  if (/^[A-Za-z0-9_]{3,}$/.test(s)) return `@${s}`
  return null
}

// ── GramJS client factory ────────────────────────────────────────────────────

async function makeClient(sessionString: string | undefined): Promise<TelegramClient> {
  const apiId   = Number(process.env.TELEGRAM_API_ID)
  const apiHash = process.env.TELEGRAM_API_HASH ?? ''
  if (!apiId || !apiHash) {
    throw new Error('TELEGRAM_API_ID або TELEGRAM_API_HASH не задано в змінних середовища')
  }
  if (!sessionString || sessionString.trim() === '') {
    throw new Error('SESSION_MISSING: акаунт не авторизований — повторіть авторизацію')
  }
  const logger = new Logger(LogLevel.NONE)
  const client = new TelegramClient(
    new StringSession(sessionString),
    apiId, apiHash,
    { connectionRetries: 5, retryDelay: 2_000, useWSS: false, baseLogger: logger },
  )
  await client.connect()
  return client
}

// ── Entity resolution ────────────────────────────────────────────────────────

/**
 * Resolve peer to a GramJS InputPeer. Returns null if unresolvable.
 * Always fetches fresh — never rely on the cached entity after a join.
 */
async function resolveEntity(
  client: TelegramClient,
  peer: string,
): Promise<Api.TypeInputPeer | null> {
  try {
    const e = await client.getInputEntity(peer)
    return e as unknown as Api.TypeInputPeer
  } catch {
    return null
  }
}

// ── Membership check ─────────────────────────────────────────────────────────

/**
 * Returns 'member' | 'not_member' | 'approval_pending'.
 *
 * Strategy:
 *  - For channels/supergroups: use GetParticipant (requires channels.GetParticipant)
 *  - For basic groups:         GetParticipant doesn't work — use GetFullChat; if the
 *    account can see the chat it's a member, otherwise not_member.
 * Throws on FloodWait so the caller can abort the account loop.
 */
async function getMembershipStatus(
  client: TelegramClient,
  entity: Api.TypeInputPeer,
): Promise<CampaignMembershipStatus> {
  try {
    await client.invoke(
      new Api.channels.GetParticipant({
        channel:     entity as unknown as Api.TypeInputChannel,
        participant: new Api.InputUserSelf(),
      }),
    )
    return 'member'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('FLOOD_WAIT')) throw err
    if (msg.includes('USER_NOT_PARTICIPANT') || msg.includes('CHANNEL_PRIVATE')) {
      return 'not_member'
    }
    if (msg.includes('INVITE_REQUEST_SENT')) return 'approval_pending'
    // GetParticipant fails on basic groups — try GetFullChat as a fallback
    if (entity instanceof Api.InputPeerChat) {
      try {
        await client.invoke(new Api.messages.GetFullChat({ chatId: (entity as Api.InputPeerChat).chatId }))
        return 'member' // If we can see the full chat, we're a member
      } catch {
        return 'not_member'
      }
    }
    // For any other unexpected error treat as not_member so we attempt to join
    return 'not_member'
  }
}

// ── Broadcast-channel write rights check ─────────────────────────────────────

/**
 * Returns true if the account can post to this entity.
 * Broadcast channels require the account to be an admin with post rights.
 * Supergroups and basic groups allow any member to send messages.
 */
async function canPostToEntity(
  client: TelegramClient,
  entity: Api.TypeInputPeer,
): Promise<{ canPost: boolean; isBroadcast: boolean }> {
  try {
    // GetFullChannel works for both channels and supergroups
    const result = await client.invoke(
      new Api.channels.GetFullChannel({
        channel: entity as unknown as Api.TypeInputChannel,
      }),
    )
    const fullChat = result.fullChat as Api.ChannelFull
    const chats = result.chats as Api.TypeChat[]
    const channel = chats.find((c): c is Api.Channel => c instanceof Api.Channel)

    if (!channel) return { canPost: true, isBroadcast: false }

    const isBroadcast = channel.broadcast === true
    if (!isBroadcast) {
      // Supergroup — any member can post (unless slowMode/restricted, but that's a send-time error)
      return { canPost: true, isBroadcast: false }
    }

    // Broadcast channel — only admins with post rights can send
    const participant = await client.invoke(
      new Api.channels.GetParticipant({
        channel:     entity as unknown as Api.TypeInputChannel,
        participant: new Api.InputUserSelf(),
      }),
    )
    const p = participant.participant
    const isAdmin    = p instanceof Api.ChannelParticipantAdmin
    const isCreator  = p instanceof Api.ChannelParticipantCreator
    const postRights = isCreator ||
      (isAdmin && (p as Api.ChannelParticipantAdmin).adminRights?.postMessages === true)

    return { canPost: postRights, isBroadcast: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('FLOOD_WAIT')) throw err
    // If we can't check rights, attempt the send and let Telegram return the error
    return { canPost: true, isBroadcast: false }
  }
}

// ── Join helper ──────────────────────────────────────────────────────────────

/**
 * Join a public channel/group or accept a private invite link.
 * Returns the resulting membership status.
 * Throws on FloodWait or CHANNELS_TOO_MUCH so the caller can abort the account.
 */
async function tryJoin(
  client: TelegramClient,
  peer: string,
  entity: Api.TypeInputPeer,
): Promise<CampaignMembershipStatus> {
  const isInvite = peer.includes('t.me/+') || peer.includes('t.me/joinchat/')

  try {
    if (isInvite) {
      const hash = peer.replace(/.*t\.me\/(?:joinchat\/|\+)/, '').split('?')[0]
      await client.invoke(new Api.messages.ImportChatInvite({ hash }))
    } else if (entity instanceof Api.InputPeerChat) {
      // Basic group — JoinChannel doesn't work for basic groups.
      // The user must be invited; if they somehow got the link, there's no
      // self-join API. Treat as join_failed with a clear message.
      throw new Error('BASIC_GROUP_NO_JOIN: базові групи не підтримують самостійний вступ через MTProto — використовуйте запрошення або перенесіть групу в супергрупу')
    } else {
      await client.invoke(new Api.channels.JoinChannel({
        channel: entity as unknown as Api.TypeInputChannel,
      }))
    }
    return 'member'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('USER_ALREADY_PARTICIPANT')) return 'member'
    if (msg.includes('INVITE_REQUEST_SENT'))      return 'approval_pending'
    if (msg.includes('JOIN_AS_PEER_INVALID'))     return 'approval_pending'
    if (msg.includes('FLOOD_WAIT'))               throw err
    if (msg.includes('CHANNELS_TOO_MUCH'))        throw err
    throw err
  }
}

// ── Per-account dispatch ──────────────────────────────────────────────────────

interface AccountSliceResult {
  sent:            number
  failedSend:      number
  joined:          number
  failedJoin:      number
  skipped:         number
  waitingApproval: number
  invalidChannel:  number
  floodWait:       boolean
  floodWaitSec:    number
}

async function dispatchAccountSlice(
  campaignId:   string,
  channelIds:   string[],
  account:      { id: string; phoneNumber: string; sessionString: string | undefined },
  channelMap:   Map<string, { id: string; title?: string; usernameOrLink: string }>,
  messageText:  string,
): Promise<AccountSliceResult> {
  const res: AccountSliceResult = {
    sent: 0, failedSend: 0, joined: 0, failedJoin: 0,
    skipped: 0, waitingApproval: 0, invalidChannel: 0,
    floodWait: false, floodWaitSec: 0,
  }

  // Guard: message text must be non-empty
  const trimmedText = (messageText ?? '').trim()
  if (!trimmedText) {
    console.error(`[dispatch] account:${account.phoneNumber} — текст повідомлення порожній, кампанія не буде виконана`)
    for (const channelId of channelIds) {
      const ch = channelMap.get(channelId)
      await saveCampaignMessage({
        campaignId, channelId, channelTitle: ch?.title,
        telegramAccountId: account.id, accountPhone: account.phoneNumber,
        status: 'skipped',
        telegramErrorCode: 'EMPTY_MESSAGE',
        errorReason: 'Текст повідомлення кампанії порожній — нічого відправляти',
      })
      res.skipped++
    }
    return res
  }

  // ── 1. Connect ───────────────────────────────────────────────────────────────
  let client: TelegramClient
  try {
    client = await makeClient(account.sessionString)
    console.log(`[dispatch] account:${account.phoneNumber} connected`)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[dispatch] account:${account.phoneNumber} CONNECT_FAILED: ${reason}`)
    for (const channelId of channelIds) {
      const ch = channelMap.get(channelId)
      await saveCampaignMessage({
        campaignId, channelId, channelTitle: ch?.title,
        telegramAccountId: account.id, accountPhone: account.phoneNumber,
        status: 'failed',
        telegramErrorCode: 'CONNECT_FAILED',
        errorReason: `Не вдалося підключити акаунт ${account.phoneNumber}: ${reason}`,
      })
      await incrementCampaignCounters(campaignId, 'failed_count')
      res.failedSend++
    }
    return res
  }

  // ── 2. Validate session ──────────────────────────────────────────────────────
  try {
    await client.invoke(new Api.users.GetUsers({ id: [new Api.InputUserSelf()] }))
    console.log(`[dispatch] account:${account.phoneNumber} session valid`)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[dispatch] account:${account.phoneNumber} SESSION_INVALID: ${reason}`)
    for (const channelId of channelIds) {
      const ch = channelMap.get(channelId)
      await saveCampaignMessage({
        campaignId, channelId, channelTitle: ch?.title,
        telegramAccountId: account.id, accountPhone: account.phoneNumber,
        status: 'skipped',
        telegramErrorCode: extractErrorCode(reason),
        errorReason: `Сесія акаунту ${account.phoneNumber} недійсна: ${reason}`,
      })
      res.skipped++
    }
    try { await client.disconnect() } catch { /* ignore */ }
    return res
  }

  // ── 3. Per-channel loop ──────────────────────────────────────────────────────
  let joinsThisRun = 0
  let sendsThisRun = 0

  try {
    for (const channelId of channelIds) {
      const ch = channelMap.get(channelId)

      // ── 3a. Validate channel record ───────────────────────────────────────────
      if (!ch) {
        await saveCampaignMessage({
          campaignId, channelId,
          telegramAccountId: account.id, accountPhone: account.phoneNumber,
          status: 'invalid_channel',
          telegramErrorCode: 'CHANNEL_NOT_IN_DB',
          errorReason: `Канал ${channelId} не знайдено в базі даних`,
        })
        res.invalidChannel++
        await incrementCampaignCounters(campaignId, 'failed_count')
        continue
      }

      const peer = normalisePeer(ch.usernameOrLink)
      if (!peer) {
        await saveCampaignMessage({
          campaignId, channelId, channelTitle: ch.title,
          telegramAccountId: account.id, accountPhone: account.phoneNumber,
          status: 'invalid_channel',
          telegramErrorCode: 'INVALID_LINK',
          errorReason: `Не вдається розпізнати посилання: "${ch.usernameOrLink}"`,
        })
        res.invalidChannel++
        await incrementCampaignCounters(campaignId, 'failed_count')
        continue
      }

      console.log(`[dispatch] account:${account.phoneNumber} channel:${peer} — START`)

      // ── 3b. Initial entity resolution ─────────────────────────────────────────
      let entity = await resolveEntity(client, peer)
      if (!entity) {
        await saveCampaignMessage({
          campaignId, channelId, channelTitle: ch.title,
          telegramAccountId: account.id, accountPhone: account.phoneNumber,
          status: 'invalid_channel',
          telegramErrorCode: 'ENTITY_NOT_FOUND',
          errorReason: `Не вдалося знайти канал у Telegram: "${peer}"`,
        })
        res.invalidChannel++
        await incrementCampaignCounters(campaignId, 'failed_count')
        continue
      }

      // ── 3c. Check membership → join if needed ──────────────────────────────────
      let joinStatus: CampaignJoinStatus = 'already_member'

      try {
        const membership = await getMembershipStatus(client, entity)
        console.log(`[dispatch] account:${account.phoneNumber} channel:${peer} membership:${membership}`)

        if (membership === 'approval_pending') {
          // Previously sent a join request — cannot send, still waiting
          await saveCampaignMessage({
            campaignId, channelId, channelTitle: ch.title,
            telegramAccountId: account.id, accountPhone: account.phoneNumber,
            joinStatus: 'approval_pending', membershipStatus: 'approval_pending',
            status: 'waiting_approval',
            errorReason: 'Запит на вступ вже надіслано раніше — очікується підтвердження адміна',
          })
          res.waitingApproval++
          continue // Cannot send — must wait for admin approval
        }

        if (membership === 'not_member') {
          // ── join_started ──
          if (joinsThisRun >= CAMPAIGN_ACCOUNT_LIMITS.maxJoinsPerCampaign) {
            await saveCampaignMessage({
              campaignId, channelId, channelTitle: ch.title,
              telegramAccountId: account.id, accountPhone: account.phoneNumber,
              joinStatus: 'join_failed', status: 'skipped',
              telegramErrorCode: 'JOIN_LIMIT_REACHED',
              errorReason: `Акаунт досяг ліміту вступів (${CAMPAIGN_ACCOUNT_LIMITS.maxJoinsPerCampaign}) за одну кампанію`,
            })
            res.skipped++
            continue
          }

          console.log(`[dispatch] account:${account.phoneNumber} channel:${peer} join_started`)
          await sleep(randDelay(
            CAMPAIGN_ACCOUNT_LIMITS.joinDelayMinMs,
            CAMPAIGN_ACCOUNT_LIMITS.joinDelayMaxMs,
          ))

          try {
            const afterJoin = await tryJoin(client, peer, entity)
            joinsThisRun++
            console.log(`[dispatch] account:${account.phoneNumber} channel:${peer} join_success (${afterJoin})`)

            if (afterJoin === 'approval_pending') {
              // Join request submitted — cannot send until approved
              await saveCampaignMessage({
                campaignId, channelId, channelTitle: ch.title,
                telegramAccountId: account.id, accountPhone: account.phoneNumber,
                joinStatus: 'approval_pending', membershipStatus: 'approval_pending',
                status: 'waiting_approval',
                errorReason: 'Запит на вступ надіслано — очікується підтвердження адміна каналу',
              })
              res.waitingApproval++
              continue // Must wait for approval — skip send for this channel
            }

            // join_success — update counters and fall through to SEND
            joinStatus = 'joined'
            res.joined++

            // Re-resolve entity after join — entity cache may have changed
            const freshEntity = await resolveEntity(client, peer)
            if (freshEntity) entity = freshEntity

            // Pause after join before sending (anti-spam)
            const postJoinDelay = randDelay(
              CAMPAIGN_ACCOUNT_LIMITS.joinDelayMinMs * 2,
              CAMPAIGN_ACCOUNT_LIMITS.joinDelayMaxMs * 2,
            )
            console.log(`[dispatch] account:${account.phoneNumber} channel:${peer} waiting ${Math.round(postJoinDelay / 1000)}s before send`)
            await sleep(postJoinDelay)

          } catch (joinErr) {
            const reason   = joinErr instanceof Error ? joinErr.message : String(joinErr)
            const floodSec = extractFloodWaitSeconds(reason)

            if (floodSec !== null) {
              console.warn(`[dispatch] account:${account.phoneNumber} FLOOD_WAIT_${floodSec}s on join`)
              res.floodWait    = true
              res.floodWaitSec = floodSec
              await saveCampaignMessage({
                campaignId, channelId, channelTitle: ch.title,
                telegramAccountId: account.id, accountPhone: account.phoneNumber,
                joinStatus: 'join_failed', status: 'skipped',
                telegramErrorCode: `FLOOD_WAIT_${floodSec}`,
                errorReason: `FloodWait ${floodSec}с при спробі вступу — акаунт зупинено`,
              })
              res.skipped++
              break // Abort all remaining channels for this account
            }

            if (reason.includes('CHANNELS_TOO_MUCH')) {
              await saveCampaignMessage({
                campaignId, channelId, channelTitle: ch.title,
                telegramAccountId: account.id, accountPhone: account.phoneNumber,
                joinStatus: 'join_failed', status: 'skipped',
                telegramErrorCode: 'CHANNELS_TOO_MUCH',
                errorReason: 'Акаунт перевищив ліміт 500 каналів Telegram',
              })
              res.skipped++
              break // Abort all remaining channels for this account
            }

            // Other join error — log and continue to next channel
            console.error(`[dispatch] account:${account.phoneNumber} channel:${peer} join_failed: ${reason}`)
            await saveCampaignMessage({
              campaignId, channelId, channelTitle: ch.title,
              telegramAccountId: account.id, accountPhone: account.phoneNumber,
              joinStatus: 'join_failed', status: 'failed',
              telegramErrorCode: extractErrorCode(reason),
              errorReason: `Не вдалося вступити до ${peer}: ${reason}`,
            })
            res.failedJoin++
            await incrementCampaignCounters(campaignId, 'failed_count')
            continue // Try next channel
          }
        }
        // else: already_member — joinStatus = 'already_member', fall through to send

      } catch (memberErr) {
        const reason   = memberErr instanceof Error ? memberErr.message : String(memberErr)
        const floodSec = extractFloodWaitSeconds(reason)
        if (floodSec !== null) {
          res.floodWait    = true
          res.floodWaitSec = floodSec
          await saveCampaignMessage({
            campaignId, channelId, channelTitle: ch.title,
            telegramAccountId: account.id, accountPhone: account.phoneNumber,
            status: 'skipped',
            telegramErrorCode: `FLOOD_WAIT_${floodSec}`,
            errorReason: `FloodWait ${floodSec}с при перевірці членства — акаунт зупинено`,
          })
          res.skipped++
          break
        }
        await saveCampaignMessage({
          campaignId, channelId, channelTitle: ch.title,
          telegramAccountId: account.id, accountPhone: account.phoneNumber,
          joinStatus: 'join_failed', status: 'invalid_channel',
          telegramErrorCode: extractErrorCode(reason),
          errorReason: `Не вдалося перевірити членство у ${peer}: ${reason}`,
        })
        res.invalidChannel++
        await incrementCampaignCounters(campaignId, 'failed_count')
        continue
      }

      // ─────────────────────────────────────────────────────────────────────────
      // ── 3d. Check broadcast post rights BEFORE sending ────────────────────────
      // ─────────────────────────────────────────────────────────────────────────
      try {
        const { canPost, isBroadcast } = await canPostToEntity(client, entity)
        if (!canPost) {
          console.warn(`[dispatch] account:${account.phoneNumber} channel:${peer} CHAT_WRITE_FORBIDDEN (broadcast channel, not an admin)`)
          await saveCampaignMessage({
            campaignId, channelId, channelTitle: ch.title,
            telegramAccountId: account.id, accountPhone: account.phoneNumber,
            joinStatus,
            status: 'failed',
            telegramErrorCode: 'CHAT_WRITE_FORBIDDEN',
            errorReason: `Немає прав на відправку в канал "${ch.title ?? peer}" — акаунт не є адміністратором broadcast-каналу`,
          })
          res.failedSend++
          await incrementCampaignCounters(campaignId, 'failed_count')
          continue
        }
        if (isBroadcast) {
          console.log(`[dispatch] account:${account.phoneNumber} channel:${peer} is broadcast channel, account has post rights`)
        }
      } catch (rightsErr) {
        const reason   = rightsErr instanceof Error ? rightsErr.message : String(rightsErr)
        const floodSec = extractFloodWaitSeconds(reason)
        if (floodSec !== null) {
          res.floodWait    = true
          res.floodWaitSec = floodSec
          await saveCampaignMessage({
            campaignId, channelId, channelTitle: ch.title,
            telegramAccountId: account.id, accountPhone: account.phoneNumber,
            joinStatus, status: 'skipped',
            telegramErrorCode: `FLOOD_WAIT_${floodSec}`,
            errorReason: `FloodWait ${floodSec}с при перевірці прав — акаунт зупинено`,
          })
          res.skipped++
          break
        }
        // Non-fatal rights check error — proceed with send attempt
        console.warn(`[dispatch] account:${account.phoneNumber} channel:${peer} rights check error (non-fatal): ${reason}`)
      }

      // ─────────────────────────────────────────────────────────────────────────
      // ── 3e. Send message ───────────────────────────────────────────────────────
      // ─────────────────────────────────────────────────────────────────────────
      if (sendsThisRun >= CAMPAIGN_ACCOUNT_LIMITS.maxSendsPerCampaign) {
        await saveCampaignMessage({
          campaignId, channelId, channelTitle: ch.title,
          telegramAccountId: account.id, accountPhone: account.phoneNumber,
          joinStatus, status: 'skipped',
          telegramErrorCode: 'SEND_LIMIT_REACHED',
          errorReason: `Акаунт досяг ліміту відправок (${CAMPAIGN_ACCOUNT_LIMITS.maxSendsPerCampaign}) за одну кампанію`,
        })
        res.skipped++
        continue
      }

      // Small delay before each send
      await sleep(randDelay(
        CAMPAIGN_ACCOUNT_LIMITS.sendDelayMinMs,
        CAMPAIGN_ACCOUNT_LIMITS.sendDelayMaxMs,
      ))

      console.log(`[dispatch] account:${account.phoneNumber} channel:${peer} send_started`)

      try {
        // Use the re-resolved entity for send — avoids PEER_ID_INVALID after join.
        // sendMessage() is the GramJS high-level API; it handles peer resolution
        // internally but giving it an already-resolved entity is more reliable.
        const sendResult = await client.sendMessage(entity as Parameters<typeof client.sendMessage>[0], {
          message:   trimmedText,
          parseMode: undefined,
        })

        const messageId = typeof sendResult?.id === 'number' ? sendResult.id : undefined
        console.log(`[dispatch] account:${account.phoneNumber} channel:${peer} send_success msgId:${messageId ?? '?'}`)

        await saveCampaignMessage({
          campaignId, channelId, channelTitle: ch.title,
          telegramAccountId: account.id, accountPhone: account.phoneNumber,
          messageId,
          joinStatus,
          membershipStatus: 'member',
          status:           'sent',
          sentAt:           new Date().toISOString(),
        })
        await incrementCampaignCounters(campaignId, 'sent_count')
        sendsThisRun++
        res.sent++

      } catch (sendErr) {
        const reason   = sendErr instanceof Error ? sendErr.message : String(sendErr)
        const floodSec = extractFloodWaitSeconds(reason)

        if (floodSec !== null) {
          console.warn(`[dispatch] account:${account.phoneNumber} FLOOD_WAIT_${floodSec}s on send to ${peer}`)
          res.floodWait    = true
          res.floodWaitSec = floodSec
          await saveCampaignMessage({
            campaignId, channelId, channelTitle: ch.title,
            telegramAccountId: account.id, accountPhone: account.phoneNumber,
            joinStatus, status: 'skipped',
            telegramErrorCode: `FLOOD_WAIT_${floodSec}`,
            errorReason: `FloodWait ${floodSec}с при відправці до ${peer} — акаунт зупинено`,
          })
          res.skipped++
          break // Abort remaining channels for this account
        }

        // CHAT_WRITE_FORBIDDEN at send time (might have been missed in rights check)
        if (reason.includes('CHAT_WRITE_FORBIDDEN')) {
          console.error(`[dispatch] account:${account.phoneNumber} channel:${peer} send_failed CHAT_WRITE_FORBIDDEN`)
          await saveCampaignMessage({
            campaignId, channelId, channelTitle: ch.title,
            telegramAccountId: account.id, accountPhone: account.phoneNumber,
            joinStatus, status: 'failed',
            telegramErrorCode: 'CHAT_WRITE_FORBIDDEN',
            errorReason: `Немає прав на відправку в канал "${ch.title ?? peer}"`,
          })
          await incrementCampaignCounters(campaignId, 'failed_count')
          res.failedSend++
          continue
        }

        const isInvalid =
          reason.includes('USERNAME_INVALID') ||
          reason.includes('CHANNEL_INVALID')  ||
          reason.includes('PEER_ID_INVALID')

        console.error(`[dispatch] account:${account.phoneNumber} channel:${peer} send_failed: ${reason}`)
        await saveCampaignMessage({
          campaignId, channelId, channelTitle: ch.title,
          telegramAccountId: account.id, accountPhone: account.phoneNumber,
          joinStatus,
          status:            isInvalid ? 'invalid_channel' : 'failed',
          telegramErrorCode: extractErrorCode(reason),
          errorReason:       `Помилка відправки до ${peer}: ${reason}`,
        })
        await incrementCampaignCounters(campaignId, 'failed_count')
        if (isInvalid) res.invalidChannel++
        else res.failedSend++
      }
    } // end per-channel loop
  } finally {
    try { await client.disconnect() } catch { /* ignore */ }
  }

  console.log(`[dispatch] account:${account.phoneNumber} DONE — sent:${res.sent} joined:${res.joined} failedSend:${res.failedSend} failedJoin:${res.failedJoin} skipped:${res.skipped}`)
  return res
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function dispatchCampaign(campaignId: string): Promise<{
  sent:            number
  failedSend:      number
  joined:          number
  failedJoin:      number
  skipped:         number
  waitingApproval: number
  invalidChannel:  number
}> {
  console.log(`[dispatch] starting campaign:${campaignId}`)
  const campaign = await getCampaignById(campaignId)
  if (!campaign) throw new Error(`Кампанія ${campaignId} не знайдена`)

  await updateCampaignStatus(campaignId, 'joining')

  // ── Resolve sender accounts ───────────────────────────────────────────────
  const allUserAccounts = await getTelegramAccounts(campaign.userId)
  console.log(`[dispatch] all user accounts: ${allUserAccounts.length} (userId:${campaign.userId})`)

  const now = new Date()
  const activeAll = allUserAccounts.filter(
    (a) => a.status === 'active' &&
           (!a.floodWaitUntil || new Date(a.floodWaitUntil) <= now)
  )
  console.log(`[dispatch] active accounts available: ${activeAll.length}`)

  let activeAccounts = activeAll
  if (campaign.accountIds && campaign.accountIds.length > 0) {
    const idSet = new Set(campaign.accountIds)
    const sel   = activeAll.filter((a) => idSet.has(a.id))
    console.log(`[dispatch] campaign.accountIds filter: ${campaign.accountIds.length} requested, ${sel.length} matched active`)
    if (sel.length > 0) activeAccounts = sel
  } else if (campaign.accountId) {
    const primary = activeAll.find((a) => a.id === campaign.accountId)
    if (primary) activeAccounts = [primary]
  }

  if (activeAccounts.length === 0) {
    await updateCampaignStatus(campaignId, 'no_accounts')
    throw new Error('Немає активного Telegram-акаунту для відправки. Перевірте авторизацію акаунтів.')
  }

  // ── Load channels selected in this campaign ───────────────────────────────
  const targetIds = campaign.targetChannelIds ?? []
  console.log(`[dispatch] target channels: ${targetIds.length}`)

  if (targetIds.length === 0) {
    await updateCampaignStatus(campaignId, 'failed')
    throw new Error('Кампанія не містить каналів для розсилки')
  }

  const channels   = await getTelegramChannelsByIds(targetIds)
  console.log(`[dispatch] channels loaded from DB: ${channels.length} of ${targetIds.length} requested`)
  const channelMap = new Map(channels.map((c) => [c.id, c]))

  // ── Round-robin distribute channels across accounts ───────────────────────
  const numAccounts = activeAccounts.length
  const slices: string[][] = activeAccounts.map(() => [])
  targetIds.forEach((id, i) => { slices[i % numAccounts].push(id) })
  console.log(`[dispatch] distributing ${targetIds.length} channels across ${numAccounts} accounts`)

  await updateCampaignStatus(campaignId, 'sending')

  // ── Sequential per-account dispatch ──────────────────────────────────────
  const totals = { sent: 0, failedSend: 0, joined: 0, failedJoin: 0, skipped: 0, waitingApproval: 0, invalidChannel: 0 }
  const allFloodResults: boolean[] = []

  for (let i = 0; i < activeAccounts.length; i++) {
    const account = activeAccounts[i]
    const slice   = slices[i]
    if (slice.length === 0) continue

    try {
      const r = await dispatchAccountSlice(
        campaignId,
        slice,
        account as { id: string; phoneNumber: string; sessionString: string | undefined },
        channelMap as Map<string, { id: string; title?: string; usernameOrLink: string }>,
        campaign.messageText,
      )
      totals.sent            += r.sent
      totals.failedSend      += r.failedSend
      totals.joined          += r.joined
      totals.failedJoin      += r.failedJoin
      totals.skipped         += r.skipped
      totals.waitingApproval += r.waitingApproval
      totals.invalidChannel  += r.invalidChannel
      allFloodResults.push(r.floodWait)
    } catch (err) {
      console.error(`[dispatch] account:${account.phoneNumber} unhandled error:`, err)
      allFloodResults.push(false)
    }
  }

  // ── Determine final status ─────────────────────────────────────────────────
  const allFlood    = allFloodResults.length > 0 && allFloodResults.every(Boolean)
  const totalFailed = totals.failedSend + totals.failedJoin + totals.invalidChannel

  const finalStatus =
    allFlood && totals.sent === 0                           ? 'flood_wait'
    : totals.sent === 0 && totals.waitingApproval > 0      ? 'paused'
    : totalFailed === targetIds.length && totals.sent === 0 ? 'failed'
    : totals.sent > 0 && totalFailed > 0                   ? 'partially_completed'
    : totals.sent > 0                                      ? 'completed'
    : 'failed'

  console.log(`[dispatch] campaign:${campaignId} DONE — status:${finalStatus} sent:${totals.sent} failed:${totalFailed} joined:${totals.joined}`)
  await updateCampaignStatus(campaignId, finalStatus)

  return totals
}
