/**
 * Open an existing session in a real 0.2.1 instance and inspect both the view
 * tab strip and the prompt panel's sent list.
 *
 * Answers two questions at once:
 *  1. does the tab strip exist once a session has content?
 *  2. does the panel's sent list include the session's NEWEST prompt?
 *
 * Usage: node session-probe.cjs <url-with-token>
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

  // Sidebar session rows: pick the first clickable row that is not a control.
  const picked = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('a[href], [role="treeitem"], [data-session-id], aside button')]
    const row = candidates.find(element => (element.textContent ?? '').trim().length > 1)
    if (row === undefined) return 'no-session-row'
    row.click()
    return `clicked:${(row.textContent ?? '').trim().slice(0, 50)}`
  })
  await sleep(4000)

  const chat = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')].map(tab => ({
      text: tab.textContent?.trim() ?? '',
      selected: tab.getAttribute('aria-selected') === 'true',
    }))
    const userBubbles = [...document.querySelectorAll('[data-message-role="user"], [data-role="user"]')]
    return {
      tabs,
      tabCount: tabs.length,
      hasPromptTab: tabs.some(tab => tab.text === '提示词'),
      userBubbleCount: userBubbles.length,
      text: (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 240),
    }
  })

  let panel = null
  if (chat.hasPromptTab) {
    await page.evaluate(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find(element => element.textContent?.trim() === '提示词')
      tab?.click()
    })
    await sleep(2500)
    panel = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.pl-item .pl-text')].map(node => (node.textContent ?? '').trim())
      const count = document.querySelector('.pl-count')?.textContent?.trim() ?? ''
      const empty = document.querySelector('.pl-empty')?.textContent?.trim() ?? ''
      return {
        count,
        itemCount: items.length,
        first: items[0]?.slice(0, 120) ?? '',
        last: items[items.length - 1]?.slice(0, 120) ?? '',
        empty,
        coverCoversComposer: (() => {
          const cover = document.querySelector('.pl-cover')
          const seat = document.querySelector('[data-composer-seat]')
          if (cover === null || seat === null) return 'missing'
          const a = cover.getBoundingClientRect()
          const b = seat.getBoundingClientRect()
          return a.top <= b.top && a.bottom >= b.bottom ? 'yes' : `no(cover ${Math.round(a.top)}-${Math.round(a.bottom)} seat ${Math.round(b.top)}-${Math.round(b.bottom)})`
        })(),
      }
    })
  }

  console.log(JSON.stringify({ errors, picked, chat, panel }, null, 2))
  await browser.close()
})().catch(error => {
  console.error('PROBE_FAILED', error)
  process.exit(1)
})
