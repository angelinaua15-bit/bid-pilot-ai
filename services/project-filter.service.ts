/**
 * services/project-filter.service.ts
 *
 * Multi-stage filtering pipeline for Freelancehunt projects.
 * Order of checks (each can SKIP the project, no OpenAI tokens wasted):
 *   1. Budget minimum (2000 UAH / 50 USD)
 *   2. Blocked keywords (hard reject)
 *   3. Allowed keywords  (must match at least one)
 *   4. Allowed categories (optional — when provided)
 *   5. AI relevance score via OpenAI (score < 70 → skip)
 *
 * Every decision is logged with matched/blocked keywords, score, budget, category.
 */

import type { Project, AutoBidSettings, FreelancerCategory } from '@/types';
import { safeText as safe } from '@/lib/safe-text';

// ─── Config: budget minimums ──────────────────────────────────────────────────

export const MIN_BUDGET_UAH = 2000;
export const MIN_BUDGET_USD = 50;
export const MIN_BUDGET_EUR = 50;

// ─── Config: allowed IT/digital keywords (whitelist) ─────────────────────────

export const ALLOWED_KEYWORDS: string[] = [
  // CMS / e-commerce
  'wordpress', 'opencart', 'shopify', 'woocommerce', 'woo commerce', 'prestashop',
  'bitrix', 'webflow', 'tilda', 'joomla', 'drupal',
  // Frameworks & languages
  'react', 'next.js', 'nextjs', 'vue', 'nuxt', 'angular', 'svelte',
  'php', 'laravel', 'symfony', 'yii',
  'python', 'django', 'flask', 'fastapi',
  'node.js', 'nodejs', 'express', 'nest.js', 'nestjs',
  'javascript', 'typescript', 'html', 'css', 'sass', 'tailwind',
  'flutter', 'react native', 'swift', 'kotlin',
  // Back-end / infra
  'backend', 'front-end', 'frontend', 'fullstack', 'full stack', 'full-stack',
  'api', 'rest api', 'graphql', 'webhook', 'docker', 'devops', 'ci/cd', 'serverless',
  // Databases
  'postgresql', 'mysql', 'mongodb', 'redis', 'firebase', 'supabase',
  // Ads & analytics
  'seo', 'google ads', 'meta ads', 'facebook ads', 'контекстна реклама',
  'tracking', 'ga4', 'gtm', 'google tag manager', 'pixel', 'google analytics',
  // Bots & automation
  'telegram bot', 'telegram mini app', 'mini app', 'телеграм бот', 'чат бот', 'chatbot',
  'бот', 'bot', 'automation', 'автоматизація', 'автоматизация',
  'парсер', 'парсинг', 'scraping', 'parsing',
  'zapier', 'make.com', 'n8n',
  // AI
  'ai', 'openai', 'chatgpt', 'gpt', 'llm', 'langchain', 'штучний інтелект',
  'нейромережа', 'нейросеть',
  // CRM / integrations
  'crm', 'інтеграція', 'интеграция', 'integration',
  // Web & digital generic
  'website', 'web development', 'вебсайт', 'веб розробка', 'веб-розробка',
  'landing page', 'лендінг', 'лендинг', 'landing',
  'saas', 'mvp', 'dashboard', 'admin panel', 'адмін панель',
  'portal', 'додаток', 'застосунок', 'мобільний додаток',
  'верстка', 'верстання',
  'figma', 'ui/ux', 'ux design',
  // Generic IT
  'розробка', 'разработка', 'програміст', 'программист', 'програмування',
  'software', 'web app', 'mobile app', 'веб-додаток',
];

// ─── Config: blocked keywords (hard reject) ───────────────────────────────────

export const BLOCKED_KEYWORDS: string[] = [
  // Video / media
  'монтаж', 'відеомонтаж', 'video editing', 'video edit', 'відео монтаж',
  'рилс', 'reels', 'tiktok',
  // Fashion / physical
  'fashion', 'одяг', 'одежда', 'швейний', 'пошиття',
  // Gambling / betting
  'беттинг', 'бетинг', 'гемблінг', 'gambling', 'ставки на спорт', 'казино',
  'букмекер', 'бетс', 'betting',
  // Copywriting / writing
  'копирайтинг', 'копірайтинг', 'copywriting',
  'написання текстів', 'написання статей', 'написання постів',
  'перевод', 'переклад', 'translation', 'transcription', 'транскрибация', 'транскрипція',
  'редактура', 'коректура',
  // Logo / graphic design only
  'логотип', 'лого', 'logo design', 'брендинг', 'бренд-бук', 'brandbook',
  'ілюстрація', 'illustration', 'поліграфія', 'баннер дизайн', 'банери дизайн',
  // Consulting / non-digital
  'консультация', 'консультація', 'consulting',
  'notion', 'нотіон',
  'поставщик', 'постачальник', 'supplier',
  // Physical / materials
  'дерево', 'дуб', 'ясень', 'деревообробка', 'виробництво',
  'будівництво', 'ремонт квартири', 'ремонт офісу',
  'масаж', 'манікюр', 'косметолог',
  // Instagram posts / social content only
  'instagram post', 'instagram posts', 'пости в instagram', 'контент план',
  'smm пости', 'написання постів',
];

