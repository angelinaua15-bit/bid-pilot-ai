/**
 * GET /api/stats
 * Returns real-time statistics from Supabase:
 *   - sentTotal:       total bids with status='sent'
 *   - sentToday:       bids submitted today (UTC)
 *   - draftTotal:      bids with status='draft'
 *   - errorCount:      log entries with level='error' in the last 24h
 *   - successCount:    log entries with level='success' in the last 24h
 *
 * Falls back to zeros when the DB is not configured.
 */

import { NextResponse } from 'next/server';
import { getBids, getLogs } from '@/lib/db';

export async function GET() {
  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const [allBids, todayLogs] = await Promise.all([
      getBids({ limit: 200 }),
      getLogs({ limit: 200 }),
    ]);

    const bids = allBids.bids;
    const logs = todayLogs.logs;

    const sentTotal  = bids.filter((b) => b.status === 'sent').length;
    const sentToday  = bids.filter(
      (b) => b.status === 'sent' && b.sentAt && new Date(b.sentAt) >= todayStart
    ).length;
    const draftTotal = bids.filter((b) => b.status === 'draft').length;

    const last24h = Date.now() - 24 * 60 * 60 * 1000;
    const recentLogs = logs.filter((l) => new Date(l.timestamp).getTime() >= last24h);
    const errorCount   = recentLogs.filter((l) => l.level === 'error').length;
    const successCount = recentLogs.filter((l) => l.level === 'success').length;

    return NextResponse.json({
      ok: true,
      data: {
        sentTotal,
        sentToday,
        draftTotal,
        errorCount,
        successCount,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({
      ok: false,
      error: message,
      data: { sentTotal: 0, sentToday: 0, draftTotal: 0, errorCount: 0, successCount: 0 },
    });
  }
}
