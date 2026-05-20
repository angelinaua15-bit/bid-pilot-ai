/**
 * services/freelancehunt-auto-bid.service.ts
 * Auto-bid orchestrator.
 *
 * Flow:
 *   1. Pre-flight (token present)
 *   2. Parse projects via Freelancehunt REST API
 *   3. Filter projects
 *   4. Generate AI proposal via OpenAI
 *   5. Submit bid via Freelancehunt REST API  POST /v2/projects/{id}/bids
 *   6. Telegram notification
 *   7. Persist to DB
 *
 * No Playwright. No storageState. No session files.
 * Uses FREELANCEHUNT_TOKEN exclusively.
 */

import type { AutoBidSettings, AutoBidLog, Project } from '@/types';
import type { StepLogFn } from './freelancehunt-parser.service';
import { parseNewProjects } from './freelancehunt-parser.service';
import { generateAutoBid } from './ai-bid.service';
import { submitBidViaPlaywright } from './playwright-browser.service';
import { sendTelegramMessage } from './telegram.service';
import { shouldBid } from './project-filter.service';
import { config } from '@/lib/config';
import { saveBid, appendLog as persistLog } from '@/lib/db';


export interface AutoBidRunResult {
  logs: AutoBidLog[];
  bidsSubmitted: number;
  bidsSkipped: number;
  errors: number;
}

// ─── Daily counters (reset on new day / process restart) ─────────────────────

const dailyCounters: Map<string, { date: string; count: number }> = new Map();

function getDailyCount(key: string): number {
  const today = new Date().toISOString().slice(0, 10);
  const entry = dailyCounters.get(key);
  if (!entry || entry.date !== today) return 0;
  return entry.count;
}

function incrementDailyCount(key: string): void {
  const today = new Date().toISOString().slice(0, 10);
  const entry = dailyCounters.get(key);
  if (!entry || entry.date !== today) {
    dailyCounters.set(key, { date: today, count: 1 });
  } else {
    entry.count++;
  }
}

const alreadyBidIds = new Set<string>();

// ─── Log helper ───────────────────────────────────────────────────────────────

function log(
  logs: AutoBidLog[],
  level: AutoBidLog['level'],
  message: string,
  extra?: Partial<AutoBidLog>
): void {
  const safeMessage =
    typeof message === 'string' && message.trim() !== ''
      ? message
      : message != null
        ? String(message)
        : '(empty message)';

  const entry: AutoBidLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    timestamp: new Date().toISOString(),
    level: level ?? 'info',
    message: safeMessage,
    ...extra,
  };

  logs.push(entry);

  // Persist to database asynchronously (fire-and-forget)
  // Errors are swallowed so a DB failure never kills the cycle.
  persistLog(entry).catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main cycle ───────────────────────────────────────────────────────────────

/**
 * Run one full auto-bid cycle.
 *
 * @param _token        - Ignored — uses FREELANCEHUNT_TOKEN from env
 * @param settings      - Auto-bid settings from DB
 * @param telegramChatId - Optional Telegram chat ID for notifications
 * @param externalStepLog - Optional external log callback (e.g. worker log store)
 * @param forceRun      - When true, ignores settings.enabled
 */
