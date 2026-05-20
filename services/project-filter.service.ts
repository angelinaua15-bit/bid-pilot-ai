/**
 * services/project-filter.service.ts
 * Filters projects by auto-bid settings: budget, categories, blocked keywords,
 * match score threshold, and duplicate detection.
 */

import type { Project, AutoBidSettings, FreelancerCategory } from '@/types';
import { safeText as safe } from '@/lib/safe-text';

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

// ─── IT-only filter ───────────────────────────────────────────────────────────

const IT_ALLOW_TERMS: RegExp[] = [
  // Languages & runtimes
  /\bjavascript\b/i, /\btypescript\b/i, /\bnode\.?js\b/i, /\bphp\b/i,
  /\bpython\b/i, /\bruby\b/i, /\bc#\b/i, /\.net\b/i,
  // Front-end
  /\breact\b/i, /\bnext\.?js\b/i, /\bvue\b/i, /\bnuxt\b/i, /\bangular\b/i,
  /\bsvelte\b/i, /\bhtml\b/i, /\bcss\b/i, /\btailwind\b/i, /\bверстк/i,
  // Back-end / infra
  /\bbackend\b/i, /\bfrontend\b/i, /\bfull[\s-]?stack\b/i,
  /\bapi\b/i, /\brest\s*api\b/i, /\bgraphql\b/i,
  /\bdocker\b/i, /\bdevops\b/i, /\bci[\s/]?cd\b/i, /\bserverless\b/i,
  // CMS / e-commerce
  /\bwordpress\b/i, /\bwoocommerce\b/i, /\bshopify\b/i, /\bopencart\b/i,
  /\bprestashop\b/i, /\bcms\b/i, /\bbitrix\b/i, /\bwebflow\b/i,
  // PHP frameworks
  /\blaravel\b/i, /\bsymfony\b/i, /\byii\b/i,
  // DBs
  /\bsupabase\b/i, /\bpostgres(ql)?\b/i, /\bmysql\b/i, /\bmongodb\b/i,
  /\bredis\b/i, /\bfirebase\b/i,
  // Bots & automation
  /\btelegram[\s-]*bot\b/i, /\btelegram[\s-]*mini[\s-]*app\b/i,
  /\bautomation\b/i, /\bавтоматизац/i, /\bparsing\b/i, /\bscraping\b/i,
  /\bпарс/i, /\bсайт\b/i,
  // AI
  /\bopenai\b/i, /\bgpt\b/i, /\bllm\b/i, /\bchatbot\b/i, /\bai[\s-]bot\b/i,
  /\bштучн/i, /\bнейро/i,
  // CRM / integrations
  /\bcrm\b/i, /\bінтеграц/i, /\bintegrat/i, /\bwebhook\b/i,
  /\bzapier\b/i, /\bn8n\b/i,
  // Web & digital generic
  /\bwebsite\b/i, /\bweb[\s-]?develop/i, /\bвеб[\s-]?розробк/i,
  /\bрозробк[аиі]\b/i, /\bпрограміст/i, /\bпрограмуванн/i, /\bпрограмн/i,
  /\blanding[\s-]*page\b/i, /\blanding\b/i, /\bsaas\b/i, /\bmvp\b/i,
  // Analytics / SEO tech
  /\bga4\b/i, /\bgtm\b/i, /\bgoogle[\s-]*tag[\s-]*manager\b/i,
  /\btechnical[\s-]*seo\b/i,
  // Mobile
  /\bmobile[\s-]*app\b/i, /\breact[\s-]*native\b/i, /\bflutter\b/i,
  // Generic dev keywords
  /\bdashboard\b/i, /\badmin[\s-]*panel\b/i, /\bадмін[\s-]*панель\b/i,
  /\bportal\b/i, /\bдодат[оки]\b/i, /\bзастосун[оки]\b/i,
];

const REJECT_ONLY_TERMS: RegExp[] = [
  // Design-only (non-dev)
  /\blogo[\s-]*design\b/i, /\bлоготип\b/i, /\bбрендинг\b/i, /\bбренд-бук\b/i,
  /\bграфічн[ийі][\s-]*дизайн\b/i, /\bui[\s-]*design\b/i, /\bвізитк/i,
  /\bбанер[\s-]*design\b/i, /\bілюстрац/i, /\billustrat/i, /\bполіграф/i,
  // Copywriting / writing
  /\bcopywriting\b/i, /\bкопірайт/i, /\bнаписанн[яі][\s-]*текст/i,
  /\bтекст[иів][\s-]*для\b/i, /\bконтент[\s-]*план\b/i,
  /\bстатт[яі]\b/i, /\bарти[кк]л/i, /\bseo[\s-]*текст/i,
  /\bпереклад/i, /\btranslat/i, /\bредактур/i, /\bкоректур/i,
  // Video / audio / photo
  /\bвідеомонтаж\b/i, /\bvideo[\s-]*edit/i, /\bмонтаж[\s-]*відео\b/i,
  /\bфотограф/i, /\bфоторетуш/i, /\bphoto[\s-]*retouch/i,
  /\b3d[\s-]*model/i, /\b3d[\s-]*render/i, /\b3d[\s-]*граф/i,
  /\bанімац/i, /\bmotion[\s-]*graphic/i,
  // Architecture / interior
  /\bархітект/i, /\bінтер['']?єр\b/i, /\bдизайн[\s-]*інтер/i,
  // Legal / accounting / education
  /\bюридич/i, /\bбухгалтер/i, /\bподатк/i,
  /\bдомашнє[\s-]*завданн/i, /\bдиплом[ан]/i, /\bреферат\b/i,
  // Print / offline / physical
  /\bдрук\b/i, /\bтипограф/i, /\bпромоутер/i, /\bкур'єр\b/i,
  /\bмасаж\b/i, /\bманікюр\b/i, /\bбудівництв/i, /\bремонт[\s-]*квартир\b/i,
];

export interface ShouldBidResult {
  allowed: boolean;
  reason: string;
}

/**
 * Decide whether to bid on a project.
 *
 * Rules (in order):
 *   1. ANY IT term matches → allowed
 *   2. NO IT term + ANY reject term → rejected with reason
 *   3. Neither list matched → allowed (unknown category, no harm in trying)
 */
export function shouldBid(project: Project): ShouldBidResult {
  const text = [
    safeText(project.title),
    safeText(project.description),
    safeText(project.category),
    Array.isArray(project.skills)
      ? project.skills.map((s) => safeText(s)).join(' ')
      : safeText(project.skills),
  ].join(' ');

  for (const re of IT_ALLOW_TERMS) {
    const m = text.match(re);
    if (m) return { allowed: true, reason: `IT project — matched: "${m[0]}"` };
  }

  for (const re of REJECT_ONLY_TERMS) {
    const m = text.match(re);
    if (m) return { allowed: false, reason: `Not IT project — matched reject term: "${m[0]}"` };
  }

  return { allowed: true, reason: 'No reject terms found — allowing (unknown category)' };
}

// ─── Filter a list of projects ────────────────────────────────────────────────

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
