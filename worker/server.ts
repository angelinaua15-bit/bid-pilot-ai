#!/usr/bin/env tsx

import http from 'http'
import fs from 'fs'
import path from 'path'
import { URL } from 'url'
const envPath = path.resolve(__dirname, '..', '.env.local')

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue

    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')

    if (!process.env[key]) process.env[key] = val
  }

  console.log(`[worker] Loaded env from ${envPath}`)
}

const PORT = Number(process.env.PORT || process.env.WORKER_PORT || 8080)
const SECRET = process.env.AUTOMATION_SECRET || ''

if (!SECRET) {
  console.error('[worker] AUTOMATION_SECRET is not set. Set it in Railway Variables.')
  process.exit(1)
}

// ─── Auto-loop state ───────────────────────────────────────────────────────────
// Runs a bid cycle every AUTO_LOOP_INTERVAL_MS when auto-bid is enabled.
const AUTO_LOOP_INTERVAL_MS = Number(process.env.AUTO_LOOP_INTERVAL_MS || 60_000) // default: 60s
let autoLoopTimer: ReturnType<typeof setInterval> | null = null
let autoLoopEnabled = false
let lastCheckedAt: string | null = null
let lastLoopError: string | null = null

// Tracks processed project IDs across cycles so we never submit twice per process run
const processedProjectIds = new Set<string>()

// ─── Connect session store (in-memory, per worker process) ────────────────────
interface ConnectSession {
  id: string
  status: 'pending' | 'logged_in' | 'saved' | 'error'
  username?: string
  cookieCount?: number
  error?: string
  createdAt: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page?: any    // Playwright Page reference — closed after save
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context?: any // Playwright BrowserContext
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  browser?: any // Playwright Browser
}
const connectSessions = new Map<string, ConnectSession>()

interface LogEntry {
  id: string
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
  timestamp: string
  projectId?: string
  projectTitle?: string
  meta?: Record<string, unknown>
}

const logStore: LogEntry[] = []
const MAX_LOGS = 500

const cycleCounters = {
  parsed: 0,
  submitted: 0,
  skipped: 0,
  failed: 0,
  lastReset: new Date().toISOString(),
}

let stopRequested = false
let cycleRunning = false

function resetCycleCounters() {
  cycleCounters.parsed = 0
  cycleCounters.submitted = 0
  cycleCounters.skipped = 0
  cycleCounters.failed = 0
  cycleCounters.lastReset = new Date().toISOString()
}

