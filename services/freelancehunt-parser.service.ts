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

// No seenProjectIds cache — every cycle returns all fetched projects.
// Dedup is handled by the Freelancehunt API itself (422 ALREADY_BID on re-submit).
// A local cache was causing all projects to appear as "seen" after the first cycle,
// resulting in 0 submissions on every subsequent run.

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

  // All fetched projects are treated as candidates — no local dedup.
  // The Freelancehunt API returns 422 ALREADY_BID if a bid was already submitted,
  // which the orchestrator catches and counts as a skip with the exact API reason.
  const allWithNew = allProjects.map((p) => ({ ...p, isNew: true }));

  log('info', `[Parser] ${allProjects.length} projects fetched — all passed to bid loop (source: ${source})`);

  return {
    allProjects: allWithNew,
    newProjects: allWithNew,
    totalFetched: allProjects.length,
    newCount: allProjects.length,
    source,
  };
}

// resetSeenProjects / markProjectsSeen removed — no local cache exists.
