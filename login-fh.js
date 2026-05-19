const { chromium } = require('playwright')
const fs = require('fs')

;(async () => {
  const browser = await chromium.launch({
    headless: false,
  })

  const context = await browser.newContext()

  const page = await context.newPage()

  await page.goto('https://freelancehunt.com/login')

  console.log('Увійди у Freelancehunt.')
  console.log('Після входу натисни ENTER у терміналі.')

  process.stdin.once('data', async () => {
    await context.storageState({
      path: 'storageState.json',
    })

    console.log('storageState.json створено')

    await browser.close()
    process.exit()
  })
})()