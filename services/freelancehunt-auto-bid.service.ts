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
import { submitBidViaBrowser } from './playwright-bid.service';
import { sendTelegramMessage } from './telegram.service';
import { shouldApply } from './project-filter.service';
import { config } from '@/lib/config';
import { saveBid, saveApplication, appendLog as persistLog } from '@/lib/db';


export interface AutoBidRunResult {
  logs: AutoBidLog[];
  bidsSubmitted: number;
  bidsSkipped: number;
  errors: number;
}

// ─── Daily counters (per-user, reset on new day / process restart) ───────────

const dailyCounters: Map<string, { date: string; count: number }> = new Map();

/** key = `${userId}:bids` or `global:bids` */
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

// ─── Per-user in-cycle dedup sets ─────────────────────────────────────────────

/** userId → Set of project IDs already bid in the current cycle */
const alreadyBidByUser: Map<string, Set<string>> = new Map();

function getAlreadyBidSet(userId: string): Set<string> {
  if (!alreadyBidByUser.has(userId)) alreadyBidByUser.set(userId, new Set());
  return alreadyBidByUser.get(userId)!;
}

/** @deprecated use getAlreadyBidSet(userId) — kept for legacy global mode */
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

  const dailyKey  = settings.userId ? `${settings.userId}:bids` : 'global:bids';
  const bidSet    = settings.userId ? getAlreadyBidSet(settings.userId) : alreadyBidIds;
  const dailyUsed = getDailyCount(dailyKey);
  log(logs, 'info', `Cycle started. Daily limit: ${settings.dailyLimit} (used today: ${dailyUsed})${settings.userId ? ` [user: ${settings.userId}]` : ''}`, {
    meta: { dailyUsed, dailyLimit: settings.dailyLimit, userId: settings.userId },
  });

  // ── Pre-flight — verify browser session mode ──────────────────────────────
  if (isMockMode) {
    log(logs, 'warning', '[Pre-flight] MOCK mode (FREELANCEHUNT_MOCK=1) — bids will not be submitted to Freelancehunt');
  } else {
    // Check that we have a userId and a Supabase-backed session
    const userId = settings.userId;
    if (!userId) {
      log(logs, 'error', '[Pre-flight] FAILED: settings.userId is missing — cannot load per-user browser session. NO_SESSION');
      errors++;
      return { logs, bidsSubmitted, bidsSkipped, errors };
    }
    // Check session existence via Supabase (non-fatal here — bid loop will surface LOGIN_REQUIRED)
    try {
      const { getSessionStatus } = await import('./freelancehunt-session.service');
      const sess = await getSessionStatus(userId);
      if (sess.connected) {
        log(logs, 'success', `[Pre-flight] SESSION_FOUND — user ${userId}, username: ${sess.username ?? 'unknown'}, cookies: ${sess.cookieCount}`);
      } else {
        log(logs, 'error', `[Pre-flight] NO_SESSION — ${sess.reason ?? 'no session in DB'}. User must reconnect Freelancehunt account.`);
        errors++;
        return { logs, bidsSubmitted, bidsSkipped, errors };
      }
    } catch (sessErr) {
      // If Supabase isn't configured, warn but continue — the bid service will error per-project
      log(logs, 'warning', `[Pre-flight] Could not verify session from DB: ${sessErr instanceof Error ? sessErr.message : String(sessErr)}. Proceeding anyway.`);
    }
    log(logs, 'success', '[Pre-flight] Browser-session mode — bids submitted via Playwright (no deprecated API)');
  }

  // ── Step logger — pipes parser/submission logs into this cycle's log[] ──────
  const stepLog: StepLogFn = (level, message, meta) => {
    const safeMsg = (message != null && String(message).trim() !== '')
      ? String(message)
      : '(no message)';
    log(logs, level, safeMsg, meta ? { meta } : undefined);
    externalStepLog?.(level, safeMsg, meta);
  };

  // ── 1. Parse projects from API ────────────────────────────���─────��───────────
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
    if (getDailyCount(dailyKey) >= dailyLimit) {
      log(logs, 'warning', `Daily bid limit reached (${settings.dailyLimit}). Stopping.`);
      break;
    }

    const projectTitle = project.title ?? project.projectUrl ?? `project-${i + 1}`;
    const projectUrl   = project.projectUrl ?? '';
    const numericId    = project.freelancehuntId ?? project.id.replace('fh_', '');

    // ── In-cycle dedup ────────────────────────────────────────────────────────
    if (bidSet.has(project.id) || (project.freelancehuntId && bidSet.has(project.freelancehuntId))) {
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

    // ── Multi-stage filter: budget → blocked keywords → allowed keywords → AI score ─
    const filter = await shouldApply(project, Boolean(process.env.OPENAI_API_KEY));
    if (!filter.allowed) {
      const detail = [
        `stage=${filter.stage}`,
        `budget=${filter.budget} ${filter.currency}`,
        `category="${filter.category}"`,
        filter.blockedKeywords.length > 0 ? `blocked=[${filter.blockedKeywords.slice(0, 3).join(', ')}]` : null,
        filter.matchedKeywords.length > 0 ? `matched=[${filter.matchedKeywords.slice(0, 3).join(', ')}]` : null,
        filter.aiScore !== undefined ? `ai_score=${filter.aiScore}` : null,
      ].filter(Boolean).join(' | ');

      log(logs, 'info',
        `[SKIP] "${projectTitle}" — ${filter.reason} | ${detail}`,
        { projectId: project.id, projectTitle, meta: { filterStage: filter.stage, aiScore: filter.aiScore } }
      );

      // Persist so Dashboard "Skipped" tab shows real data
      await saveApplication({
        id:              `app_skip_${project.id}_${Date.now()}`,
        userId:          settings.userId,
        projectId:       project.id,
        freelancehuntId: project.freelancehuntId ?? undefined,
        title:           projectTitle,
        url:             projectUrl,
        budget:          filter.budget,
        currency:        filter.currency,
        status:          'skipped',
        createdAt:       new Date().toISOString(),
        aiScore:         filter.aiScore,
        matchedKeywords: filter.matchedKeywords,
        blockedKeywords: filter.blockedKeywords,
        skippedReason:   filter.reason,
        filterStage:     filter.stage,
      }).catch(() => {});

      bidsSkipped++;
      continue;
    }

    log(logs, 'info',
      `[FILTER PASS] "${projectTitle}" | keywords=[${filter.matchedKeywords.slice(0, 4).join(', ')}]${filter.aiScore !== undefined ? ` | ai_score=${filter.aiScore}` : ''} | budget=${filter.budget} ${filter.currency}`,
      { projectId: project.id, projectTitle }
    );

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

    // ── 5. Submit bid via browser session (Playwright) ───────────────────────
    // API POST /v2/projects/{id}/bids returns HTTP 410 — browser submit only.
    // Parse days from deadline string: "14 днів" → 14, "21 день" → 21
    const daysRaw = parseInt(String(bid.deadline ?? '14'), 10);
    const days    = isNaN(daysRaw) || daysRaw <= 0 ? 14 : daysRaw;

    // Budget must be > 0 — use project budget as floor if AI returned 0
    const budgetAmount = (bid.price ?? 0) > 0
      ? bid.price
      : project.budget > 0
        ? project.budget
        : 500;

    const projectIdentifier = numericId || project.freelancehuntId || projectUrl;

    if (!projectIdentifier) {
      log(logs, 'error',
        `[${i + 1}/${filtered.length}] SKIP: "${projectTitle}" — no project ID or URL to submit bid`,
        { projectId: project.id, projectTitle }
      );
      errors++;
      continue;
    }

    log(logs, 'info',
      `BROWSER_SUBMIT_STARTED — "${projectTitle}" | id:${projectIdentifier} | budget:${budgetAmount} ${project.currency ?? 'UAH'} | days:${days} | user:${settings.userId}`,
      { projectId: project.id, projectTitle }
    );

    try {
      const result = await submitBidViaBrowser({
        userId:     settings.userId,
        projectId:  numericId,
        projectUrl,                                  // real project page URL is required
        comment:    bid.text ?? '',
        amount:     budgetAmount!,
        days,
        safeType:   'no_safe',
        log: (level, message, meta) =>
          stepLog(level as 'info' | 'success' | 'warning' | 'error', message, meta),
      });

      if (result.success) {
        bidSet.add(project.id);
        if (project.freelancehuntId) bidSet.add(project.freelancehuntId);
        globalProcessedIds?.add(project.id);
        if (project.freelancehuntId) globalProcessedIds?.add(project.freelancehuntId);
        if (numericId) globalProcessedIds?.add(numericId);
        incrementDailyCount(dailyKey);
        bidsSubmitted++;

        const sentAt = new Date().toISOString();

        await saveBid({
          ...bid,
          status:             'sent',
          freelancehuntBidId: result.bidId,
          sentAt,
        });

        await saveApplication({
          id:                 `app_sent_${project.id}_${Date.now()}`,
          userId:             settings.userId,
          projectId:          project.id,
          freelancehuntId:    project.freelancehuntId ?? undefined,
          title:              projectTitle,
          url:                projectUrl,
          budget:             budgetAmount ?? project.budget,
          currency:           project.currency ?? 'UAH',
          deadline:           bid.deadline,
          status:             'sent',
          createdAt:          bid.createdAt ?? sentAt,
          sentAt,
          proposalText:       bid.text,
          proposalPrice:      bid.price,
          freelancehuntBidId: result.bidId,
          aiScore:            filter.aiScore,
          matchedKeywords:    filter.matchedKeywords,
        }).catch(() => {});

        log(logs, 'success',
          `BID_CONFIRMED [${i + 1}/${filtered.length}] — "${projectTitle}" | bidId:${result.bidId ?? 'n/a'} | price:${budgetAmount} ${project.currency ?? 'UAH'} | days:${days} | url:${projectUrl}`,
          {
            projectId: project.id, projectTitle, bidId: result.bidId,
            meta: { price: budgetAmount, deadline: days, matchScore: project.matchScore, projectUrl, strategy: 'browser' },
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
            projectUrl ? `<a href="${projectUrl}">View project</a>` : '',
          ].filter(Boolean).join('\n');

          await sendTelegramMessage(chatId, msg, {
            parseMode: 'HTML',
            disableWebPagePreview: true,
          });
        }
      } else {
        // Map the browser submit's exact status to your canonical error prefixes
        // so the catch-block below classifies and persists the precise reason.
        const statusToCode: Record<string, string> = {
          already_bid:    'ALREADY_BID',
          project_closed: 'PROJECT_CLOSED',
          login_required: 'LOGIN_REQUIRED',
          failed:         'BROWSER_SUBMIT_FAILED',
        };
        const prefix = statusToCode[result.status] ?? 'BROWSER_SUBMIT_FAILED';
        throw new Error(`${prefix}: ${result.reason}`);
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
        const skipCode  = msg.startsWith('ALREADY_BID:') ? 'ALREADY_BID' : 'PROJECT_CLOSED';
        const skipLabel = skipCode === 'ALREADY_BID' ? 'Заявка вже подана' : 'Проєкт закрито';
        log(logs, 'warning',
          `SKIPPED [${i + 1}/${filtered.length}] — "${projectTitle}" | code:${skipCode} | url:${projectUrl}`,
          { projectId: project.id, projectTitle, meta: { projectUrl, reason: msg } }
        );
        bidsSkipped++;
        await saveApplication({
          id:              `app_skip_browser_${project.id}_${Date.now()}`,
          userId:          settings.userId,
          projectId:       project.id,
          freelancehuntId: project.freelancehuntId ?? undefined,
          title:           projectTitle,
          url:             projectUrl,
          budget:          project.budget,
          currency:        project.currency ?? 'UAH',
          status:          'skipped',
          createdAt:       new Date().toISOString(),
          skippedReason:   `${skipCode}: ${skipLabel}`,
        }).catch(() => {});
        // Mark as seen so we don't retry this project
        bidSet.add(project.id);
        if (project.freelancehuntId) bidSet.add(project.freelancehuntId);
        continue;
      }

      // All other errors: log full error, count as failure, continue to next project

      // Extract canonical error code from REST API error message prefix
      const ERROR_CODES = [
        'INVALID_TOKEN',
        'FORBIDDEN',
        'NOT_FOUND',
        'RATE_LIMITED',
        'ALREADY_BID',
        'PROJECT_CLOSED',
        'INVALID_ID',
        'API_ERROR_400',
        'API_ERROR_422',
        'API_ERROR_500',
        'JSON_PARSE_ERROR',
        // Browser-submit + deprecated-endpoint codes
        'ENDPOINT_GONE_410',
        'BID_API_UNSUPPORTED',
        'BROWSER_SUBMIT_FAILED',
        'LOGIN_REQUIRED',
        'NO_SESSION',
        'NO_BID_FORM',
        'FORM_FIELD_MISSING',
        'VALIDATION_ERROR',
        'UNCONFIRMED',
      ];
      const detectedCode = ERROR_CODES.find((code) => msg.includes(code)) ?? 'UNKNOWN_ERROR';

      const ERROR_LABELS: Record<string, string> = {
        INVALID_TOKEN:    'Невірна або відсутня сесія браузера',
        FORBIDDEN:        'Доступ заборонено — акаунт може бути обмежений',
        NOT_FOUND:        'Проєкт не знайдено (404)',
        RATE_LIMITED:     'Перевищено ліміт запитів — зачекайте',
        ALREADY_BID:      'Заявка вже подана на цей проєкт',
        PROJECT_CLOSED:   'Проєкт закрито або завершено',
        INVALID_ID:       'Невірний ідентифікатор проєкту',
        API_ERROR_400:    'Помилка запиту (400) — невірні дані',
        API_ERROR_422:    'Помилка валідації (422)',
        API_ERROR_500:    'Помилка сервера Freelancehunt (500)',
        JSON_PARSE_ERROR: 'Некоректна відповідь від API',
        ENDPOINT_GONE_410:     'Endpoint застарів (410) — використовуйте браузерний сабміт',
        BID_API_UNSUPPORTED:   'API не підтримує подачу заявок — потрібен браузерний сабміт',
        BROWSER_SUBMIT_FAILED: 'Не вдалося подати заявку через браузер',
        LOGIN_REQUIRED:        'Сесію втрачено — потрібно повторно увійти у Freelancehunt',
        NO_SESSION:            'Немає автентифікованої сесії браузера',
        NO_BID_FORM:           'Форму заявки не знайдено (перевірте селектори / право подачі)',
        FORM_FIELD_MISSING:    'Поле форми не знайдено (перевірте селектори)',
        VALIDATION_ERROR:      'Форма повернула помилку валідації',
        UNCONFIRMED:           'Сабміт не підтверджено — заявку не зараховано',
        UNKNOWN_ERROR:    'Невідома помилка',
      };
      const humanLabel = ERROR_LABELS[detectedCode] ?? msg.slice(0, 200);

      log(logs, 'error',
        `FAILED [${i + 1}/${filtered.length}] — "${projectTitle}" | code:${detectedCode} | ${msg.slice(0, 300)} | url:${projectUrl}`,
        { projectId: project.id, projectTitle, meta: { projectUrl, errorCode: detectedCode, errorMsg: msg } }
      );
      errors++;

      // Persist failed application so Dashboard and Заявки tab show it with reason
      await saveApplication({
        id:              `app_fail_${project.id}_${Date.now()}`,
        userId:          settings.userId,
        projectId:       project.id,
        freelancehuntId: project.freelancehuntId ?? undefined,
        title:           projectTitle,
        url:             projectUrl,
        budget:          filter.budget ?? project.budget,
        currency:        filter.currency ?? project.currency ?? 'UAH',
        status:          'failed',
        createdAt:       new Date().toISOString(),
        errorReason:     `${detectedCode}: ${humanLabel}`,
        aiScore:         filter.aiScore,
        matchedKeywords: filter.matchedKeywords,
      }).catch(() => {});

      // Telegram error notification
      if (chatId) {
        const errMsg = [
          '<b>Bid failed</b>',
          '',
          `<b>Project:</b> ${projectTitle}`,
          `<b>Error code:</b> <code>${detectedCode}</code>`,
          `<b>Details:</b> ${humanLabel}`,
          projectUrl ? `<a href="${projectUrl}">View project</a>` : '',
        ].filter(Boolean).join('\n');
        await sendTelegramMessage(chatId, errMsg, { parseMode: 'HTML', disableWebPagePreview: true }).catch(() => {});
      }

      continue;
    }

    // ── 7. Delay between bids ──────────────��──────────────────────────────────
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
