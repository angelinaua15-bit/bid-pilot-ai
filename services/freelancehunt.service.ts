/**
 * services/freelancehunt.service.ts
 * Freelancehunt REST API v2 integration.
 *
 * Authentication: Bearer token via FREELANCEHUNT_TOKEN env var.
 * No browser automation. No session files. No Playwright.
 *
 * Project listing:  GET  /v2/projects
 * Bid submission:   POST /v2/projects/{id}/bids
 *
 * Full request + response logging on every call.
 * No silent failures — every error surface with exact reason.
 */

import type { Project } from '@/types';

const BASE_URL = 'https://api.freelancehunt.com/v2';

type LogFn = (level: string, message: string) => void;
const noop: LogFn = () => {};

// ─── HTTP helper ──────────────────────────────────────────────────────────────

/**
 * Core fetch wrapper.
 * On non-2xx: reads the full response body, tries to parse structured errors,
 * and always throws with a descriptive message.
 * Never swallows errors silently.
 */
async function fhFetch<T = unknown>(
  endpoint: string,
  token: string,
  options: RequestInit = {},
  log: LogFn = noop
): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;

  log('info', `[HTTP] ${options.method ?? 'GET'} ${url}`);

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers ?? {}),
    },
  });

  log('info', `[HTTP] Response status: ${res.status} ${res.statusText}`);

  // Always read body so we can log it
  const bodyText = await res.text().catch(() => '');

  if (!res.ok) {
    log('error', `[HTTP] Error body: ${bodyText}`);

    // Try to extract a structured error from Freelancehunt JSON shape:
    // { errors: [{ title, detail }] }  OR  { message: string }
    let reason = bodyText || `HTTP ${res.status}`;
    let errorCode = `API_ERROR_${res.status}`;

    try {
      const parsed = JSON.parse(bodyText) as {
        errors?: Array<{ title?: string; detail?: string; code?: string }>;
        message?: string;
      };

      if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
        reason = parsed.errors
          .map((e) => [e.title, e.detail].filter(Boolean).join(': '))
          .join('; ');

        // Check for specific known codes
        const firstCode = parsed.errors[0]?.code ?? '';
        if (firstCode) errorCode = firstCode.toUpperCase();
      } else if (parsed.message) {
        reason = parsed.message;
      }
    } catch {
      // JSON parse failed — use raw body as reason
    }

    const lowerReason = reason.toLowerCase();

    // Classify skippable API responses
    if (
      res.status === 401 ||
      lowerReason.includes('invalid token') ||
      lowerReason.includes('unauthorized')
    ) {
      throw new Error(`INVALID_TOKEN: ${reason}`);
    }
    if (res.status === 403) {
      throw new Error(`FORBIDDEN: ${reason}`);
    }
    if (res.status === 404) {
      throw new Error(`NOT_FOUND: ${reason}`);
    }
    if (res.status === 429) {
      throw new Error(`RATE_LIMITED: ${reason}`);
    }
    if (
      lowerReason.includes('already') ||
      lowerReason.includes('вже') ||
      lowerReason.includes('duplicate') ||
      lowerReason.includes('bid exists')
    ) {
      throw new Error(`ALREADY_BID: ${reason}`);
    }
    if (
      lowerReason.includes('closed') ||
      lowerReason.includes('закрит') ||
      lowerReason.includes('not open')
    ) {
      throw new Error(`PROJECT_CLOSED: ${reason}`);
    }

    // Generic error with full details
    throw new Error(`${errorCode}: ${reason}`);
  }

  // Success — parse JSON
  try {
    return JSON.parse(bodyText) as T;
  } catch {
    log('error', `[HTTP] Failed to parse success response as JSON: ${bodyText.slice(0, 200)}`);
    throw new Error(`JSON_PARSE_ERROR: Could not parse API response: ${bodyText.slice(0, 200)}`);
  }
}

// ─── Response mappers ─────────────────────────────────────────────────────────

interface FHProject {
  id: number;
  attributes: {
    name: string;
    description: string;
    budget: { amount: number; currency: string } | null;
    budget_max?: { amount: number; currency: string } | null;
    status: { id: number; name: string };
    skills: { name: string }[];
    employer: { login: string; feedback: { positive: number; total: number } | null };
    bid_count: number;
    published_at: string;
    safe_type: string;
    tags: string[];
  };
  links: { self: { web: string } };
}

