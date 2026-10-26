/**
 * Click the clarify button with some text and report the resulting state, to
 * prove the button is wired to the host route (a blank session has no live
 * agent, so the expected answer is the route's own 409 rather than a child).
 *
 * Usage: node clarify-probe.cjs <url-with-token>
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
  const requests = []
  page.on('request', request => {
    if (request.url().includes('/_dsh/prompt-enricher/')) requests.push(`${request.method()} ${request.url().replace(/^https?:\/\/[^/]+/, '')}`)
  })

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(2500)
  await page.evaluate(() => { document.querySelector('.pl-chip')?.click() })
  await sleep(1200)

  await page.evaluate(() => {
    const area = document.querySelector('textarea.pl-editor')
    area.focus()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(area, '帮我写一个周报汇总的提示词')
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(400)

  await page.evaluate(() => {
    const button = [...document.querySelectorAll('.pl-actions .pl-btn')].find(node => node.textContent?.includes('澄清'))
    button?.click()
  })
  await sleep(2500)

  const after = await page.evaluate(() => ({
    error: document.querySelector('.pl-error')?.textContent?.trim() ?? null,
    drafts: [...document.querySelectorAll('.pl-item .pl-text')].map(node => (node.textContent ?? '').trim().slice(0, 30)).slice(0, 3),
  }))

  console.log(JSON.stringify({ requests, after }, null, 1))
  await browser.close()
})().catch(error => {
  console.error('PROBE_FAILED', error)
  process.exit(1)
})
