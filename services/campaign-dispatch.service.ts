/**
 * services/campaign-dispatch.service.ts
 *
 * Dispatches a single campaign via MTProto (GramJS):
 *  - Resolves which Telegram account to use
 *  - For each target channel:
 *    1. Checks membership status (member / approval_pending / not_member)
 *    2. Attempts to join if not a member
 *    3. Sends the message; records per-channel CampaignMessage rows
 *       with status: sent | waiting_approval | invalid_channel | failed | skipped
 *  - Marks campaign completed / failed when done
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
import { CampaignMembershipStatus } from '../types'
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { Api } from 'telegram/tl'
import { Logger, LogLevel } from 'telegram/extensions/Logger.js'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Build a connected GramJS client from a session string. */
async function makeClient(sessionString: string): Promise<TelegramClient> {
  const apiId   = Number(process.env.TELEGRAM_API_ID)
  const apiHash = process.env.TELEGRAM_API_HASH ?? ''
  if (!apiId || !apiHash) throw new Error('TELEGRAM_API_ID or TELEGRAM_API_HASH env var is missing')

  const logger = new Logger(LogLevel.ERROR)
  const client = new TelegramClient(
    new StringSession(sessionString),
    apiId,
    apiHash,
    { connectionRetries: 3, retryDelay: 1000, useWSS: false, baseLogger: logger },
  )
  await client.connect()
  return client
}

/**
 * Check the account's membership status in a channel.
 * Returns 'member' | 'approval_pending' | 'not_member'.
 * If the channel can't be resolved at all, throws.
 */
async function getMembershipStatus(
  client: TelegramClient,
  peer: string,
): Promise<CampaignMembershipStatus> {
  try {
    const full = await client.invoke(
      new Api.channels.GetFullChannel({ channel: peer }),
    )
    const chat = (full as unknown as Record<string, unknown>).full_chat as Record<string, unknown> | undefined
    // If the bot/user requested to join but hasn't been approved yet
    if (chat?.left === false && chat?.participants_count == null) {
      return 'approval_pending'
    }
    return 'member'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('CHANNEL_PRIVATE') || msg.includes('USERNAME_INVALID')) {
      // Not a member — we can try joining
      return 'not_member'
    }
    throw err
  }
}

/**
 * Try to join a channel/group.
 * Returns the resulting membership status after the attempt.
 */
async function tryJoinChannel(
  client: TelegramClient,
  peer: string,
): Promise<CampaignMembershipStatus> {
  try {
    await client.invoke(new Api.channels.JoinChannel({ channel: peer }))
    return 'member'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('USER_ALREADY_PARTICIPANT')) return 'member'
    if (msg.includes('CHANNELS_TOO_MUCH'))        throw err
    if (
      msg.includes('INVITE_REQUEST_SENT') ||
      msg.includes('JOIN_AS_PEER_INVALID')
    ) return 'approval_pending'
    // Any other error — can't join
    throw err
  }
}

/** Extract Telegram message ID from the raw update object. */
function extractMessageId(result: unknown): number | undefined {
  const updates = result as Record<string, unknown>
  if (Array.isArray(updates.updates)) {
    const upd = (updates.updates as Record<string, unknown>[]).find(
      (u) => u._ === 'updateMessageID' || u.id !== undefined,
    )
    if (upd?.id) return Number(upd.id)
  }
  if (typeof updates.id === 'number') return updates.id
  return undefined
}

/**
 * Send one slice of channels using a single Telegram account.
 * Returns per-slice counters.
 */
