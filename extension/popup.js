/* global chrome */

// Set this to your deployed app origin (same as in manifest host_permissions).
const APP_URL = 'https://YOUR-APP.vercel.app';
const SESSION_ENDPOINT = `${APP_URL}/api/freelancehunt/session`;

const $ = (id) => document.getElementById(id);
const setStatus = (msg, cls = 'muted') => {
  const el = $('status');
  el.textContent = msg;
  el.className = cls;
};

// Chrome sameSite → Playwright sameSite
function mapSameSite(s) {
  switch (s) {
    case 'no_restriction': return 'None';
    case 'strict': return 'Strict';
    case 'lax': return 'Lax';
    default: return 'Lax';
  }
}

// Read all freelancehunt.com cookies and convert to Playwright storageState.
async function captureStorageState() {
  const domains = ['freelancehunt.com', '.freelancehunt.com'];
  const all = [];
  for (const domain of domains) {
    const cookies = await chrome.cookies.getAll({ domain });
    all.push(...cookies);
  }
  // De-duplicate by name+domain+path
  const seen = new Set();
  const cookies = [];
  for (const c of all) {
    const key = `${c.name}|${c.domain}|${c.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cookies.push({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.session ? -1 : Math.round(c.expirationDate ?? -1),
      httpOnly: !!c.httpOnly,
      secure: !!c.secure,
      sameSite: mapSameSite(c.sameSite),
    });
  }
  return { cookies, origins: [] };
}

$('connect').addEventListener('click', async () => {
  const btn = $('connect');
  const token = $('code').value.trim();
  if (!token) {
    setStatus('Вставте код підключення з застосунку.', 'err');
    return;
  }

  btn.disabled = true;
  setStatus('Зчитую сесію Freelancehunt…');

  try {
    const storageState = await captureStorageState();
    if (storageState.cookies.length === 0) {
      setStatus('Не знайдено cookies. Спершу увійдіть на freelancehunt.com.', 'err');
      btn.disabled = false;
      return;
    }

    setStatus(`Надсилаю сесію (${storageState.cookies.length} cookies)…`);
    const res = await fetch(SESSION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, storageState }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.ok) {
      setStatus(`Підключено ✓ (${data.cookieCount} cookies). Поверніться в застосунок.`, 'ok');
    } else {
      setStatus(`Помилка: ${data.error ?? res.status}`, 'err');
      btn.disabled = false;
    }
  } catch (err) {
    setStatus(`Помилка: ${err?.message ?? err}`, 'err');
    btn.disabled = false;
  }
});