/**
 * POST /api/freelance/start
 *
 * Runs one auto-bid cycle for the user:
 *   1. Parse projects from Freelancehunt feed via Playwright browser session
 *   2. Filter by user preferences
 *   3. Generate AI proposal
 *   4. Submit bid through the browser (NO REST API — POST /v2/projects/{id}/bids
 *      returns HTTP 410; only browser submit works)
 *   5. Persist result to DB
 *
 * Session: uses the per-user storageState saved at
 *   sessions/freelancehunt_<userId>.json
 *
 * If the session file is missing or expired → returns { setupRequired: true }
 * so the client can route the user to the reconnect screen.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getFreelanceAccount,
  getFreelanceFilter,
  upsertFreelanceFilter,
  upsertFreelanceAccount,
  incrementBidCount,
  saveApplication,
  appendLog,
  createAutomationJob,
  updateAutomationJob,
  getUserById,
} from '@/lib/db';
import { randomUUID } from 'crypto';
import type { AutoBidLog } from '@/types';
import { PLAN_LIMITS } from '@/types';
import { parseNewProjects } from '@/services/freelancehunt-parser.service';
import { submitBidViaBrowser } from '@/services/playwright-bid.service';
import { generateAutoBid } from '@/services/ai-bid.service';
import { shouldApply } from '@/services/project-filter.service';
import { getSessionStatus } from '@/services/freelancehunt-session.service';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });
    }

    // ── Session check — verify Supabase-backed browser session ───────────────
    const sessionStatus = await getSessionStatus(userId);

    if (!sessionStatus.connected) {
      return NextResponse.json(
        {
          ok:            false,
          error:         `NO_SESSION: Freelancehunt browser session not found or expired (${sessionStatus.reason ?? 'no session'}). Reconnect your account.`,
          setupRequired: true,
          sessionReason: sessionStatus.reason,
        },
        { status: 401 },
      );
    }

    // ── Enforce subscription plan limits ──────────────────────────────────────
    const saasUser = await getUserById(userId).catch(() => null);
    if (saasUser) {
      const planLimits = PLAN_LIMITS[saasUser.subscriptionPlan] ?? PLAN_LIMITS.free;
      const used = saasUser.applicationsThisMonth ?? 0;
      if (used >= planLimits.applicationsPerMonth) {
        return NextResponse.json(
          {
            ok:           false,
            error:        `Досягнуто місячний ліміт заявок (${planLimits.applicationsPerMonth}) для плану ${saasUser.subscriptionPlan}. Оновіть підписку.`,
            limitReached: true,
            plan:         saasUser.subscriptionPlan,
            used,
            limit:        planLimits.applicationsPerMonth,
          },
          { status: 429 },
        );
      }
    }

    // ── Enable auto-bid flag and create job record ────────────────────────────
    const existing = await getFreelanceFilter(userId);
    const filter   = await upsertFreelanceFilter({ ...(existing ?? {}), userId, isEnabled: true });
    const account  = await getFreelanceAccount(userId);
    await upsertFreelanceAccount({ userId, status: 'connected', lastCheckAt: new Date().toISOString() });
    const job = await createAutomationJob(userId, account?.id ?? userId);

    const now = new Date().toISOString();

    await appendLog({
      id:        randomUUID(),
      userId,
      level:     'info',
      message:   `SESSION_FOUND — підключено як ${sessionStatus.username ?? 'unknown'} (${sessionStatus.cookieCount} cookies). Запуск скану через Playwright.`,
      timestamp: now,
    }).catch(() => {});

    // ── 1. Parse projects from feed via browser session ───────────────────────
    let parseResult: Awaited<ReturnType<typeof parseNewProjects>>;
    try {
      console.log('[api/freelance/start] Parsing projects via browser session', { userId });
      parseResult = await parseNewProjects('', {}, (level, message) => {
        appendLog({ id: randomUUID(), userId, level, message, timestamp: new Date().toISOString() }).catch(() => {});
      });

      console.log('[api/freelance/start] Parsed projects', {
        total: parseResult.totalFetched,
        source: parseResult.source,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[api/freelance/start] parse error:', msg);

      // Session expired during parsing
      const isSessionError =
        msg.includes('LOGIN_REQUIRED') ||
        msg.includes('AUTH_STATE_MISSING') ||
        msg.includes('session expired');

      if (isSessionError) {
        await upsertFreelanceAccount({ userId, status: 'session_expired' });
        return NextResponse.json(
          { ok: false, error: 'Сесія Freelancehunt протухла. Перепідключіть акаунт.', sessionExpired: true },
          { status: 401 },
        );
      }

      return NextResponse.json({ ok: false, error: `Помилка парсингу: ${msg}` }, { status: 500 });
    }

    const projects = parseResult.newProjects;

    // ── 2. Filter projects ────────────────────────────────────────────────────
    const allowed  = filter?.allowedKeywords ?? [];
    const blocked  = filter?.blockedKeywords ?? [];

    type Filtered = {
      project: (typeof projects)[0];
      skipReason?: string;
      filterStage?: string;
      blockedKeywords: string[];
      matchedKeywords: string[];
    };

    const allFiltered: Filtered[] = projects.map((p) => {
      const text = `${p.title} ${p.description ?? ''}`.toLowerCase();
      const hitBlocked = blocked.filter((kw) => text.includes(kw.toLowerCase()));
      const hitAllowed = allowed.filter((kw) => text.includes(kw.toLowerCase()));

      if (hitBlocked.length > 0) {
        return { project: p, skipReason: `Заблоковане слово: ${hitBlocked.join(', ')}`, filterStage: 'keyword_block', blockedKeywords: hitBlocked, matchedKeywords: [] };
      }
      if (allowed.length > 0 && hitAllowed.length === 0) {
        return { project: p, skipReason: 'Не відповідає ключовим словам', filterStage: 'keyword_allow', blockedKeywords: [], matchedKeywords: [] };
      }
      return { project: p, blockedKeywords: [], matchedKeywords: hitAllowed };
    });

    const matching   = allFiltered.filter((f) => !f.skipReason);
    const dailyLimit = filter?.dailyLimit ?? 5;
    const toProcess  = matching.slice(0, dailyLimit);

    let submitted   = 0;
    let bidsSkipped = 0;
    const errors: string[] = [];

    await appendLog({
      id:        randomUUID(),
      userId,
      level:     'info',
      message:   `Знайдено ${projects.length} проектів, ${matching.length} відповідають фільтрам, ліміт: ${dailyLimit}`,
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    // Persist skipped projects
    for (const fp of allFiltered) {
      if (!fp.skipReason) continue;
      await saveApplication({
        id:              randomUUID(),
        userId,
        projectId:       fp.project.id,
        title:           fp.project.title,
        url:             fp.project.projectUrl ?? '',
        budget:          fp.project.budget,
        currency:        fp.project.currency ?? 'UAH',
        status:          'skipped',
        createdAt:       now,
        skippedReason:   fp.skipReason,
        filterStage:     fp.filterStage,
        blockedKeywords: fp.blockedKeywords.length > 0 ? fp.blockedKeywords : undefined,
      }).catch(() => {});
    }

    // ── 3. Process each project ───────────────────────────────────────────────
    for (const fp of toProcess) {
      const project      = fp.project;
      const projectTitle = project.title ?? project.projectUrl ?? `project-${project.id}`;
      const projectUrl   = project.projectUrl ?? '';
      const numericId    = project.freelancehuntId ?? project.id.replace('fh_', '');

      if (!projectUrl) {
        errors.push(`No URL for project ${project.id}`);
        continue;
      }

      // Deep filter via shouldApply (budget + AI score)
      const deepFilter = await shouldApply(project, Boolean(process.env.OPENAI_API_KEY));
      if (!deepFilter.allowed) {
        await saveApplication({
          id:              randomUUID(),
          userId,
          projectId:       project.id,
          title:           projectTitle,
          url:             projectUrl,
          budget:          deepFilter.budget,
          currency:        deepFilter.currency,
          status:          'skipped',
          createdAt:       new Date().toISOString(),
          aiScore:         deepFilter.aiScore,
          matchedKeywords: deepFilter.matchedKeywords,
          blockedKeywords: deepFilter.blockedKeywords,
          skippedReason:   deepFilter.reason,
          filterStage:     deepFilter.stage,
        }).catch(() => {});
        bidsSkipped++;
        continue;
      }

      // Generate AI proposal
      const bid = await generateAutoBid(project);

      const daysRaw    = parseInt(String(bid.deadline ?? '14'), 10);
      const days       = isNaN(daysRaw) || daysRaw <= 0 ? 14 : daysRaw;
      const budgetAmt  = (bid.price ?? 0) > 0 ? bid.price! : project.budget > 0 ? project.budget : 500;

      await appendLog({
        id:        randomUUID(),
        userId,
        level:     'info',
        message:   `BROWSER_SUBMIT_STARTED — "${projectTitle}" | url:${projectUrl} | price:${budgetAmt} | days:${days}`,
        timestamp: new Date().toISOString(),
      }).catch(() => {});

      try {
        const result = await submitBidViaBrowser({
          userId,
          projectId:  numericId,
          projectUrl,
          comment:    bid.text ?? '',
          amount:     budgetAmt,
          days,
          safeType:   'no_safe',
          log: (level, message) => {
            appendLog({ id: randomUUID(), userId, level, message, timestamp: new Date().toISOString() }).catch(() => {});
          },
        });

        console.log('[api/freelance/start] bid result', { projectId: project.id, result });

        if (result.success) {
          submitted++;
          await incrementBidCount(userId).catch(() => {});
          const sentAt = new Date().toISOString();

          await saveApplication({
            id:                 randomUUID(),
            userId,
            projectId:          project.id,
            freelancehuntId:    project.freelancehuntId ?? undefined,
            title:              projectTitle,
            url:                projectUrl,
            budget:             budgetAmt,
            currency:           project.currency ?? 'UAH',
            deadline:           bid.deadline,
            status:             'sent',
            createdAt:          bid.createdAt ?? sentAt,
            sentAt,
            proposalText:       bid.text,
            proposalPrice:      bid.price,
            freelancehuntBidId: result.bidId,
            aiScore:            deepFilter.aiScore,
            matchedKeywords:    deepFilter.matchedKeywords,
          }).catch(() => {});

          await appendLog({
            id:        randomUUID(),
            userId,
            level:     'success' as AutoBidLog['level'],
            message:   `BID_CONFIRMED — "${projectTitle}" | bidId:${result.bidId ?? 'n/a'} | price:${budgetAmt} | days:${days}`,
            timestamp: new Date().toISOString(),
          }).catch(() => {});
        } else {
          // Map browser status to skip or error
          const isSkip = result.status === 'already_bid' || result.status === 'project_closed';

          if (isSkip) {
            bidsSkipped++;
            await saveApplication({
              id:           randomUUID(),
              userId,
              projectId:    project.id,
              title:        projectTitle,
              url:          projectUrl,
              budget:       project.budget,
              currency:     project.currency ?? 'UAH',
              status:       'skipped',
              createdAt:    new Date().toISOString(),
              skippedReason: result.reason,
            }).catch(() => {});
          } else if (result.status === 'login_required') {
            // Session expired mid-cycle
            await upsertFreelanceAccount({ userId, status: 'session_expired' }).catch(() => {});
            errors.push(`СЕСІЯ ПРОТУХЛА: ${result.reason}`);
            await appendLog({
              id:        randomUUID(),
              userId,
              level:     'error',
              message:   `Сесія протухла під час подачі заявки на "${projectTitle}". Перепідключіть акаунт.`,
              timestamp: new Date().toISOString(),
            }).catch(() => {});
            break; // stop processing — session is dead
          } else {
            errors.push(result.reason);
            await saveApplication({
              id:          randomUUID(),
              userId,
              projectId:   project.id,
              title:       projectTitle,
              url:         projectUrl,
              budget:      project.budget,
              currency:    project.currency ?? 'UAH',
              status:      'failed',
              createdAt:   new Date().toISOString(),
              errorReason: result.reason,
              filterStage: 'bid_submit',
            }).catch(() => {});
            await appendLog({
              id:        randomUUID(),
              userId,
              level:     'error',
              message:   `Помилка подачі на "${projectTitle}": ${result.reason}`,
              timestamp: new Date().toISOString(),
            }).catch(() => {});
          }
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error('[api/freelance/start] exception on bid submit', { projectId: project.id, error: errMsg });
        errors.push(errMsg);

        await saveApplication({
          id:          randomUUID(),
          userId,
          projectId:   project.id,
          title:       projectTitle,
          url:         projectUrl,
          budget:      project.budget,
          currency:    project.currency ?? 'UAH',
          status:      'failed',
          createdAt:   new Date().toISOString(),
          errorReason: errMsg,
          filterStage: 'bid_submit',
        }).catch(() => {});
      }
    }

    // ── Restore env and finalize ─────────────────────────────────────────────���
    if (prevSession !== undefined) process.env.FREELANCEHUNT_SESSION_PATH = prevSession;
    else delete process.env.FREELANCEHUNT_SESSION_PATH;

    const cycleNow = new Date().toISOString();

    await appendLog({
      id:        randomUUID(),
      userId,
      level:     submitted > 0 ? 'success' : 'info',
      message:   `Скан завершено — надіслано ${submitted} заявок, пропущено ${bidsSkipped}${errors.length ? `, помилок: ${errors.length}` : ''}`,
      timestamp: cycleNow,
    }).catch(() => {});

    if (job) {
      await updateAutomationJob(job.id, {
        status:          'stopped',
        stoppedAt:       cycleNow,
        lastCycleAt:     cycleNow,
        lastCycleError:  errors.length > 0 ? errors[0] : null,
        cyclesCompleted: 1,
        bidsSubmitted:   submitted,
        bidsSkipped:     bidsSkipped + allFiltered.filter((f) => f.skipReason).length,
        bidsFailed:      errors.length,
      }).catch(() => {});
    }

    await upsertFreelanceFilter({ ...(filter ?? {}), userId, isEnabled: false }).catch(() => {});

    return NextResponse.json({
      ok:              true,
      isWorkerRunning: false,
      jobId:           job?.id,
      found:           matching.length,
      skipped:         bidsSkipped + allFiltered.filter((f) => f.skipReason).length,
      submitted,
      errors:          errors.length > 0 ? errors : undefined,
      filter,
      strategy:        'browser',
    });
  } catch (err) {
    console.error('[api/freelance/start] error:', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
