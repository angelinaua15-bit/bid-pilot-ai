/**
 * services/campaign-dispatch.service.ts
 *
 * Full join-then-send campaign dispatch using GramJS (MTProto).
 *
 * Key fixes vs. previous version:
 *  - Uses client.getInputEntity() before every invoke() — GramJS invoke() does NOT
 *    auto-resolve string peers; only high-level methods (sendMessage, etc.) do.
 *  - Uses client.sendMessage() (high-level) for sending — handles peer resolution
 *    and message formatting correctly.
 *  - Loads only the channels selected in the campaign (getTelegramChannelsByIds)
 *    instead of all 20 000 channels — avoids the ch.status check blocking all channels.
 *  - Channel status check is now a warning, not a hard block — lets the dispatch
 *    attempt the channel and fail gracefully if the link is invalid.
 *  - getMembershipStatus uses GetParticipant (not GetFullChannel) with a resolved entity.
 *  - Per-account sequential dispatch (not Promise.all) to avoid Telegram rate limits.
 *  - Detailed logs saved per channel: joinStatus + telegramErrorCode + errorReason.
 */

import {
  getCampaignById,
  getTelegramAccounts,
  getTelegramChannelsByIds,
  updateCampaignStatus,
  saveCampaignMessage,
  incrementCampaignCounters,
} from '../lib/db'
import { CAMPAIGN_ACCOUNT_LIMITS, CampaignJoinStatus, CampaignMembershipStatus } from '../types'
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
  const m = msg.match(/([A-Z][A-Z0-9_]{4,})/)
  return m ? m[1] : 'UNKNOWN_ERROR'
}

/** Normalise a channel/group username or link into a string GramJS can getInputEntity() on. */
function normalisePeer(raw: string): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null

  // Private invite links (t.me/+ or t.me/joinchat/)
  if (s.includes('t.me/+') || s.includes('t.me/joinchat/')) return s

  // t.me/username → @username
  const tme = s.match(/t\.me\/([A-Za-z0-9_]{3,})/)
  if (tme) return `@${tme[1]}`

  // Already @username
  if (s.startsWith('@')) return s

  // Bare username without @
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
    throw new Error('SESSION_MISSING: акаунт не авторизований — необхідно повторно пройти авторизацію')
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

// ── Membership helpers ───────────────────────────────────────────────────────

/**
 * Resolve a peer to a GramJS entity.
 * Returns null if the peer cannot be resolved (invalid username / private channel).
 */
async function resolveEntity(
  client: TelegramClient,
  peer: string,
): Promise<Api.TypeInputPeer | null> {
  try {
    // getInputEntity handles @usernames, t.me links, invite links, etc.
    const entity = await client.getInputEntity(peer)
    return entity as unknown as Api.TypeInputPeer
  } catch {
    return null
  }
}

/**
 * Check whether the current account is a participant of the channel/group.
 * Uses GetParticipant which works for both channels and groups.
 * Returns 'member' | 'not_member' | 'approval_pending'.
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
    if (msg.includes('USER_NOT_PARTICIPANT') || msg.includes('CHANNEL_PRIVATE')) {
      return 'not_member'
    }
    if (msg.includes('INVITE_REQUEST_SENT')) return 'approval_pending'
    if (msg.includes('FLOOD_WAIT'))          throw err
    // For regular groups, GetParticipant might throw — treat as not_member
    return 'not_member'
  }
}

/**
 * Join a public channel/group or accept a private invite link.
 * Returns the resulting membership status.
 * Throws on FloodWait or CHANNELS_TOO_MUCH (caller aborts the account).
 */
