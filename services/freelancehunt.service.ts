/**
 * services/freelancehunt.service.ts
 * Freelancehunt REST API v2 integration.
 *
 * Authentication: Bearer token via FREELANCEHUNT_TOKEN env var.
 * No browser automation. No session files. No Playwright.
 *
 * Project listing:  GET  /v2/projects
 * Bid submission:   POST /v2/projects/{id}/bids
 */

import type { Project } from '@/types';

const BASE_URL = 'https://api.freelancehunt.com/v2';

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function fhFetch<T = unknown>(
  endpoint: string,
  token: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 401) throw new Error('INVALID_TOKEN: Freelancehunt token is invalid or expired');
  if (res.status === 403) throw new Error('FORBIDDEN: Access denied');
  if (res.status === 404) throw new Error('NOT_FOUND: Resource not found');
  if (res.status === 429) throw new Error('RATE_LIMITED: Too many requests');

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Try to extract a structured error message from the JSON body
    let reason = text;
    try {
      const parsed = JSON.parse(text);
      // Freelancehunt error shape: { errors: [{ title, detail }] }
      const errs = parsed?.errors as Array<{ title?: string; detail?: string }> | undefined;
      if (Array.isArray(errs) && errs.length > 0) {
        reason = errs.map((e) => [e.title, e.detail].filter(Boolean).join(': ')).join('; ');
        // Detect "already applied" so the caller can classify it as a skip
        const lower = reason.toLowerCase();
        if (lower.includes('already') || lower.includes('вже') || lower.includes('duplicate')) {
          throw new Error(`ALREADY_BID: ${reason}`);
        }
        if (lower.includes('closed') || lower.includes('закрит')) {
          throw new Error(`PROJECT_CLOSED: ${reason}`);
        }
      }
    } catch (parseErr) {
      // Re-throw if it was one of our own typed errors
      if (parseErr instanceof Error && (parseErr.message.startsWith('ALREADY_BID:') || parseErr.message.startsWith('PROJECT_CLOSED:'))) {
        throw parseErr;
      }
    }
    throw new Error(`API_ERROR_${res.status}: ${reason}`);
  }

  return res.json() as Promise<T>;
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
  const skills = attr.skills.map((s) => s.name);
  const rating = attr.employer.feedback
    ? Math.round((attr.employer.feedback.positive / Math.max(attr.employer.feedback.total, 1)) * 50) / 10
    : undefined;

  return {
    id: `fh_${raw.id}`,
    freelancehuntId: String(raw.id),
    title: attr.name,
    description: attr.description,
    budget,
    budgetMax,
    currency,
    category: attr.tags?.[0] ?? 'Інше',
    skills,
    clientName: attr.employer.login,
    clientRating: rating,
    projectUrl: raw.links.self.web,
    publishedAt: attr.published_at,
    bidsCount: attr.bid_count,
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
  // Extract numeric ID from "fh_12345" or "12345"
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
 * Body: { days, safe_type, budget: { amount, currency }, comment, is_hidden }
 *
 * Returns success ONLY when the API responds with 2xx.
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
  const log = bid.logFn ?? (() => {});

  // Resolve numeric project ID from URL or "fh_12345" or plain "12345"
  let numericId: string;
  if (projectIdOrUrl.startsWith('http')) {
    // Handles all Freelancehunt URL formats:
    //   https://freelancehunt.com/project/some-slug/12345.html
    //   https://freelancehunt.com/project/12345.html
    //   https://freelancehunt.com/project/12345
    const match = projectIdOrUrl.match(/\/(\d+)(?:\.html)?(?:[/?#]|$)/);
    if (!match) {
      // Last-resort: grab the last run of digits in the URL
      const digits = projectIdOrUrl.match(/(\d{4,})/g);
      if (!digits) throw new Error(`Cannot extract project ID from URL: ${projectIdOrUrl}`);
      numericId = digits[digits.length - 1];
    } else {
      numericId = match[1];
    }
  } else if (projectIdOrUrl.startsWith('fh_')) {
    numericId = projectIdOrUrl.slice(3);
  } else {
    numericId = projectIdOrUrl;
  }

  log('info', `[API] Resolved project ID: ${numericId} from "${projectIdOrUrl}"`);

  log('info', `[API] Submitting bid via REST API — project ID: ${numericId}`);
  log('info', `[API] Budget: ${bid.budget} ${bid.currency ?? 'UAH'} | Days: ${bid.days}`);
  log('info', `[API] Proposal length: ${bid.text.length} chars`);

  const body = {
    days: bid.days,
    safe_type: 'employer',
    budget: {
      amount: bid.budget,
      currency: bid.currency ?? 'UAH',
    },
    comment: bid.text,
    is_hidden: false,
  };

  log('info', `[API] POST /v2/projects/${numericId}/bids — payload: ${JSON.stringify(body)}`);

  const response = await fhFetch<{
    data?: { id: number; attributes?: { status?: { name: string } } };
    errors?: Array<{ title: string; detail?: string }>;
  }>(
    `/projects/${numericId}/bids`,
    token,
    {
      method: 'POST',
      body: JSON.stringify(body),
    }
  );

  log('info', `[API] Raw response: ${JSON.stringify(response)}`);

  const bidId = response.data?.id ? String(response.data.id) : undefined;
  log('success', `[API] Bid submitted successfully — bidId: ${bidId ?? 'unknown'}`);

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