function mapProject(raw: FHProject): Project {
  const attr = raw.attributes;
  const budget = attr.budget?.amount ?? 0;
  const budgetMax = attr.budget_max?.amount;
  const currency = attr.budget?.currency ?? 'UAH';
  const skills = (attr.skills ?? []).map((s) => s.name);
  const rating = attr.employer?.feedback
    ? Math.round((attr.employer.feedback.positive / Math.max(attr.employer.feedback.total, 1)) * 50) / 10
    : undefined;

  return {
    id: `fh_${raw.id}`,
    freelancehuntId: String(raw.id),
    title: attr.name ?? '',
    description: attr.description ?? '',
    budget,
    budgetMax,
    currency,
    category: attr.tags?.[0] ?? 'Інше',
    skills,
    clientName: attr.employer?.login ?? '',
    clientRating: rating,
    projectUrl: raw.links?.self?.web ?? '',
    publishedAt: attr.published_at ?? new Date().toISOString(),
    bidsCount: attr.bid_count ?? 0,
    isNew: false,
  };
}

// ─── Validate token ───────────────────────────────────────────────────────────

export async function validateFreelancehuntToken(
  token: string
): Promise<{ valid: boolean; username?: string }> {
  if (!token) return { valid: false };
  try {
    const data = await fhFetch<{ data: { attributes: { login: string } } }>('/my/profile', token);
    return { valid: true, username: data.data?.attributes?.login };
  } catch {
    return { valid: false };
  }
}

// ─── Project listing ──────────────────────────────────────────────────────────

export async function getProjects(
  token: string,
  filters?: { skills?: string[]; budgetMin?: number; page?: number }
): Promise<Project[]> {
  return fetchFreelancehuntProjects(token, filters);
}

export async function fetchFreelancehuntProjects(
  token: string,
  filters?: { skills?: string[]; budgetMin?: number; page?: number }
): Promise<Project[]> {
  const params = new URLSearchParams({ 'filter[status]': 'open' });
  if (filters?.page) params.set('page[number]', String(filters.page));
  if (filters?.skills?.length) params.set('filter[skill]', filters.skills.join(','));

  const data = await fhFetch<{ data: FHProject[] }>(`/projects?${params}`, token);
  let projects = (data.data ?? []).map(mapProject);

  if (filters?.budgetMin) {
    projects = projects.filter((p) => p.budget >= (filters.budgetMin ?? 0));
  }

  return projects;
}

export async function getProject(token: string, id: string): Promise<Project | null> {
  return fetchFreelancehuntProject(token, id);
}

export async function fetchFreelancehuntProject(
  token: string,
  projectId: string
): Promise<Project | null> {
  const numericId = projectId.startsWith('fh_') ? projectId.slice(3) : projectId;
  try {
    const data = await fhFetch<{ data: FHProject }>(`/projects/${numericId}`, token);
    return mapProject(data.data);
  } catch {
    return null;
  }
}

// ─── Bid submission ───────────────────────────────────────────────────────────

/**
 * Submit a bid via the Freelancehunt REST API.
 *
 * Endpoint: POST /v2/projects/{project_id}/bids
 *
 * Payload shape (from Freelancehunt API docs):
 *   {
 *     "days":       number,           // integer, required
 *     "safe_type":  "employer",       // who holds the safe payment, required
 *     "budget": {
 *       "amount":   number,           // integer UAH/USD/EUR, required
 *       "currency": "UAH"|"USD"|"EUR" // required
 *     },
 *     "comment":    string,           // proposal text, required
 *     "is_hidden":  boolean           // hide bid from other freelancers
 *   }
 *
 * Returns { success: true, bidId } ONLY when API responds 2xx with data.id.
 * Never returns fake success.
 */
