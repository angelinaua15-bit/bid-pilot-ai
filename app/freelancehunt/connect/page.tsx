'use client';

/**
 * app/freelancehunt/connect/page.tsx
 *
 * Standalone "Connect Freelancehunt via browser" page, opened in the user's
 * REAL external browser from the Mini App: /freelancehunt/connect?userId=<id>
 *
 * Flow:
 *   1. Mint a one-time connect code bound to userId (/api/freelancehunt/connect-token).
 *   2. User logs into freelancehunt.com in this browser.
 *   3. The BidPilot extension (or local helper) reads the FH cookies and uploads
 *      them with the code (/api/freelancehunt/session) → saved in Supabase.
 *   4. This page polls /api/freelancehunt/status?userId= and shows "Підключено".
 *
 * Why an extension/helper: a web page cannot read freelancehunt.com cookies
 * (cross-origin + httpOnly). The extension/helper is the only way to capture them.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const EXTENSION_URL = process.env.NEXT_PUBLIC_FH_EXTENSION_URL ?? '';

function ConnectInner() {
  const params = useSearchParams();
  const userId = params.get('userId') ?? '';

  const [code, setCode] = useState<string>();
  const [minting, setMinting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [username, setUsername] = useState<string>();
  const [err, setErr] = useState<string>();
  const [origin, setOrigin] = useState('');

  useEffect(() => { setOrigin(window.location.origin); }, []);

  const mint = useCallback(async () => {
    if (!userId) { setErr('Відсутній userId у посиланні. Відкрийте сторінку з Mini App.'); return; }
    setMinting(true); setErr(undefined);
    try {
      const res = await fetch('/api/freelancehunt/connect-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCode(data.token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMinting(false);
    }
  }, [userId]);

  // Auto-mint on load
  useEffect(() => { if (userId) mint(); }, [userId, mint]);

  // Poll status until connected
  useEffect(() => {
    if (!userId || connected) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/freelancehunt/status?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
        const data = await res.json();
        const d = data?.data ?? data;
        if (d?.connected) { setConnected(true); setUsername(d.username); }
      } catch { /* ignore */ }
    }, 4000);
    return () => clearInterval(t);
  }, [userId, connected]);

  if (connected) {
    return (
      <div style={card}>
        <div style={{ fontSize: 40, textAlign: 'center' }}>✅</div>
        <h1 style={h1}>Підключено{username ? ` — ${username}` : ''}</h1>
        <p style={muted}>Акаунт Freelancehunt збережено. Можете повернутися в застосунок — статус оновиться автоматично.</p>
      </div>
    );
  }

  const helperCmd = `APP_URL=${origin} CODE=${code ?? '<код>'} node scripts/connect-freelancehunt.mjs`;

  return (
    <div style={card}>
      <h1 style={h1}>Підключити Freelancehunt</h1>
      <p style={muted}>Увійдіть у свій акаунт у цьому браузері, потім захопіть сесію розширенням або хелпером.</p>

      <div style={{ margin: '16px 0' }}>
        <div style={label}>Ваш код підключення</div>
        {code ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={codeBox}>{code}</code>
            <button style={btnGhost} onClick={() => navigator.clipboard?.writeText(code)}>Копіювати</button>
          </div>
        ) : (
          <button style={btn} disabled={minting} onClick={mint}>{minting ? 'Готую код…' : 'Згенерувати код'}</button>
        )}
        {err ? <p style={{ color: '#f87171', fontSize: 13, marginTop: 8 }}>{err}</p> : null}
      </div>

      <ol style={{ paddingLeft: 18, lineHeight: 1.7, fontSize: 14 }}>
        <li><a href="https://freelancehunt.com/login" target="_blank" rel="noreferrer" style={link}>Увійдіть на freelancehunt.com</a></li>
        <li>
          {EXTENSION_URL
            ? <>Відкрийте <a href={EXTENSION_URL} target="_blank" rel="noreferrer" style={link}>розширення BidPilot Connect</a>, вставте код, натисніть «Підключити».</>
            : <>Відкрийте розширення BidPilot Connect, вставте код, натисніть «Підключити».</>}
        </li>
      </ol>

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: '#93c5fd' }}>Немає розширення? Підключити командою</summary>
        <p style={{ ...muted, marginTop: 8 }}>Виконайте локально (потрібен Node + Playwright):</p>
        <code style={{ ...codeBox, display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{helperCmd}</code>
      </details>

      <p style={{ ...muted, marginTop: 16 }}>Очікую підключення… статус оновиться автоматично після захоплення сесії.</p>
    </div>
  );
}

export default function FreelancehuntConnectPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#0b0b0f', color: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <Suspense fallback={<div style={{ color: '#9ca3af' }}>Завантаження…</div>}>
        <ConnectInner />
      </Suspense>
    </div>
  );
}

const card: React.CSSProperties = { width: '100%', maxWidth: 440, background: '#15151c', border: '1px solid #27272a', borderRadius: 16, padding: 24 };
const h1: React.CSSProperties = { fontSize: 20, fontWeight: 700, margin: '0 0 6px', textAlign: 'center' };
const muted: React.CSSProperties = { color: '#9ca3af', fontSize: 13, margin: 0 };
const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#cbd5e1' };
const codeBox: React.CSSProperties = { flex: 1, padding: '10px 12px', background: '#0b0b0f', border: '1px solid #27272a', borderRadius: 10, fontSize: 14, userSelect: 'all' };
const btn: React.CSSProperties = { padding: '10px 16px', fontWeight: 600, color: '#fff', background: '#2563eb', border: 'none', borderRadius: 10, cursor: 'pointer' };
const btnGhost: React.CSSProperties = { padding: '10px 12px', borderRadius: 10, border: '1px solid #27272a', background: 'transparent', color: '#e5e7eb', cursor: 'pointer' };
const link: React.CSSProperties = { color: '#93c5fd' };
