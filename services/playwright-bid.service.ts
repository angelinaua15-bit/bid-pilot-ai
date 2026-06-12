/**
 * services/playwright-bid.service.ts
 *
 * Submits a bid to a Freelancehunt project using the AUTHENTICATED browser
 * session — NOT the REST API.
 *
 * WHY: Freelancehunt API v2 has NO "create bid" endpoint. The old public
 * POST /v2/projects/{id}/bids route was retired and now returns HTTP 410
 * ("This public endpoint is no longer available due to API v2 deprecation").
 * The only way to place a bid programmatically is through the logged-in
 * website, exactly as a human would.
 *
 * This service reuses the same authenticated Playwright context that
 * playwright-browser.service.ts already uses for parsing the projects feed.
 *
 * ── SESSION (real, not fake) ─────────────────────────────────────────────────
 * This file imports `getAuthenticatedContext` from playwright-browser.service.ts
 * and opens a page on that SAME logged-in context (the storageState session your
 * parser already uses). It never logs in or launches a throwaway browser.
 * Add `getAuthenticatedContext` to playwright-browser.service.ts using the
 * snippet in playwright-browser.additions.ts shipped next to this file.
 *
 * ── SELECTORS (verify against the live DOM once) ─────────────────────────────
 * I cannot see Freelancehunt's current bid-form HTML, so the selectors in
 * SELECTORS are best-effort with fallbacks. Open any open project page while
 * logged in, inspect the "Place a bid" form, and adjust the few strings in the
 * SELECTORS block. Everything else stays the same.
 */

import type { Page } from 'playwright';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BidLogFn = (
  level: 'info' | 'success' | 'warning' | 'error',
  message: string,
  meta?: Record<string, unknown>
) => void;

export interface BrowserBidInput {
  /** Numeric Freelancehunt project id, e.g. "299170" */
  projectId: string;
  /** Full project URL, e.g. https://freelancehunt.com/project/.../299170.html */
  projectUrl: string;
  /** Proposal text */
  comment: string;
  /** Bid amount (project currency) */
  amount: number;
  /** Days to complete */
  days: number;
  /** 'safe' = safe deal, 'no_safe' = without safe deal. Match the form's radio. */
  safeType?: 'safe' | 'no_safe';
  log?: BidLogFn;
}

export interface BrowserBidResult {
  success: boolean;
  /** Present only when we can read it back from the page after submit */
  bidId?: string;
  /** Machine-readable outcome */
  status: 'sent' | 'already_bid' | 'project_closed' | 'login_required' | 'failed';
  /** Human-readable exact reason (never generic) */
  reason: string;
}

// ─── Selectors — the ONLY thing likely to need tweaking ──────────────────────
// Each entry is an ordered list of fallback selectors; the first match wins.
const SELECTORS = {
  // The bid/proposal form container on the project page
  bidForm: ['form[action*="/bid"]', 'form#bid-form', 'form[name="bid"]', '.bid-form form'],
  // Amount input
  amount: ['input[name="amount"]', 'input[name*="amount"]', 'input#bid_amount'],
  // Days / term input
  days: ['input[name="days"]', 'input[name*="days"]', 'input#bid_days'],
  // Comment / proposal textarea
  comment: ['textarea[name="comment"]', 'textarea[name*="comment"]', 'textarea#bid_comment'],
  // Safe-deal radio/checkbox (optional)
  safeYes: ['input[name="safe_type"][value="safe"]', 'input[value="safe"]'],
  safeNo: ['input[name="safe_type"][value="no_safe"]', 'input[value="no_safe"]'],
  // Submit button
  submit: ['button[type="submit"]', 'form button.button-submit', 'input[type="submit"]'],
  // Signals that you ALREADY placed a bid on this project
  alreadyBid: ['.my-bid', '[class*="your-bid"]', 'text=Ви вже подали заявку', 'text=Вы уже подали заявку'],
  // Signals the project is closed / not accepting bids
  closed: ['text=Проєкт закрито', 'text=Проект закрыт', 'text=не приймає заявки', '.project-closed'],
  // Signal we are NOT logged in
  loginWall: ['text=Увійти', 'a[href*="/login"]', 'form[action*="/login"]'],
  // After successful submit: the just-created bid block (used to read bidId)
  postedBid: ['[data-bid-id]', '.my-bid[data-id]', '[id^="bid-"]'],
};

