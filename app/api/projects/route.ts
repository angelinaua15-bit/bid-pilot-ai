/**
 * GET /api/projects?userId=xxx&page=1&budgetMin=300&skills=react,node
 * Fetches open projects from Freelancehunt REST API directly using the stored token.
 * No worker required — Freelancehunt has a proper REST API.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFreelanceAccount } from '@/lib/db';

const FH_BASE = 'https://api.freelancehunt.com/v2';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId    = searchParams.get('userId') ?? '';
    const page      = searchParams.get('page') ?? '1';
    const budgetMin = searchParams.get('budgetMin');
    const skills    = searchParams.get('skills');

    // Get the user's stored Freelancehunt token
    let token: string | undefined;
    if (userId) {
      const account = await getFreelanceAccount(userId);
      token = account?.apiToken;
    }

    if (!token) {
      return NextResponse.json(
        { ok: false, error: 'Freelancehunt account not connected. Please connect your account first.', data: [] },
        { status: 401 },
      );
    }

    // Build Freelancehunt API query
    const qs = new URLSearchParams({ 'page[number]': page, 'page[size]': '20' });
    if (budgetMin) qs.set('filter[budget_from]', budgetMin);
    if (skills)    qs.set('filter[skills]', skills);

    const res = await fetch(`${FH_BASE}/projects?${qs}`, {
      headers: {
        Authorization: `Bearer ${token}`,
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
    const projects = (json?.data ?? []).map((item: Record<string, unknown>) => {
      const attr = item.attributes as Record<string, unknown> ?? {};
      return {
        id:          item.id,
        title:       attr.name,
        description: attr.description,
        url:         (attr.url as string) ?? `https://freelancehunt.com/project/${item.id}`,
        budget:      attr.budget,
        currency:    attr.currency,
        deadline:    attr.safe_type,
        skills:      (attr.skills as { name: string }[] ?? []).map((s) => s.name),
        bids:        attr.bid_count,
        status:      attr.status,
        publishedAt: attr.published_at,
        employer:    (attr.employer as Record<string, unknown>)?.login,
      };
    });

    return NextResponse.json({
      ok: true,
      data: projects,
      total: json?.meta?.pagination?.total ?? projects.length,
      page: Number(page),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[GET /api/projects]', message);
    return NextResponse.json({ ok: false, error: message, data: [] }, { status: 500 });
  }
}
