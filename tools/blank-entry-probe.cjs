/**
 * Verify the blank-session entry round trip in a real 0.2.1 instance:
 * chip appears → opens the board → the board's back control returns to chat.
 *
 * Usage: node blank-entry-probe.cjs <url-with-token>
 */
const puppeteer = require(process.env.PUPPETEER_CORE ?? 'puppeteer-core')

const url = process.argv[2]
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const snapshot = (page) => page.evaluate(() => {
  const chip = document.querySelector('.pl-chip')
  const cover = document.querySelector('.pl-cover')
  // The board keeps exactly one back control, in the editor action row.
  const back = [...document.querySelectorAll('.pl-actions .pl-btn')].find(node => node.textContent?.includes('返回'))
  const headBack = [...document.querySelectorAll('.pl-head .pl-link')].some(node => node.textContent?.includes('返回'))
  const tabs = [...document.querySelectorAll('[role="tab"]')].map(tab => tab.textContent?.trim() ?? '')
  return {
    chip: chip === null ? null : chip.textContent?.trim() ?? '',
    cover: cover !== null,
    back: back !== undefined,
    headBack,
    tabs,
    composerVisible: (() => {
      const seat = document.querySelector('[data-composer-seat]')
      if (seat === null) return false
      const box = seat.getBoundingClientRect()
      const coverBox = cover?.getBoundingClientRect()
      return coverBox === undefined || coverBox.bottom < box.top || coverBox.top > box.bottom
    })(),
  }
})

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1500,950'],
  })
  const page = await browser.newPage()
  const errors = []
  const consoleLines = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => consoleLines.push(`${message.type()}: ${message.text().slice(0, 200)}`))

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(3000)

  const stages = { initial: await snapshot(page) }

  await page.evaluate(() => { document.querySelector('.pl-chip')?.click() })
  await sleep(1800)
  stages.opened = await snapshot(page)

  await page.evaluate(() => {
    const back = [...document.querySelectorAll('.pl-actions .pl-btn')].find(node => node.textContent?.includes('返回'))
    back?.click()
  })
  await sleep(1800)
  stages.returned = await snapshot(page)

  console.log(JSON.stringify({ errors, console: consoleLines.slice(0, 20), stages }, null, 2))
  await browser.close()
})().catch(error => {
  console.error('PROBE_FAILED', error)
  process.exit(1)
})