function addLog(
  entry: Omit<LogEntry, 'id' | 'timestamp'> & {
    id?: string
    timestamp?: string
  }
) {
  const message =
    typeof entry.message === 'string' && entry.message.trim() !== ''
      ? entry.message
      : entry.message != null
        ? String(entry.message)
        : '(empty message)'

  const log: LogEntry = {
    id: entry.id ?? `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: entry.timestamp ?? new Date().toISOString(),
    level: entry.level ?? 'info',
    message,
    projectId: entry.projectId,
    projectTitle: entry.projectTitle,
    meta: entry.meta,
  }

  logStore.unshift(log)
  if (logStore.length > MAX_LOGS) logStore.splice(MAX_LOGS)

  const prefix =
    {
      info: 'INFO',
      success: 'OK  ',
      warning: 'WARN',
      error: 'ERR ',
    }[log.level] ?? 'LOG '

  process.stdout.write(`[worker] ${prefix} ${log.message}\n`)
  return log
}

function json(res: http.ServerResponse, statusCode: number, body: unknown) {
  const payload = JSON.stringify(body)

  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  })

  res.end(payload)
}

function authenticate(req: http.IncomingMessage, url: URL): boolean {
  const auth = req.headers.authorization || ''
  const querySecret = url.searchParams.get('secret') || ''

  return auth === `Bearer ${SECRET}` || querySecret === SECRET
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = ''

    req.on('data', (chunk) => {
      data += chunk
    })

    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        resolve({})
      }
    })
  })
}

// ─── Auto-loop ────────────────────────────────────────────────────────────────

async function runAutoLoop() {
  if (cycleRunning) {
    addLog({ level: 'info', message: '[Auto-loop] Skipping — cycle already running' })
    return
  }

  lastCheckedAt = new Date().toISOString()
  lastLoopError = null

  try {
    const { runAutoBidCycle } = await import('../services/freelancehunt-auto-bid.service')
    const { getSettings } = await import('../lib/db')

    const settings = await getSettings()
    if (!settings.enabled) {
      addLog({ level: 'info', message: '[Auto-loop] Auto-bid disabled in settings — skipping cycle' })
      return
    }

    if (settings.emergencyStop) {
      addLog({ level: 'warning', message: '[Auto-loop] Emergency stop active — skipping cycle' })
      return
    }

    cycleRunning = true
    resetCycleCounters()

    const stepLog = (
      level: LogEntry['level'],
      message: string,
      meta?: Record<string, unknown>
    ) => {
      const log = addLog({ level, message: message || '(no message)', meta })
      cycleLogs.push(log)
      if (/BID SENT|SUBMITTED/i.test(message)) cycleCounters.submitted++
      if (/ALREADY_BID|PROJECT_CLOSED/i.test(message)) cycleCounters.skipped++
      if (/BID FAILED|ERROR/i.test(message)) cycleCounters.failed++
      const match = message.match(/(\d+)\s+project/i)
      if (match) cycleCounters.parsed = Number(match[1])
    }
    const cycleLogs: LogEntry[] = []

    addLog({ level: 'info', message: `[Auto-loop] Starting cycle at ${lastCheckedAt}` })

    const chatId = process.env.TELEGRAM_CHAT_ID ? Number(process.env.TELEGRAM_CHAT_ID) : undefined

    const result = await runAutoBidCycle('', settings as never, chatId, stepLog, true, processedProjectIds)

    cycleCounters.submitted = Number(result.bidsSubmitted ?? cycleCounters.submitted)
    cycleCounters.skipped   = Number(result.bidsSkipped   ?? cycleCounters.skipped)
    cycleCounters.failed    = Number(result.errors        ?? cycleCounters.failed)

    // Track processed projects so duplicates are never re-submitted
    if (Array.isArray(result.processedIds)) {
      for (const id of result.processedIds) processedProjectIds.add(String(id))
    }

    addLog({
      level: cycleCounters.submitted > 0 ? 'success' : 'info',
      message: `[Auto-loop] Cycle done — submitted: ${cycleCounters.submitted} | skipped: ${cycleCounters.skipped} | errors: ${cycleCounters.failed}`,
    })
  } catch (err) {
    lastLoopError = err instanceof Error ? err.message : String(err)
    addLog({ level: 'error', message: `[Auto-loop] Cycle error: ${lastLoopError}` })
  } finally {
    cycleRunning = false
  }
}

function startAutoLoop() {
  if (autoLoopTimer) return
  autoLoopEnabled = true
  addLog({ level: 'info', message: `[Auto-loop] Started — interval ${AUTO_LOOP_INTERVAL_MS / 1000}s` })
  // Run immediately, then on interval
  runAutoLoop()
  autoLoopTimer = setInterval(runAutoLoop, AUTO_LOOP_INTERVAL_MS)
}

function stopAutoLoop() {
  if (autoLoopTimer) {
    clearInterval(autoLoopTimer)
    autoLoopTimer = null
  }
  autoLoopEnabled = false
  addLog({ level: 'warning', message: '[Auto-loop] Stopped' })
}

// ─── Connect handlers ─────────────────────────────────────────────────────────

async function handleConnectStart(res: http.ServerResponse) {
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const session: ConnectSession = {
    id: sessionId,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  connectSessions.set(sessionId, session)

  addLog({ level: 'info', message: `[Connect] Starting login session ${sessionId}` })

  // Launch browser async — do not await here so we return the sessionId immediately
  ;(async () => {
    try {
      const { chromium } = await import('playwright')
      const browser = await chromium.launch({
        headless: false, // visible so user can log in
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale: 'uk-UA',
        viewport: { width: 1280, height: 900 },
      })
      const page = await context.newPage()

      session.page    = page
      session.context = context
      session.browser = browser

      await page.goto('https://freelancehunt.com/login', { waitUntil: 'domcontentloaded', timeout: 30_000 })
      addLog({ level: 'info', message: `[Connect] Browser opened — waiting for login (session ${sessionId})` })

      // Poll for login completion (check for authenticated page)
      let polls = 0
      const maxPolls = 120 // 4 minutes
      const pollInterval = setInterval(async () => {
        polls++
        try {
          const url = page.url()
          const html = await page.content().catch(() => '')

          const isLoggedIn =
            url.includes('/my/') ||
            url.includes('/freelancer/') ||
            url.includes('/employer/') ||
            html.includes('logout') ||
            html.includes('profile') && !url.includes('/login')

          if (isLoggedIn) {
            clearInterval(pollInterval)
            // Extract username from page
            const username = await page.evaluate(() => {
              const el =
                document.querySelector('.header-user-name') ??
                document.querySelector('[class*="username"]') ??
                document.querySelector('[class*="user-name"]')
              return el?.textContent?.trim() ?? ''
            }).catch(() => '')

            session.status   = 'logged_in'
            session.username = username || 'authenticated'
            addLog({ level: 'success', message: `[Connect] Login detected — user: ${session.username}` })
          } else if (polls >= maxPolls) {
            clearInterval(pollInterval)
            session.status = 'error'
            session.error  = 'Login timeout — user did not log in within 4 minutes'
            addLog({ level: 'error', message: `[Connect] ${session.error}` })
            await browser.close().catch(() => {})
          }
        } catch (pollErr) {
          clearInterval(pollInterval)
          session.status = 'error'
          session.error  = pollErr instanceof Error ? pollErr.message : String(pollErr)
          await browser.close().catch(() => {})
        }
      }, 2_000)

    } catch (err) {
      session.status = 'error'
      session.error  = err instanceof Error ? err.message : String(err)
      addLog({ level: 'error', message: `[Connect] Browser launch error: ${session.error}` })
    }
  })()

  return json(res, 200, { ok: true, sessionId })
}

function handleConnectStatus(sessionId: string, res: http.ServerResponse) {
  const session = connectSessions.get(sessionId)
  if (!session) {
    return json(res, 404, { ok: false, error: 'Session not found' })
  }
  return json(res, 200, {
    ok: true,
    status:    session.status,
    username:  session.username,
    error:     session.error,
    createdAt: session.createdAt,
  })
}

async function handleConnectSave(sessionId: string, res: http.ServerResponse) {
  const session = connectSessions.get(sessionId)
  if (!session) {
    return json(res, 404, { ok: false, error: 'Session not found' })
  }
  if (session.status !== 'logged_in') {
    return json(res, 400, { ok: false, error: `Cannot save — session status is "${session.status}"` })
  }

  try {
    const { context, browser } = session

    // Determine save path
    const savePath = process.env.FREELANCEHUNT_SESSION_PATH
      ? process.env.FREELANCEHUNT_SESSION_PATH
      : path.resolve(process.cwd(), 'storageState.json')

    await context.storageState({ path: savePath })
    addLog({ level: 'success', message: `[Connect] Session saved to ${savePath}` })

    // Count cookies
    const state = JSON.parse(fs.readFileSync(savePath, 'utf-8'))
    const cookieCount = (state.cookies ?? []).length

    session.status      = 'saved'
    session.cookieCount = cookieCount

    await browser.close().catch(() => {})

    return json(res, 200, {
      ok: true,
      username:    session.username,
      cookieCount,
      sessionPath: savePath,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    session.status = 'error'
    session.error  = message
    return json(res, 500, { ok: false, error: message })
  }
}

async function handleConnectLogout(res: http.ServerResponse) {
  try {
    const { resolveSessionPath } = await import('../services/playwright-browser.service')
    const sessionPath = resolveSessionPath()
    if (sessionPath && fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath)
      addLog({ level: 'info', message: `[Connect] Session file deleted: ${sessionPath}` })
    }
    return json(res, 200, { ok: true, message: 'Session cleared' })
  } catch (err) {
    return json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

async function handleStatus(res: http.ServerResponse) {
  const { sessionExists, resolveSessionPath } = await import('../services/playwright-browser.service')
  const sessionFound = sessionExists()
  const sessionPath = resolveSessionPath()

  // Read cookie count from storageState.json for informational display
  let cookieCount: number | undefined
  if (sessionFound && sessionPath) {
    try {
      const raw = fs.readFileSync(sessionPath, 'utf-8')
      const state = JSON.parse(raw)
      cookieCount = (state.cookies ?? []).length
    } catch { /* ignore */ }
  }

  return json(res, 200, {
    ok: true,
    service: 'bid-pilot-worker',
    version: '3.0.0',
    uptime: process.uptime(),
    cycleRunning,
    stopRequested,
    counters: { ...cycleCounters },
    autoLoop: {
      enabled:       autoLoopEnabled,
      intervalMs:    AUTO_LOOP_INTERVAL_MS,
      lastCheckedAt: lastCheckedAt ?? null,
      lastError:     lastLoopError ?? null,
    },
    freelancehunt: {
      connected:   sessionFound,
      authMode:    'playwright_session',
      sessionPath: sessionPath ?? null,
      cookieCount: cookieCount ?? 0,
      error: sessionFound ? undefined : 'storageState.json not found. Run: npm run login:freelancehunt',
    },
    openai: {
      configured: Boolean(process.env.OPENAI_API_KEY),
    },
    telegram: {
      configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    },
  })
}

async function handleSettingsDebug(res: http.ServerResponse) {
  try {
    const { getSettings } = await import('../lib/db')
    const settings = await getSettings()

    return json(res, 200, {
      ok: true,
      settings,
      meta: {
        source: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'memory/default',
        workerUptime: process.uptime(),
        cycleRunning,
        stopRequested,
        freelancehuntToken: Boolean(process.env.FREELANCEHUNT_TOKEN),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return json(res, 500, { ok: false, error: message })
  }
}

async function handleAutoBidStart(req: http.IncomingMessage, res: http.ServerResponse) {
  if (cycleRunning) {
    return json(res, 409, {
      ok: false,
      error: 'A cycle is already running',
    })
  }

  const body = await readBody(req)

  cycleRunning = true
  stopRequested = false
  resetCycleCounters()

  const cycleLogs: LogEntry[] = []

  const stepLog = (
    level: LogEntry['level'],
    message: string,
    meta?: Record<string, unknown>
  ) => {
    const log = addLog({
      level,
      message: message || '(no message)',
      meta,
    })

    cycleLogs.push(log)

    const msg = log.message

    if (/BID SENT|SUBMITTED|BID SUBMITTED/i.test(msg)) {
      cycleCounters.submitted++
    }

    if (/SKIP|SKIPPED|ALREADY|CLOSED|VALIDATION/i.test(msg)) {
      cycleCounters.skipped++
    }

    if (/FAILED|ERROR/i.test(msg)) {
      cycleCounters.failed++
    }

    const match = msg.match(/(\d+)\s+project/i)
    if (match) {
      cycleCounters.parsed = Number(match[1])
    }
  }

  try {
    const { runAutoBidCycle } = await import('../services/freelancehunt-auto-bid.service')
    const { getSettings } = await import('../lib/db')

    const dbSettings = await getSettings()

    const bodySettings =
      body.settings && typeof body.settings === 'object'
        ? (body.settings as Record<string, unknown>)
        : {}

    const settings = {
      ...dbSettings,
      ...bodySettings,
      enabled: true,
    }

    addLog({
      level: 'info',
      message: `[Worker] Starting cycle — enabled=true | forceRun=true | dailyLimit=${
        (settings as Record<string, unknown>).dailyLimit ?? 20
      }`,
    })

    const chatId = process.env.TELEGRAM_CHAT_ID
      ? Number(process.env.TELEGRAM_CHAT_ID)
      : undefined

    const result = await runAutoBidCycle('', settings as never, chatId, stepLog, true)

    cycleCounters.submitted = Number(result.bidsSubmitted ?? cycleCounters.submitted)
    cycleCounters.skipped = Number(result.bidsSkipped ?? cycleCounters.skipped)
    cycleCounters.failed = Number(result.errors ?? cycleCounters.failed)

    const summary = `Cycle complete — parsed: ${cycleCounters.parsed} | submitted: ${cycleCounters.submitted} | skipped: ${cycleCounters.skipped} | failed: ${cycleCounters.failed}`

    addLog({
      level: cycleCounters.submitted > 0 ? 'success' : 'info',
      message: summary,
    })

    return json(res, 200, {
      ok: true,
      bidsSubmitted: cycleCounters.submitted,
      bidsSkipped: cycleCounters.skipped,
      errors: cycleCounters.failed,
      counters: { ...cycleCounters },
      logs: result.logs ?? cycleLogs,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    stepLog('error', `Cycle failed: ${message}`)

    return json(res, 500, {
      ok: false,
      error: message,
      logs: cycleLogs,
    })
  } finally {
    cycleRunning = false
    stopRequested = false
  }
}

function handleAutoBidStop(res: http.ServerResponse) {
  stopRequested = true

  addLog({
    level: 'warning',
    message: 'Emergency stop requested via API',
  })

  return json(res, 200, {
    ok: true,
    message: 'Stop signal sent',
  })
}

function handleLogs(url: URL, res: http.ServerResponse) {
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '100'), 500)
  const level = url.searchParams.get('level')

  const filtered = level ? logStore.filter((log) => log.level === level) : logStore
  const data = filtered.slice(0, limit)

  return json(res, 200, {
    ok: true,
    data,
    logs: data,
    total: filtered.length,
  })
}

async function handleGetProjects(_url: URL, res: http.ServerResponse) {
  // Use Playwright feed parser — no API token required.
  // The parser opens freelancehunt.com/projects with the authenticated browser session.
  try {
    const { parseProjectsFromFeed } = await import('../services/playwright-browser.service')

    const feedLog = (level: LogEntry['level'], message: string) => {
      addLog({ level, message: message || '(no message)' })
    }

    const projects = await parseProjectsFromFeed(feedLog)

    return json(res, 200, {
      ok: true,
      data: projects,
      total: projects.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    addLog({ level: 'error', message: `[Projects] Parse failed: ${message}` })

    return json(res, 500, {
      ok: false,
      error: message,
      data: [],
    })
  }
}



const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)
  const method = req.method || 'GET'
  const pathname = url.pathname

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    })

    return res.end()
  }

  if (method === 'GET' && pathname === '/') {
    return json(res, 200, {
      ok: true,
      service: 'bid-pilot-worker',
      status: 'online',
      uptime: process.uptime(),
    })
  }

  if (!authenticate(req, url)) {
    return json(res, 401, {
      ok: false,
      error: 'Unauthorized',
    })
  }

  try {
    if (method === 'GET' && pathname === '/status') {
      return await handleStatus(res)
    }

    if (method === 'GET' && pathname === '/settings/debug') {
      return await handleSettingsDebug(res)
    }

    if (method === 'POST' && pathname === '/auto-bid/start') {
      return await handleAutoBidStart(req, res)
    }

    if (method === 'POST' && pathname === '/auto-bid/stop') {
      return handleAutoBidStop(res)
    }

    if (method === 'GET' && pathname === '/logs') {
      return handleLogs(url, res)
    }

    if (method === 'GET' && pathname === '/projects') {
      return await handleGetProjects(url, res)
    }

    // ── Auto-loop control ─────────────────────────────────────────────────────
    if (method === 'POST' && pathname === '/auto-loop/start') {
      startAutoLoop()
      return json(res, 200, { ok: true, message: 'Auto-loop started' })
    }

    if (method === 'POST' && pathname === '/auto-loop/stop') {
      stopAutoLoop()
      return json(res, 200, { ok: true, message: 'Auto-loop stopped' })
    }

    // ── Freelancehunt connect (browser login) ─────────────────────────────────
    if (method === 'POST' && pathname === '/connect/freelancehunt/start') {
      return await handleConnectStart(res)
    }

    if (method === 'GET' && /^\/connect\/freelancehunt\/status\//.test(pathname)) {
      const sessionId = decodeURIComponent(pathname.replace('/connect/freelancehunt/status/', ''))
      return handleConnectStatus(sessionId, res)
    }

    if (method === 'POST' && /^\/connect\/freelancehunt\/save\//.test(pathname)) {
      const sessionId = decodeURIComponent(pathname.replace('/connect/freelancehunt/save/', ''))
      return await handleConnectSave(sessionId, res)
    }

    if (method === 'POST' && pathname === '/connect/freelancehunt/logout') {
      return await handleConnectLogout(res)
    }

    return json(res, 404, {
      ok: false,
      error: `Unknown route: ${method} ${pathname}`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    console.error('[worker] Unhandled error:', message)

    return json(res, 500, {
      ok: false,
      error: message,
    })
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n[worker] BidPilot Worker v2 running on http://0.0.0.0:${PORT}`)
  console.log('[worker] Railway/public URL should point to this service')
  console.log('[worker] Waiting for requests...\n')

  // Check Playwright session at startup
  import('../services/playwright-browser.service').then(({ sessionExists, resolveSessionPath }) => {
    const found = sessionExists()
    addLog({
      level: found ? 'success' : 'warning',
      message: found
        ? `Playwright session loaded — ${resolveSessionPath()}`
        : 'storageState.json not found. Run: npm run login:freelancehunt',
    })

    // Auto-start the background loop when session exists
    if (found) {
      import('../lib/db').then(({ getSettings }) => {
        getSettings().then((settings) => {
          if (settings.enabled && !settings.emergencyStop) {
            startAutoLoop()
          } else {
            addLog({ level: 'info', message: '[Auto-loop] Not started — auto-bid disabled in DB settings' })
          }
        }).catch(() => {
          // If DB not available yet, start loop anyway and let it check settings per cycle
          startAutoLoop()
        })
      }).catch(() => startAutoLoop())
    }
  }).catch(() => {})

  if (!process.env.OPENAI_API_KEY) {
    addLog({ level: 'warning', message: 'OPENAI_API_KEY not set — will use template bids' })
  }

})

process.on('SIGINT', () => {
  console.log('\n[worker] Shutting down...')
  server.close(() => process.exit(0))
})

process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
})
