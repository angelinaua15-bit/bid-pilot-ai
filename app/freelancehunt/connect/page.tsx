'use client';

/**
 * app/freelancehunt/connect/page.tsx — Variant 1 (credential login).
 *
 * User enters Freelancehunt email + password. We POST them to
 * /api/freelancehunt/connect, which proxies to the Railway worker; the worker
 * logs in headlessly and saves the session to Supabase under userId.
 *
 * The password is sent once over HTTPS, used only to log in, and never stored.
 * No useSearchParams (reads userId from window.location) and no React.CSSProperties
 * → safe for `next build`.
 */

import { useEffect, useState } from 'react';

export default function FreelancehuntConnectPage() {
  const [mounted, setMounted] = useState(false);
  const [userId, setUserId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [username, setUsername] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setUserId(sp.get('userId') ?? '');
    setMounted(true);
  }, []);

  async function connect() {
    setErr('');
    if (!email || !password) { setErr('Введіть email і пароль.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/freelancehunt/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setDone(true);
        setUsername(data.username ?? '');
      } else {
        setErr(data.message || 'Не вдалося підключитися. Спробуйте ще раз.');
      }
    } catch {
      setErr('Помилка мережі. Спробуйте ще раз.');
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) {
    return (
      <main className="min-h-screen bg-[#0b0b0f] text-gray-200 flex items-center justify-center p-4">
        <p className="text-gray-400">Завантаження…</p>
      </main>
    );
  }

  if (done) {
    return (
      <main className="min-h-screen bg-[#0b0b0f] text-gray-200 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#15151c] border border-[#27272a] rounded-2xl p-6 text-center">
          <div className="text-4xl mb-2">✅</div>
          <h1 className="text-xl font-bold mb-1">Підключено{username ? ` — ${username}` : ''}</h1>
          <p className="text-sm text-gray-400">Акаунт Freelancehunt збережено. Можете повернутися в застосунок.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0b0b0f] text-gray-200 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#15151c] border border-[#27272a] rounded-2xl p-6">
        <h1 className="text-xl font-bold mb-1 text-center">Підключити Freelancehunt</h1>
        <p className="text-sm text-gray-400 mb-4 text-center">
          Увійдіть своїм акаунтом Freelancehunt. Пароль використовується один раз для входу і <b>не зберігається</b> — зберігаються лише cookies сесії.
        </p>

        <label className="block text-xs font-semibold mb-1 text-gray-300">Email або логін</label>
        <input
          type="text"
          inputMode="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-3 px-3 py-2.5 rounded-xl bg-[#0b0b0f] border border-[#27272a] text-sm outline-none focus:border-blue-500"
          placeholder="you@example.com"
        />

        <label className="block text-xs font-semibold mb-1 text-gray-300">Пароль</label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-4 px-3 py-2.5 rounded-xl bg-[#0b0b0f] border border-[#27272a] text-sm outline-none focus:border-blue-500"
          placeholder="••••••••"
        />

        <button
          onClick={connect}
          disabled={busy}
          className="w-full py-3 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-colors"
        >
          {busy ? 'Підключаємо…' : 'Підключити'}
        </button>

        {err ? <p className="text-red-400 text-[13px] mt-3">{err}</p> : null}

        {busy ? (
          <p className="text-gray-500 text-xs mt-3 text-center">Воркер входить у Freelancehunt — це може зайняти 10–20 секунд…</p>
        ) : null}
      </div>
    </main>
  );
}