export async function runAutoBidCycle(
  _token: string,
  settings: AutoBidSettings,
  telegramChatId?: number,
  externalStepLog?: StepLogFn,
  forceRun = true,
  /** Cross-cycle dedup: project IDs already bid in this worker process */
  globalProcessedIds?: Set<string>
): Promise<AutoBidRunResult> {
  const chatId: number | undefined = telegramChatId ?? config.telegram.chatId ?? undefined;
  const logs: AutoBidLog[] = [];
  let bidsSubmitted = 0;
  let bidsSkipped = 0;
  let errors = 0;

  const isMockMode = Boolean(process.env.FREELANCEHUNT_MOCK);

  log(logs, 'info',
    `[Settings] enabled=${settings.enabled} | forceRun=${forceRun} | dailyLimit=${settings.dailyLimit} | minBudget=${settings.minBudget} | emergencyStop=${settings.emergencyStop}`,
    { meta: { settingsEnabled: settings.enabled, forceRun, dailyLimit: settings.dailyLimit } }
  );

  if (settings.emergencyStop) {
    log(logs, 'error', '[Settings] EMERGENCY STOP is active. Cycle cancelled.');
    return { logs, bidsSubmitted, bidsSkipped, errors };
  }

  if (!settings.enabled && !forceRun) {
    log(logs, 'warning', '[Settings] Auto-bid is disabled (enabled=false). Use forceRun=true to override.');
    return { logs, bidsSubmitted, bidsSkipped, errors };
  }

  if (!settings.enabled && forceRun) {
    log(logs, 'warning', '[Settings] settings.enabled=false but forceRun=true — running anyway');
  }

  const dailyUsed = getDailyCount('bids');
  log(logs, 'info', `Cycle started. Daily limit: ${settings.dailyLimit} (used today: ${dailyUsed})`, {
    meta: { dailyUsed, dailyLimit: settings.dailyLimit },
  });

  // ── Pre-flight ──────────────────────────────────────────────────────────────
  if (isMockMode) {
    log(logs, 'warning', '[Pre-flight] Auth mode: MOCK (FREELANCEHUNT_MOCK=1) — no real browser automation');
  } else {
    // Verify Playwright session: open /my/ and confirm we are not on the login page
    try {
      const { verifySession, sessionExists, resolveSessionPath } = await import('./playwright-browser.service');

      if (!sessionExists()) {
        log(logs, 'error',
          '[Pre-flight] FAILED: storageState.json not found. ' +
          'Run: npm run login:freelancehunt to save your session.'
        );
        errors++;
        return { logs, bidsSubmitted, bidsSkipped, errors };
      }

      log(logs, 'info', `[Pre-flight] Session file found: ${resolveSessionPath()}`);

      const sessionLog = (level: 'info' | 'success' | 'warning' | 'error', msg: string) => {
        log(logs, level, msg);
        externalStepLog?.(level, msg);
      };

      const verification = await verifySession(sessionLog);
      if (!verification.valid) {
        log(logs, 'error',
          `[Pre-flight] Session verification FAILED — ${verification.reason}. ` +
          'Re-run: npm run login:freelancehunt to refresh your session.'
        );
        errors++;
        return { logs, bidsSubmitted, bidsSkipped, errors };
      }

      log(logs, 'success',
        `[Pre-flight] Session valid — logged in as: ${verification.username ?? 'unknown'}. Starting auto-bid.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(logs, 'error', `[Pre-flight] Session check error: ${msg}`);
      errors++;
      return { logs, bidsSubmitted, bidsSkipped, errors };
    }
  }

  // ── Step logger — pipes parser/submission logs into this cycle's log[] ──────
  const stepLog: StepLogFn = (level, message, meta) => {
    const safeMsg = (message != null && String(message).trim() !== '')
      ? String(message)
      : '(no message)';
    log(logs, level, safeMsg, meta ? { meta } : undefined);
    externalStepLog?.(level, safeMsg, meta);
  };

  // ── 1. Parse projects from API ──────────────────────────────────────────────
  let parseResult: Awaited<ReturnType<typeof parseNewProjects>>;
  try {
    // Parse from website feed — no API token needed
    parseResult = await parseNewProjects('', {}, stepLog);

    log(logs, 'info',
      `Found ${parseResult.totalFetched} projects total, ${parseResult.newCount} new (source: ${parseResult.source})`,
      { meta: { total: parseResult.totalFetched, newCount: parseResult.newCount, source: parseResult.source } }
    );

    // Log each new project title + URL so they appear individually in the Logs screen
    for (const p of parseResult.newProjects.slice(0, 20)) {
      log(logs, 'info',
        `[Project] "${p.title}" — budget: ${p.budget} ${p.currency} — ${p.projectUrl}`,
        { projectId: p.id, projectTitle: p.title, meta: { projectUrl: p.projectUrl, budget: p.budget } }
      );
    }
    if (parseResult.newCount > 20) {
      log(logs, 'info', `[Project] ...and ${parseResult.newCount - 20} more new projects`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(logs, 'error', `Project parsing failed: ${msg}`);
    errors++;
    return { logs, bidsSubmitted, bidsSkipped, errors };
  }

  if (parseResult.newCount === 0) {
    log(logs, 'info', 'No new projects found. Cycle complete.');
    return { logs, bidsSubmitted, bidsSkipped, errors };
  }

  // ── 2. No filters — attempt bid on every project returned by the API ─────────
  // No category, budget, keyword, match-score, session-duplicate, or any other
  // filter is applied here. Every project in parseResult.newProjects goes
  // directly to the bid submission step.
  const filtered: Array<Project & { matchScore?: number }> = parseResult.newProjects.map(
    (p) => ({ ...p, matchScore: 100 })
  );

  log(logs, 'info', `${filtered.length} project(s) queued — submitting bid to all`, {
    meta: { count: filtered.length },
  });

  // ── 3. Process each project ─────────────────────────────────────────────────
  for (let i = 0; i < filtered.length; i++) {
    const project = filtered[i];

    const dailyLimit = settings.dailyLimit > 0 ? settings.dailyLimit : Infinity;
    if (getDailyCount('bids') >= dailyLimit) {
      log(logs, 'warning', `Daily bid limit reached (${settings.dailyLimit}). Stopping.`);
      break;
    }

    const projectTitle = project.title ?? project.projectUrl ?? `project-${i + 1}`;
    const projectUrl   = project.projectUrl ?? '';
    const numericId    = project.freelancehuntId ?? project.id.replace('fh_', '');

    // ── IT-only filter ────────────────────────────────────────────────────────
    const itFilter = shouldBid(project);
    if (!itFilter.allowed) {
      log(logs, 'info',
        `[SKIP] Not IT project — ${itFilter.reason} | "${projectTitle}"`,
        { projectId: project.id, projectTitle }
      );
      bidsSkipped++;
      continue;
    }

    // ── In-cycle dedup ────────────────────────────────────────────────────────
    if (alreadyBidIds.has(project.id) || (project.freelancehuntId && alreadyBidIds.has(project.freelancehuntId))) {
      log(logs, 'info',
        `[SKIP] Already bid in this cycle — "${projectTitle}"`,
        { projectId: project.id, projectTitle }
      );
      bidsSkipped++;
      continue;
    }

    if (globalProcessedIds?.has(project.id) || (project.freelancehuntId && globalProcessedIds?.has(project.freelancehuntId))) {
      log(logs, 'info',
        `[SKIP] Already bid in this worker process — "${projectTitle}"`,
        { projectId: project.id, projectTitle }
      );
      bidsSkipped++;
      continue;
    }

    log(logs, 'info',
      `[${i + 1}/${filtered.length}] Processing: "${projectTitle}" — ${projectUrl}`,
      { projectId: project.id, projectTitle, meta: { matchScore: project.matchScore, projectUrl } }
    );

    // ── 4. Generate AI proposal ───────────────────────────────────────────────
    log(logs, 'info', `[${i + 1}/${filtered.length}] Generating AI proposal for "${projectTitle}"`, {
      projectId: project.id, projectTitle,
    });

    const bid = await generateAutoBid(project);

    if (bid.usedFallback) {
      const reason =
        bid.fallbackReason === 'quota_exceeded' ? 'OpenAI quota exceeded'
        : bid.fallbackReason === 'no_key' ? 'OPENAI_API_KEY not set'
        : 'OpenAI unavailable';
      log(logs, 'warning', `${reason} — using template proposal for "${projectTitle}"`, {
        projectId: project.id, projectTitle,
        meta: { fallback: true, reason: bid.fallbackReason ?? 'unknown' },
      });
    } else {
      log(logs, 'info',
        `AI proposal ready — price: ${bid.price ?? '?'} ${project.currency ?? 'UAH'}, deadline: ${bid.deadline ?? '?'}`,
        { projectId: project.id, projectTitle, bidId: bid.id, meta: { price: bid.price, deadline: bid.deadline } }
      );
    }

    // ── 5. Submit bid via Playwright browser automation ───────────────────────
    // POST /v2/projects/{id}/bids was removed (410 Gone) from the Freelancehunt API.
    // We now submit bids by automating the website with Playwright.
    if (!projectUrl) {
      log(logs, 'error',
        `[${i + 1}/${filtered.length}] SKIP: "${projectTitle}" — project URL is empty, cannot open in browser`,
        { projectId: project.id, projectTitle }
      );
      errors++;
      continue;
    }

    log(logs, 'info',
      `[${i + 1}/${filtered.length}] Opening browser for: "${projectTitle}" — ${projectUrl}`,
      { projectId: project.id, projectTitle, meta: { projectUrl } }
    );

    // Parse days from deadline string: "14 днів" → 14, "21 день" → 21
    const daysRaw = parseInt(String(bid.deadline ?? '14'), 10);
    const days    = isNaN(daysRaw) || daysRaw <= 0 ? 14 : daysRaw;

    // Budget must be > 0 — use project budget as floor if AI returned 0
    const budgetAmount = (bid.price ?? 0) > 0
      ? bid.price
      : project.budget > 0
        ? project.budget
        : 500;

    log(logs, 'info',
      `[${i + 1}/${filtered.length}] Bid details — budget: ${budgetAmount} ${project.currency ?? 'UAH'} | days: ${days} | proposal: ${(bid.text ?? '').length} chars`,
      { projectId: project.id, projectTitle }
    );

    try {
      // Retry on browser/network errors only — not on FORM_NOT_FOUND / ALREADY_BID / PROJECT_CLOSED
      let result: Awaited<ReturnType<typeof submitBidViaPlaywright>> | undefined;
      const MAX_RETRIES = 2;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          result = await submitBidViaPlaywright({
            projectUrl,
            text:     bid.text ?? '',
            budget:   budgetAmount!,
            days,
            currency: project.currency ?? 'UAH',
            logFn:    stepLog,
          });
          break; // success
        } catch (retryErr) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          // Non-retryable errors — re-throw immediately
          const isNonRetryable =
            retryMsg.startsWith('ALREADY_BID:') ||
            retryMsg.startsWith('PROJECT_CLOSED:') ||
            retryMsg.startsWith('FORM_NOT_FOUND:') ||
            retryMsg.startsWith('INVALID_ID:');
          if (isNonRetryable || attempt === MAX_RETRIES) throw retryErr;
          log(logs, 'warning',
            `[${i + 1}/${filtered.length}] Browser error (attempt ${attempt}/${MAX_RETRIES}), retrying in 5s: ${retryMsg}`,
            { projectId: project.id, projectTitle }
          );
          await sleep(5000);
        }
      }
      if (!result) throw new Error('submitBidViaPlaywright returned no result after retries');

      if (result.success) {
        alreadyBidIds.add(project.id);
        if (project.freelancehuntId) alreadyBidIds.add(project.freelancehuntId);
        // Also record in cross-cycle global set
        globalProcessedIds?.add(project.id);
        if (project.freelancehuntId) globalProcessedIds?.add(project.freelancehuntId);
        if (numericId) globalProcessedIds?.add(numericId);
        incrementDailyCount('bids');
        bidsSubmitted++;

        await saveBid({
          ...bid,
          status: 'sent',
          freelancehuntBidId: result.bidId,
          sentAt: new Date().toISOString(),
        });

        log(logs, 'success',
          `SUBMITTED [${i + 1}/${filtered.length}] — "${projectTitle}" | strategy: ${result.strategy} | bidId: ${result.bidId ?? 'n/a'} | price: ${budgetAmount} ${project.currency ?? 'UAH'} | days: ${days} | url: ${projectUrl}`,
          {
            projectId: project.id, projectTitle, bidId: result.bidId,
            meta: { price: budgetAmount, deadline: days, matchScore: project.matchScore, projectUrl, strategy: result.strategy },
          }
        );

        // ── 6. Telegram notification ────────────────────────────────────────
        if (chatId) {
          const msg = [
            '<b>Bid submitted!</b>',
            '',
            `<b>Project:</b> ${projectTitle}`,
            `<b>Price:</b> ${bid.price ?? '?'} ${project.currency ?? 'UAH'}`,
            `<b>Deadline:</b> ${bid.deadline ?? '?'}`,
            `<b>Match:</b> ${project.matchScore ?? '?'}%`,
            `<a href="${projectUrl}">View project</a>`,
          ].join('\n');

          await sendTelegramMessage(chatId, msg, {
            parseMode: 'HTML',
            disableWebPagePreview: true,
          });
        }
      } else {
        throw new Error('API returned success: false');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // ALREADY_BID / PROJECT_CLOSED = truly skip (API confirmed cannot bid)
      // Everything else = real failure → errors counter, NOT bidsSkipped
      const isApiSkip =
        msg.startsWith('ALREADY_BID:') ||
        msg.startsWith('PROJECT_CLOSED:') ||
        msg.toLowerCase().includes('already placed') ||
        msg.toLowerCase().includes('already applied');

      if (isApiSkip) {
        log(logs, 'warning',
          `SKIPPED_REASON [${i + 1}/${filtered.length}] — "${projectTitle}" | reason: ${msg.slice(0, 300)} | url: ${projectUrl}`,
          { projectId: project.id, projectTitle, meta: { projectUrl, reason: msg } }
        );
        bidsSkipped++;
        // Mark as seen so we don't retry this project
        alreadyBidIds.add(project.id);
        if (project.freelancehuntId) alreadyBidIds.add(project.freelancehuntId);
        continue;
      }

      // All other errors: log full error, count as failure, continue to next project
      log(logs, 'error',
        `FAILED_REASON [${i + 1}/${filtered.length}] — "${projectTitle}" | error: ${msg} | url: ${projectUrl}`,
        { projectId: project.id, projectTitle, meta: { projectUrl, apiError: msg } }
      );
      errors++;

      // Telegram error notification (send but don't block the cycle)
      if (chatId) {
        const errMsg = [
          '<b>Bid failed</b>',
          '',
          `<b>Project:</b> ${projectTitle}`,
          `<b>Error:</b> ${msg.slice(0, 300)}`,
          projectUrl ? `<a href="${projectUrl}">View project</a>` : '',
        ].filter(Boolean).join('\n');
        await sendTelegramMessage(chatId, errMsg, { parseMode: 'HTML', disableWebPagePreview: true }).catch(() => {});
      }

      continue;
    }

    // ── 7. Delay between bids ─────────────────────────────────────────────────
    const delayMs =
      (settings.delayBetweenBidsMin +
        Math.random() * (settings.delayBetweenBidsMax - settings.delayBetweenBidsMin)) *
      1000;
    log(logs, 'info', `Waiting ${Math.round(delayMs / 1000)}s before next bid`);
    await sleep(delayMs);
  }

  const summary = `Cycle complete. Submitted: ${bidsSubmitted}, skipped: ${bidsSkipped}, errors: ${errors}`;
  log(logs, bidsSubmitted > 0 ? 'success' : 'info', summary, {
    meta: { bidsSubmitted, bidsSkipped, errors },
  });

  // Send cycle-level Telegram summary (only if anything happened)
  if (chatId && (bidsSubmitted > 0 || errors > 0)) {
    const cycleMsg = [
      bidsSubmitted > 0 ? '<b>Auto-bid cycle complete</b>' : '<b>Auto-bid cycle finished (no bids sent)</b>',
      '',
      `Submitted: <b>${bidsSubmitted}</b>`,
      `Skipped: ${bidsSkipped}`,
      errors > 0 ? `Errors: <b>${errors}</b>` : null,
    ].filter(Boolean).join('\n');

    await sendTelegramMessage(chatId, cycleMsg, { parseMode: 'HTML', disableWebPagePreview: true }).catch(() => {});
  }

  return { logs, bidsSubmitted, bidsSkipped, errors };
}

export function getDailyBidCount(): number {
  return getDailyCount('bids');
}

export function triggerEmergencyStop(): void {
  // Handled via settings.emergencyStop
}
