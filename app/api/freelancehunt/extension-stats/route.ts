/**
 * Extension activity / analytics bridge.
 *
 *  POST  { code, event:'bid', title?, amount?, days?, ai?, status? }   ← from extension
 *  GET   ?userId=...                                                    ← from Mini App
 *
 * `code` is the user's connect code (their account id) shown in the app.
 * CORS-open for POST so the chrome-extension origin can report.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

export async function POST(req: Request) {
  let b: any = {};
  try { b = await req.json(); } catch { /* ignore */ }
  const userId = String(b.code || '').trim();
  if (!userId) return NextResponse.json({ ok: false, error: 'no code' }, { status: 200, headers: CORS });

  await fetch(`${SB_URL}/rest/v1/extension_activity`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      event: b.event || 'bid',
      title: (b.title || '').slice(0, 200) || null,
      amount: Number(b.amount) || null,
      days: Number(b.days) || null,
      ai: !!b.ai,
      status: b.status || null,
    }),
  }).catch(() => {});

  return NextResponse.json({ ok: true }, { headers: CORS });
}

export async function GET(req: Request) {
  const userId = new URL(req.url).searchParams.get('userId') || '';
  if (!userId) return NextResponse.json({ ok: false }, { status: 200, headers: CORS });

  const res = await fetch(
    `${SB_URL}/rest/v1/extension_activity?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=100`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } },
  );
  const rows: any[] = await res.json().catch(() => []);
  const bids = rows.filter((r) => r.event === 'bid');
  const submitted = bids.filter((r) => r.status === 'submitted');
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const today = submitted.filter((r) => new Date(r.created_at) >= startOfDay);
  const aiCount = bids.filter((r) => r.ai).length;

  return NextResponse.json({
    ok: true,
    stats: {
      bidsTotal: submitted.length,
      bidsToday: today.length,
      filled: bids.length,
      aiShare: bids.length ? Math.round((aiCount / bids.length) * 100) : 0,
      lastActive: rows[0]?.created_at || null,
      connected: rows.length > 0,
    },
    recent: bids.slice(0, 50).map((r) => ({ title: r.title, amount: r.amount, days: r.days, ai: r.ai, status: r.status, at: r.created_at })),
  }, { headers: CORS });
}