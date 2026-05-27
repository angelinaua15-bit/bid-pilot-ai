/**
 * services/ai-bid.service.ts
 * Generates bid text, price, and deadline for a project using OpenAI.
 * Incorporates the King Kong Lab company profile for context.
 *
 * Resilience:
 *   - No API key → immediate template fallback (no error thrown)
 *   - 429 / quota exceeded → warning logged, template fallback (no error thrown)
 *   - Other transient errors → exponential backoff, up to MAX_RETRIES attempts
 *   - Permanent API failure → template fallback (no error thrown)
 */

import type { Project, GeneratedBid, CompanyProfile } from '@/types';
import { companyProfile as defaultProfile } from '@/lib/mock-data';
import { safeText as safe } from '@/lib/safe-text';

// ─── Error class exposed to callers ──────────────────────────────────────────

/** Thrown only when the caller wants to distinguish quota exhaustion from other errors. */
export class OpenAIQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenAIQuotaError';
  }
}

// ─── OpenAI client ────────────────────────────────────────────────────────────

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const OpenAI = require('openai').default as typeof import('openai').default;
    return new OpenAI({ apiKey: key });
  } catch {
    return null;
  }
}

// ─── Retry helper ─────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // 1 s → 2 s → 4 s

function isQuotaError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // OpenAI SDK surfaces quota/rate-limit as status 429
    if (msg.includes('429') || msg.includes('quota') || msg.includes('rate limit') || msg.includes('insufficient_quota')) {
      return true;
    }
    // Check OpenAI SDK typed error
    const asAny = err as unknown as Record<string, unknown>;
    if (typeof asAny.status === 'number' && asAny.status === 429) return true;
    if (typeof asAny.code === 'string' && asAny.code === 'insufficient_quota') return true;
  }
  return false;
}