async function dispatchSlice(
  campaignId: string,
  channelIds: string[],
  account: { id: string; phoneNumber: string; sessionString: string },
  channelMap: Map<string, { id: string; title: string; usernameOrLink: string; status: string }>,
  delayMinSeconds: number,
  delayMaxSeconds: number,
  messageText: string,
): Promise<{ sent: number; failed: number; skipped: number; waitingApproval: number; invalidChannel: number }> {
  let sent = 0, failed = 0, skipped = 0, waitingApproval = 0, invalidChannel = 0

  let client: TelegramClient | null = null
  try {
    client = await makeClient(account.sessionString)
  } catch (err) {
    // Can't connect — mark all channels in this slice as failed
    for (const channelId of channelIds) {
      const channel = channelMap.get(channelId)
      await saveCampaignMessage({
        campaignId,
        channelId,
        channelTitle:      channel?.title,
        telegramAccountId: account.id,
        accountPhone:      account.phoneNumber,
        status:            'failed',
        errorReason:       `Account connect failed: ${err instanceof Error ? err.message : String(err)}`,
      })
      await incrementCampaignCounters(campaignId, 'failed_count')
      failed++
    }
    return { sent, failed, skipped, waitingApproval, invalidChannel }
  }

  try {
    for (const channelId of channelIds) {
      const channel = channelMap.get(channelId)

      if (!channel || channel.status !== 'active') {
        await saveCampaignMessage({
          campaignId,
          channelId,
          channelTitle:      channel?.title,
          telegramAccountId: account.id,
          accountPhone:      account.phoneNumber,
          status:            'invalid_channel',
          errorReason:       channel ? `Channel status: ${channel.status}` : 'Channel not found in DB',
        })
        invalidChannel++
        await incrementCampaignCounters(campaignId, 'failed_count')
        continue
      }

      const peer = channel.usernameOrLink.startsWith('@')
        ? channel.usernameOrLink
        : `@${channel.usernameOrLink}`

      try {
        let membership = await getMembershipStatus(client, peer).catch(() => 'not_member' as const)
        if (membership === 'not_member') {
          membership = await tryJoinChannel(client, peer)
        }

        if (membership === 'approval_pending') {
          await saveCampaignMessage({
            campaignId,
            channelId,
            channelTitle:      channel.title,
            telegramAccountId: account.id,
            accountPhone:      account.phoneNumber,
            membershipStatus:  'approval_pending',
            status:            'waiting_approval',
            errorReason:       'Запит на вступ надіслано, очікується підтвердження адміна',
          })
          waitingApproval++
          continue
        }

        const result = await client.invoke(new Api.messages.SendMessage({
          peer,
          message:   messageText,
          noWebpage: true,
        }))

        const messageId = extractMessageId(result)

        await saveCampaignMessage({
          campaignId,
          channelId,
          channelTitle:      channel.title,
          telegramAccountId: account.id,
          accountPhone:      account.phoneNumber,
          messageId,
          membershipStatus:  'member',
          status:            'sent',
          sentAt:            new Date().toISOString(),
        })
        await incrementCampaignCounters(campaignId, 'sent_count')
        sent++
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        const isInvalidChannel =
          reason.includes('USERNAME_INVALID') ||
          reason.includes('CHANNEL_INVALID') ||
          reason.includes('PEER_ID_INVALID')

        await saveCampaignMessage({
          campaignId,
          channelId,
          channelTitle:      channel.title,
          telegramAccountId: account.id,
          accountPhone:      account.phoneNumber,
          status:            isInvalidChannel ? 'invalid_channel' : 'failed',
          errorReason:       reason,
        })
        await incrementCampaignCounters(campaignId, 'failed_count')
        if (isInvalidChannel) invalidChannel++
        else failed++
      }

      const delayMs = (delayMinSeconds + Math.random() * (delayMaxSeconds - delayMinSeconds)) * 1_000
      await sleep(delayMs)
    }
  } finally {
    try { await client.disconnect() } catch { /* ignore */ }
  }

  return { sent, failed, skipped, waitingApproval, invalidChannel }
}

/** Dispatch a campaign by ID. Rotates channels across all selected accounts. */
export async function dispatchCampaign(campaignId: string): Promise<{
  sent: number
  failed: number
  skipped: number
  waitingApproval: number
  invalidChannel: number
}> {
  const campaign = await getCampaignById(campaignId)
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)

  await updateCampaignStatus(campaignId, 'running')

  // ── Resolve active sender accounts ────────────────────────────────────────
  const allUserAccounts = await getTelegramAccounts(campaign.userId)
  const activeAll       = allUserAccounts.filter((a) => a.status === 'active' && a.sessionString)

  // Use campaign.accountIds if set, otherwise fall back to campaign.accountId,
  // otherwise use all active accounts for the user.
  let activeAccounts = activeAll
  if (campaign.accountIds && campaign.accountIds.length > 0) {
    const idSet = new Set(campaign.accountIds)
    activeAccounts = activeAll.filter((a) => idSet.has(a.id))
    // If none of the selected accounts are active, fall back to all
    if (activeAccounts.length === 0) activeAccounts = activeAll
  } else if (campaign.accountId) {
    const primary = activeAll.find((a) => a.id === campaign.accountId)
    if (primary) activeAccounts = [primary]
  }

  if (activeAccounts.length === 0) {
    await updateCampaignStatus(campaignId, 'failed')
    throw new Error('Немає активного Telegram-акаунту для відправки')
  }

  // ── Split channels evenly across accounts ─────────────────────────────────
  const totalChannels = campaign.targetChannelIds.length
  const numAccounts   = activeAccounts.length
  const slices: string[][] = activeAccounts.map(() => [])

  campaign.targetChannelIds.forEach((id, i) => {
    slices[i % numAccounts].push(id)
  })

  // ── Load channel map ───────────────────────────────────────────────────────
  const channels   = await getTelegramChannels({ limit: 20_000 })
  const channelMap = new Map(channels.map((c) => [c.id, c]))

  // ── Dispatch all slices in parallel ───────────────────────────────────────
  const results = await Promise.all(
    activeAccounts.map((account, i) =>
      dispatchSlice(
        campaignId,
        slices[i],
        account as { id: string; phoneNumber: string; sessionString: string },
        channelMap as Map<string, { id: string; title: string; usernameOrLink: string; status: string }>,
        campaign.delayMinSeconds,
        campaign.delayMaxSeconds,
        campaign.messageText,
      ),
    ),
  )

  // ── Aggregate counters ─────────────────────────────────────────────────────
  const totals = results.reduce(
    (acc, r) => ({
      sent:           acc.sent           + r.sent,
      failed:         acc.failed         + r.failed,
      skipped:        acc.skipped        + r.skipped,
      waitingApproval:acc.waitingApproval + r.waitingApproval,
      invalidChannel: acc.invalidChannel  + r.invalidChannel,
    }),
    { sent: 0, failed: 0, skipped: 0, waitingApproval: 0, invalidChannel: 0 },
  )

  const finalStatus =
    totals.sent === 0 && totals.waitingApproval > 0 ? 'paused'
    : totals.failed === totalChannels               ? 'failed'
    : (totals.sent > 0 || totals.skipped > 0)       ? 'completed'
    : 'failed'

  await updateCampaignStatus(campaignId, finalStatus)

  return totals
}
