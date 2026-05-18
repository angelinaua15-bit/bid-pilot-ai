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
import { sendFreelancehuntBid } from './freelancehunt.service';
import { sendTelegramMessage } from './telegram.service';
import { companyProfile } from '@/lib/mock-data';
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
  forceRun = true
): Promise<AutoBidRunResult> {
  const chatId: number | undefined = telegramChatId ?? config.telegram.chatId ?? undefined;
  const logs: AutoBidLog[] = [];
  let bidsSubmitted = 0;
  let bidsSkipped = 0;
  let errors = 0;

  // Auth token from env
  const apiToken = process.env.FREELANCEHUNT_TOKEN ?? '';
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
  if (!isMockMode && !apiToken) {
    log(logs, 'error',
      'PRE-FLIGHT FAILED: FREELANCEHUNT_TOKEN is not set. ' +
      'Add FREELANCEHUNT_TOKEN to your .env.local or environment variables.'
    );
    errors++;
    return { logs, bidsSubmitted, bidsSkipped, errors };
  }

  if (isMockMode) {
    log(logs, 'warning', '[Pre-flight] Auth mode: MOCK (FREELANCEHUNT_MOCK=1) — no real API calls');
  } else {
    log(logs, 'info', '[Pre-flight] Auth mode: REST API (FREELANCEHUNT_TOKEN set)');

    // Validate token against Freelancehunt API
    try {
      const { validateFreelancehuntToken } = await import('./freelancehunt.service');
      const validation = await validateFreelancehuntToken(apiToken);
      if (!validation.valid) {
        log(logs, 'error', '[Pre-flight] FREELANCEHUNT_TOKEN is invalid or expired. Aborting cycle.');
        errors++;
        return { logs, bidsSubmitted, bidsSkipped, errors };
      }
      log(logs, 'success', `[Pre-flight] Freelancehunt API connected — account: ${validation.username ?? 'unknown'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(logs, 'error', `[Pre-flight] API validation failed: ${msg}`);
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
    parseResult = await parseNewProjects(apiToken, {
      categories: settings.allowedCategories,
      budgetMin: settings.minBudget,
    }, stepLog);

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

  // ── 2. Filter projects ──────────────────────────────────────────────────────
  const filtered: Array<Project & { matchScore?: number }> = [];
  const { filterProject, computeMatchScore } = await import('./project-filter.service');

  for (const project of parseResult.newProjects) {
    const result = filterProject(project, settings, alreadyBidIds);
    if (result.passed) {
      filtered.push({
        ...project,
        matchScore: result.matchScore ?? computeMatchScore(project, settings.allowedCategories),
      });
    } else {
      log(logs, 'warning', `[Filter] SKIP "${project.title ?? project.projectUrl}": ${result.reason}`, {
        projectId: project.id,
        meta: { projectUrl: project.projectUrl, reason: result.reason },
      });
      bidsSkipped++;
    }
  }

  if (filtered.length === 0) {
    log(logs, 'info', `No projects passed the filter (${bidsSkipped} skipped). Cycle complete.`);
    return { logs, bidsSubmitted, bidsSkipped, errors };
  }

  log(logs, 'info', `${filtered.length} project(s) will be processed`, { meta: { count: filtered.length } });

  // ── 3. Process each project ─────────────────────────────────────────────────
  for (let i = 0; i < filtered.length; i++) {
    const project = filtered[i];

    if (getDailyCount('bids') >= settings.dailyLimit) {
      log(logs, 'warning', `Daily bid limit reached (${settings.dailyLimit}). Stopping.`);
      break;
    }

    const projectTitle = project.title ?? project.projectUrl ?? `project-${i + 1}`;
    const projectUrl   = project.projectUrl ?? '';
    const numericId    = project.freelancehuntId ?? project.id.replace('fh_', '');

    log(logs, 'info',
      `[${i + 1}/${filtered.length}] Processing: "${projectTitle}" — ${projectUrl}`,
      { projectId: project.id, projectTitle, meta: { matchScore: project.matchScore, projectUrl } }
    );

    // ── 4. Generate AI proposal ───────────────────────────────────────────────
    log(logs, 'info', `[${i + 1}/${filtered.length}] Generating AI proposal for "${projectTitle}"`, {
      projectId: project.id, projectTitle,
    });

    const bid = await generateAutoBid(project, companyProfile);

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

    // ── 5. Submit bid via REST API ────────────────────────────────────────────
    log(logs, 'info',
      `[${i + 1}/${filtered.length}] Submitting bid via API — project ${numericId}: ${projectUrl}`,
      { projectId: project.id, projectTitle, meta: { projectUrl } }
    );

    try {
      if (!projectUrl && !numericId) throw new Error('Project URL/ID is empty — cannot submit bid');

      const result = await sendFreelancehuntBid(apiToken, projectUrl || numericId, {
        text:     bid.text ?? '',
        budget:   bid.price ?? 0,
        days:     parseInt(String(bid.deadline)) || 14,
        currency: project.currency ?? 'UAH',
        logFn:    stepLog,
      });

      if (result.success) {
        alreadyBidIds.add(project.id);
        if (project.freelancehuntId) alreadyBidIds.add(project.freelancehuntId);
        incrementDailyCount('bids');
        bidsSubmitted++;

        await saveBid({
          ...bid,
          status: 'sent',
          freelancehuntBidId: result.bidId,
          sentAt: new Date().toISOString(),
        });

        log(logs, 'success',
          `BID SENT [${i + 1}/${filtered.length}] — bidId: ${result.bidId ?? 'unknown'} | "${projectTitle}"`,
          {
            projectId: project.id, projectTitle, bidId: result.bidId,
            meta: { price: bid.price, deadline: bid.deadline, matchScore: project.matchScore, projectUrl },
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

      // ALREADY_BID / PROJECT_CLOSED / VALIDATION_ERROR = skip, non-fatal
      const isSkippable =
        msg.startsWith('ALREADY_BID:') ||
        msg.startsWith('PROJECT_CLOSED:') ||
        msg.startsWith('VALIDATION_ERROR:') ||
        msg.includes('already placed');

      if (isSkippable) {
        log(logs, 'warning',
          `[${i + 1}/${filtered.length}] SKIP: "${projectTitle}" — ${msg.slice(0, 160)}`,
          { projectId: project.id, projectTitle, meta: { projectUrl, reason: msg } }
        );
        bidsSkipped++;
        continue;
      }

      log(logs, 'error',
        `[${i + 1}/${filtered.length}] FAILED: "${projectTitle}" — ${msg}`,
        { projectId: project.id, projectTitle, meta: { projectUrl } }
      );
      errors++;
      bidsSkipped++;
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
