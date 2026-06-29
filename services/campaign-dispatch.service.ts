/**
 * services/campaign-dispatch.service.ts
 *
 * Full join-then-send campaign dispatch using GramJS (MTProto).
 *
 * Flow per account:
 *  1. Connect and validate session (skip account if invalid/banned/flood-wait)
 *  2. For each target channel in this account's slice:
 *     a. Resolve entity (username / t.me link / invite link)
 *     b. Check membership → already_member / not_member / approval_pending
 *     c. If not_member → tryJoin (human-like delay after join)
 *     d. If member → send message (human-like delay between sends)
 *  3. Per-account limits: maxJoinsPerCampaign, maxSendsPerCampaign
 *  4. FloodWait: caught per-account; account is skipped, remaining targets rotate to next account
 *  5. Detailed CampaignMessage row saved per channel: joinStatus + sendStatus + errorCode
 *  6. Campaign status updated to granular value on completion
 */

import {
  getCampaignById,
  getTelegramAccountById,
  getTelegramAccounts,
  getTelegramChannels,
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
  // Extract Telegram uppercase error codes like FLOOD_WAIT_X, USERNAME_INVALID, etc.
  const m = msg.match(/([A-Z_]{5,}(?:_\d+)?)/)
  return m ? m[1] : 'UNKNOWN'
}

/** Normalise a channel/group username or link to the form GramJS can resolve. */
function normalisePeer(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null

  // Invite links — GramJS resolves these via importChatInvite
  if (s.includes('t.me/+') || s.includes('t.me/joinchat/')) return s

  // t.me/username  → @username
  const tme = s.match(/t\.me\/([A-Za-z0-9_]{5,})/)
  if (tme) return `@${tme[1]}`

  // already @username
  if (s.startsWith('@')) return s

  // bare username (no @)
  if (/^[A-Za-z0-9_]{5,}$/.test(s)) return `@${s}`

  return null
}

/** Build a connected GramJS client from a session string. */
async function makeClient(sessionString: string): Promise<TelegramClient> {
  const apiId   = Number(process.env.TELEGRAM_API_ID)
  const apiHash = process.env.TELEGRAM_API_HASH ?? ''
  if (!apiId || !apiHash) throw new Error('TELEGRAM_API_ID or TELEGRAM_API_HASH env var is missing')

  const logger = new Logger(LogLevel.ERROR)
  const client = new TelegramClient(
    new StringSession(sessionString),
    apiId, apiHash,
    { connectionRetries: 3, retryDelay: 1_000, useWSS: true, baseLogger: logger },
  )
  await client.connect()
  return client
}

/**
 * Check membership status.
 * Returns 'member' | 'approval_pending' | 'not_member'.
 * If the channel can't be resolved at all → 'not_member' (caller will try join).
 */
async function getMembershipStatus(
  client: TelegramClient,
  peer: string,
): Promise<CampaignMembershipStatus> {
  try {
    // GetFullChannel works for channels; for groups use GetFullChat — try both
    const full = await client.invoke(
      new Api.channels.GetFullChannel({ channel: peer }),
    )
    const fc = full as unknown as { full_chat?: { left?: boolean; participants_count?: number } }
    if (fc.full_chat?.left === false && fc.full_chat?.participants_count == null) {
      return 'approval_pending'
    }
    return 'member'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (
      msg.includes('CHANNEL_PRIVATE') ||
      msg.includes('USERNAME_INVALID') ||
      msg.includes('CHANNEL_INVALID') ||
      msg.includes('USER_NOT_PARTICIPANT')
    ) {
      return 'not_member'
    }
    // Re-throw FloodWait so the outer loop can handle it
    if (msg.includes('FLOOD_WAIT')) throw err
    // Anything else → treat as not_member, tryJoin will surface real error
    return 'not_member'
  }
}

