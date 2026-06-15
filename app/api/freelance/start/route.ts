/**
 * POST /api/freelance/start   body: { userId, settings? }
 *
 * Triggers ONE auto-bid cycle for the user. Playwright NEVER runs on Vercel —
 * this route only validates + delegates to the Railway worker, which does the
 * real parse → filter → AI proposal → browser submit using the user's session.
 *
 * Requires AUTOMATION_WORKER_URL + AUTOMATION_SECRET. Without them → 503.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getFreelanceFilter,
  upsertFreelanceFilter,
  upsertFreelanceAccount,
  appendLog,
  createAutomationJob,
  updateAutomationJob,
  getUserById,
} from '@/lib/db';
import { randomUUID } from 'crypto';
import { PLAN_LIMITS } from '@/types';
import { config } from '@/lib/config';
import { getSessionStatus } from '@/services/freelancehunt-session.service';
import { toStructuredError, userMessageForCode } from '@/lib/playwright-errors';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId: string | undefined = body.userId;
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });
    }

    // ── Worker required — Playwright cannot run on Vercel ─────────────────────
    if (!config.worker.enabled) {
      return NextResponse.json(
        {
          ok: false,
          setupRequired: true,
          error:
            'Automation worker not configured. Set AUTOMATION_WORKER_URL and AUTOMATION_SECRET, ' +
            'and deploy the worker (Railway). Playwright cannot run on Vercel.',
        },
        { status: 503 },
      );
    }

    // ── Session check (Supabase, the per-user browser session) ────────────────
    const sessionStatus = await getSessionStatus(userId);
    if (!sessionStatus.connected) {
      return NextResponse.json(
        {
          ok: false,
          setupRequired: true,
          error: `NO_SESSION: Freelancehunt session not found or expired (${sessionStatus.reason ?? 'no session'}). Reconnect your account.`,
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
            ok: false,
            limitReached: true,
            error: `Досягнуто місячний ліміт заявок (${planLimits.applicationsPerMonth}) для плану ${saasUser.subscriptionPlan}. Оновіть підписку.`,
            plan: saasUser.subscriptionPlan,
            used,
            limit: planLimits.applicationsPerMonth,
          },
          { status: 429 },
        );
      }
    }

    // ── Build settings + job record ───────────────────────────────────────────
    const existing = await getFreelanceFilter(userId);
    const filter   = await upsertFreelanceFilter({ ...(existing ?? {}), userId, isEnabled: true });
    await upsertFreelanceAccount({ userId, status: 'connected', lastCheckAt: new Date().toISOString() });
    const job = await createAutomationJob(userId, userId);

    const now = new Date().toISOString();
    await appendLog({
      id: randomUUID(), userId, level: 'info',
      message: `SESSION_FOUND — ${sessionStatus.username ?? 'unknown'} (${sessionStatus.cookieCount} cookies). Delegating cycle to worker.`,
      timestamp: now,
    }).catch(() => {});

    // ── Delegate the whole cycle to the worker (Playwright runs there) ────────
    const { startWorkerAutoBid } = await import('@/lib/worker-client');
    const result = await startWorkerAutoBid({ userId, settings: { ...(filter ?? {}), userId } });

    // Persist worker logs into Supabase
    if (Array.isArray(result.logs)) {
      for (const entry of result.logs) await appendLog(entry).catch(() => {});
    }

    const submitted = Number(result.bidsSubmitted ?? 0);
    const skipped   = Number(result.bidsSkipped ?? 0);
    const errCount  = Number(result.errors ?? 0);
    const cycleNow  = new Date().toISOString();

    if (job) {
      await updateAutomationJob(job.id, {
        status: 'stopped', stoppedAt: cycleNow, lastCycleAt: cycleNow,
        lastCycleError: result.error ?? null, cyclesCompleted: 1,
        bidsSubmitted: submitted, bidsSkipped: skipped, bidsFailed: errCount,
      }).catch(() => {});
    }
    await upsertFreelanceFilter({ ...(filter ?? {}), userId, isEnabled: false }).catch(() => {});

    return NextResponse.json({
      ok: result.ok,
      isWorkerRunning: false,
      jobId: job?.id,
      submitted,
      skipped,
      errors: errCount > 0 ? errCount : undefined,
      // Structured failure code/message (e.g. WORKER_REQUIRED / PLAYWRIGHT_NOT_INSTALLED)
      code: result.ok ? undefined : (result.code ?? 'UNKNOWN'),
      message: result.ok ? undefined : (result.message ?? userMessageForCode(result.code)),
      strategy: 'browser',
      workerMode: true,
    });
  } catch (err) {
    console.error('[api/freelance/start] error:', err);
    const e = toStructuredError(err);
    return NextResponse.json({ ok: false, code: e.code, message: e.message }, { status: 200 });
  }
}