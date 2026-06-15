'use client';

/**
 * app/freelancehunt/connect/page.tsx
 *
 * "Connect Freelancehunt via browser" page, opened in the user's real external
 * browser from the Mini App: /freelancehunt/connect?userId=<id>
 *
 * Bulletproof against build/prerender: it does NOT use next/navigation
 * useSearchParams (which triggers CSR-bailout during `next build`). Instead it
 * reads userId from window.location.search inside useEffect (client-only), and
 * uses Tailwind classes (no React.CSSProperties typing).
 *
 *   1. Mint a one-time code bound to userId (/api/freelancehunt/connect-token).
 *   2. User logs into freelancehunt.com in this browser.
 *   3. The BidPilot extension (or local helper) reads the FH cookies and uploads
 *      them with the code (/api/freelancehunt/session) → saved in Supabase.
 *   4. Page polls /api/freelancehunt/status?userId= and shows "Підключено".
 */

import { useCallback, useEffect, useState } from 'react';

const EXTENSION_URL = process.env.NEXT_PUBLIC_FH_EXTENSION_URL ?? '';

export default function FreelancehuntConnectPage() {
  const [mounted, setMounted] = useState(false);
  const [userId, setUserId] = useState('');
  const [origin, setOrigin] = useState('');
  const [code, setCode] = useState('');
  const [minting, setMinting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [username, setUsername] = useState('');
  const [err, setErr] = useState('');

  // Read userId from the URL — client-only, no useSearchParams.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setUserId(sp.get('userId') ?? '');
    setOrigin(window.location.origin);
    setMounted(true);
  }, []);

  const mint = useCallback(async (uid: string) => {
    if (!uid) {
      setErr('Відсутній userId у посиланні. Відкрийте сторінку з Mini App.');
      return;
    }
    setMinting(true);
    setErr('');
    try {
      const res = await fetch('/api/freelancehunt/connect-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uid }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCode(data.token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMinting(false);
    }
  }, []);

  useEffect(() => {
    if (mounted && userId) mint(userId);
  }, [mounted, userId, mint]);

  // Poll status until connected
  useEffect(() => {
    if (!userId || connected) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/freelancehunt/status?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
        const data = await res.json();
        const d = data?.data ?? data;
        if (d?.connected) {
          setConnected(true);
          setUsername(d.username ?? '');
        }
      } catch {
        /* ignore */
      }
    }, 4000);
    return () => clearInterval(t);
  }, [userId, connected]);

  if (!mounted) {
    return (
      <main className="min-h-screen bg-[#0b0b0f] text-gray-200 flex items-center justify-center p-4">
        <p className="text-gray-400">Завантаження…</p>
      </main>
    );
  }

  if (connected) {
    return (
      <main className="min-h-screen bg-[#0b0b0f] text-gray-200 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#15151c] border border-[#27272a] rounded-2xl p-6 text-center">
          <div className="text-4xl mb-2">✅</div>
          <h1 className="text-xl font-bold mb-1">Підключено{username ? ` — ${username}` : ''}</h1>
          <p className="text-sm text-gray-400">Акаунт Freelancehunt збережено. Поверніться в застосунок — статус оновиться автоматично.</p>
        </div>
      </main>
    );
  }

  const helperCmd = `APP_URL=${origin} CODE=${code || '<код>'} node scripts/connect-freelancehunt.mjs`;

  return (
    <main className="min-h-screen bg-[#0b0b0f] text-gray-200 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#15151c] border border-[#27272a] rounded-2xl p-6">
        <h1 className="text-xl font-bold mb-1.5 text-center">Підключити Freelancehunt</h1>
        <p className="text-sm text-gray-400 m-0">Увійдіть у свій акаунт у цьому браузері, потім захопіть сесію розширенням або хелпером.</p>

        <div className="my-4">
          <div className="text-xs font-semibold mb-1.5 text-gray-300">Ваш код підключення</div>
          {code ? (
            <div className="flex gap-2 items-center">
              <code className="flex-1 px-3 py-2.5 bg-[#0b0b0f] border border-[#27272a] rounded-xl text-sm select-all break-all">{code}</code>
              <button
                onClick={() => navigator.clipboard?.writeText(code)}
                className="px-3 py-2.5 rounded-xl border border-[#27272a] bg-transparent text-gray-200 text-sm"
              >
                Копіювати
              </button>
            </div>
          ) : (
            <button
              onClick={() => mint(userId)}
              disabled={minting}
              className="px-4 py-2.5 font-semibold text-white bg-blue-600 rounded-xl disabled:opacity-50"
            >
              {minting ? 'Готую код…' : 'Згенерувати код'}
            </button>
          )}
          {err ? <p className="text-red-400 text-[13px] mt-2">{err}</p> : null}
        </div>

        <ol className="pl-4 text-sm leading-7 list-decimal">
          <li><a href="https://freelancehunt.com/login" target="_blank" rel="noreferrer" className="text-blue-300 underline">Увійдіть на freelancehunt.com</a></li>
          <li>
            {EXTENSION_URL ? (
              <>Відкрийте <a href={EXTENSION_URL} target="_blank" rel="noreferrer" className="text-blue-300 underline">розширення BidPilot Connect</a>, вставте код, натисніть «Підключити».</>
            ) : (
              <>Відкрийте розширення BidPilot Connect, вставте код, натисніть «Підключити».</>
            )}
          </li>
        </ol>

        <details className="mt-3">
          <summary className="cursor-pointer text-[13px] text-blue-300">Немає розширення? Підключити командою</summary>
          <p className="text-sm text-gray-400 mt-2">Виконайте локально (потрібен Node + Playwright):</p>
          <code className="block mt-1 px-3 py-2.5 bg-[#0b0b0f] border border-[#27272a] rounded-xl text-sm whitespace-pre-wrap break-all">{helperCmd}</code>
        </details>

        <p className="text-sm text-gray-400 mt-4">Очікую підключення… статус оновиться автоматично після захоплення сесії.</p>
      </div>
    </main>
  );
}