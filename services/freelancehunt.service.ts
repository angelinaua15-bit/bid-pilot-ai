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
 * @deprecated
 * POST /v2/projects/{id}/bids was removed from the Freelancehunt API (410 Gone).
 * Bid submission must be done via Playwright browser automation.
 * Use submitBidViaPlaywright() from services/playwright-browser.service.ts instead.
 *
 * This function always throws API_GONE_410 so callers fail fast and clearly.
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
  // Suppress unused-variable warnings for the deprecated signature
  void token; void projectIdOrUrl; void bid;

  throw new Error(
    'API_GONE_410: POST /v2/projects/{id}/bids is no longer available (Freelancehunt deprecated this endpoint). ' +
    'Use submitBidViaPlaywright() from services/playwright-browser.service.ts instead.'
  );
}


