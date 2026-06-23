/**
 * POST /api/freelancehunt/generate-bid
 * body: { title, description, budget?, code? }
 * returns: { text, amount, days }
 *
 * AI writes the proposal AND decides a competitive bid amount (UAH) and a
 * realistic deadline (days), based on the project. Called by the BidPilot
 * extension. CORS-open for the chrome-extension origin.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

export async function POST(req: Request) {
  let body: { title?: string; description?: string; budget?: number } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const title = (body.title || '').slice(0, 300);
  const description = (body.description || '').slice(0, 3000);
  const budget = Number(body.budget) || 0;

  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ text: '', amount: budget || '', days: 3 }, { headers: CORS });

  const sys =
    'Ти досвідчений україномовний фрілансер. Проаналізуй проєкт і поверни ВИКЛЮЧНО JSON без пояснень і без markdown, у форматі: ' +
    '{"text": string, "amount": number, "days": number}. ' +
    '"text" — коротка (3-5 речень) привітна й конкретна заявка українською, без вигадок, без контактів і посилань, звертання на «ви», показати розуміння задачі. ' +
    '"amount" — конкурентна ставка в гривнях (число). Якщо вказано бюджет > 0 — орієнтуйся на нього (можна трохи нижче, але не демпінгуй). Якщо бюджет 0 — оціни розумно за обсягом. ' +
    '"days" — реалістичний термін виконання в днях (ціле число, зазвичай 1-14).';
  const user = `Назва: ${title}\nБюджет (грн, 0 = невідомо): ${budget}\nОпис: ${description}`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        max_tokens: 400,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      }),
    });
    const data = await res.json().catch(() => ({}));
    const raw = data?.choices?.[0]?.message?.content?.trim() || '';
    let parsed: { text?: string; amount?: number; days?: number } = {};
    try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch { /* leave empty */ }

    const text = (parsed.text || '').trim();
    let amount = Number(parsed.amount) || budget || 0;
    if (budget > 0 && amount > budget * 1.2) amount = budget; // safety: never overbid wildly
    let days = Math.round(Number(parsed.days) || 3);
    if (days < 1) days = 1; if (days > 60) days = 60;

    return NextResponse.json({ text, amount: amount || '', days }, { headers: CORS });
  } catch {
    return NextResponse.json({ text: '', amount: budget || '', days: 3 }, { headers: CORS });
  }
}