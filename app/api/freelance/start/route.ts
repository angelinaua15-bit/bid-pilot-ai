/**
 * POST /api/freelance/start
 * Enables auto-bid mode for the user and triggers one immediate cycle
 * using Freelancehunt REST API directly — no worker needed.
 * Body: { userId }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFreelanceAccount, getFreelanceFilter, upsertFreelanceFilter, upsertFreelanceAccount, incrementBidCount, saveApplication, appendLog, createAutomationJob, updateAutomationJob } from '@/lib/db';
import { randomUUID } from 'crypto';
import type { AutoBidLog } from '@/types';

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
    for (const project of projects) {
      if (matching.includes(project)) continue; // will be processed below
      const attr = (project.attributes as Record<string, unknown>) ?? {};
      const appId = randomUUID();
      await saveApplication({
        id:           appId,
        userId,
        projectId:    String(project.id),
        title:        String(attr.name ?? `Project ${project.id}`),
        url:          String((attr as Record<string, unknown>).safe_url ?? `https://freelancehunt.com/project/${project.id}`),
        budget:       Number(((attr as Record<string, unknown>).budget as Record<string, unknown>)?.amount ?? 0),
        currency:     String(((attr as Record<string, unknown>).budget as Record<string, unknown>)?.currency ?? 'UAH'),
        status:       'skipped',
        createdAt:    now,
        skippedReason: 'Не відповідає фільтру ключових слів',
        filterStage:  'keyword_filter',
      }).catch(() => {});
    }

    for (const project of toProcess) {
      const attr     = (project.attributes as Record<string, unknown>) ?? {};
      const proposal = `Доброго дня! Зацікавив ваш проект "${attr.name}". Маю досвід у подібних задачах, готовий виконати якісно та в строк. Напишіть — обговоримо деталі!`;
      const appId    = randomUUID();
      const projectTitle = String(attr.name ?? `Project ${project.id}`);
      const projectUrl   = String((attr as Record<string, unknown>).safe_url ?? `https://freelancehunt.com/project/${project.id}`);
      const budget       = Number(((attr as Record<string, unknown>).budget as Record<string, unknown>)?.amount ?? 0);
      const currency     = String(((attr as Record<string, unknown>).budget as Record<string, unknown>)?.currency ?? 'UAH');

      try {
        const bidRes = await fetch(`${FH_BASE}/projects/${project.id}/bids`, {
          method:  'POST',
          headers: { Authorization: `Bearer ${account.apiToken}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ data: { type: 'bid', attributes: { comment: proposal } } }),
          signal:  AbortSignal.timeout(15_000),
        });

        if (bidRes.ok) {
          const bidJson = await bidRes.json().catch(() => ({}));
          const bidId   = String(bidJson?.data?.id ?? '');
          submitted++;
          await incrementBidCount(userId).catch(() => {});

          // Save application record
          await saveApplication({
            id:                 appId,
            userId,
            projectId:          String(project.id),
            title:              projectTitle,
            url:                projectUrl,
            budget,
            currency,
            status:             'sent',
            createdAt:          now,
            sentAt:             new Date().toISOString(),
            proposalText:       proposal,
            freelancehuntBidId: bidId || undefined,
          }).catch(() => {});

          await appendLog({
            id:           randomUUID(),
            userId,
            level:        'success' as AutoBidLog['level'],
            message:      `Заявку надіслано: "${projectTitle}"`,
            projectId:    String(project.id),
            projectTitle,
            bidId:        bidId || undefined,
            timestamp:    new Date().toISOString(),
          }).catch(() => {});
        } else {
          const e       = await bidRes.json().catch(() => ({}));
          const errMsg  = e?.errors?.[0]?.detail ?? `bid failed for project ${project.id}`;
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
            skippedReason: errMsg,
          }).catch(() => {});

          await appendLog({
            id:           randomUUID(),
            userId,
            level:        'error',
            message:      `Помилка подачі заявки на "${projectTitle}": ${errMsg}`,
            projectId:    String(project.id),
            projectTitle,
            timestamp:    new Date().toISOString(),
          }).catch(() => {});
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : `Error on project ${project.id}`;
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
          skippedReason: errMsg,
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
        bidsSkipped:     projects.length - matching.length,
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
      submitted,
      errors: errors.length > 0 ? errors : undefined,
      filter,
    });
  } catch (err) {
    console.error('[api/freelance/start] error:', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
