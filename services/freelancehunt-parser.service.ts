/**
 * services/freelancehunt-parser.service.ts
 *
 * Fetches Freelancehunt projects via Playwright browser automation.
 * No FREELANCEHUNT_TOKEN or API v2 required.
 *
 * Mock mode: FREELANCEHUNT_MOCK=1 (UI development only).
 */

import type { Project } from '@/types';
import { parseProjectsFromFeed } from './playwright-browser.service';
import { mockProjects } from '@/lib/mock-data';

const USE_MOCK = Boolean(process.env.FREELANCEHUNT_MOCK);

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
  source: 'playwright' | 'mock';
}

/**
 * Fetch projects from the Freelancehunt website feed using the saved Playwright
 * session. No API token needed. Session must be present at storageStatePath.
 */
export async function parseNewProjects(
  _token: string,
  _filters?: {
    categories?: string[];
    budgetMin?: number;
    page?: number;
  },
  logFn?: StepLogFn
): Promise<ParseResult> {
  const log: StepLogFn = logFn ?? (() => {});
  let allProjects: Project[];
  let source: ParseResult['source'];

  if (USE_MOCK) {
    log('warning', '[Parser] FREELANCEHUNT_MOCK=1 — using mock projects (no real browser)');
    await new Promise((r) => setTimeout(r, 300));
    allProjects = mockProjects.map((p, i) => ({
      ...p,
      isNew: i < 3,
      publishedAt: i < 3
        ? new Date(Date.now() - 1_000 * 60 * (i + 1)).toISOString()
        : p.publishedAt,
    }));
    source = 'mock';
  } else {
    log('info', '[Parser] Mode: Playwright (website feed) — no API token needed');

    const feedProjects = await parseProjectsFromFeed((level, message) => {
      log(level, message);
    });

    allProjects = feedProjects.map((fp) => ({
      id:             fp.id,
      title:          fp.title,
      description:    fp.description,
      budget:         fp.budget,
      currency:       fp.currency as Project['currency'],
      skills:         fp.skills,
      projectUrl:     fp.projectUrl,
      freelancehuntId: fp.id.replace('fh_', ''),
      publishedAt:    fp.publishedAt,
      category:       '',
      clientName:     '',
      bidsCount:      0,
      isNew:          true,
      matchScore:     0,
      employer:       { name: '', id: '' },
    }));
    source = 'playwright';

    const invalid = allProjects.filter(
      (p) => !p.projectUrl?.startsWith('https://freelancehunt.com/')
    );
    if (invalid.length > 0) {
      log('warning',
        `[Parser] ${invalid.length} project(s) had no valid freelancehunt.com URL and were removed`
      );
      allProjects = allProjects.filter(
        (p) => p.projectUrl?.startsWith('https://freelancehunt.com/')
      );
    }

    log('success', `[Parser] Feed returned ${allProjects.length} projects (source: playwright)`);
  }

  return {
    allProjects,
    newProjects: allProjects,
    totalFetched: allProjects.length,
    newCount:     allProjects.length,
    source,
  };
}
