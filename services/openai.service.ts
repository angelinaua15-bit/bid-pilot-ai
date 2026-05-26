/**
 * services/openai.service.ts
 * OpenAI API integration for AI bid generation.
 * Requires: OPENAI_API_KEY environment variable.
 *
 * Falls back to mock data when OPENAI_API_KEY is not set so the
 * app works in browser preview / demo mode.
 */

import type { FreelancerProfile, Project, GeneratedBid, ProjectAnalysis } from '@/types';
import { mockGenerateBid } from '@/lib/mock-data';
import { config } from '@/lib/config';

// Lazy-initialize OpenAI client only on the server when key is present
let _openai: import('openai').default | null = null;

function getOpenAI() {
  if (_openai) return _openai;
  const key = config.openai.apiKey;
  if (!key) return null;
  // Dynamic import avoids bundling issues when the package is not installed
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const OpenAI = require('openai').default as typeof import('openai').default;
  _openai = new OpenAI({ apiKey: key });
  return _openai;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a personalized bid proposal for a project.
 */
export async function generateBid(
  project: Project,
  profile: FreelancerProfile,
  options?: { additionalNotes?: string; customPrice?: number; customDeadline?: string }
): Promise<GeneratedBid> {
  const openai = getOpenAI();

  if (!openai) {
    // No API key — return mock
    await new Promise((r) => setTimeout(r, 1500));
    return mockGenerateBid(project.title, profile.tone);
  }

  const completion = await openai.chat.completions.create({
    model: config.openai.model,
    temperature: 0.7,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: buildSystemPrompt(profile) },
      { role: 'user', content: buildBidPrompt(project, options) },
    ],
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0]?.message?.content ?? '{}';
  return parseBidResponse(raw, project, profile);
}

/**
 * Analyze a project and return fit score, complexity, risks, pricing suggestion.
 */
export async function analyzeProject(
  project: Project,
  profile: FreelancerProfile
): Promise<ProjectAnalysis> {
  const openai = getOpenAI();

  if (!openai) {
    // No API key — return mock analysis
    await new Promise((r) => setTimeout(r, 800));
    const matchScore = project.matchScore ?? 80;
    return {
      fitScore: matchScore,
      complexity: matchScore > 90 ? 'low' : matchScore > 75 ? 'medium' : 'high',
      strategy:
        'Акцентуйте на релевантному кейсі та технічному підході. Запропонуйте MVP за 2 тижні з подальшим розширенням.',
      risks: [
        'Нечітке ТЗ — уточніть перед стартом',
        'Можливе розширення скопу — зафіксуйте рамки в договорі',
      ],
      priceMin: project.budget,
      priceMax: project.budgetMax ?? Math.round(project.budget * 1.5),
      deadline: '14 днів',
    };
  }

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    max_tokens: 512,
    messages: [
      {
        role: 'system',
        content: `Ти — AI-консультант для фрілансера. Відповідай ТІЛЬКИ JSON. 
Схема: { "fitScore": number(0-100), "complexity": "low"|"medium"|"high", "strategy": string, "risks": string[], "priceMin": number, "priceMax": number, "deadline": string }`,
      },
      { role: 'user', content: buildAnalysisPrompt(project, profile) },
    ],
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0]?.message?.content ?? '{}';
  return JSON.parse(raw) as ProjectAnalysis;
}

/**
 * Suggest an optimal price for a project based on profile and market data.
 */
export async function suggestPrice(project: Project, profile: FreelancerProfile): Promise<number> {
  const base = project.budget;
  const factor = profile.experience.length > 50 ? 1.2 : 1.0;
  return Math.round(base * factor);
}

/**
 * Suggest an optimal deadline for a project.
 */
export async function suggestDeadline(project: Project): Promise<string> {
  const budgetMid = ((project.budget ?? 0) + (project.budgetMax ?? project.budget ?? 0)) / 2;
  if (budgetMid > 2000) return '21 день';
  if (budgetMid > 800) return '14 днів';
  return '7 днів';
}

// ─── Response parser ─────────────────────────────────────────────────────────

function parseBidResponse(raw: string, project: Project, profile: FreelancerProfile): GeneratedBid {
  let parsed: { text?: string; price?: number; deadline?: string; questions?: string[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  return {
    id: `bid_${Date.now()}`,
    userId: profile.userId,
    projectId: project.id,
    projectTitle: project.title,
    text: parsed.text ?? '',
    price: parsed.price ?? project.budget,
    deadline: parsed.deadline ?? '14 днів',
    questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    status: 'draft',
    createdAt: new Date().toISOString(),
  };
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildSystemPrompt(profile: FreelancerProfile): string {
  return `Ти — AI-асистент для фрілансера. 
Ім'я: ${profile.name}
Спеціалізація: ${profile.specialization}
Послуги: ${profile.services}
Досвід: ${profile.experience}
Портфоліо: ${profile.portfolioLinks.join(', ')}
Тон заявки: ${profile.tone}
Мова заявки: ${profile.language}

Генеруй персоналізовані заявки на проєкти у форматі JSON:
{
  "text": "текст заявки",
  "price": число,
  "deadline": "рядок",
  "questions": ["питання 1", "питання 2", "питання 3"]
}`;
}

function buildAnalysisPrompt(project: Project, profile: FreelancerProfile): string {
  return `Проєкт: ${project.title}
Опис: ${project.description}
Бюджет: ${project.budget}–${project.budgetMax ?? project.budget} ${project.currency}
Навички: ${project.skills.join(', ')}
Фрілансер: ${profile.specialization} (${profile.experience})
Категорії фрілансера: ${profile.categories.join(', ')}

Проаналізуй відповідність і поверни JSON.`;
}

function buildBidPrompt(
  project: Project,
  options?: { additionalNotes?: string; customPrice?: number; customDeadline?: string }
): string {
  return `Проєкт: ${project.title}
Опис: ${project.description}
Бюджет: ${project.budget}–${project.budgetMax ?? project.budget} ${project.currency}
Категорія: ${project.category}
Навички: ${project.skills.join(', ')}
${options?.additionalNotes ? `Додаткові нотатки: ${options.additionalNotes}` : ''}
${options?.customPrice ? `Бажана ціна: ${options.customPrice}` : ''}
${options?.customDeadline ? `Бажаний дедлайн: ${options.customDeadline}` : ''}

Згенеруй сильну персоналізовану заявку.`;
}
