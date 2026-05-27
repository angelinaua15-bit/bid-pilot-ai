/**
 * GET /api/applications?status=sent|sent_unconfirmed|skipped|failed|all&limit=50
 *
 * Returns worker-processed application records from the database.
 * No mock/demo data — only real applications saved by the orchestrator.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getApplications } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 500);
    const rawStatus = searchParams.get('status') ?? 'sent';

    // Validate status param — includes sent_unconfirmed
    const validStatuses = ['sent', 'sent_unconfirmed', 'skipped', 'failed', 'all'] as const;
    type StatusParam = typeof validStatuses[number];
    const status: StatusParam = (validStatuses as readonly string[]).includes(rawStatus)
      ? (rawStatus as StatusParam)
      : 'sent';

    const { applications, total } = await getApplications({ limit, status });

    return NextResponse.json({ ok: true, data: applications, total, status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
