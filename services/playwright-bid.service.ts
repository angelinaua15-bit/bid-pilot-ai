/**
 * services/playwright-bid.service.ts
 *
 * Places a bid on a Freelancehunt project through the authenticated browser
 * session — never the API. Freelancehunt API v2 has no create-bid endpoint
 * (the old public route POST /v2/projects/{id}/bids returns HTTP 410), so the
 * only programmatic way to bid is to drive the logged-in website.
 *
 * Session: reuses the single shared context from playwright-browser.service.ts
 * (the same storageState that parseProjectsFromFeed uses).
 *
 * Field location: the bid form is located and its fields are matched by role
 * (textarea = comment; numeric inputs matched by nearby label/name/placeholder
 * text for amount and term). This survives DOM/class changes; if a project page
 * has no recognizable bid form, the page HTML is dumped to the log so the exact
 * reason is visible.
 */

import type { Page } from 'playwright';
import { getAuthenticatedContext } from './playwright-browser.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BidLogFn = (
  level: 'info' | 'success' | 'warning' | 'error',
  message: string,
  meta?: Record<string, unknown>
) => void;

export interface BrowserBidInput {
  userId: string;             // whose authenticated session to use
  projectId: string;          // numeric id, e.g. "299170"
  projectUrl: string;         // full project page URL
  comment: string;            // proposal text
  amount: number;             // bid amount (project currency)
  days: number;               // term in days
  safeType?: 'safe' | 'no_safe';
  /** When true: locate + fill the form but DO NOT click submit. For verification. */
  dryRun?: boolean;
  log?: BidLogFn;
}

export interface BrowserBidResult {
  success: boolean;
  bidId?: string;
  status: 'sent' | 'already_bid' | 'project_closed' | 'login_required' | 'dry_run' | 'failed';
  reason: string;
}

const noop: BidLogFn = () => {};

// ─── In-page form discovery report ────────────────────────────────────────────

interface FormReport {
  found: boolean;
  hasAmount: boolean;
  hasDays: boolean;
  hasComment: boolean;
  hasSubmit: boolean;
  alreadyBid: boolean;
  closed: boolean;
  loginWall: boolean;
}

/**
 * Runs inside the page. Finds the bid form and tags its fields with data-fh-*
 * attributes so the Node side can fill them with stable locators. Also reports
 * page-level signals (already bid / closed / login wall).
 */
