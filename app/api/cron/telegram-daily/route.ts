/**
 * GET /api/cron/telegram-daily
 *
 * Called by Vercel Cron (every 15 min) or any external scheduler.
 * For each user with active campaigns, checks if any scheduled campaign
 * is due and fires dispatch via the worker.
 *
 * Add to vercel.json:
 *   {
 *     "crons": [{ "path": "/api/cron/telegram-daily", "schedule": "* /15 * * * *" }]
 *   }
 *
 * Protect with CRON_SECRET env var (set in Vercel dashboard).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCampaignsDue } from '@/lib/db'
import { config } from '@/lib/config'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  // Verify cron secret
  const secret = process.env.CRON_SECRET ?? ''
  const authHeader = req.headers.get('authorization')
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const now = new Date()
    const due = await getCampaignsDue()

    if (due.length === 0) {
      return NextResponse.json({ ok: true, triggered: 0, message: 'No due campaigns' })
    }

    const workerUrl = config.worker.url
    const workerSecret = process.env.AUTOMATION_SECRET ?? ''

    let triggered = 0
    const errors: string[] = []

    for (const campaign of due) {
      try {
        if (workerUrl && workerSecret) {
          const res = await fetch(`${workerUrl}/campaigns/dispatch`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${workerSecret}`,
            },
            body: JSON.stringify({ campaignId: campaign.id }),
            signal: AbortSignal.timeout(10_000),
          })
          if (!res.ok) {
            const body = await res.text().catch(() => '')
            errors.push(`${campaign.id}: ${res.status} ${body.slice(0, 100)}`)
          } else {
            triggered++
          }
        } else {
          // No worker URL — dispatch inline (dev only)
          const { dispatchCampaign } = await import('@/services/campaign-dispatch.service')
          dispatchCampaign(campaign.id).catch(() => {})
          triggered++
        }
      } catch (err) {
        errors.push(`${campaign.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return NextResponse.json({
      ok: true,
      triggered,
      errors: errors.length > 0 ? errors : undefined,
      checkedAt: now.toISOString(),
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
