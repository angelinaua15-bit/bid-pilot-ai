import 'dotenv/config'

// Set port before importing server so it binds to the right port
process.env.WORKER_PORT = process.env.WORKER_PORT ?? '4000'

// Start the HTTP server
import './server'

// ── Multi-user auto loop ───────────────────────────────────────────────────────
// Every INTERVAL ms:
//  1. Call GET /users/connected to get all users with a connected account + enabled filter
//  2. For each user, POST /auto-bid/start with { userId }
//  3. If no connected users found, fall back to legacy global mode (no userId)

const INTERVAL   = Number(process.env.AUTO_LOOP_INTERVAL_MS ?? 10 * 60 * 1000) // default 10 min
const BASE_URL   = `http://localhost:${process.env.WORKER_PORT}`
const AUTH_HEADER = `Bearer ${process.env.AUTOMATION_SECRET ?? ''}`

let loopRunning = false

async function runMultiUserLoop() {
  if (loopRunning) return
  loopRunning = true

  try {
    // 1. Fetch connected users
    const usersRes = await fetch(`${BASE_URL}/users/connected`, {
      headers: { Authorization: AUTH_HEADER },
    }).then((r) => r.json()).catch(() => ({ ok: false, users: [] }))

    const users: Array<{ userId: string }> = usersRes?.users ?? []

    if (users.length === 0) {
      // Legacy fallback — single global mode
      console.log('[worker:loop] No connected users found — running global cycle')
      await fetch(`${BASE_URL}/auto-bid/start`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: AUTH_HEADER },
        body:    JSON.stringify({}),
      }).catch((err) => console.error('[worker:loop] Global cycle error:', err))
      return
    }

    console.log(`[worker:loop] Found ${users.length} connected user(s) — running per-user cycles`)

    // 2. Run cycles for all users in parallel
    await Promise.allSettled(
      users.map(({ userId }) =>
        fetch(`${BASE_URL}/auto-bid/start`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: AUTH_HEADER },
          body:    JSON.stringify({ userId }),
        })
          .then((r) => r.json())
          .then((result) => {
            console.log(`[worker:loop] User ${userId} — submitted: ${result.bidsSubmitted ?? 0} | skipped: ${result.bidsSkipped ?? 0} | errors: ${result.errors ?? 0}`)
          })
          .catch((err) => {
            console.error(`[worker:loop] User ${userId} cycle error:`, err)
          })
      )
    )
  } catch (err) {
    console.error('[worker:loop] Loop error:', err)
  } finally {
    loopRunning = false
  }
}

// Wait for server to start before first loop run
setTimeout(() => {
  console.log('[worker:loop] Starting multi-user auto loop')
  runMultiUserLoop()
  setInterval(runMultiUserLoop, INTERVAL)
}, 3_000)
