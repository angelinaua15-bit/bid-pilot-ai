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

/** Dispatch a campaign by ID. Safe to call fire-and-forget from an API route. */
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

  let sent = 0, failed = 0, skipped = 0, waitingApproval = 0, invalidChannel = 0

  // Resolve which Telegram account to use
  let account = campaign.accountId
    ? await getTelegramAccountById(campaign.accountId)
    : null

  if (!account || account.status !== 'active' || !account.sessionString) {
    const all = await getTelegramAccounts(campaign.userId)
    account = all.find((a) => a.status === 'active' && a.sessionString) ?? null
  }

  if (!account || !account.sessionString) {
    await updateCampaignStatus(campaignId, 'failed')
    throw new Error('Немає активного Telegram-акаунту для відправки')
  }

  const accountId    = account.id
  const accountPhone = account.phoneNumber
  let client: TelegramClient | null = null

  try {
    client = await makeClient(account.sessionString)
  } catch (err) {
    await updateCampaignStatus(campaignId, 'failed')
    throw err
  }

  // Load channel map
  const channels   = await getTelegramChannels({ limit: 20_000 })
  const channelMap = new Map(channels.map((c) => [c.id, c]))

  try {
    for (const channelId of campaign.targetChannelIds) {
      const channel = channelMap.get(channelId)

      // Channel not in our DB or not active
      if (!channel || channel.status !== 'active') {
        await saveCampaignMessage({
          campaignId,
          channelId,
          channelTitle:      channel?.title,
          telegramAccountId: accountId,
          accountPhone,
          status:      'invalid_channel',
          errorReason: channel ? `Channel status: ${channel.status}` : 'Channel not found in DB',
        })
        invalidChannel++
        await incrementCampaignCounters(campaignId, 'failed_count')
        continue
      }

      const peer = channel.usernameOrLink.startsWith('@')
        ? channel.usernameOrLink
        : `@${channel.usernameOrLink}`

      try {
        // 1. Check membership
        let membership = await getMembershipStatus(client, peer).catch(() => 'not_member' as const)

        // 2. Try to join if not a member
        if (membership === 'not_member') {
          membership = await tryJoinChannel(client, peer)
        }

        // 3. If join result is approval_pending — can't send yet, record and move on
        if (membership === 'approval_pending') {
          await saveCampaignMessage({
            campaignId,
            channelId,
            channelTitle:      channel.title,
            telegramAccountId: accountId,
            accountPhone,
            membershipStatus:  'approval_pending',
            status:            'waiting_approval',
            errorReason:       'Запит на вступ надіслано, очікується підтвердження адміна',
          })
          waitingApproval++
          continue
        }

        // 4. Send the message
        const result = await client.invoke(new Api.messages.SendMessage({
          peer,
          message:   campaign.messageText,
          noWebpage: true,
        }))

        const messageId = extractMessageId(result)

        await saveCampaignMessage({
          campaignId,
          channelId,
          channelTitle:      channel.title,
          telegramAccountId: accountId,
          accountPhone,
          messageId,
          membershipStatus:  'member',
          status:            'sent',
          sentAt:            new Date().toISOString(),
        })
        await incrementCampaignCounters(campaignId, 'sent_count')
        sent++
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)

        // Determine whether the error means the channel is inaccessible
        const isInvalidChannel =
          reason.includes('USERNAME_INVALID') ||
          reason.includes('CHANNEL_INVALID') ||
          reason.includes('PEER_ID_INVALID')

        await saveCampaignMessage({
          campaignId,
          channelId,
          channelTitle:      channel.title,
          telegramAccountId: accountId,
          accountPhone,
          status:      isInvalidChannel ? 'invalid_channel' : 'failed',
          errorReason: reason,
        })
        await incrementCampaignCounters(campaignId, 'failed_count')
        if (isInvalidChannel) invalidChannel++
        else failed++
      }

      // Randomised delay between sends to stay under Telegram flood limits
      const { delayMinSeconds, delayMaxSeconds } = campaign
      const delayMs =
        (delayMinSeconds + Math.random() * (delayMaxSeconds - delayMinSeconds)) * 1_000
      await sleep(delayMs)
    }
  } finally {
    try { await client.disconnect() } catch { /* ignore */ }
  }

  const totalProcessed = sent + failed + invalidChannel
  const finalStatus =
    totalProcessed === 0 && waitingApproval > 0 ? 'paused'   // all pending approval
    : failed === campaign.targetChannelIds.length ? 'failed'
    : (sent > 0 || skipped > 0) ? 'completed'
    : 'failed'

  await updateCampaignStatus(campaignId, finalStatus)

  return { sent, failed, skipped, waitingApproval, invalidChannel }
}
