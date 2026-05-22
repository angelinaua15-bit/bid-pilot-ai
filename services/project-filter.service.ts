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

// ─── Blocked keywords — hard reject, checked BEFORE opening any browser page ──
// Includes video, відео, монтаж, architect, interior, personal brand video, etc.

export const BLOCKED_KEYWORDS: string[] = [
  // Video / media production
  'video', 'відео', 'монтаж', 'відеомонтаж', 'video editing', 'video edit',
  'редагування відео', 'редагування-відео', 'reel', 'reels', 'рилс',
  'tiktok', 'youtube channel', 'ютуб канал', 'ютуб',
  // Photography
  'фотограф', 'фотосесія', 'фоторетуш', 'photo retouch', 'photo editing',
  'фото', 'photography',
  // Animation / motion / 3D
  'анімація', 'animation', '3d model', '3d render', 'motion graphic',
  // Architecture / interior design
  'архітект', 'інтер\'єр', 'interior design', 'дизайн інтер\'єру',
  'дизайн квартири', 'дизайн будинку',
  // Personal branding / non-dev branding
  'особистий бренд', 'personal brand', 'brand video', 'бренд відео',
  // Fashion / physical goods
  'fashion', 'одяг', 'одежда', 'швейний', 'пошиття', 'тканина', 'вишивка',
  // Gambling / betting (adult/illegal)
  'гемблінг', 'gambling', 'беттинг', 'бетинг', 'ставки на спорт',
  'казино', 'букмекер', 'betting',
  // Pure copywriting / writing / translation
  'copywriting', 'копірайтинг', 'копирайтинг',
  'написання текстів', 'написання статей', 'написання постів',
  'transcription', 'транскрибация', 'транскрипція',
  'переклад', 'перевод', 'translation',
  'редактура', 'коректура',
  // Logo / print graphic design only
  'логотип', 'лого', 'logo design', 'бренд-бук', 'brandbook',
  'ілюстрація', 'illustration', 'поліграфія',
  // Physical / construction / beauty services
  'дерево', 'деревообробка', 'виробництво меблів',
  'будівництво', 'ремонт квартири', 'ремонт офісу',
  'масаж', 'манікюр', 'косметолог',
  // Consulting / non-digital productivity
  'notion шаблон', 'notion template', 'постачальник', 'поставщик', 'supplier',
];

// ─── Allowed IT/digital keywords — must match at least one ───────────────────

export const ALLOWED_KEYWORDS: string[] = [
  // CMS / e-commerce platforms
  'wordpress', 'opencart', 'shopify', 'woocommerce', 'prestashop',
  'bitrix', 'webflow', 'tilda', 'joomla', 'drupal',
  // JS frameworks & languages
  'react', 'next.js', 'nextjs', 'vue', 'nuxt', 'angular', 'svelte',
  'javascript', 'typescript', 'html', 'css', 'tailwind',
  // Backend
  'php', 'laravel', 'symfony', 'yii',
  'python', 'django', 'flask', 'fastapi',
  'node.js', 'nodejs', 'express', 'nestjs',
  'ruby on rails', 'golang', 'rust',
  // Mobile
  'flutter', 'react native', 'swift', 'kotlin',
  // Infra / DevOps
  'backend', 'frontend', 'fullstack', 'full stack', 'full-stack',
  'api', 'rest api', 'graphql', 'webhook', 'docker', 'devops', 'serverless',
  // Databases
  'postgresql', 'mysql', 'mongodb', 'redis', 'firebase', 'supabase',
  // Ads & analytics
  'seo', 'google ads', 'meta ads', 'facebook ads',
  'ga4', 'gtm', 'google tag manager', 'google analytics',
  // Bots & automation
  'telegram bot', 'telegram mini app', 'телеграм бот', 'chatbot',
  'чат-бот', 'чатбот', 'бот', 'bot',
  'automation', 'автоматизація', 'автоматизация',
  'парсер', 'парсинг', 'scraping', 'parsing',
  'zapier', 'make.com', 'n8n',
  // AI / ML
  'openai', 'chatgpt', 'gpt', 'llm', 'langchain', 'ai agent',
  'штучний інтелект', 'нейромережа',
  // CRM / integrations
  'crm', 'інтеграція', 'интеграция', 'integration',
  // Web & digital generic
  'website', 'сайт', 'вебсайт', 'веб розробка', 'веб-розробка',
  'landing page', 'лендінг', 'лендинг',
  'saas', 'mvp', 'dashboard', 'admin panel', 'адмін панель',
  'додаток', 'застосунок', 'мобільний додаток', 'web app', 'mobile app',
  'верстка', 'верстання', 'figma', 'ui/ux',
  // Generic IT
  'розробка', 'разработка', 'програміст', 'программист', 'програмування',
  'software', 'веб-додаток',
];

