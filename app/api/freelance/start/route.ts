/**
 * POST /api/freelance/start
 * Enables auto-bid mode for the user and triggers one immediate cycle
 * using Freelancehunt REST API directly — no worker needed.
 * Body: { userId }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFreelanceAccount, getFreelanceFilter, upsertFreelanceFilter, upsertFreelanceAccount, incrementBidCount, saveApplication, appendLog, createAutomationJob, updateAutomationJob, getUserById } from '@/lib/db';
import { randomUUID } from 'crypto';
import type { AutoBidLog } from '@/types';
import { PLAN_LIMITS } from '@/types';

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

    // Enforce subscription plan limits
    const saasUser = await getUserById(userId).catch(() => null);
    if (saasUser) {
      const planLimits = PLAN_LIMITS[saasUser.subscriptionPlan] ?? PLAN_LIMITS.free;
      const used = saasUser.applicationsThisMonth ?? 0;
      if (used >= planLimits.applicationsPerMonth) {
        return NextResponse.json(
          {
            ok:    false,
            error: `Досягнуто місячний ліміт заявок (${planLimits.applicationsPerMonth}) для плану ${saasUser.subscriptionPlan}. Оновіть підписку.`,
            limitReached: true,
            plan:  saasUser.subscriptionPlan,
            used,
            limit: planLimits.applicationsPerMonth,
          },
          { status: 429 },
        );
      }
    }

    // Enable auto-bid flag in the filter
    const existing = await getFreelanceFilter(userId);
    const filter   = await upsertFreelanceFilter({ ...(existing ?? {}), userId, isEnabled: true });
    await upsertFreelanceAccount({ userId, status: 'connected', lastCheckAt: new Date().toISOString() });

    // Create a tracked automation job record
    const job = await createAutomationJob(userId, account.id);

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

    // Keyword filtering with match tracking
    const allowed  = filter?.allowedKeywords ?? [];
    const blocked  = filter?.blockedKeywords ?? [];
    type FilteredProject = {
      raw: Record<string, unknown>;
      matchedKeywords: string[];
      blockedKeywords: string[];
      skipReason?: string;
      filterStage?: string;
    };
    const allFiltered: FilteredProject[] = projects.map((p) => {
      const attr = (p.attributes as Record<string, unknown>) ?? {};
      const text = `${attr.name ?? ''} ${attr.description ?? ''}`.toLowerCase();
      const hitBlocked = blocked.filter((kw) => text.includes(kw.toLowerCase()));
      const hitAllowed = allowed.filter((kw) => text.includes(kw.toLowerCase()));
      if (hitBlocked.length > 0) {
        return { raw: p, matchedKeywords: [], blockedKeywords: hitBlocked, skipReason: `Заблоковане слово: ${hitBlocked.join(', ')}`, filterStage: 'keyword_block' };
      }
      if (allowed.length > 0 && hitAllowed.length === 0) {
        return { raw: p, matchedKeywords: [], blockedKeywords: [], skipReason: 'Не відповідає ключовим словам', filterStage: 'keyword_allow' };
      }
      return { raw: p, matchedKeywords: hitAllowed, blockedKeywords: [] };
    });
    const matching = allFiltered.filter((f) => !f.skipReason);

    const dailyLimit = filter?.dailyLimit ?? 5;
    const toProcess  = matching.slice(0, dailyLimit);
    let submitted    = 0;
    const errors: string[] = [];
    const now = new Date().toISOString();

    // Log scan start
    await appendLog({
      id:        randomUUID(),
      userId,
      level:     'info',
      message:   `Скан запущено — знайдено ${projects.length} проектів, ${matching.length} відповідають фільтрам, ліміт: ${dailyLimit}`,
      timestamp: now,
    }).catch(() => {});

    // Record skipped projects (filtered out)
    for (const fp of allFiltered) {
      if (!fp.skipReason) continue; // will be processed below
      const project = fp.raw;
      const attr    = (project.attributes as Record<string, unknown>) ?? {};
      await saveApplication({
        id:              randomUUID(),
        userId,
        projectId:       String(project.id),
        title:           String(attr.name ?? `Project ${project.id}`),
        url:             String((attr as Record<string, unknown>).safe_url ?? `https://freelancehunt.com/project/${project.id}`),
        budget:          Number(((attr as Record<string, unknown>).budget as Record<string, unknown>)?.amount ?? 0),
        currency:        String(((attr as Record<string, unknown>).budget as Record<string, unknown>)?.currency ?? 'UAH'),
        status:          'skipped',
        createdAt:       now,
        skippedReason:   fp.skipReason,
        filterStage:     fp.filterStage,
        blockedKeywords: fp.blockedKeywords.length > 0 ? fp.blockedKeywords : undefined,
      }).catch(() => {});
    }

    for (const fp of toProcess) {
      const project  = fp.raw;
      const attr     = (project.attributes as Record<string, unknown>) ?? {};
      const proposal = `Доброго дня! Зацікавив ваш проект "${attr.name}". Маю досвід у подібних задачах, готовий виконати якісно та в строк. Напишіть — обговоримо деталі!`;
      const appId    = randomUUID();
      const projectTitle = String(attr.name ?? `Project ${project.id}`);
      const projectUrl   = String((attr as Record<string, unknown>).safe_url ?? `https://freelancehunt.com/project/${project.id}`);
      const budget       = Number(((attr as Record<string, unknown>).budget as Record<string, unknown>)?.amount ?? 0);
      const currency     = String(((attr as Record<string, unknown>).budget as Record<string, unknown>)?.currency ?? 'UAH');

      // Parse deadline (days) from filter or default to 14
      const bidDays    = 14; // default deadline in days — FreelanceFilter has no deadline field yet
      const bidAmount  = budget > 0 ? budget : (filter?.minBudgetUah ?? 500);
      const bidPayload = {
        days:      bidDays,
        safe_type: 'employer' as const,
        budget:    { amount: bidAmount, currency },
        comment:   proposal,
        is_hidden: false,
      };

      try {
        const bidRes = await fetch(`${FH_BASE}/projects/${project.id}/bids`, {
          method:  'POST',
          headers: { Authorization: `Bearer ${account.apiToken}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify(bidPayload),
          signal:  AbortSignal.timeout(15_000),
        });

        // Always read the full body for logging — do not rely on bidRes.ok alone
        const bidRawText = await bidRes.text().catch(() => '');
        let bidJson: Record<string, unknown> = {};
        try { bidJson = JSON.parse(bidRawText); } catch { /* leave empty */ }

        console.log('[api/freelance/start] bid attempt', {
          projectId:  project.id,
          projectTitle: projectTitle.slice(0, 60),
          status:     bidRes.status,
          payload:    bidPayload,
          rawResponse: bidRawText.slice(0, 500),
        });

        if (bidRes.ok) {
          const bidId = String((bidJson as { data?: { id?: unknown } })?.data?.id ?? '');
          submitted++;
          await incrementBidCount(userId).catch(() => {});

          // Save application record
          await saveApplication({
            id:                 appId,
            userId,
            projectId:          String(project.id),
            title:              projectTitle,
            url:                projectUrl,
            budget:             bidAmount,
            currency,
            status:             'sent',
            createdAt:          now,
            sentAt:             new Date().toISOString(),
            proposalText:       proposal,
            freelancehuntBidId: bidId || undefined,
            matchedKeywords:    fp.matchedKeywords.length > 0 ? fp.matchedKeywords : undefined,
          }).catch(() => {});

          await appendLog({
            id:           randomUUID(),
            userId,
            level:        'success' as AutoBidLog['level'],
            message:      `Заявку надіслано: "${projectTitle}" | bidId:${bidId || 'n/a'} | price:${bidAmount} ${currency} | days:${bidDays}`,
            projectId:    String(project.id),
            projectTitle,
            bidId:        bidId || undefined,
            timestamp:    new Date().toISOString(),
          }).catch(() => {});
        } else {
          // Extract real error from API response — try multiple field paths
          const apiErrors = (bidJson as { errors?: { detail?: string; title?: string }[] })?.errors;
          const firstErr  = apiErrors?.[0];
          const errMsg    = firstErr?.detail ?? firstErr?.title
            ?? (bidJson as { message?: string })?.message
            ?? `HTTP ${bidRes.status}: ${bidRawText.slice(0, 300)}`;
          errors.push(errMsg);

          await saveApplication({
            id:           appId,
            userId,
            projectId:    String(project.id),
            title:        projectTitle,
            url:          projectUrl,
            budget,
            currency,
            status:       'failed',
            createdAt:    now,
            errorReason:  errMsg,
            filterStage:  'bid_submit',
          }).catch(() => {});

          await appendLog({
            id:           randomUUID(),
            userId,
            level:        'error',
            message:      `Помилка подачі заявки на "${projectTitle}" [HTTP ${bidRes.status}]: ${errMsg}`,
            projectId:    String(project.id),
            projectTitle,
            timestamp:    new Date().toISOString(),
          }).catch(() => {});
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : `Error on project ${project.id}`;
        console.error('[api/freelance/start] exception on bid', { projectId: project.id, error: errMsg });
        errors.push(errMsg);

        await saveApplication({
          id:           appId,
          userId,
          projectId:    String(project.id),
          title:        projectTitle,
          url:          projectUrl,
          budget,
          currency,
          status:       'failed',
          createdAt:    now,
          errorReason:  errMsg,
          filterStage:  'bid_submit',
        }).catch(() => {});

        await appendLog({
          id:           randomUUID(),
          userId,
          level:        'error',
          message:      `Виняток при заявці на "${projectTitle}": ${errMsg}`,
          projectId:    String(project.id),
          projectTitle,
          timestamp:    new Date().toISOString(),
        }).catch(() => {});
      }
    }

    const cycleNow = new Date().toISOString();

    // Log scan complete
    await appendLog({
      id:        randomUUID(),
      userId,
      level:     'info',
      message:   `Скан завершено — надіслано ${submitted} заявок${errors.length ? `, помилок: ${errors.length}` : ''}`,
      timestamp: cycleNow,
    }).catch(() => {});

    // Update job with cycle results and mark stopped (one-shot cycle)
    if (job) {
      await updateAutomationJob(job.id, {
        status:          'stopped',
        stoppedAt:       cycleNow,
        lastCycleAt:     cycleNow,
        lastCycleError:  errors.length > 0 ? errors[0] : null,
        cyclesCompleted: 1,
        bidsSubmitted:   submitted,
        bidsSkipped:     allFiltered.filter((f) => f.skipReason).length,
        bidsFailed:      errors.length,
      }).catch(() => {});
    }

    // Disable filter after one-shot cycle
    await upsertFreelanceFilter({ ...(filter ?? {}), userId, isEnabled: false }).catch(() => {});

    return NextResponse.json({
      ok: true,
      isWorkerRunning: false,
      jobId: job?.id,
      found: matching.length,
      skipped: allFiltered.filter((f) => f.skipReason).length,
      submitted,
      errors: errors.length > 0 ? errors : undefined,
      filter,
    });
  } catch (err) {
    console.error('[api/freelance/start] error:', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
