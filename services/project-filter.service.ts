/**
 * services/project-filter.service.ts
 * Filters projects by auto-bid settings: budget, categories, blocked keywords,
 * match score threshold, and duplicate detection.
 */

import type { Project, AutoBidSettings, FreelancerCategory } from '@/types';

/**
 * Safely convert any project field value to a lowercase string.
 * Handles: string | string[] | object | null | undefined.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const safe = (v: any): string => {
  if (typeof v === 'string') return v.toLowerCase();
  if (Array.isArray(v)) return v.map(String).join(' ').toLowerCase();
  if (v && typeof v === 'object') return JSON.stringify(v).toLowerCase();
  return '';
};

// Category → keywords map for relevance matching
const CATEGORY_KEYWORDS: Record<FreelancerCategory, string[]> = {
  websites:       ['сайт', 'лендінг', 'next.js', 'react', 'vue', 'верстка', 'wordpress', 'web'],
  shops:          ['магазин', 'e-commerce', 'woocommerce', 'shopify', 'інтернет-магазин', 'catalog'],
  telegram_bots:  ['telegram', 'бот', 'bot', 'telegraf', 'aiogram', 'телеграм'],
  ai_agents:      ['ai', 'gpt', 'openai', 'langchain', 'rag', 'chatbot', 'штучний інтелект', 'nlp', 'llm'],
  automation:     ['автоматизац', 'парсинг', 'selenium', 'playwright', 'zapier', 'make', 'n8n', 'скрипт'],
  seo:            ['seo', 'просування', 'органіч', 'keyword', 'позиції'],
  google_ads:     ['google ads', 'контекст', 'ppc', 'реклама google', 'adwords'],
  smm:            ['smm', 'instagram', 'facebook', 'контент', 'соц мережі', 'таргет'],
  design:         ['дизайн', 'figma', 'ui', 'ux', 'логотип', 'брендинг', 'графіка'],
  copywriting:    ['копірайтинг', 'текст', 'стаття', 'контент', 'copywriting'],
};

export interface FilterResult {
  passed: boolean;
  reason?: string;
  matchScore?: number;
}

/**
 * Compute a match score (0–100) for a project against the allowed categories.
 * Uses keyword matching across title + description.
 */
export function computeMatchScore(
  project: Project,
  allowedCategories: FreelancerCategory[]
): number {
  const haystack = [
    safe(project.title),
    safe(project.description),
    safe(project.skills),
    safe(project.category),
  ].join(' ');

  let hits = 0;
  let totalKeywords = 0;

  for (const cat of allowedCategories) {
    const keywords = CATEGORY_KEYWORDS[cat] ?? [];
    totalKeywords += keywords.length;
    for (const kw of keywords) {
      if (haystack.includes(kw)) hits++;
    }
  }

  if (totalKeywords === 0) return 50;

  // Normalize: cap at 100, weight heavier hits more
  const raw = Math.min((hits / totalKeywords) * 100 * 3, 100);
  return Math.round(raw);
}

/**
 * Check whether a project passes all auto-bid filters.
 * Returns { passed: true } or { passed: false, reason: '...' }.
 */
export function filterProject(
  project: Project,
  settings: AutoBidSettings,
  alreadyBidIds: Set<string>
): FilterResult {
  // Emergency stop
  if (settings.emergencyStop) {
    return { passed: false, reason: 'Emergency stop активовано' };
  }

  // Duplicate check
  if (alreadyBidIds.has(project.id) || alreadyBidIds.has(project.freelancehuntId)) {
    return { passed: false, reason: 'Заявку вже відправлено на цей проєкт' };
  }

  // Budget filter
  if (project.budget < settings.minBudget) {
    return {
      passed: false,
      reason: `Бюджет ${project.budget} нижче мінімального ${settings.minBudget}`,
    };
  }
  if (settings.maxBudget > 0 && project.budget > settings.maxBudget) {
    return {
      passed: false,
      reason: `Бюджет ${project.budget} вище максимального ${settings.maxBudget}`,
    };
  }

  // Blocked keywords
  const haystack = `${safe(project.title)} ${safe(project.description)}`;
  for (const kw of settings.blockedKeywords) {
    if (kw.trim() && haystack.includes(safe(kw).trim())) {
      return { passed: false, reason: `Заблоковане слово: "${kw}"` };
    }
  }

  // Match score
  const matchScore = project.matchScore ?? computeMatchScore(project, settings.allowedCategories);
  if (matchScore < settings.minMatchScore) {
    return {
      passed: false,
      reason: `matchScore ${matchScore} нижче порогу ${settings.minMatchScore}`,
      matchScore,
    };
  }

  // Working hours check (server-side, Kyiv time UTC+2/+3)
  const now = new Date();
  const kyivHour = (now.getUTCHours() + 2) % 24; // simplified +2 offset
  const kyivDay = now.getUTCDay();

  if (!settings.workingDays.includes(kyivDay)) {
    return { passed: false, reason: `Не робочий день (${kyivDay})`, matchScore };
  }
  if (kyivHour < settings.workingHoursStart || kyivHour >= settings.workingHoursEnd) {
    return {
      passed: false,
      reason: `За межами робочих годин (${settings.workingHoursStart}–${settings.workingHoursEnd})`,
      matchScore,
    };
  }

  return { passed: true, matchScore };
}

/**
 * Filter a list of projects, returning only those that pass.
 */
export function filterProjects(
  projects: Project[],
  settings: AutoBidSettings,
  alreadyBidIds: Set<string>
): Array<Project & { matchScore: number }> {
  const results: Array<Project & { matchScore: number }> = [];

  for (const project of projects) {
    const result = filterProject(project, settings, alreadyBidIds);
    if (result.passed) {
      results.push({ ...project, matchScore: result.matchScore ?? 80 });
    }
  }

  // Sort by matchScore descending
  return results.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
}
