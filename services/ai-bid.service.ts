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
    const asAny = err as Record<string, unknown>;
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

const MOCK_BIDS: Record<string, string> = {
  websites: 'Привіт! King Kong Lab. Робимо сайти на Next.js — швидко, якісно, з гарантією результату. Є схожі кейси. Готові взятись.',
  telegram_bots: 'Привіт! Ми — King Kong Lab. Telegram-боти — наш профіль. Реалізуємо повністю: логіка, оплата, адмін. Готові.',
  ai_agents: 'King Kong Lab. Будуємо AI-агентів на GPT-4 + LangChain. Є реальні кейси в e-commerce та SaaS. Обговоримо?',
  automation: 'King Kong Lab. Автоматизація — наша стихія. Parsinig, скрипти, n8n, Make — закриємо будь-яке завдання.',
  default: 'Привіт! Ми — King Kong Lab. Маємо релевантний досвід саме для цього проєкту. Готові взятись і зробити чисто.',
};

function buildSystemPrompt(profile: CompanyProfile): string {
  return `Ти — AI-асистент компанії ${profile.name}.
${profile.description}

Послуги: ${profile.services.join(', ')}.
Стиль заявок: ${profile.bidStyle} (short = коротко, впевнено, без зайвого).

Правила:
- Заявка має бути КОРОТКОЮ (3-5 речень максимум)
- Звертайся по-людськи, без шаблонів
- Згадай 1 конкретний кейс або технологію
- НЕ пиши "Готовий до обговорення" або "Звертайтесь"
- Запропонуй конкретну ціну і терміни
- Мова: ${profile.language === 'uk' ? 'українська' : profile.language === 'ru' ? 'російська' : 'англійська'}

Відповідай ТІЛЬКИ JSON:
{ "text": string, "price": number, "deadline": string, "questions": string[] }`;
}

function buildBidPrompt(project: Project): string {
  return `Проєкт: ${project.title}
Опис: ${project.description.slice(0, 600)}
Бюджет: ${project.budget}–${project.budgetMax ?? project.budget} ${project.currency}
Навички: ${project.skills.join(', ')}
Конкуренти: ${project.bidsCount} заявок вже є

Згенеруй заявку та запитання до замовника (1-2 уточнюючих питання).`;
}

// ─── Template fallback bid builder ───────────────────────────────────────────

function buildTemplateBid(project: Project, profile: CompanyProfile): GeneratedBid {
  const category = project.category?.toLowerCase() ?? '';
  const bidText =
    MOCK_BIDS[
      Object.keys(MOCK_BIDS).find(
        (k) => category.includes(k) || project.skills.some((s) => s.toLowerCase().includes(k))
      ) ?? 'default'
    ] ?? MOCK_BIDS.default;

  const price = Math.round(project.budget * (1 + Math.random() * 0.2));
  const deadline = price > 1500 ? '21 день' : price > 700 ? '14 днів' : '7 днів';

  return {
    id: `bid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: 'company',
    projectId: project.id,
    projectTitle: project.title,
    text: bidText,
    price,
    deadline,
    questions: [
      'Чи є технічне завдання або Figma-макет?',
      'Які терміни критичні для запуску?',
    ],
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
export async function generateAutoBid(
  project: Project,
  profile: CompanyProfile = defaultProfile
): Promise<GeneratedBid & { usedFallback?: boolean; fallbackReason?: string }> {
  const openai = getOpenAI();

  // ── No API key ──────────────────────────────────────────────────────────────
  if (!openai) {
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 200));
    return { ...buildTemplateBid(project, profile), usedFallback: true, fallbackReason: 'no_key' };
  }

  // ── Call OpenAI with retry + fallback ───────────────────────────────────────
  const outcome = await callOpenAIWithRetry(
    () =>
      openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.6,
        max_tokens: 512,
        messages: [
          { role: 'system', content: buildSystemPrompt(profile) },
          { role: 'user', content: buildBidPrompt(project) },
        ],
        response_format: { type: 'json_object' },
      }),
    `project "${project.title.slice(0, 40)}"`
  );

  // ── Fallback (quota / error) ─────────────────────────────────────────────────
  if (outcome.usedFallback) {
    return {
      ...buildTemplateBid(project, profile),
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

  return {
    id: `bid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: 'company',
    projectId: project.id,
    projectTitle: project.title,
    text: parsed.text ?? MOCK_BIDS.default,
    price: parsed.price ?? project.budget,
    deadline: parsed.deadline ?? '14 днів',
    questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    status: 'draft',
    createdAt: new Date().toISOString(),
    usedFallback: false,
  };
}
