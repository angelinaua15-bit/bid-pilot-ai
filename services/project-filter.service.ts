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

// ─── Blocked keywords (hard reject — checked before opening any browser page) ──

export const BLOCKED_KEYWORDS: string[] = [
  // Video / media
  'video', 'відео', 'монтаж', 'відеомонтаж', 'video editing', 'video edit',
  'redaguvannya-video', 'editing', 'рилс', 'reels', 'tiktok', 'ютуб',
  'youtube channel',
  // Fashion / physical goods
  'fashion', 'одяг', 'одежда', 'швейний', 'пошиття', 'тканина', 'вишивка',
  // Gambling / betting
  'гемблінг', 'gambling', 'беттинг', 'бетинг', 'ставки на спорт', 'казино',
  'букмекер', 'betting', 'бетс',
  // Copywriting / writing / translation
  'copywriting', 'копірайтинг', 'копирайтинг',
  'написання текстів', 'написання статей', 'написання постів',
  'transcription', 'транскрибация', 'транскрипція',
  'переклад', 'перевод', 'translation',
  'редактура', 'коректура',
  // Logo / graphic design only (without dev)
  'логотип', 'лого', 'logo design', 'бренд-бук', 'brandbook',
  'ілюстрація', 'illustration', 'поліграфія',
  // Consulting / non-digital
  'notion', 'нотіон',
  'постачальник', 'поставщик', 'supplier',
  // Physical / construction / beauty
  'дерево', 'дуб', 'ясень', 'деревообробка', 'виробництво',
  'будівництво', 'ремонт квартири', 'ремонт офісу',
  'масаж', 'манікюр', 'косметолог',
  // Architecture / interior design
  'архітектор', 'інтер\'єр', 'дизайн інтер\'єру',
];

// ─── Allowed IT/digital keywords (whitelist) ─────────────────────────────────

export const ALLOWED_KEYWORDS: string[] = [
  // CMS / e-commerce
  'wordpress', 'opencart', 'shopify', 'woocommerce', 'prestashop',
  'bitrix', 'webflow', 'tilda', 'joomla', 'drupal',
  // Frameworks & languages
  'react', 'next.js', 'nextjs', 'vue', 'nuxt', 'angular', 'svelte',
  'php', 'laravel', 'symfony', 'yii',
  'python', 'django', 'flask', 'fastapi',
  'node.js', 'nodejs', 'express', 'nestjs',
  'javascript', 'typescript', 'html', 'css', 'tailwind',
  'flutter', 'react native', 'swift', 'kotlin',
  // Back-end / infra
  'backend', 'frontend', 'fullstack', 'full stack', 'full-stack',
  'api', 'rest api', 'graphql', 'webhook', 'docker', 'devops', 'serverless',
  // Databases
  'postgresql', 'mysql', 'mongodb', 'redis', 'firebase', 'supabase',
  // Ads & analytics
  'seo', 'google ads', 'meta ads', 'facebook ads',
  'ga4', 'gtm', 'google tag manager', 'google analytics',
  // Bots & automation
  'telegram bot', 'telegram mini app', 'телеграм бот', 'chatbot',
  'бот', 'automation', 'автоматизація', 'автоматизация',
  'парсер', 'парсинг', 'scraping', 'parsing',
  'zapier', 'n8n',
  // AI
  'openai', 'chatgpt', 'gpt', 'llm', 'langchain',
  'штучний інтелект', 'нейромережа',
  // CRM / integrations
  'crm', 'інтеграція', 'интеграция', 'integration',
  // Web generic
  'website', 'сайт', 'вебсайт', 'веб розробка', 'веб-розробка',
  'landing page', 'лендінг', 'лендинг',
  'saas', 'mvp', 'dashboard', 'admin panel', 'адмін панель',
  'додаток', 'застосунок', 'мобільний додаток',
  'верстка', 'верстання', 'figma', 'ui/ux',
  // Generic IT
  'розробка', 'разработка', 'програміст', 'программист',
  'software', 'web app', 'mobile app',
];

// ─── Result types ─────────────────────────────────────────────────────────────

export interface ShouldBidResult {
  allowed: boolean;
  reason: string;
}