// ─── Config: allowed Freelancehunt categories ─────────────────────────────────

export const ALLOWED_FH_CATEGORIES: string[] = [
  'веб-програмування',
  'cms',
  'html/css',
  'javascript',
  'php',
  'python',
  'seo',
  'реклама',
  'контекстна реклама',
  'боти',
  'автоматизація',
  'ai',
  'парсинг',
  'інтеграції',
  'мобільні додатки',
  'дизайн',    // included — may have UI/UX dev
  'верстка',
];

// ─── Result type ──────────────────────────────────────────────────────────────

export interface ApplyResult {
  allowed: boolean;
  reason: string;
  stage: 'budget' | 'blocked_keyword' | 'no_allowed_keyword' | 'category' | 'ai_score' | 'passed';
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
      : safe(project.skills),
  ].join(' ').toLowerCase();
}

function findMatches(text: string, keywords: string[]): string[] {
  return keywords.filter((kw) => text.includes(kw.toLowerCase()));
}

function budgetInUAH(project: Project): number {
  const cur = (project.currency ?? 'UAH').toUpperCase();
  if (cur === 'USD') return project.budget * 40;   // rough UAH rate
  if (cur === 'EUR') return project.budget * 43;
  if (cur === 'UAH') return project.budget;
  return project.budget;
}

// ─── AI relevance score via OpenAI ───────────────────────────────────────────

export const AI_SCORE_THRESHOLD = 70;

export async function getAIRelevanceScore(project: Project): Promise<{ score: number; reason: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { score: 75, reason: 'No OPENAI_API_KEY — skipping AI score check (default 75)' };

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const OpenAI = require('openai').default as typeof import('openai').default;
    const openai = new OpenAI({ apiKey: key });

    const titleText = safe(project.title).slice(0, 120);
    const descText  = safe(project.description).slice(0, 400);
    const catText   = safe(project.category);
    const budText   = `${project.budget} ${project.currency ?? 'UAH'}`;

    const prompt = `Ти — IT-підрядник. Оціни релевантність проєкту для веб/IT/digital фрілансера.
Проєкт: "${titleText}"
Категорія: ${catText}
Бюджет: ${budText}
Опис: ${descText}

Оціни від 0 до 100:
- 90–100: чітко IT/digital (розробка, автоматизація, боти, реклама)
- 70–89: схоже на IT (може мати технічні компоненти)
- 50–69: нечітко, може бути нерелевантним
- 0–49: явно не IT (монтаж, копірайтинг, логотипи, фізичні товари)

Відповідай ТІЛЬКИ JSON: { "score": number, "reason": string }`;

    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 80,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}') as { score?: number; reason?: string };
    const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 50;
    return { score, reason: parsed.reason ?? '' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // On API error, default to passing (don't block valid projects due to API failure)
    return { score: 75, reason: `AI score check failed (${msg}) — defaulting to 75` };
  }
}

// ─── Main: shouldApply() ──────────────────────────────────────────────────────

/**
 * Decide whether to apply to a project.
 * Runs synchronous checks first (fast, no API cost), then optional AI scoring.
 *
 * @param project     Project to evaluate
 * @param useAIScore  When true, calls OpenAI to score the project (costs tokens). Default: true
 */