const noop: BidLogFn = () => {};

async function firstVisible(page: Page, selectors: string[], timeout = 2_000) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    try {
      if (await loc.isVisible({ timeout })) return loc;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function exists(page: Page, selectors: string[], timeout = 1_500): Promise<boolean> {
  return (await firstVisible(page, selectors, timeout)) !== null;
}

// ─── Authenticated session — reused from playwright-browser.service.ts ────────
// This pulls the SAME logged-in Freelancehunt context that parseProjectsFromFeed
// uses (built from the saved storageState). It does NOT create a new login.
// You must add `getAuthenticatedContext` to playwright-browser.service.ts — see
// the snippet shipped alongside this file (playwright-browser.additions.ts).
import { getAuthenticatedContext } from './playwright-browser.service';

/** Returns a fresh Page on the shared authenticated context (same session as the parser). */
async function getAuthenticatedPage(): Promise<Page> {
  const context = await getAuthenticatedContext();
  return context.newPage();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Place a bid through the authenticated browser session.
 * Returns success:true ONLY when the bid is verifiably posted.
 * Never mocks success. Never returns a generic failure — always an exact reason.
 */
export async function submitBidViaBrowser(input: BrowserBidInput): Promise<BrowserBidResult> {
  const log = input.log ?? noop;
  const { projectId, projectUrl, comment, amount, days } = input;
  const safeType = input.safeType ?? 'no_safe';

  let page: Page;
  try {
    page = await getAuthenticatedPage();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log('error', `[FH-Browser] Cannot obtain authenticated page — ${reason}`, { projectId });
    return { success: false, status: 'login_required', reason: `NO_SESSION: ${reason}` };
  }

  try {
    log('info', `[FH-Browser] GET ${projectUrl}`, { projectId, meta: { projectUrl } });
    await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // 0. Logged in?
    if (await exists(page, SELECTORS.loginWall, 1_000) && !(await exists(page, SELECTORS.bidForm, 1_000))) {
      log('error', `[FH-Browser] Login wall detected — session expired`, { projectId });
      return { success: false, status: 'login_required', reason: 'LOGIN_REQUIRED: session expired or not authenticated' };
    }

    // 1. Already bid?
    if (await exists(page, SELECTORS.alreadyBid, 1_200)) {
      log('warning', `[FH-Browser] Bid already exists on project ${projectId}`, { projectId });
      return { success: false, status: 'already_bid', reason: 'ALREADY_BID: a bid from this account already exists' };
    }

    // 2. Closed?
    if (await exists(page, SELECTORS.closed, 1_200)) {
      log('warning', `[FH-Browser] Project ${projectId} is closed`, { projectId });
      return { success: false, status: 'project_closed', reason: 'PROJECT_CLOSED: not accepting bids' };
    }

    // 3. Bid form present?
    const form = await firstVisible(page, SELECTORS.bidForm, 4_000);
    if (!form) {
      const htmlSnippet = (await page.content().catch(() => '')).slice(0, 1200);
      log('error', `[FH-Browser] Bid form not found on ${projectUrl}`, { projectId, meta: { htmlSnippet } });
      return { success: false, status: 'failed', reason: 'NO_BID_FORM: bid form not found (selector mismatch or not eligible). See logged htmlSnippet.' };
    }

    // 4. Fill the form — log exactly what we submit
    log('info', `[FH-Browser] Filling bid form — amount:${amount} days:${days} safe:${safeType} commentLen:${comment.length}`, {
      projectId,
      meta: { amount, days, safeType, commentPreview: comment.slice(0, 120) },
    });

    const amountInput = await firstVisible(page, SELECTORS.amount, 3_000);
    const daysInput = await firstVisible(page, SELECTORS.days, 3_000);
    const commentInput = await firstVisible(page, SELECTORS.comment, 3_000);

    if (!amountInput || !daysInput || !commentInput) {
      const missing = [!amountInput && 'amount', !daysInput && 'days', !commentInput && 'comment'].filter(Boolean).join(', ');
      log('error', `[FH-Browser] Missing form field(s): ${missing}`, { projectId });
      return { success: false, status: 'failed', reason: `FORM_FIELD_MISSING: ${missing} (verify SELECTORS against live DOM)` };
    }

    await amountInput.fill(String(amount));
    await daysInput.fill(String(days));
    await commentInput.fill(comment);

    const safeSel = safeType === 'safe' ? SELECTORS.safeYes : SELECTORS.safeNo;
    const safeRadio = await firstVisible(page, safeSel, 800);
    if (safeRadio) await safeRadio.check().catch(() => {});

    // 5. Submit
    const submitBtn = await firstVisible(page, SELECTORS.submit, 3_000);
    if (!submitBtn) {
      log('error', `[FH-Browser] Submit button not found`, { projectId });
      return { success: false, status: 'failed', reason: 'NO_SUBMIT_BUTTON: verify submit selector' };
    }

    log('info', `[FH-Browser] Submitting bid for project ${projectId}`, { projectId });
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {}),
      submitBtn.click({ timeout: 10_000 }),
    ]);

    // 6. Verify outcome — success ONLY if we can confirm it
    await page.waitForTimeout(1_200);

    // 6a. Validation error surfaced by the form?
    const formError = await page
      .locator('.has-error, .form-error, [class*="error-message"]')
      .first()
      .innerText()
      .catch(() => '');
    if (formError && formError.trim()) {
      log('error', `[FH-Browser] Form validation error: ${formError.trim()}`, { projectId });
      return { success: false, status: 'failed', reason: `VALIDATION_ERROR: ${formError.trim().slice(0, 200)}` };
    }

    // 6b. Did our bid appear / form disappear?
    const nowAlreadyBid = await exists(page, SELECTORS.alreadyBid, 2_000);
    const formGone = !(await exists(page, SELECTORS.bidForm, 1_000));
    const postedEl = await firstVisible(page, SELECTORS.postedBid, 1_500);

    if (nowAlreadyBid || formGone || postedEl) {
      let bidId: string | undefined;
      if (postedEl) {
        bidId =
          (await postedEl.getAttribute('data-bid-id').catch(() => null)) ??
          (await postedEl.getAttribute('data-id').catch(() => null)) ??
          (await postedEl.getAttribute('id').catch(() => null))?.replace(/\D/g, '') ??
          undefined;
      }
      log('success', `[FH-Browser] Bid CONFIRMED for project ${projectId}${bidId ? ` (bidId:${bidId})` : ''}`, {
        projectId,
        bidId,
        meta: { finalUrl: page.url() },
      });
      return { success: true, status: 'sent', bidId, reason: 'OK' };
    }

    // 6c. Could not confirm — treat as failure (no mock success), dump state
    const finalUrl = page.url();
    const dump = (await page.content().catch(() => '')).slice(0, 1200);
    log('error', `[FH-Browser] Could not confirm bid for project ${projectId} — final URL ${finalUrl}`, {
      projectId,
      meta: { finalUrl, htmlSnippet: dump },
    });
    return { success: false, status: 'failed', reason: `UNCONFIRMED: submit did not produce a confirmable result. finalUrl=${finalUrl}` };
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    log('error', `[FH-Browser] Exception while bidding project ${projectId} — ${reason}`, { projectId });
    return { success: false, status: 'failed', reason: `EXCEPTION: ${reason}` };
  } finally {
    // Close only the page, NOT the shared context/browser.
    await page.close().catch(() => {});
  }
}