export interface ApplyResult {
  allowed: boolean;
  reason: string;
  stage: 'budget' | 'blocked_keyword' | 'no_allowed_keyword' | 'passed';
  matchedKeywords: string[];
  blockedKeywords: string[];
  aiScore?: number;
  budget: number;
  currency: string;
  category: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function projectText(project: Project): string {
  return [
    safe(project.title),
    safe(project.description),
    safe(project.category),
    Array.isArray(project.skills)
      ? project.skills.map((s) => safe(s)).join(' ')
      : safe(project.skills ?? ''),
  ].join(' ').toLowerCase();
}

function findMatches(text: string, keywords: string[]): string[] {
  return keywords.filter((kw) => text.includes(kw.toLowerCase()));
}

function budgetInUAH(project: Project): number {
  const cur = (project.currency ?? 'UAH').toUpperCase();
  if (cur === 'USD') return project.budget * 40;
  if (cur === 'EUR') return project.budget * 43;
  return project.budget;
}

export const MIN_BUDGET_UAH = 2000;
export const MIN_BUDGET_USD = 50;

// ─── shouldApply — multi-stage sync filter ────────────────────────────────────

/**
 * Decide whether to apply to a project.
 * Runs entirely synchronously — no OpenAI tokens consumed.
 * Call this BEFORE opening any browser page.
 */
export async function shouldApply(
  project: Project,
  _useAIScore = false   // reserved for future use
): Promise<ApplyResult> {
  const text     = projectText(project);
  const budget   = project.budget ?? 0;
  const currency = (project.currency ?? 'UAH').toUpperCase();
  const category = safe(project.category ?? '').toLowerCase();

  const base: Omit<ApplyResult, 'allowed' | 'reason' | 'stage'> = {
    matchedKeywords: [],
    blockedKeywords: [],
    budget,
    currency,
    category,
  };

  // Stage 1: budget minimum
  const uahEq = budgetInUAH(project);
  const tooLow =
    (currency === 'UAH' && budget > 0 && budget < MIN_BUDGET_UAH) ||
    (currency === 'USD' && budget > 0 && budget < MIN_BUDGET_USD) ||
    (currency !== 'UAH' && currency !== 'USD' && uahEq > 0 && uahEq < MIN_BUDGET_UAH);

  if (tooLow) {
    return { ...base, allowed: false, stage: 'budget',
      reason: `Budget too low: ${budget} ${currency} (min ${MIN_BUDGET_UAH} UAH / ${MIN_BUDGET_USD} USD)` };
  }

  // Stage 2: blocked keywords — hard reject, no browser page opened
  const blocked = findMatches(text, BLOCKED_KEYWORDS);
  if (blocked.length > 0) {
    return { ...base, allowed: false, stage: 'blocked_keyword', blockedKeywords: blocked,
      reason: `Blocked keyword: ${blocked.slice(0, 3).map((k) => `"${k}"`).join(', ')}` };
  }

  // Stage 3: must match at least one allowed IT keyword
  const matched = findMatches(text, ALLOWED_KEYWORDS);
  if (matched.length === 0) {
    return { ...base, allowed: false, stage: 'no_allowed_keyword',
      reason: 'No IT/digital keywords found in title, description, or skills' };
  }

  return { ...base, allowed: true, stage: 'passed', matchedKeywords: matched,
    reason: `Passed. Matched: [${matched.slice(0, 3).join(', ')}]` };
}

// ─── Legacy sync helper ───────────────────────────────────────────────────────

export function shouldBid(project: Project): ShouldBidResult {
  const text = projectText(project);
  const blocked = findMatches(text, BLOCKED_KEYWORDS);
  if (blocked.length > 0) return { allowed: false, reason: `Blocked keyword: "${blocked[0]}"` };
  const matched = findMatches(text, ALLOWED_KEYWORDS);
  if (matched.length > 0) return { allowed: true, reason: `IT keyword: "${matched[0]}"` };
  return { allowed: false, reason: 'No IT/digital keywords found' };
}

// ─── Filter a list of projects ────────────────────────────────────────────────

export function filterProjects(
  projects: Project[],
  settings: AutoBidSettings,
  alreadyBidIds: Set<string>
): Array<Project & { matchScore: number }> {
  return projects
    .map((p) => ({ ...p, matchScore: p.matchScore ?? 50 }))
    .filter((p) => {
      if (settings.emergencyStop) return false;
      if (alreadyBidIds.has(p.id) || alreadyBidIds.has(p.freelancehuntId)) return false;
      return shouldBid(p).allowed;
    })
    .sort((a, b) => b.matchScore - a.matchScore);
}