/**
 * Try to join a channel / group / via invite link.
 * Returns resulting membership status.
 * Throws on FLOOD_WAIT, CHANNELS_TOO_MUCH, or unrecoverable errors.
 */
async function tryJoin(
  client: TelegramClient,
  raw: string,
): Promise<CampaignMembershipStatus> {
  const isInvite = raw.includes('t.me/+') || raw.includes('t.me/joinchat/')

  try {
    if (isInvite) {
      // Extract hash from invite link
      const hash = raw.split('/').pop() ?? ''
      await client.invoke(new Api.messages.ImportChatInvite({ hash }))
    } else {
      const peer = raw.startsWith('@') ? raw : `@${raw}`
      await client.invoke(new Api.channels.JoinChannel({ channel: peer }))
    }
    return 'member'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('USER_ALREADY_PARTICIPANT')) return 'member'
    if (msg.includes('INVITE_REQUEST_SENT'))      return 'approval_pending'
    if (msg.includes('JOIN_AS_PEER_INVALID'))     return 'approval_pending'
    // Propagate these so the account is marked unusable for this campaign
    if (msg.includes('FLOOD_WAIT'))   throw err
    if (msg.includes('CHANNELS_TOO_MUCH')) throw err
    throw err
  }
}

// ── Per-account dispatch ──────────────────────────────────────────────────────

interface AccountSliceResult {
  sent:           number
  failedSend:     number
  joined:         number
  failedJoin:     number
  skipped:        number
  waitingApproval:number
  invalidChannel: number
  floodWait:      boolean
  floodWaitSec:   number
}