async function tryJoin(
  client: TelegramClient,
  peer: string,
  entity: Api.TypeInputPeer,
): Promise<CampaignMembershipStatus> {
  const isInvite = peer.includes('t.me/+') || peer.includes('t.me/joinchat/')

  try {
    if (isInvite) {
      // Private invite: extract hash
      const hash = peer.replace(/.*t\.me\/(?:joinchat\/|\+)/, '').split('?')[0]
      await client.invoke(new Api.messages.ImportChatInvite({ hash }))
    } else {
      // Public channel/group: use resolved entity
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
        campaignId,
        channelId,
        channelTitle:      ch?.title,
        telegramAccountId: account.id,
        accountPhone:      account.phoneNumber,
        status:            'failed',
        telegramErrorCode: 'CONNECT_FAILED',
        errorReason:       `Не вдалося підключити акаунт ${account.phoneNumber}: ${reason}`,
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
        campaignId,
        channelId,
        channelTitle:      ch?.title,
        telegramAccountId: account.id,
        accountPhone:      account.phoneNumber,
        status:            'skipped',
        telegramErrorCode: extractErrorCode(reason),
        errorReason:       `Сесія акаунту ${account.phoneNumber} недійсна: ${reason}`,
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

      if (!ch) {
        // Channel ID not found in our DB — could have been deleted
        await saveCampaignMessage({
          campaignId,
          channelId,
          telegramAccountId: account.id,
          accountPhone:      account.phoneNumber,
          status:            'invalid_channel',
          telegramErrorCode: 'CHANNEL_NOT_IN_DB',
          errorReason:       `Канал ${channelId} не знайдено в базі даних`,
        })
        res.invalidChannel++
        await incrementCampaignCounters(campaignId, 'failed_count')
        continue
      }

      const peer = normalisePeer(ch.usernameOrLink)
      if (!peer) {
        await saveCampaignMessage({
          campaignId,
          channelId,
          channelTitle:      ch.title,
          telegramAccountId: account.id,
          accountPhone:      account.phoneNumber,
          status:            'invalid_channel',
          telegramErrorCode: 'INVALID_LINK',
          errorReason:       `Не вдається розпізнати посилання: "${ch.usernameOrLink}"`,
        })
        res.invalidChannel++
        await incrementCampaignCounters(campaignId, 'failed_count')
        continue
      }

      console.log(`[dispatch] account:${account.phoneNumber} processing channel:${peer}`)

      // ── 3a. Resolve entity ────────────────────────────────────────────────────
      const entity = await resolveEntity(client, peer)
      if (!entity) {
        await saveCampaignMessage({
          campaignId,
          channelId,
          channelTitle:      ch.title,
          telegramAccountId: account.id,
          accountPhone:      account.phoneNumber,
          status:            'invalid_channel',
          telegramErrorCode: 'ENTITY_NOT_FOUND',
          errorReason:       `Не вдалося знайти канал у Telegram: "${peer}"`,
        })
        res.invalidChannel++
        await incrementCampaignCounters(campaignId, 'failed_count')
        continue
      }

      // ── 3b. Check / Join ──────────────────────────────────────────────────────
      let joinStatus: CampaignJoinStatus = 'already_member'

      try {
        const membership = await getMembershipStatus(client, entity)
        console.log(`[dispatch] account:${account.phoneNumber} channel:${peer} membership:${membership}`)

        if (membership === 'not_member') {
          if (joinsThisRun >= CAMPAIGN_ACCOUNT_LIMITS.maxJoinsPerCampaign) {
            await saveCampaignMessage({
              campaignId,
              channelId,
              channelTitle:      ch.title,
              telegramAccountId: account.id,
              accountPhone:      account.phoneNumber,
              joinStatus:        'join_failed',
              status:            'skipped',
              telegramErrorCode: 'JOIN_LIMIT_REACHED',
              errorReason:       `Акаунт досяг ліміту вступів (${CAMPAIGN_ACCOUNT_LIMITS.maxJoinsPerCampaign}) за одну кампанію`,
            })
            res.skipped++
            continue
          }

          await sleep(randDelay(
            CAMPAIGN_ACCOUNT_LIMITS.joinDelayMinMs,
            CAMPAIGN_ACCOUNT_LIMITS.joinDelayMaxMs,
          ))

          try {
            const afterJoin = await tryJoin(client, peer, entity)
            joinsThisRun++
            console.log(`[dispatch] account:${account.phoneNumber} channel:${peer} joined (${afterJoin})`)

            if (afterJoin === 'approval_pending') {
              await saveCampaignMessage({
                campaignId,
                channelId,
                channelTitle:      ch.title,
                telegramAccountId: account.id,
                accountPhone:      account.phoneNumber,
                joinStatus:        'approval_pending',
                membershipStatus:  'approval_pending',
                status:            'waiting_approval',
                errorReason:       'Запит на вступ надіслано — очікується підтвердження адміна каналу',
              })
              res.waitingApproval++
              continue
            }

            joinStatus = 'joined'
            res.joined++
            // Pause after joining before sending
            await sleep(randDelay(
              CAMPAIGN_ACCOUNT_LIMITS.joinDelayMinMs * 2,
              CAMPAIGN_ACCOUNT_LIMITS.joinDelayMaxMs * 2,
            ))
          } catch (joinErr) {
            const reason    = joinErr instanceof Error ? joinErr.message : String(joinErr)
            const floodSec  = extractFloodWaitSeconds(reason)

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
              break
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
              break
            }

            await saveCampaignMessage({
              campaignId, channelId, channelTitle: ch.title,
              telegramAccountId: account.id, accountPhone: account.phoneNumber,
              joinStatus: 'join_failed', status: 'failed',
              telegramErrorCode: extractErrorCode(reason),
              errorReason: `Не вдалося вступити до ${peer}: ${reason}`,
            })
            res.failedJoin++
            await incrementCampaignCounters(campaignId, 'failed_count')
            continue
          }
        } else if (membership === 'approval_pending') {
          await saveCampaignMessage({
            campaignId, channelId, channelTitle: ch.title,
            telegramAccountId: account.id, accountPhone: account.phoneNumber,
            joinStatus: 'approval_pending', membershipStatus: 'approval_pending',
            status: 'waiting_approval',
            errorReason: 'Запит на вступ вже надіслано раніше — очікується підтвердження',
          })
          res.waitingApproval++
          continue
        }
        // else: already_member — joinStatus stays 'already_member'

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

      // ── 3c. Send message ──────────────────────────────────────────────────────
      if (sendsThisRun >= CAMPAIGN_ACCOUNT_LIMITS.maxSendsPerCampaign) {
        await saveCampaignMessage({
          campaignId, channelId, channelTitle: ch.title,
          telegramAccountId: account.id, accountPhone: account.phoneNumber,
          joinStatus,
          status: 'skipped',
          telegramErrorCode: 'SEND_LIMIT_REACHED',
          errorReason: `Акаунт досяг ліміту відправок (${CAMPAIGN_ACCOUNT_LIMITS.maxSendsPerCampaign}) за одну кампанію`,
        })
        res.skipped++
        continue
      }

      await sleep(randDelay(
        CAMPAIGN_ACCOUNT_LIMITS.sendDelayMinMs,
        CAMPAIGN_ACCOUNT_LIMITS.sendDelayMaxMs,
      ))

      try {
        // After joining, the GramJS entity cache may not yet know about the
        // channel, so sendMessage(string peer) can silently fail or throw
        // PEER_ID_INVALID. We re-resolve the entity fresh before every send.
        // If re-resolution fails we fall back to the original peer string.
        let sendPeer: Parameters<typeof client.sendMessage>[0] = peer
        try {
          const freshEntity = await client.getInputEntity(peer)
          if (freshEntity) sendPeer = freshEntity as Parameters<typeof client.sendMessage>[0]
        } catch {
          // fall back to string peer — sendMessage will try to resolve it
        }

        const sendResult = await client.sendMessage(sendPeer, {
          message:   messageText,
          parseMode: undefined,
        })

        const messageId = typeof sendResult?.id === 'number' ? sendResult.id : undefined
        console.log(`[dispatch] account:${account.phoneNumber} channel:${peer} SENT msgId:${messageId ?? '?'}`)

        await saveCampaignMessage({
          campaignId,
          channelId,
          channelTitle:      ch.title,
          telegramAccountId: account.id,
          accountPhone:      account.phoneNumber,
          messageId,
          joinStatus,
          membershipStatus:  'member',
          status:            'sent',
          sentAt:            new Date().toISOString(),
        })
        await incrementCampaignCounters(campaignId, 'sent_count')
        sendsThisRun++
        res.sent++

      } catch (sendErr) {
        const reason   = sendErr instanceof Error ? sendErr.message : String(sendErr)
        const floodSec = extractFloodWaitSeconds(reason)

        if (floodSec !== null) {
          console.warn(`[dispatch] account:${account.phoneNumber} FLOOD_WAIT_${floodSec}s on send`)
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
          break
        }

        const isInvalid =
          reason.includes('USERNAME_INVALID') ||
          reason.includes('CHANNEL_INVALID') ||
          reason.includes('PEER_ID_INVALID') ||
          reason.includes('CHAT_WRITE_FORBIDDEN')

        console.error(`[dispatch] account:${account.phoneNumber} channel:${peer} SEND_FAILED: ${reason}`)

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
    }
  } finally {
    try { await client.disconnect() } catch { /* ignore */ }
  }

  console.log(`[dispatch] account:${account.phoneNumber} done — sent:${res.sent} joined:${res.joined} failed:${res.failedSend} skipped:${res.skipped}`)
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

  // ── Resolve sender accounts ────────��───────────────────────────────────────
  const allUserAccounts = await getTelegramAccounts(campaign.userId)
  console.log(`[dispatch] all user accounts: ${allUserAccounts.length} (userId:${campaign.userId})`)

  const activeAll = allUserAccounts.filter(
    (a) => a.status === 'active' &&
           (!a.floodWaitUntil || new Date(a.floodWaitUntil) <= new Date())
  )
  console.log(`[dispatch] active accounts: ${activeAll.length}`)

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

  // ── Load only the channels selected in this campaign ──────────────────────
  const targetIds  = campaign.targetChannelIds ?? []
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

  // ── Sequential per-account dispatch (avoids parallel rate limiting) ───────
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
      console.error(`[dispatch] account:${account.phoneNumber} unhandled:`, err)
      allFloodResults.push(false)
    }
  }

  // ── Determine final status ────────────────────────────────────────────────
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