// ─── ApplyResult ──────────────────────────────────────────────────────────────

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
  const skills = Array.isArray(project.skills)
    ? project.skills.map((s) => safe(s)).join(' ')
    : safe(project.skills ?? '');
  return [safe(project.title), safe(project.description), safe(project.category ?? ''), skills]
    .join(' ')
    .toLowerCase();
}

function findMatches(text: string, keywords: string[]): string[] {
  return keywords.filter((kw) => text.includes(kw.toLowerCase()));
}

export const MIN_BUDGET_UAH = 2000;
export const MIN_BUDGET_USD = 50;

function budgetTooLow(project: Project): boolean {
  const cur = (project.currency ?? 'UAH').toUpperCase();
  const b = project.budget ?? 0;
  if (b === 0) return false; // no budget set — don't filter
  if (cur === 'USD') return b < MIN_BUDGET_USD;
  if (cur === 'UAH') return b < MIN_BUDGET_UAH;
  // other currencies: convert roughly via UAH rate
  return b * 40 < MIN_BUDGET_UAH;
}

// ─── shouldApply — runs BEFORE any browser page is opened ────────────────────

/**
 * Multi-stage synchronous filter. Call this before opening the browser.
 *   Stage 1: budget minimum
 *   Stage 2: blocked keywords (video, монтаж, архітектор, особистий бренд, …)
 *   Stage 3: must match at least one IT/digital keyword
 */
export async function shouldApply(
  project: Project,
  _useAIScore = false,
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

  // Stage 1 — budget minimum
  if (budgetTooLow(project)) {
    return { ...base, allowed: false, stage: 'budget',
      reason: `Budget too low: ${budget} ${currency} (min ${MIN_BUDGET_UAH} UAH / ${MIN_BUDGET_USD} USD)` };
  }

  // Stage 2 — blocked keywords (hard reject, no browser opened)
  const blocked = findMatches(text, BLOCKED_KEYWORDS);
  if (blocked.length > 0) {
    return { ...base, allowed: false, stage: 'blocked_keyword', blockedKeywords: blocked,
      reason: `Blocked keyword: ${blocked.slice(0, 3).map((k) => `"${k}"`).join(', ')}` };
  }

  // Stage 3 — must match at least one allowed IT keyword
  const matched = findMatches(text, ALLOWED_KEYWORDS);
  if (matched.length === 0) {
    return { ...base, allowed: false, stage: 'no_allowed_keyword',
      reason: 'No IT/digital keywords found in title, description, or skills' };
  }

  return { ...base, allowed: true, stage: 'passed', matchedKeywords: matched,
    reason: `Passed. Matched: [${matched.slice(0, 3).join(', ')}]` };
}

// ─── Legacy shouldBid (kept for backwards compatibility) ─────────────────────

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
  const results: Array<Project & { matchScore: number }> = [];
  for (const project of projects) {
    const result = filterProject(project, settings, alreadyBidIds);
    if (result.passed) {
      results.push({ ...project, matchScore: result.matchScore ?? 80 });
    }
  }
  return results.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
}