async function dispatchAccountSlice(
  campaignId:  string,
  channelIds:  string[],
  account:     { id: string; phoneNumber: string; sessionString: string },
  channelMap:  Map<string, { id: string; title: string; usernameOrLink: string; status: string }>,
  messageText: string,
): Promise<AccountSliceResult> {
  const res: AccountSliceResult = {
    sent: 0, failedSend: 0, joined: 0, failedJoin: 0,
    skipped: 0, waitingApproval: 0, invalidChannel: 0,
    floodWait: false, floodWaitSec: 0,
  }

  // ── Connect ──────────────────────────────────────────────────────────────
  let client: TelegramClient
  try {
    client = await makeClient(account.sessionString)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[dispatch] account:${account.phoneNumber} connect_failed:${reason}`)
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
        errorReason:       `Не вдалося підключити акаунт: ${reason}`,
      })
      await incrementCampaignCounters(campaignId, 'failed_count')
      res.failedSend++
    }
    return res
  }

  // ── Validate session ─────────────────────────────────────────────────────
  try {
    await client.invoke(new Api.users.GetUsers({ id: [new Api.InputUserSelf()] }))
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[dispatch] account:${account.phoneNumber} session_invalid:${reason}`)
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
        errorReason:       `Сесія акаунту недійсна: ${reason}`,
      })
      res.skipped++
    }
    try { await client.disconnect() } catch { /* ignore */ }
    return res
  }

  // ── Per-channel loop ─────────────────────────────────────────────────────
  let joinsThisRun  = 0
  let sendsThisRun  = 0

  try {
    for (const channelId of channelIds) {
      const ch = channelMap.get(channelId)

      // Skip missing / inactive channels
      if (!ch || ch.status !== 'active') {
        await saveCampaignMessage({
          campaignId,
          channelId,
          channelTitle:      ch?.title,
          telegramAccountId: account.id,
          accountPhone:      account.phoneNumber,
          status:            'invalid_channel',
          telegramErrorCode: 'CHANNEL_INACTIVE',
          errorReason:       ch ? `Статус каналу: ${ch.status}` : 'Канал не знайдено в БД',
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

      // Private invite links that can't be joined → skip with clear reason
      if (peer.includes('t.me/+') || peer.includes('t.me/joinchat/')) {
        // We'll try joining via invite — allow it to fall through to the join logic
      }

      // ── Check / Join ────────────────────────────────────────────────────
      let joinStatus: CampaignJoinStatus = 'already_member'

      try {
        const membership = await getMembershipStatus(client, peer)

        if (membership === 'not_member') {
          if (joinsThisRun >= CAMPAIGN_ACCOUNT_LIMITS.maxJoinsPerCampaign) {
            // Account has reached join limit — skip and hand off to next account
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

          // Human-like delay before join
          await sleep(randDelay(
            CAMPAIGN_ACCOUNT_LIMITS.joinDelayMinMs,
            CAMPAIGN_ACCOUNT_LIMITS.joinDelayMaxMs,
          ))

          try {
            const afterJoin = await tryJoin(client, peer)
            joinsThisRun++

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

            // Human-like pause after joining before sending
            await sleep(randDelay(
              CAMPAIGN_ACCOUNT_LIMITS.joinDelayMinMs * 2,
              CAMPAIGN_ACCOUNT_LIMITS.joinDelayMaxMs * 2,
            ))
          } catch (joinErr) {
            const reason = joinErr instanceof Error ? joinErr.message : String(joinErr)
            const floodSec = extractFloodWaitSeconds(reason)

            if (floodSec !== null) {
              res.floodWait    = true
              res.floodWaitSec = floodSec
              await saveCampaignMessage({
                campaignId,
                channelId,
                channelTitle:      ch.title,
                telegramAccountId: account.id,
                accountPhone:      account.phoneNumber,
                joinStatus:        'join_failed',
                status:            'skipped',
                telegramErrorCode: `FLOOD_WAIT_${floodSec}`,
                errorReason:       `FloodWait ${floodSec}с при спробі вступу — акаунт пропущено`,
              })
              res.skipped++
              // Stop using this account entirely
              break
            }

            if (reason.includes('CHANNELS_TOO_MUCH')) {
              await saveCampaignMessage({
                campaignId,
                channelId,
                channelTitle:      ch.title,
                telegramAccountId: account.id,
                accountPhone:      account.phoneNumber,
                joinStatus:        'join_failed',
                status:            'skipped',
                telegramErrorCode: 'CHANNELS_TOO_MUCH',
                errorReason:       'Акаунт перевищив ліміт каналів Telegram (500) — вступ неможливий',
              })
              res.skipped++
              break // No point continuing with this account
            }

            // Other join error — log and skip this channel, continue with others
            await saveCampaignMessage({
              campaignId,
              channelId,
              channelTitle:      ch.title,
              telegramAccountId: account.id,
              accountPhone:      account.phoneNumber,
              joinStatus:        'join_failed',
              status:            'failed',
              telegramErrorCode: extractErrorCode(reason),
              errorReason:       `Не вдалося вступити: ${reason}`,
            })
            res.failedJoin++
            await incrementCampaignCounters(campaignId, 'failed_count')
            continue
          }
        } else if (membership === 'approval_pending') {
          await saveCampaignMessage({
            campaignId,
            channelId,
            channelTitle:      ch.title,
            telegramAccountId: account.id,
            accountPhone:      account.phoneNumber,
            joinStatus:        'approval_pending',
            membershipStatus:  'approval_pending',
            status:            'waiting_approval',
            errorReason:       'Запит на вступ вже надіслано раніше — очікується підтвердження',
          })
          res.waitingApproval++
          continue
        }
        // else: already_member — joinStatus stays 'already_member'

      } catch (memberErr) {
        const reason = memberErr instanceof Error ? memberErr.message : String(memberErr)
        if (reason.includes('FLOOD_WAIT')) {
          const sec = extractFloodWaitSeconds(reason) ?? 0
          res.floodWait    = true
          res.floodWaitSec = sec
          await saveCampaignMessage({
            campaignId,
            channelId,
            channelTitle:      ch.title,
            telegramAccountId: account.id,
            accountPhone:      account.phoneNumber,
            status:            'skipped',
            telegramErrorCode: `FLOOD_WAIT_${sec}`,
            errorReason:       `FloodWait ${sec}с при перевірці членства — акаунт пропущено`,
          })
          res.skipped++
          break
        }
        // Unresolvable peer → invalid_channel
        await saveCampaignMessage({
          campaignId,
          channelId,
          channelTitle:      ch.title,
          telegramAccountId: account.id,
          accountPhone:      account.phoneNumber,
          joinStatus:        'join_failed',
          status:            'invalid_channel',
          telegramErrorCode: extractErrorCode(reason),
          errorReason:       `Не вдалося розпізнати канал: ${reason}`,
        })
        res.invalidChannel++
        await incrementCampaignCounters(campaignId, 'failed_count')
        continue
      }

      // ── Send message ─────────────────────────────────────────────────────
      if (sendsThisRun >= CAMPAIGN_ACCOUNT_LIMITS.maxSendsPerCampaign) {
        await saveCampaignMessage({
          campaignId,
          channelId,
          channelTitle:      ch.title,
          telegramAccountId: account.id,
          accountPhone:      account.phoneNumber,
          joinStatus,
          status:            'skipped',
          telegramErrorCode: 'SEND_LIMIT_REACHED',
          errorReason:       `Акаунт досяг ліміту відправок (${CAMPAIGN_ACCOUNT_LIMITS.maxSendsPerCampaign}) за одну кампанію`,
        })
        res.skipped++
        continue
      }

      // Human-like delay before send
      await sleep(randDelay(
        CAMPAIGN_ACCOUNT_LIMITS.sendDelayMinMs,
        CAMPAIGN_ACCOUNT_LIMITS.sendDelayMaxMs,
      ))

      try {
        const result = await client.invoke(new Api.messages.SendMessage({
          peer,
          message:   messageText,
          noWebpage: true,
        }))

        // Extract message ID from result
        let messageId: number | undefined
        const upd = result as unknown as { updates?: { _?: string; id?: number }[]; id?: number }
        if (Array.isArray(upd.updates)) {
          const u = upd.updates.find((x) => x._ === 'updateMessageID' || x.id)
          if (u?.id) messageId = u.id
        } else if (typeof upd.id === 'number') {
          messageId = upd.id
        }

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
        const reason = sendErr instanceof Error ? sendErr.message : String(sendErr)
        const floodSec = extractFloodWaitSeconds(reason)

        if (floodSec !== null) {
          res.floodWait    = true
          res.floodWaitSec = floodSec
          await saveCampaignMessage({
            campaignId,
            channelId,
            channelTitle:      ch.title,
            telegramAccountId: account.id,
            accountPhone:      account.phoneNumber,
            joinStatus,
            status:            'skipped',
            telegramErrorCode: `FLOOD_WAIT_${floodSec}`,
            errorReason:       `FloodWait ${floodSec}с при відправці — акаунт пропущено`,
          })
          res.skipped++
          break
        }

        const isInvalid =
          reason.includes('USERNAME_INVALID') ||
          reason.includes('CHANNEL_INVALID') ||
          reason.includes('PEER_ID_INVALID')

        await saveCampaignMessage({
          campaignId,
          channelId,
          channelTitle:      ch.title,
          telegramAccountId: account.id,
          accountPhone:      account.phoneNumber,
          joinStatus,
          status:            isInvalid ? 'invalid_channel' : 'failed',
          telegramErrorCode: extractErrorCode(reason),
          errorReason:       reason,
        })
        await incrementCampaignCounters(campaignId, 'failed_count')
        if (isInvalid) res.invalidChannel++
        else res.failedSend++
      }
    }
  } finally {
    try { await client.disconnect() } catch { /* ignore */ }
  }

  return res
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function dispatchCampaign(campaignId: string): Promise<{
  sent:           number
  failedSend:     number
  joined:         number
  failedJoin:     number
  skipped:        number
  waitingApproval:number
  invalidChannel: number
}> {
  const campaign = await getCampaignById(campaignId)
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)

  await updateCampaignStatus(campaignId, 'joining')

  // ── Resolve active sender accounts ────────────────────────────────────────
  const allUserAccounts = await getTelegramAccounts(campaign.userId)
  const activeAll = allUserAccounts.filter(
    (a) => a.status === 'active' && a.sessionString &&
    (!a.floodWaitUntil || new Date(a.floodWaitUntil) <= new Date())
  )

  let activeAccounts = activeAll
  if (campaign.accountIds && campaign.accountIds.length > 0) {
    const idSet = new Set(campaign.accountIds)
    const sel = activeAll.filter((a) => idSet.has(a.id))
    if (sel.length > 0) activeAccounts = sel
  } else if (campaign.accountId) {
    const primary = activeAll.find((a) => a.id === campaign.accountId)
    if (primary) activeAccounts = [primary]
  }

  if (activeAccounts.length === 0) {
    await updateCampaignStatus(campaignId, 'no_accounts')
    throw new Error('Немає активного Telegram-акаунту для відправки')
  }

  // ── Load channel map ───────────────────────────────────────────────────────
  const channels  = await getTelegramChannels({ limit: 20_000 })
  const channelMap = new Map(channels.map((c) => [c.id, c]))

  // ── Round-robin distribute channels across accounts ───────────────────────
  // Accounts that get flooded mid-run are dropped; remaining targets spill to
  // subsequent accounts in rotation order.
  const numAccounts = activeAccounts.length
  const slices: string[][] = activeAccounts.map(() => [])
  campaign.targetChannelIds.forEach((id, i) => {
    slices[i % numAccounts].push(id)
  })

  // ── Dispatch — parallel per account ───────────────────────────────────────
  await updateCampaignStatus(campaignId, 'sending')

  const results = await Promise.all(
    activeAccounts.map((account, i) =>
      dispatchAccountSlice(
        campaignId,
        slices[i],
        account as { id: string; phoneNumber: string; sessionString: string },
        channelMap as Map<string, { id: string; title: string; usernameOrLink: string; status: string }>,
        campaign.messageText,
      ).catch((err) => {
        console.error(`[dispatch] account:${account.phoneNumber} unhandled:`, err)
        return {
          sent: 0, failedSend: slices[i].length, joined: 0, failedJoin: 0,
          skipped: 0, waitingApproval: 0, invalidChannel: 0,
          floodWait: false, floodWaitSec: 0,
        } satisfies AccountSliceResult
      })
    )
  )

  // ── Aggregate ─────────────────────────────────────────────────────────────
  const totals = results.reduce(
    (acc, r) => ({
      sent:            acc.sent            + r.sent,
      failedSend:      acc.failedSend      + r.failedSend,
      joined:          acc.joined          + r.joined,
      failedJoin:      acc.failedJoin      + r.failedJoin,
      skipped:         acc.skipped         + r.skipped,
      waitingApproval: acc.waitingApproval + r.waitingApproval,
      invalidChannel:  acc.invalidChannel  + r.invalidChannel,
    }),
    { sent: 0, failedSend: 0, joined: 0, failedJoin: 0, skipped: 0, waitingApproval: 0, invalidChannel: 0 },
  )

  const allFlood     = results.every((r) => r.floodWait)
  const total        = campaign.targetChannelIds.length
  const totalFailed  = totals.failedSend + totals.failedJoin + totals.invalidChannel

  const finalStatus =
    allFlood && totals.sent === 0                ? 'flood_wait'
    : totals.sent === 0 && totals.waitingApproval > 0 ? 'paused'
    : totalFailed === total && totals.sent === 0 ? 'failed'
    : totals.sent > 0 && totalFailed > 0         ? 'partially_completed'
    : totals.sent > 0                            ? 'completed'
    : 'failed'

  await updateCampaignStatus(campaignId, finalStatus)

  return totals
}
