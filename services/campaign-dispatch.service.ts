/**
 * services/campaign-dispatch.service.ts
 *
 * Handles dispatching a single campaign:
 *  - Iterates over targetChannelIds with a random delay between sends
 *  - Uses MTProto (GramJS) when campaign.accountId is set with an active session
 *  - Falls back to Telegram Bot API otherwise
 *  - Records per-channel CampaignMessage rows + increments sent/failed counters
 */

import {
  getCampaignById,
  getTelegramAccountById,
  getTelegramChannels,
  updateCampaignStatus,
  saveCampaignMessage,
  incrementCampaignCounters,
} from '../lib/db'
import { sendMessageMTProto } from './telegram-mtproto.service'
import { sendTelegramMessage } from './telegram.service'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Dispatch a campaign by ID. Safe to call from the worker loop. */
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

  // Resolve MTProto session if an accountId is set
  let sessionString: string | undefined
  if (campaign.accountId) {
    const account = await getTelegramAccountById(campaign.accountId)
    if (account?.status === 'active' && account.sessionString) {
      sessionString = account.sessionString
    }
  }

  // Load channel usernameOrLink map (batch load — channels can be many)
  const channels = await getTelegramChannels({ limit: 20_000 })
  const channelMap = new Map(channels.map((c) => [c.id, c]))

  for (const channelId of campaign.targetChannelIds) {
    const channel = channelMap.get(channelId)

    if (!channel || channel.status !== 'active') {
      await saveCampaignMessage({
        campaignId,
        channelId,
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
      if (sessionString) {
        await sendMessageMTProto(sessionString, peer, campaign.messageText)
      } else {
        // Bot API fallback: resolve numeric chatId from username is not trivial
        // via Bot API; send via sendMessage using the username as chat_id string
        // (works for public channels where the bot is admin)
        const chatIdStr = peer.startsWith('@') ? peer : `@${channel.usernameOrLink}`
        await sendTelegramMessage(chatIdStr as unknown as number, campaign.messageText)
      }

      await saveCampaignMessage({
        campaignId,
        channelId,
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

  const finalStatus =
    failed === campaign.targetChannelIds.length ? 'failed'
    : sent > 0 || skipped > 0 ? 'completed'
    : 'failed'

  await updateCampaignStatus(campaignId, finalStatus)

  return { sent, failed, skipped }
}
