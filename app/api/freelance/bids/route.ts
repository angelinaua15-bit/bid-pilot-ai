/**
 * GET /api/freelance/bids?userId=xxx
 * Fetches the user's submitted bids from Freelancehunt REST API.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFreelanceAccount } from '@/lib/db';

const FH_BASE = 'https://api.freelancehunt.com/v2';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId') ?? '';
    const page   = searchParams.get('page') ?? '1';

    if (!userId) {
      return NextResponse.json({ ok: false, error: 'userId required', data: [] }, { status: 400 });
    }

    const account = await getFreelanceAccount(userId);
    if (!account?.apiToken) {
      return NextResponse.json(
        { ok: false, error: 'Freelancehunt account not connected', data: [] },
        { status: 401 },
      );
    }

    const qs = new URLSearchParams({ 'page[number]': page, 'page[size]': '50' });

    const res = await fetch(`${FH_BASE}/my/bids?${qs}`, {
      headers: {
        Authorization:  `Bearer ${account.apiToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json(
        { ok: false, error: err?.errors?.[0]?.detail ?? `Freelancehunt API error ${res.status}`, data: [] },
        { status: res.status },
      );
    }

    const json = await res.json();

    const bids = (json?.data ?? []).map((item: Record<string, unknown>) => {
      const attr    = (item.attributes as Record<string, unknown>) ?? {};
      const project = (attr.project as Record<string, unknown>) ?? {};
      return {
        id:        item.id,
        title:     project.name ?? attr.project_id,
        url:       project.url  ?? `https://freelancehunt.com/project/${project.id}`,
        budget:    attr.budget,
        currency:  attr.currency,
        comment:   attr.comment,
        status:    attr.status ?? 'sent',
        createdAt: attr.created_at,
      };
    });

    return NextResponse.json({
      ok: true,
      data: bids,
      total: json?.meta?.pagination?.total ?? bids.length,
    });
  } catch (err) {
    console.error('[GET /api/freelance/bids]', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error', data: [] }, { status: 500 });
  }
}
