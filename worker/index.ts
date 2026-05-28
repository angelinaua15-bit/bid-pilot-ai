import 'dotenv/config'

// порт
process.env.WORKER_PORT = process.env.WORKER_PORT ?? '4000'

// запускаємо сервер
import './server'

// ---- АВТО ЦИКЛ ----

const INTERVAL = 10 * 60 * 1000 // 10 хв

let isRunning = false

async function runUserAutoBid(userId: string) {
  try {
    console.log(`[worker] Running auto-bid for user ${userId}`)

    const res = await fetch(
      `http://localhost:${process.env.WORKER_PORT}/auto-bid/start`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.AUTOMATION_SECRET}`,
        },
        body: JSON.stringify({
          userId,
        }),
      }
    )

    const json = await res.json().catch(() => ({}))

    if (!res.ok) {
      console.error(
        `[worker] User ${userId} failed:`,
        json?.error ?? res.status
      )
      return
    }

    console.log(`[worker] User ${userId} done`)
  } catch (err) {
    console.error(`[worker] User ${userId} error:`, err)
  }
}

async function runAutoLoop() {
  if (isRunning) return
  isRunning = true

  console.log('[worker] Multi-user auto loop started')

  while (true) {
    try {
      console.log('[worker] Loading connected users...')

      // беремо всіх users з API
      const usersRes = await fetch(
        `http://localhost:${process.env.WORKER_PORT}/users/connected`,
        {
          headers: {
            Authorization: `Bearer ${process.env.AUTOMATION_SECRET}`,
          },
        }
      )

      const usersJson = await usersRes.json().catch(() => ({}))

      const users = Array.isArray(usersJson?.data)
        ? usersJson.data
        : []

      console.log(`[worker] Connected users: ${users.length}`)

      for (const user of users) {
        if (!user?.id) continue

        await runUserAutoBid(user.id)

        // невелика затримка між юзерами
        await new Promise((res) => setTimeout(res, 5000))
      }

      console.log('[worker] Cycle done, waiting...')
    } catch (err) {
      console.error('[worker] Error in loop:', err)
    }

    await new Promise((res) => setTimeout(res, INTERVAL))
  }
}

// невелика затримка щоб сервер точно піднявся
setTimeout(() => {
  runAutoLoop()
}, 3000)