async function callOpenAIWithRetry<T>(
  fn: () => Promise<T>,
  context: string
): Promise<{ result: T; usedFallback: false } | { result: null; usedFallback: true; reason: 'quota' | 'error'; message: string }> {
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      const result = await fn();
      return { result, usedFallback: false };
    } catch (err) {
      attempt++;

      if (isQuotaError(err)) {
        // Quota exhausted — no point retrying, fall back immediately
        const msg = `OpenAI quota exceeded (${context}). Using template bid.`;
        console.warn(`[ai-bid] ${msg}`);
        return { result: null, usedFallback: true, reason: 'quota', message: msg };
      }

      const errMsg = err instanceof Error ? err.message : String(err);

      if (attempt >= MAX_RETRIES) {
        console.error(`[ai-bid] OpenAI call failed after ${MAX_RETRIES} attempts (${context}): ${errMsg}`);
        return { result: null, usedFallback: true, reason: 'error', message: errMsg };
      }

      // Exponential backoff before next attempt
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`[ai-bid] OpenAI attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${delay}ms: ${errMsg}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  // Should be unreachable, but satisfies TypeScript
  return { result: null, usedFallback: true, reason: 'error', message: 'Max retries reached' };
}

// ─── Language detection ───────────────────────────────────────────────────────

type Lang = 'uk' | 'ru' | 'en';

function detectLanguage(project: Project): Lang {
  const text = [
    safe(project.title),
    safe(project.description),
  ].join(' ');

  // Count Cyrillic chars that are unique to Ukrainian (і, ї, є, ґ)
  const ukChars   = (text.match(/[іїєґ]/gi) ?? []).length;
  // Russian-only chars (ы, э, ъ, ё)
  const ruChars   = (text.match(/[ыэъё]/gi) ?? []).length;
  // Any Cyrillic at all
  const anyCyrillic = (text.match(/[а-яёіїєґ]/gi) ?? []).length;

  if (anyCyrillic < 10) return 'en';
  if (ruChars > ukChars) return 'ru';
  return 'uk';
}

// ─── Template fallback bids — individual freelancer voice ─────────────────────

const FALLBACK_UA =
  'Вітаю! Маю релевантний досвід у подібних задачах і готова взятись за ваш проєкт. ' +
  'Можу швидко розібратись у вимогах, запропонувати оптимальне рішення та виконати роботу якісно. ' +
  'Готова обговорити деталі й одразу почати.';

const FALLBACK_RU =
  'Здравствуйте! У меня есть релевантный оп��т в похожих задачах, готова взяться за ваш проект. ' +
  'Могу быстро разобраться в требованиях, предложить оптимальное решение и выполнить работу качественно. ' +
  'Готова обсудить детали и начать.';

const FALLBACK_EN =
  'Hello! I have relevant experience with similar tasks and can help with your project. ' +
  'I can quickly review the requirements, suggest the best solution, and complete the work carefully. ' +
  'Ready to discuss details and start.';

function getFallbackText(lang: Lang): string {
  if (lang === 'ru') return FALLBACK_RU;
  if (lang === 'en') return FALLBACK_EN;
  return FALLBACK_UA;
}

function buildSystemPrompt(lang: Lang): string {
  const langLabel = lang === 'uk' ? 'українська' : lang === 'ru' ? 'російська' : 'English';

  return `Ти — фрілансер-розробник, що шукає замовлення на Freelancehunt.
Пишеш заявки від ПЕРШОЇ ОСОБИ (Я, не Ми).

ЗАБОРОНЕНО використовувати:
- "Ми", "Наша команда", "King Kong Lab", "компанія", "агентство", "команда спеціалістів"

ОБОВ'ЯЗКОВО використовуй:
- "Я", "Маю досвід", "Можу зробити", "Готовий/готова взятись", "Запропоную рішення"

Правила:
- Заявка КОРОТКА: 4–6 речень максимум
- Структура: привітання → розуміння задачі → релевантний досвід → що конкретно зроблю → ціна і термін → запрошення обговорити
- Згадай 1 конкретну технологію або кейс
- НЕ пиши "Готовий до обговорення" або "Звертайтесь" — занадто шаблонно
- Мова відповіді: ${langLabel}

Відповідай ТІЛЬКИ JSON:
{ "text": string, "price": number, "deadline": string, "questions": string[] }`;
}

function buildBidPrompt(project: Project): string {
  const skillsList = Array.isArray(project.skills)
    ? project.skills.map(String).join(', ')
    : safe(project.skills);
  const description = typeof project.description === 'string'
    ? project.description.slice(0, 600)
    : safe(project.description).slice(0, 600);
  return `Проєкт: ${safe(project.title) || project.title}
Опис: ${description}
Бюджет: ${project.budget}–${project.budgetMax ?? project.budget} ${project.currency}
Навички: ${skillsList}
Конкуренти: ${project.bidsCount} заявок вже є

Згенеруй заявку та запитання до замовника (1-2 уточнюючих питання).`;
}

// ─── Template fallback bid builder ───────────────────────────────────────────

function buildTemplateBid(project: Project, _profile?: CompanyProfile): GeneratedBid {
  const lang = detectLanguage(project);
  const bidText = getFallbackText(lang);
  const price = Math.round(project.budget * (1 + Math.random() * 0.2));
  const deadline = price > 1500 ? '21 день' : price > 700 ? '14 днів' : '7 днів';

  const questions = lang === 'ru'
    ? ['Есть ли техническое задание или макет?', 'Какие сроки критичны для запуска?']
    : lang === 'en'
      ? ['Do you have a technical spec or design mockup?', 'What are the critical deadlines?']
      : ['Чи є технічне завдання або Figma-макет?', '��кі терміни критичні для запуску?'];

  return {
    id: `bid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: 'freelancer',
    projectId: project.id,
    projectTitle: project.title,
    text: bidText,
    price,
    deadline,
    questions,
    status: 'draft',
    createdAt: new Date().toISOString(),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a bid for a project on behalf of King Kong Lab.
 * - If OPENAI_API_KEY is not set: returns a template bid immediately (no error).
 * - If OpenAI returns 429 / quota exceeded: returns a template bid, emits a warning.
 * - If OpenAI fails transiently: retries up to 3 times with exponential backoff, then falls back.
 * - Never throws — the cycle always continues regardless of OpenAI availability.
 *
 * @param project - The project to bid on
 * @param profile - Company profile (defaults to King Kong Lab)
 * @returns { bid, usedFallback, fallbackReason? }
 */
// Forbidden company phrases to strip/replace from OpenAI output
const COMPANY_PHRASES: [RegExp, string][] = [
  [/\bми\b[\s—-]*(king\s*kong\s*lab|kkl)\b/gi, 'Я'],
  [/\bking\s*kong\s*lab\b/gi, 'Я'],
  [/\bmi\s+(king|kkl)\b/gi, 'Я'],
  [/\bнаша\s+команда\b/gi, 'Я'],
  [/\bнаш[іа]\s+фахівц[іи]\b/gi, 'Я'],
  [/\bкоманда\s+спеціалістів\b/gi, 'досвідчений розробник'],
  [/\bкомпанія\b/gi, 'фрілансер'],
  [/\bагентство\b/gi, 'фрілансер'],
  [/\bми\s+готов[іи]/gi, 'Я готовий/готова'],
  [/\bми\s+маємо\b/gi, 'Маю'],
  [/\bми\s+зроби/gi, 'Зроблю'],
  [/\bми\s+виконаємо\b/gi, 'Виконаю'],
  [/\bми\s+пропонуємо\b/gi, 'Пропоную'],
  // Russian equivalents
  [/\bнаша\s+команда\b/gi, 'Я'],
  [/\bмы\s+готов[ыы]/gi, 'Я готов/готова'],
  [/\bмы\s+имеем\b/gi, 'У меня есть'],
  [/\bмы\s+сделаем\b/gi, 'Сделаю'],
  [/\bкомпания\b/gi, 'фрилансер'],
  [/\bагентство\b/gi, 'фрилансер'],
];

function sanitizeProposalText(text: string): string {
  let result = text;
  for (const [pattern, replacement] of COMPANY_PHRASES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export async function generateAutoBid(
  project: Project,
  _profile?: CompanyProfile
): Promise<GeneratedBid & { usedFallback?: boolean; fallbackReason?: string }> {
  const openai = getOpenAI();
  const lang = detectLanguage(project);

  // ── No API key ──────────────────────────────────────────────────────────────
  if (!openai) {
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 200));
    return { ...buildTemplateBid(project), usedFallback: true, fallbackReason: 'no_key' };
  }

  // ── Call OpenAI with retry + fallback ───────────────────────────────────────
  const outcome = await callOpenAIWithRetry(
    () =>
      openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.65,
        max_tokens: 512,
        messages: [
          { role: 'system', content: buildSystemPrompt(lang) },
          { role: 'user', content: buildBidPrompt(project) },
        ],
        response_format: { type: 'json_object' },
      }),
    `project "${project.title.slice(0, 40)}"`
  );

  // ── Fallback (quota / error) ─────────────────────────────────────────────────
  if (outcome.usedFallback) {
    return {
      ...buildTemplateBid(project),
      usedFallback: true,
      fallbackReason: outcome.reason === 'quota' ? 'quota_exceeded' : 'api_error',
    };
  }

  // ── Parse response ───────────────────────────────────────────────────────────
  let parsed: { text?: string; price?: number; deadline?: string; questions?: string[] } = {};
  try {
    parsed = JSON.parse(outcome.result.choices[0]?.message?.content ?? '{}');
  } catch {
    parsed = {};
  }

  const rawText = parsed.text ?? getFallbackText(lang);
  const cleanText = sanitizeProposalText(rawText);

  return {
    id: `bid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: 'freelancer',
    projectId: project.id,
    projectTitle: project.title,
    text: cleanText,
    price: parsed.price ?? project.budget,
    deadline: parsed.deadline ?? '14 днів',
    questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    status: 'draft',
    createdAt: new Date().toISOString(),
    usedFallback: false,
  };
}
