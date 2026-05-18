/**
 * services/freelancehunt-parser.service.ts
 *
 * Fetches real Freelancehunt projects for the auto-bid cycle via REST API v2.
 * Requires: FREELANCEHUNT_TOKEN environment variable.
 *
 * No Playwright. No storageState. No session files.
 *
 * Mock mode: set FREELANCEHUNT_MOCK=1 (UI development only).
 */

import type { Project, FreelancerCategory } from '@/types';
import { fetchFreelancehuntProjects } from './freelancehunt.service';
import { mockProjects } from '@/lib/mock-data';

const USE_MOCK = Boolean(process.env.FREELANCEHUNT_MOCK);

// In-memory cache of seen project IDs between cycle runs (per process).
// Cleared every hour so fresh projects are always fetched when the API returns them again.
const seenProjectIds = new Set<string>();
let _lastCacheClear = Date.now();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function maybeResetCache(): void {
  if (Date.now() - _lastCacheClear > CACHE_TTL_MS) {
    seenProjectIds.clear();
    _lastCacheClear = Date.now();
  }
}

export type StepLogFn = (
  level: 'info' | 'success' | 'warning' | 'error',
  message: string,
  meta?: Record<string, unknown>
) => void;

export interface ParseResult {
  allProjects: Project[];
  newProjects: Project[];
  totalFetched: number;
  newCount: number;
  source: 'api' | 'mock';
}

/**
 * Fetch projects from Freelancehunt API and detect which ones are new.
 *
 * @param token   - FREELANCEHUNT_TOKEN
 * @param filters - Optional filters (categories, budget, page)
 * @param logFn   - Step logger so each action appears in the UI Logs screen
 */
export async function parseNewProjects(
  token: string,
  filters?: {
    categories?: FreelancerCategory[];
    budgetMin?: number;
    page?: number;
  },
  logFn?: StepLogFn
): Promise<ParseResult> {
  const log: StepLogFn = logFn ?? (() => {});
  maybeResetCache(); // Reset hourly so we always detect fresh projects
  let allProjects: Project[];
  let source: ParseResult['source'];

  if (USE_MOCK) {
    log('warning', '[Parser] FREELANCEHUNT_MOCK=1 — using mock projects (not real data)');
    await new Promise((r) => setTimeout(r, 400));
    allProjects = mockProjects.map((p, i) => ({
      ...p,
      isNew: i < 2,
      publishedAt: i < 2
        ? new Date(Date.now() - 1000 * 60 * (i + 1)).toISOString()
        : p.publishedAt,
    }));
    source = 'mock';
  } else {
    if (!token) {
      throw new Error(
        'FREELANCEHUNT_TOKEN is not set. ' +
        'Set FREELANCEHUNT_TOKEN in your environment to use the Freelancehunt API.'
      );
    }

    log('info', '[Parser] Mode: REST API v2 (FREELANCEHUNT_TOKEN)');

    allProjects = await fetchFreelancehuntProjects(token, {
      skills: filters?.categories,
      budgetMin: filters?.budgetMin,
      page: filters?.page ?? 1,
    });
    source = 'api';

    // Sanity check — every project must have a real freelancehunt.com URL
    const invalid = allProjects.filter(
      (p) => !p.projectUrl || !p.projectUrl.startsWith('https://freelancehunt.com/')
    );
    if (invalid.length > 0) {
      throw new Error(
        `API returned ${invalid.length} project(s) without a valid freelancehunt.com URL. ` +
        `First: id=${invalid[0].id}, url="${invalid[0].projectUrl}"`
      );
    }

    log('success', `[Parser] REST API returned ${allProjects.length} projects`);
  }

  // Detect new projects (not yet seen in this process run).
  const newProjects = allProjects.filter((p) => {
    const fhId = p.freelancehuntId ?? p.id;
    if (seenProjectIds.has(fhId)) return false;
    seenProjectIds.add(fhId);
    return true;
  });

  const allWithNew = allProjects.map((p) => ({
    ...p,
    isNew: newProjects.some((n) => n.id === p.id),
  }));

  log('info', `[Parser] ${allProjects.length} total, ${newProjects.length} new (source: ${source})`);

  return {
    allProjects: allWithNew,
    newProjects,
    totalFetched: allProjects.length,
    newCount: newProjects.length,
    source,
  };
}

export function resetSeenProjects(): void {
  seenProjectIds.clear();
}

export function markProjectsSeen(ids: string[]): void {
  for (const id of ids) seenProjectIds.add(id);
}
