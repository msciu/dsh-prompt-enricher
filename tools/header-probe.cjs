/**
 * Probe the conversation header in a REAL 0.2.1 instance: does the view tab
 * strip exist before the first prompt, and is the plugin's tab reachable?
 *
 * Usage: node header-probe.cjs <url-with-token>
 */
const puppeteer = require(process.env.PUPPETEER_CORE ?? 'puppeteer-core')

const url = process.argv[2]
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function report(page, label) {
  return page.evaluate((tag) => {
    const tabs = [...document.querySelectorAll('[role="tab"]')].map(tab => ({
      text: tab.textContent?.trim() ?? '',
      selected: tab.getAttribute('aria-selected') === 'true',
    }))
    const text = document.body.innerText ?? ''
    return {
      label: tag,
      tabs,
      tabCount: tabs.length,
      hasPromptTab: tabs.some(tab => tab.text === '提示词'),
      hasComposer: document.querySelector('[data-composer-seat]') !== null,
      heroVisible: text.includes('有什么可以帮') || text.includes('选择工作区') || text.includes('Choose workspace'),
      bodyHead: text.replace(/\s+/g, ' ').slice(0, 300),
    }
  }, label)
}

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1400,900'],
  })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(2500)

  const stages = []
  stages.push(await report(page, 'cold-start'))

  // Try to open a workspace so a blank session exists.
  const opened = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')]
    const chip = buttons.find(button => /工作区|workspace|选择工作区|Choose/i.test(button.textContent ?? ''))
    if (chip === undefined) return 'no-workspace-button'
    chip.click()
    return 'clicked'
  })
  await sleep(1500)
  stages.push(await report(page, `after-workspace-click(${opened})`))

  // Pick the first menu item if a menu opened.
  const picked = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[role="menuitem"], [role="option"], li button')]
    if (items.length === 0) return 'no-menu-items'
    items[0].click()
    return `picked:${items[0].textContent?.trim().slice(0, 40) ?? ''}`
  })
  await sleep(3000)
  stages.push(await report(page, `after-pick(${picked})`))

  console.log(JSON.stringify({ errors, stages }, null, 2))
  await browser.close()
})().catch(error => {
  console.error('PROBE_FAILED', error)
  process.exit(1)
})
