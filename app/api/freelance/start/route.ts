/**
 * POST /api/freelance/start
 * Enables auto-bid mode for the user and triggers one immediate cycle
 * using Freelancehunt REST API directly — no worker needed.
 * Body: { userId }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFreelanceAccount, getFreelanceFilter, upsertFreelanceFilter, upsertFreelanceAccount, incrementBidCount } from '@/lib/db';

const FH_BASE = 'https://api.freelancehunt.com/v2';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });

    const account = await getFreelanceAccount(userId);
    if (!account?.apiToken) {
      return NextResponse.json(
        { ok: false, error: 'Freelancehunt account not connected. Please add your API token first.', setupRequired: true },
        { status: 401 },
      );
    }

    // Enable auto-bid flag in the filter
    const existing = await getFreelanceFilter(userId);
    const filter   = await upsertFreelanceFilter({ ...(existing ?? {}), userId, isEnabled: true });
    await upsertFreelanceAccount({ userId, status: 'connected', lastCheckAt: new Date().toISOString() });

    // Fetch latest open projects
    const qs = new URLSearchParams({ 'page[size]': '20', 'page[number]': '1' });
    if (filter?.minBudgetUah) qs.set('filter[budget_from]', String(filter.minBudgetUah));

    const projRes = await fetch(`${FH_BASE}/projects?${qs}`, {
      headers: { Authorization: `Bearer ${account.apiToken}` },
      signal: AbortSignal.timeout(20_000),
    });

    if (!projRes.ok) {
      const errJson = await projRes.json().catch(() => ({}));
      return NextResponse.json(
        { ok: false, error: errJson?.errors?.[0]?.detail ?? `Freelancehunt API error ${projRes.status}` },
        { status: projRes.status },
      );
    }

    const projJson   = await projRes.json();
    const projects: Record<string, unknown>[] = projJson?.data ?? [];

    // Keyword filtering
    const allowed  = filter?.allowedKeywords ?? [];
    const blocked  = filter?.blockedKeywords ?? [];
    const matching = projects.filter((p) => {
      const attr = (p.attributes as Record<string, unknown>) ?? {};
      const text = `${attr.name ?? ''} ${attr.description ?? ''}`.toLowerCase();
      if (blocked.length > 0 && blocked.some((kw) => text.includes(kw.toLowerCase()))) return false;
      if (allowed.length > 0 && !allowed.some((kw) => text.includes(kw.toLowerCase()))) return false;
      return true;
    });

    const dailyLimit = filter?.dailyLimit ?? 5;
    const toProcess  = matching.slice(0, dailyLimit);
    let submitted    = 0;
    const errors: string[] = [];

    for (const project of toProcess) {
      const attr     = (project.attributes as Record<string, unknown>) ?? {};
      const proposal = `Доброго дня! Зацікавив ваш проект "${attr.name}". Маю досвід у подібних задачах, готовий виконати якісно та в строк. Напишіть — обговоримо деталі!`;

      try {
        const bidRes = await fetch(`${FH_BASE}/projects/${project.id}/bids`, {
          method:  'POST',
          headers: { Authorization: `Bearer ${account.apiToken}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ data: { type: 'bid', attributes: { comment: proposal } } }),
          signal:  AbortSignal.timeout(15_000),
        });
        if (bidRes.ok) {
          submitted++;
          await incrementBidCount(userId).catch(() => {});
        } else {
          const e = await bidRes.json().catch(() => ({}));
          errors.push(e?.errors?.[0]?.detail ?? `bid failed for project ${project.id}`);
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `Error on project ${project.id}`);
      }
    }

    return NextResponse.json({
      ok: true,
      isWorkerRunning: true,
      found: matching.length,
      submitted,
      errors: errors.length > 0 ? errors : undefined,
      filter,
    });
  } catch (err) {
    console.error('[api/freelance/start] error:', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