async function locateAndTagBidForm(page: Page): Promise<FormReport> {
  return page.evaluate(() => {
    const norm = (s: string | null | undefined) => (s ?? '').toLowerCase();
    const bodyText = norm(document.body.textContent);

    const AMOUNT_KW = ['бюджет', 'сума', 'сумма', 'ставк', 'ціна', 'цена', 'варті', 'amount', 'budget', 'price', 'bid'];
    const DAYS_KW = ['термін', 'строк', 'днів', 'дні', 'дня', 'дней', 'срок', 'days', 'term', 'deadline'];
    const BID_KW = ['заявк', 'ставк', 'пропоз', 'bid', 'proposal', 'offer'];
    const ALREADY_KW = ['ви вже подали', 'вы уже подали', 'ваша заявка', 'your bid', 'заявку подано'];
    const CLOSED_KW = ['закрито', 'закрыт', 'не приймає заявки', 'не принимает заявки', 'завершено', 'closed'];

    const report: FormReport = {
      found: false, hasAmount: false, hasDays: false, hasComment: false,
      hasSubmit: false, alreadyBid: false, closed: false, loginWall: false,
    };

    report.alreadyBid = ALREADY_KW.some((k) => bodyText.includes(k));
    report.closed = CLOSED_KW.some((k) => bodyText.includes(k));
    report.loginWall =
      !!document.querySelector('a[href*="/login"]') &&
      !document.querySelector('textarea');

    if (report.alreadyBid || report.closed) return report;

    // Label text associated with an input (label[for], wrapping label, aria, placeholder, name/id)
    const fieldContext = (el: HTMLElement): string => {
      let ctx = `${el.getAttribute('name') ?? ''} ${el.id} ${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('aria-label') ?? ''}`;
      if (el.id) {
        const lbl = document.querySelector(`label[for="${el.id}"]`);
        if (lbl) ctx += ' ' + (lbl.textContent ?? '');
      }
      const wrap = el.closest('label, .field, .form-group, .input, p, div');
      if (wrap) ctx += ' ' + (wrap.textContent ?? '').slice(0, 120);
      return norm(ctx);
    };

    // Candidate forms: any form (or the document) that contains a textarea.
    const forms = Array.from(document.querySelectorAll('form')).filter(
      (f) => f.querySelector('textarea')
    );
    const scope: ParentNode =
      forms.sort((a, b) => {
        const sa = BID_KW.some((k) => norm(a.textContent).includes(k)) ? 1 : 0;
        const sb = BID_KW.some((k) => norm(b.textContent).includes(k)) ? 1 : 0;
        return sb - sa;
      })[0] ?? document;

    if (scope instanceof HTMLElement) scope.setAttribute('data-fh-bidform', '1');

    // Comment = the (first) textarea in scope
    const textarea = scope.querySelector('textarea') as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.setAttribute('data-fh-role', 'comment');
      report.hasComment = true;
    }

    // Numeric/text inputs in scope → classify into amount / days by context keywords
    const inputs = Array.from(
      scope.querySelectorAll('input')
    ).filter((i) => {
      const t = (i.getAttribute('type') ?? 'text').toLowerCase();
      return ['number', 'text', 'tel', ''].includes(t);
    }) as HTMLInputElement[];

    let amountEl: HTMLInputElement | null = null;
    let daysEl: HTMLInputElement | null = null;

    for (const inp of inputs) {
      const ctx = fieldContext(inp);
      if (!daysEl && DAYS_KW.some((k) => ctx.includes(k))) { daysEl = inp; continue; }
      if (!amountEl && AMOUNT_KW.some((k) => ctx.includes(k))) { amountEl = inp; continue; }
    }
    // Fallback: if exactly two unclassified numeric inputs, assume [amount, days]
    if ((!amountEl || !daysEl)) {
      const numeric = inputs.filter((i) => (i.getAttribute('type') ?? '') === 'number');
      const pool = numeric.length ? numeric : inputs;
      if (!amountEl && pool[0]) amountEl = pool[0];
      if (!daysEl && pool[1]) daysEl = pool[1];
    }

    if (amountEl) { amountEl.setAttribute('data-fh-role', 'amount'); report.hasAmount = true; }
    if (daysEl)   { daysEl.setAttribute('data-fh-role', 'days');   report.hasDays = true; }

    // Submit control within scope
    const submit =
      (scope.querySelector('button[type="submit"], input[type="submit"]') as HTMLElement | null) ??
      (Array.from(scope.querySelectorAll('button')).find((b) =>
        BID_KW.some((k) => norm(b.textContent).includes(k))
      ) as HTMLElement | undefined) ??
      (scope.querySelector('button') as HTMLElement | null);
    if (submit) { submit.setAttribute('data-fh-role', 'submit'); report.hasSubmit = true; }

    report.found = report.hasComment && report.hasSubmit && (report.hasAmount || report.hasDays);
    return report;
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Place a bid through the authenticated browser session.
 * Returns success:true ONLY when the bid is verifiably posted. Never mocks
 * success; on any failure returns an exact, prefixed reason.
 */
export async function submitBidViaBrowser(input: BrowserBidInput): Promise<BrowserBidResult> {
  const log = input.log ?? noop;
  const { projectId, projectUrl, comment, amount, days } = input;
  const safeType = input.safeType ?? 'no_safe';

  if (!projectUrl) {
    return { success: false, status: 'failed', reason: 'NO_PROJECT_URL: projectUrl is required for browser submit' };
  }

  let page: Page;
  try {
    const context = await getAuthenticatedContext(input.userId);
    page = await context.newPage();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log('error', `[FH-Browser] No authenticated session for user ${input.userId} — ${reason}`, { projectId });
    // AUTH_STATE_MISSING / USER_ID_REQUIRED surface here
    return { success: false, status: 'login_required', reason: `NO_SESSION: ${reason}` };
  }

  try {
    log('info', `[FH-Browser] GET ${projectUrl}`, { projectId, meta: { projectUrl } });
    await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(500);

    const report = await locateAndTagBidForm(page);

    if (report.loginWall) {
      log('error', `[FH-Browser] Login wall — session expired`, { projectId });
      return { success: false, status: 'login_required', reason: 'LOGIN_REQUIRED: session expired or not authenticated' };
    }
    if (report.alreadyBid) {
      log('warning', `[FH-Browser] Bid already exists on project ${projectId}`, { projectId });
      return { success: false, status: 'already_bid', reason: 'ALREADY_BID: a bid from this account already exists' };
    }
    if (report.closed) {
      log('warning', `[FH-Browser] Project ${projectId} is closed`, { projectId });
      return { success: false, status: 'project_closed', reason: 'PROJECT_CLOSED: not accepting bids' };
    }
    if (!report.found) {
      const html = (await page.content().catch(() => '')).slice(0, 1500);
      const missing = [
        !report.hasComment && 'comment',
        !report.hasSubmit && 'submit',
        !report.hasAmount && 'amount',
        !report.hasDays && 'days',
      ].filter(Boolean).join(', ');
      log('error', `[FH-Browser] Bid form not usable on ${projectUrl} — missing: ${missing}`, {
        projectId, meta: { missing, htmlSnippet: html },
      });
      return { success: false, status: 'failed', reason: `NO_BID_FORM: form not found/usable (missing: ${missing})` };
    }

    log('info',
      `[FH-Browser] Filling bid — amount:${amount} days:${days} safe:${safeType} commentLen:${comment.length}`,
      { projectId, meta: { amount, days, safeType, commentPreview: comment.slice(0, 120) } }
    );

    // Fill via the data-fh-role tags set in-page
    if (report.hasComment) {
      await page.locator('[data-fh-role="comment"]').first().fill(comment);
    }
    if (report.hasAmount) {
      await page.locator('[data-fh-role="amount"]').first().fill(String(amount));
    }
    if (report.hasDays) {
      await page.locator('[data-fh-role="days"]').first().fill(String(days));
    }

    // Safe-deal radio, if present (best-effort)
    const safeValue = safeType === 'safe' ? 'safe' : 'no_safe';
    const safeRadio = page.locator(`input[name="safe_type"][value="${safeValue}"]`).first();
    if (await safeRadio.isVisible({ timeout: 600 }).catch(() => false)) {
      await safeRadio.check().catch(() => {});
    }

    if (input.dryRun) {
      log('success', `[FH-Browser] DRY RUN — form located & filled, submit skipped (project ${projectId})`, { projectId });
      return { success: false, status: 'dry_run', reason: 'DRY_RUN_OK: form located and filled; submit intentionally skipped' };
    }

    log('info', `[FH-Browser] Submitting bid for project ${projectId}`, { projectId });
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {}),
      page.locator('[data-fh-role="submit"]').first().click({ timeout: 10_000 }),
    ]);
    await page.waitForTimeout(1_200);

    // Validation error surfaced by the form?
    const formError = await page
      .locator('.has-error, .form-error, [class*="error-message"], [class*="invalid-feedback"]')
      .first()
      .innerText()
      .catch(() => '');
    if (formError && formError.trim()) {
      log('error', `[FH-Browser] Form validation error: ${formError.trim()}`, { projectId });
      return { success: false, status: 'failed', reason: `VALIDATION_ERROR: ${formError.trim().slice(0, 200)}` };
    }

    // Confirm: re-scan — our bid now present OR the form is gone
    const after = await locateAndTagBidForm(page).catch(() => null);
    const confirmed = after?.alreadyBid === true || after?.found === false;

    if (confirmed) {
      let bidId: string | undefined;
      const posted = page.locator('[data-bid-id], [id^="bid-"]').first();
      if (await posted.count().catch(() => 0)) {
        bidId =
          (await posted.getAttribute('data-bid-id').catch(() => null)) ??
          (await posted.getAttribute('id').catch(() => null))?.replace(/\D/g, '') ??
          undefined;
      }
      log('success', `[FH-Browser] Bid CONFIRMED for project ${projectId}${bidId ? ` (bidId:${bidId})` : ''}`, {
        projectId, bidId, meta: { finalUrl: page.url() },
      });
      return { success: true, status: 'sent', bidId, reason: 'OK' };
    }

    const finalUrl = page.url();
    const dump = (await page.content().catch(() => '')).slice(0, 1500);
    log('error', `[FH-Browser] Could not confirm bid for project ${projectId} — finalUrl ${finalUrl}`, {
      projectId, meta: { finalUrl, htmlSnippet: dump },
    });
    return { success: false, status: 'failed', reason: `UNCONFIRMED: submit produced no confirmable result (finalUrl=${finalUrl})` };
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    log('error', `[FH-Browser] Exception bidding project ${projectId} — ${reason}`, { projectId });
    return { success: false, status: 'failed', reason: `EXCEPTION: ${reason}` };
  } finally {
    await page.close().catch(() => {});
  }
}