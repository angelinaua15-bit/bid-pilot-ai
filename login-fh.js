const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

;(async () => {
  const storageStatePath = path.resolve(process.cwd(), 'storageState.json')

  console.log('cwd:', process.cwd())
  console.log('storageStatePath:', storageStatePath)
  console.log('storageState exists:', fs.existsSync(storageStatePath))

  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto('https://freelancehunt.com/login')

  console.log('Увійди у Freelancehunt.')
  console.log('Після входу натисни ENTER у терміналі.')

  process.stdin.once('data', async () => {
    await context.storageState({ path: storageStatePath })

    console.log('cwd:', process.cwd())
    console.log('storageStatePath:', storageStatePath)
    console.log('storageState exists:', fs.existsSync(storageStatePath))
    console.log('storageState.json створено:', storageStatePath)

    await browser.close()
    process.exit()
  })
})()
