/**
 * GET /api/projects?page=1&budgetMin=300&skills=react,node
 * Returns open projects from Freelancehunt via the automation worker.
 *
 * Requires AUTOMATION_WORKER_URL — project scraping never runs on Vercel.
 */

import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';

export async function GET(req: NextRequest) {
  try {
    if (!config.worker.enabled) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Automation worker not configured. Set AUTOMATION_WORKER_URL to fetch real projects.',
          setupRequired: true,
          data: [],
        },
        { status: 503 },
      );
    }

    const { searchParams } = new URL(req.url);
    const qs = new URLSearchParams();
    if (searchParams.get('page'))      qs.set('page',      searchParams.get('page')!);
    if (searchParams.get('budgetMin')) qs.set('budgetMin', searchParams.get('budgetMin')!);
    if (searchParams.get('skills'))    qs.set('skills',    searchParams.get('skills')!);

    const res = await fetch(`${config.worker.url}/projects?${qs}`, {
      headers: { Authorization: `Bearer ${config.worker.secret}` },
      signal: AbortSignal.timeout(30_000),
    });

    const json = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: json.error ?? `Worker HTTP ${res.status}`, data: [] },
        { status: res.status },
      );
    }

    return NextResponse.json({ ok: true, data: json.data ?? json, page: json.page ?? 1 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[GET /api/projects]', message);
    return NextResponse.json({ ok: false, error: message, data: [] }, { status: 500 });
  }
}
