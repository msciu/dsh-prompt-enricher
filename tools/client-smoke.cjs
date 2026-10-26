/**
 * Headless client smoke test for a running DSH web instance.
 *
 * Answers the one question static checks cannot: does the plugin's browser
 * bundle actually MATERIALIZE inside the shipped shell? Collects every console
 * message, page error, and failed request so a bundle that throws at factory
 * execution is visible instead of looking like "the app failed to start".
 *
 * Usage: node client-smoke.cjs <url-with-token>
 */
const puppeteer = require(process.env.PUPPETEER_CORE ?? 'puppeteer-core')

const url = process.argv[2]
if (url === undefined) {
  console.error('usage: node client-smoke.cjs <url>')
  process.exit(2)
}

const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1400,900'],
  })
  const page = await browser.newPage()
  const consoleLines = []
  const errors = []
  const failed = []

  page.on('console', message => consoleLines.push(`${message.type()}: ${message.text()}`))
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', request => failed.push(`${request.url()} :: ${request.failure()?.errorText}`))

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
  await new Promise(resolve => setTimeout(resolve, 4000))

  const probe = await page.evaluate(() => {
    const text = document.body.innerText ?? ''
    const styleTags = [...document.querySelectorAll('style[data-plugin]')].map(tag => tag.dataset.plugin)
    const bundleRequests = performance.getEntriesByType('resource')
      .map(entry => entry.name)
      .filter(name => name.includes('/plugins/'))
    return {
      hasPromptWord: text.includes('提示词'),
      hasComposer: document.querySelector('[data-composer-seat]') !== null,
      styleTags,
      bundleRequests,
      bodyHead: text.slice(0, 400),
    }
  })

  console.log(JSON.stringify({
    errors,
    failed: failed.slice(0, 20),
    console: consoleLines.slice(0, 40),
    probe,
  }, null, 2))

  await browser.close()
})().catch(error => {
  console.error('SMOKE_FAILED', error)
  process.exit(1)
})
