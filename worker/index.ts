import 'dotenv/config'

// порт
process.env.WORKER_PORT = process.env.WORKER_PORT ?? '4000'

// запускаємо сервер
import './server'

// ---- АВТО ЦИКЛ ----

const INTERVAL = 10 * 60 * 1000 // 10 хв (можеш змінити)

let isRunning = false

async function runAutoLoop() {
  if (isRunning) return
  isRunning = true

  console.log('[worker] Auto loop started')

  while (true) {
    try {
      console.log('[worker] Running auto-bid cycle...')

      // дергаємо свій же endpoint
      await fetch(`http://localhost:${process.env.WORKER_PORT}/auto-bid/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.AUTOMATION_SECRET}`
        }
      })

      console.log('[worker] Cycle done, waiting...')
    } catch (err) {
      console.error('[worker] Error in loop:', err)
    }

    await new Promise(res => setTimeout(res, INTERVAL))
  }
}

// невелика затримка щоб сервер точно піднявся
setTimeout(() => {
  runAutoLoop()
}, 3000)