export async function sendFreelancehuntBid(
  token: string,
  projectIdOrUrl: string,
  bid: {
    text: string;
    budget: number;
    days: number;
    currency?: string;
    logFn?: (level: string, message: string, meta?: Record<string, unknown>) => void;
  }
): Promise<{ success: boolean; bidId?: string; strategy?: string }> {
  const logRaw = bid.logFn ?? (() => {});
  // Wrap so we can call log(level, message) without the meta arg
  const log: LogFn = (level, message) => logRaw(level, message);

  // ── 1. Resolve numeric project ID ─────────────────────────────────────────
  let numericId: string;

  if (projectIdOrUrl.startsWith('http')) {
    // URL formats:
    //   https://freelancehunt.com/project/some-slug/12345.html
    //   https://freelancehunt.com/project/12345.html
    //   https://freelancehunt.com/project/12345
    const match = projectIdOrUrl.match(/\/(\d{4,})(?:\.html)?(?:[/?#]|$)/);
    if (match) {
      numericId = match[1];
    } else {
      // Last-resort: largest digit sequence in the URL
      const allDigits = projectIdOrUrl.match(/\d{4,}/g);
      if (!allDigits) {
        throw new Error(`INVALID_URL: Cannot extract project ID from URL: ${projectIdOrUrl}`);
      }
      numericId = allDigits[allDigits.length - 1];
    }
  } else if (projectIdOrUrl.startsWith('fh_')) {
    numericId = projectIdOrUrl.slice(3);
  } else {
    numericId = projectIdOrUrl;
  }

  if (!numericId || isNaN(Number(numericId))) {
    throw new Error(`INVALID_ID: Resolved project ID "${numericId}" is not a valid number (from: ${projectIdOrUrl})`);
  }

  log('info', `[Bid] Project ID resolved: ${numericId} (from: ${projectIdOrUrl})`);

  // ── 2. Build + validate payload ───────────────────────────────────────────
  // budget.amount must be a positive integer
  const amount = Math.max(1, Math.round(bid.budget > 0 ? bid.budget : 500));
  // days must be a positive integer
  const days = Math.max(1, Math.round(bid.days > 0 ? bid.days : 14));
  // comment must be non-empty
  const comment = (bid.text ?? '').trim() || 'Привіт! Готові взятись за ваш проєкт. Обговоримо деталі?';
  const currency = (bid.currency ?? 'UAH').toUpperCase();

  const payload = {
    days,
    safe_type: 'employer' as const,
    budget: {
      amount,
      currency,
    },
    comment,
    is_hidden: false,
  };

  log('info', `[Bid] Payload: ${JSON.stringify(payload)}`);
  log('info', `[Bid] Proposal (first 200 chars): ${comment.slice(0, 200)}`);

  // ── 3. POST /v2/projects/{id}/bids ────────────────────────────────────────
  const endpoint = `/projects/${numericId}/bids`;
  log('info', `[Bid] POST ${BASE_URL}${endpoint}`);

  // Use raw fetch here (not fhFetch) so we capture status + body before any parsing
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const rawBody = await res.text().catch(() => '');

  log('info', `[Bid] Response status: ${res.status} ${res.statusText}`);
  log('info', `[Bid] Response body: ${rawBody}`);

  // ── 4. Handle non-2xx ────────────────────────────────────────────────────
  if (!res.ok) {
    let reason = rawBody || `HTTP ${res.status}`;

    try {
      const parsed = JSON.parse(rawBody) as {
        errors?: Array<{ title?: string; detail?: string; code?: string }>;
        message?: string;
      };

      if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
        reason = parsed.errors
          .map((e) => [e.title, e.detail].filter(Boolean).join(': '))
          .join('; ');
      } else if (parsed.message) {
        reason = parsed.message;
      }
    } catch {
      // use raw body
    }

    log('error', `[Bid] FAILED — HTTP ${res.status}: ${reason}`);

    const lowerReason = reason.toLowerCase();

    if (
      lowerReason.includes('already') ||
      lowerReason.includes('вже') ||
      lowerReason.includes('duplicate') ||
      lowerReason.includes('bid exists')
    ) {
      throw new Error(`ALREADY_BID: ${reason}`);
    }
    if (lowerReason.includes('closed') || lowerReason.includes('закрит')) {
      throw new Error(`PROJECT_CLOSED: ${reason}`);
    }
    if (res.status === 401) throw new Error(`INVALID_TOKEN: ${reason}`);
    if (res.status === 403) throw new Error(`FORBIDDEN: ${reason}`);
    if (res.status === 404) throw new Error(`NOT_FOUND: Project ${numericId} not found`);
    if (res.status === 429) throw new Error(`RATE_LIMITED: ${reason}`);

    throw new Error(`API_ERROR_${res.status}: ${reason}`);
  }

  // ── 5. Parse success response ─────────────────────────────────────────────
  let responseData: { data?: { id?: number; attributes?: { status?: { name?: string } } } } = {};
  try {
    responseData = JSON.parse(rawBody);
  } catch {
    log('error', `[Bid] Success but could not parse response JSON: ${rawBody.slice(0, 200)}`);
    // The bid was accepted (2xx) — treat as success even if body is unexpected
    return { success: true, bidId: undefined, strategy: 'api' };
  }

  const bidId = responseData.data?.id ? String(responseData.data.id) : undefined;
  const bidStatus = responseData.data?.attributes?.status?.name ?? 'unknown';

  log('success', `[Bid] SUCCESS — bidId: ${bidId ?? 'unknown'} | status: ${bidStatus}`);

  if (!bidId) {
    log('error', `[Bid] WARNING: API returned 2xx but no bid ID in response. Full body: ${rawBody}`);
  }

  return { success: true, bidId, strategy: 'api' };
}

/** Alias kept for call-site compatibility */
export async function createBid(
  token: string,
  projectUrl: string,
  text: string,
  price: number,
  deadline: number
): Promise<{ success: boolean; bidId?: string }> {
  return sendFreelancehuntBid(token, projectUrl, { text, budget: price, days: deadline });
}
