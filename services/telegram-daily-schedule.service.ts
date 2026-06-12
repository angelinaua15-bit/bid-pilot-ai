/**
 * services/telegram-daily-schedule.service.ts
 *
 * Assigns a randomised daily send-window to each Telegram account so that:
 *  - Each account fires once per day at a different time
 *  - Send time is re-randomised every day (seeded on date + account ID)
 *  - Multiple accounts within the same user don't send at the same minute
 *  - A random per-message delay is added during dispatch (already in campaign-dispatch.service.ts)
 *
 * How it works:
 *  1. The cron route /api/cron/telegram-daily calls `getDueCampaigns()`
 *  2. For every "scheduled" or "draft" campaign whose assignedSendAt is <= now, dispatch.
 *  3. `assignDailySchedule()` is called when a campaign is created with scheduleType='interval'
 *     — it writes a randomised `scheduled_at` for today (or tomorrow if today's window is over).
 */

import { getCampaigns, updateCampaignStatus } from '../lib/db'

/** Kyiv timezone offset in minutes from UTC (UTC+3) */
const KYIV_OFFSET_HOURS = 3

/**
 * Deterministic-but-daily-varying random float in [0, 1).
 * Seeded on: ISO date string + accountId (or campaignId).
 * Same seed → same number; different day → different number.
 */
function dailySeed(dateStr: string, id: string): number {
  // Simple hash: djb2-style, sufficient for schedule jitter
  let h = 5381
  const s = dateStr + id
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i)
    h = h >>> 0 // keep unsigned 32-bit
  }
  return h / 0xffffffff
}

/**
 * Returns the ISO send-time for a given account/campaign for today.
 * Window: 08:00–22:00 Kyiv time, segmented so different accounts
 * don't cluster on the same minute.
 *
 * @param accountIndex  0-based index of this account among the user's accounts
 * @param totalAccounts total active accounts the user has
 * @param entityId      account.id or campaign.id used as seed
 */
export function computeDailySendTime(
  accountIndex: number,
  totalAccounts: number,
  entityId: string,
  referenceDate?: Date,
): Date {
  const now = referenceDate ?? new Date()

  // Today in Kyiv
  const kyivOffsetMs = KYIV_OFFSET_HOURS * 60 * 60 * 1000
  const kyivNow = new Date(now.getTime() + kyivOffsetMs)
  const dateStr = kyivNow.toISOString().slice(0, 10) // "YYYY-MM-DD"

  // Window: 08:00 – 22:00 Kyiv = 840 minutes
  const windowStartMinutes = 8 * 60   // 480 min from midnight
  const windowEndMinutes   = 22 * 60  // 1320 min from midnight
  const windowDuration     = windowEndMinutes - windowStartMinutes // 840 min

  // Split window evenly across accounts so they don't all fire at once
  const slotSize = totalAccounts > 0 ? Math.floor(windowDuration / totalAccounts) : windowDuration
  const slotStart = windowStartMinutes + accountIndex * slotSize

  // Jitter within this account's slot (up to slotSize - 1 minutes)
  const jitter = Math.floor(dailySeed(dateStr, entityId) * Math.max(1, slotSize - 1))
  const sendMinutesFromMidnight = slotStart + jitter

  // Build UTC send time
  const kyivMidnight = new Date(
    Date.UTC(
      kyivNow.getUTCFullYear(),
      kyivNow.getUTCMonth(),
      kyivNow.getUTCDate(),
      0 - KYIV_OFFSET_HOURS, // midnight Kyiv = 21:00 prev day UTC
      0, 0, 0,
    ),
  )

  const sendUTC = new Date(kyivMidnight.getTime() + sendMinutesFromMidnight * 60 * 1000)

  // If today's window has passed, schedule for tomorrow
  if (sendUTC <= now) {
    sendUTC.setUTCDate(sendUTC.getUTCDate() + 1)
  }

  return sendUTC
}

/**
 * Returns all campaigns that:
 *  - have status 'scheduled'
 *  - have scheduled_at <= now
 */
export async function getDueCampaigns(userId: string): Promise<string[]> {
  try {
    const campaigns = await getCampaigns(userId)
    const now = new Date()
    return campaigns
      .filter(
        (c) =>
          c.status === 'scheduled' &&
          c.scheduledAt &&
          new Date(c.scheduledAt) <= now,
      )
      .map((c) => c.id)
  } catch {
    return []
  }
}

/**
 * Mark campaigns whose scheduled_at is overdue as 'running' so the cron dispatcher picks them up.
 * Returns the list of campaign IDs that were triggered.
 */
export async function triggerDueCampaigns(userId: string): Promise<string[]> {
  const dueIds = await getDueCampaigns(userId)
  for (const id of dueIds) {
    await updateCampaignStatus(id, 'running').catch(() => {})
  }
  return dueIds
}
