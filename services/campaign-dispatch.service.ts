/**
 * services/campaign-dispatch.service.ts
 *
 * Handles dispatching a single campaign:
 *  - Picks the campaign's assigned account (or the user's first active account)
 *  - Joins each target channel via GramJS before sending (tolerates already-member)
 *  - Sends the message via MTProto, records per-channel CampaignMessage rows
 *  - Increments sent/failed counters and marks the campaign completed/failed
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

/** Try to join a channel/group. Tolerates "already a member" errors. */
async function joinChannel(client: TelegramClient, peer: string): Promise<void> {
  try {
    await client.invoke(new Api.channels.JoinChannel({ channel: peer }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Ignore "already in chat" variants
    if (
      msg.includes('USER_ALREADY_PARTICIPANT') ||
      msg.includes('CHANNELS_TOO_MUCH') ||
      msg.includes('CHANNEL_PRIVATE') // can't join private without invite link
    ) return
    throw err
  }
}

/** Dispatch a campaign by ID. Safe to call from the worker loop or directly from the API route. */
export async function dispatchCampaign(campaignId: string): Promise<{
  sent: number
  failed: number
  skipped: number
}> {
  const campaign = await getCampaignById(campaignId)
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)

  // Mark as running
  await updateCampaignStatus(campaignId, 'running')

  let sent = 0, failed = 0, skipped = 0

  // Resolve which Telegram account to use
  let account = campaign.accountId
    ? await getTelegramAccountById(campaign.accountId)
    : null

  if (!account || account.status !== 'active' || !account.sessionString) {
    // Fallback: pick the first active account belonging to the campaign's owner
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
  const channels    = await getTelegramChannels({ limit: 20_000 })
  const channelMap  = new Map(channels.map((c) => [c.id, c]))

  try {
    for (const channelId of campaign.targetChannelIds) {
      const channel = channelMap.get(channelId)

      if (!channel || channel.status !== 'active') {
        await saveCampaignMessage({
          campaignId,
          channelId,
          channelTitle:       channel?.title,
          telegramAccountId:  accountId,
          accountPhone,
          status:      'skipped',
          errorReason: channel ? `Channel status: ${channel.status}` : 'Channel not found',
        })
        skipped++
        continue
      }

      const peer = channel.usernameOrLink.startsWith('@')
        ? channel.usernameOrLink
        : `@${channel.usernameOrLink}`

      try {
        // Join before sending (idempotent — tolerates already-member)
        await joinChannel(client, peer)

        // Send the message
        const result = await client.invoke(new Api.messages.SendMessage({
          peer,
          message:   campaign.messageText,
          noWebpage: true,
        }))

        // Extract the message ID from the update if possible
        let messageId: number | undefined
        const updates = result as unknown as Record<string, unknown>
        if (Array.isArray(updates.updates)) {
          const upd = (updates.updates as Record<string, unknown>[]).find(
            (u) => u._ === 'updateMessageID' || u.id !== undefined
          )
          if (upd?.id) messageId = Number(upd.id)
        }

        await saveCampaignMessage({
          campaignId,
          channelId,
          channelTitle:       channel.title,
          telegramAccountId:  accountId,
          accountPhone,
          messageId,
          status: 'sent',
          sentAt: new Date().toISOString(),
        })
        await incrementCampaignCounters(campaignId, 'sent_count')
        sent++
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        await saveCampaignMessage({
          campaignId,
          channelId,
          channelTitle:       channel.title,
          telegramAccountId:  accountId,
          accountPhone,
          status:      'failed',
          errorReason: reason,
        })
        await incrementCampaignCounters(campaignId, 'failed_count')
        failed++
      }

      // Random delay between sends to avoid flood limits
      const { delayMinSeconds, delayMaxSeconds } = campaign
      const delayMs =
        (delayMinSeconds + Math.random() * (delayMaxSeconds - delayMinSeconds)) * 1_000
      await sleep(delayMs)
    }
  } finally {
    try { await client.disconnect() } catch { /* ignore */ }
  }

  const finalStatus =
    failed === campaign.targetChannelIds.length ? 'failed'
    : sent > 0 || skipped > 0 ? 'completed'
    : 'failed'

  await updateCampaignStatus(campaignId, finalStatus)

  return { sent, failed, skipped }
}
