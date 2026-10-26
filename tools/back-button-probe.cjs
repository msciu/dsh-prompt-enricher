/**
 * Verify the editor action row: "新建" is gone, "返回对话" replaced it, and
 * clicking it closes the in-place board.
 *
 * Usage: node back-button-probe.cjs <url-with-token>
 */
const puppeteer = require(process.env.PUPPETEER_CORE ?? 'puppeteer-core')

const url = process.argv[2]
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1500,950'],
  })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(2500)

  await page.evaluate(() => { document.querySelector('.pl-chip')?.click() })
  await sleep(1500)

  const opened = await page.evaluate(() => ({
    cover: document.querySelector('.pl-cover') !== null,
    actions: [...document.querySelectorAll('.pl-actions .pl-btn')].map(node => node.textContent?.trim()),
    hasNew: [...document.querySelectorAll('.pl-actions .pl-btn')].some(node => node.textContent?.trim() === '新建'),
  }))

  await page.evaluate(() => {
    const button = [...document.querySelectorAll('.pl-actions .pl-btn')].find(node => node.textContent?.trim() === '返回对话')
    button?.click()
  })
  await sleep(1500)

  const closed = await page.evaluate(() => ({
    cover: document.querySelector('.pl-cover') !== null,
    chipBack: document.querySelector('.pl-chip') !== null,
  }))

  console.log(JSON.stringify({ errors, opened, closed }, null, 1))
  await browser.close()
})().catch(error => {
  console.error('PROBE_FAILED', error)
  process.exit(1)
})
