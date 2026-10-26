/**
 * Verify the three changes in a real instance: the entry's new position, the
 * "/" skill picker, and the prominent clarify button.
 *
 * Usage: node verify-3.cjs <url-with-token>
 */
const puppeteer = require(process.env.PUPPETEER_CORE ?? 'puppeteer-core')

const url = process.argv[2]
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const rect = (page, selector) => page.evaluate((sel) => {
  const node = document.querySelector(sel)
  if (node === null) return null
  const box = node.getBoundingClientRect()
  return { left: Math.round(box.left), top: Math.round(box.top), w: Math.round(box.width), h: Math.round(box.height), text: (node.textContent ?? '').trim().slice(0, 20) }
}, selector)

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
  page.on('console', message => consoleLines.push(`${message.type()}: ${message.text().slice(0, 160)}`))

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(3000)

  const entry = {
    chip: await rect(page, '.pl-chip'),
    permission: await rect(page, '[data-slot="conversation.input.permission"]'),
    model: await rect(page, '[data-slot="conversation.input.model"]'),
    slot: await page.evaluate(() => {
      const chip = document.querySelector('.pl-chip')
      const host = chip?.closest('[data-slot]')
      return host?.getAttribute('data-slot') ?? null
    }),
    inToolRow: await page.evaluate(() => {
      const chip = document.querySelector('.pl-chip')
      const permission = document.querySelector('[data-slot="conversation.input.permission"]')
      if (chip === null || permission === null) return null
      const a = chip.getBoundingClientRect()
      const b = permission.getBoundingClientRect()
      return { sameRow: Math.abs(a.top - b.top) < 4, afterPermission: a.left >= b.right - 2 }
    }),
  }

  // Open the board and try the slash picker.
  await page.evaluate(() => { document.querySelector('.pl-chip')?.click() })
  await sleep(1500)

  const board = {
    cover: (await rect(page, '.pl-cover')) !== null,
    clarifyButton: await page.evaluate(() => [...document.querySelectorAll('.pl-actions .pl-btn')].map(node => node.textContent?.trim())),
  }

  await page.evaluate(() => {
    const area = document.querySelector('textarea.pl-editor')
    area.focus()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(area, '/gri')
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(900)

  const slash = await page.evaluate(() => {
    const menu = document.querySelector('.pl-slash')
    return {
      open: menu !== null,
      items: [...document.querySelectorAll('.pl-slash-name')].map(node => node.textContent?.trim()),
      descriptions: [...document.querySelectorAll('.pl-slash-desc')].map(node => node.textContent?.trim().slice(0, 40)),
    }
  })

  console.log(JSON.stringify({ errors, console: consoleLines.slice(0, 10), entry, board, slash }, null, 1))
  await browser.close()
})().catch(error => {
  console.error('VERIFY_FAILED', error)
  process.exit(1)
})