export async function shouldApply(
  project: Project,
  useAIScore = true
): Promise<ApplyResult> {
  const text     = projectText(project);
  const budget   = project.budget ?? 0;
  const currency = (project.currency ?? 'UAH').toUpperCase();
  const category = safe(project.category).toLowerCase();
  const base: Omit<ApplyResult, 'allowed' | 'reason' | 'stage'> = {
    matchedKeywords: [],
    blockedKeywords: [],
    budget,
    currency,
    category,
  };

  // ── Stage 1: Budget minimum ────────────────────────────────────────────────
  const uahEquivalent = budgetInUAH(project);
  const belowBudget =
    (currency === 'UAH' && budget < MIN_BUDGET_UAH) ||
    (currency === 'USD' && budget < MIN_BUDGET_USD) ||
    (currency === 'EUR' && budget < MIN_BUDGET_EUR) ||
    (currency !== 'UAH' && currency !== 'USD' && currency !== 'EUR' && uahEquivalent < MIN_BUDGET_UAH);

  if (belowBudget) {
    return {
      ...base,
      allowed: false,
      stage: 'budget',
      reason: `Budget too low: ${budget} ${currency} (min: ${MIN_BUDGET_UAH} UAH / ${MIN_BUDGET_USD} USD)`,
    };
  }

  // ── Stage 2: Blocked keywords (hard reject) ────────────────────────────────
  const blockedMatches = findMatches(text, BLOCKED_KEYWORDS);
  if (blockedMatches.length > 0) {
    return {
      ...base,
      allowed: false,
      stage: 'blocked_keyword',
      blockedKeywords: blockedMatches,
      reason: `Blocked keywords found: ${blockedMatches.slice(0, 3).map((k) => `"${k}"`).join(', ')}`,
    };
  }

  // ── Stage 3: Must match at least one allowed keyword ──────────────────────
  const allowedMatches = findMatches(text, ALLOWED_KEYWORDS);
  if (allowedMatches.length === 0) {
    return {
      ...base,
      allowed: false,
      stage: 'no_allowed_keyword',
      reason: 'No IT/digital keywords found in title, description, or skills',
    };
  }

  // ── Stage 4: AI relevance score (optional, skips if no API key) ───────────
  if (useAIScore) {
    const { score, reason: aiReason } = await getAIRelevanceScore(project);
    if (score < AI_SCORE_THRESHOLD) {
      return {
        ...base,
        allowed: false,
        stage: 'ai_score',
        matchedKeywords: allowedMatches,
        aiScore: score,
        reason: `AI score too low: ${score}/100 (threshold: ${AI_SCORE_THRESHOLD}) — ${aiReason}`,
      };
    }

    return {
      ...base,
      allowed: true,
      stage: 'passed',
      matchedKeywords: allowedMatches,
      aiScore: score,
      reason: `Passed all filters. Keywords: [${allowedMatches.slice(0, 3).join(', ')}]. AI score: ${score}/100`,
    };
  }

  // ── Passed (no AI score) ───────────────────────────────────────────────────
  return {
    ...base,
    allowed: true,
    stage: 'passed',
    matchedKeywords: allowedMatches,
    reason: `Passed keyword filter. Matched: [${allowedMatches.slice(0, 3).join(', ')}]`,
  };
}

// ─── Legacy sync API (kept for backwards compatibility) ───────────────────────

export interface FilterResult {
  passed: boolean;
  reason?: string;
  matchScore?: number;
}

export interface ShouldBidResult {
  allowed: boolean;
  reason: string;
}

/** @deprecated Use shouldApply() instead */
export function shouldBid(project: Project): ShouldBidResult {
  const text = projectText(project);
  const blocked = findMatches(text, BLOCKED_KEYWORDS);
  if (blocked.length > 0) {
    return { allowed: false, reason: `Blocked keyword: "${blocked[0]}"` };
  }
  const allowed = findMatches(text, ALLOWED_KEYWORDS);
  if (allowed.length > 0) {
    return { allowed: true, reason: `IT keyword matched: "${allowed[0]}"` };
  }
  return { allowed: false, reason: 'No IT/digital keywords found' };
}

export function computeMatchScore(project: Project): number {
  const text = projectText(project);
  const hits = findMatches(text, ALLOWED_KEYWORDS).length;
  return Math.min(100, hits * 15);
}

export function filterProject(
  project: Project,
  settings: AutoBidSettings,
  alreadyBidIds: Set<string>
): FilterResult {
  if (settings.emergencyStop) return { passed: false, reason: 'Emergency stop' };
  if (alreadyBidIds.has(project.id) || alreadyBidIds.has(project.freelancehuntId)) {
    return { passed: false, reason: 'Already bid' };
  }
  const result = shouldBid(project);
  return { passed: result.allowed, reason: result.reason };
}

export function filterProjects(
  projects: Project[],
  settings: AutoBidSettings,
  alreadyBidIds: Set<string>
): Array<Project & { matchScore: number }> {
  return projects
    .map((p) => ({ ...p, matchScore: computeMatchScore(p) }))
    .filter((p) => filterProject(p, settings, alreadyBidIds).passed)
    .sort((a, b) => b.matchScore - a.matchScore);
}
