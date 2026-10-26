/**
 * Dump the composer's structure in a blank session, so the entry chip can be
 * placed next to the mode switch instead of on its own row.
 *
 * Usage: node composer-probe.cjs <url-with-token>
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
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(3000)

  const probe = await page.evaluate(() => {
    const slots = [...document.querySelectorAll('[data-slot]')].map(node => ({
      key: node.getAttribute('data-slot'),
      text: (node.textContent ?? '').replace(/\s+/g, ' ').slice(0, 40),
    }))
    // The composer card: find the element containing the placeholder text.
    const editor = document.querySelector('[contenteditable="true"], textarea')
    let card = editor
    for (let i = 0; i < 6 && card !== null; i += 1) card = card.parentElement
    const describe = (node, depth) => {
      if (node === null || depth > 5) return null
      const box = node.getBoundingClientRect()
      return {
        tag: node.tagName.toLowerCase(),
        cls: (node.className ?? '').toString().slice(0, 60),
        slot: node.getAttribute?.('data-slot') ?? null,
        text: (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50),
        rect: { left: Math.round(box.left), top: Math.round(box.top), w: Math.round(box.width), h: Math.round(box.height) },
        children: [...node.children].slice(0, 8).map(child => describe(child, depth + 1)),
      }
    }
    const chip = document.querySelector('.pl-chip')
    return {
      slots,
      composer: describe(card, 0),
      chipRect: chip === null ? null : (() => {
        const box = chip.getBoundingClientRect()
        return { left: Math.round(box.left), top: Math.round(box.top), w: Math.round(box.width), h: Math.round(box.height) }
      })(),
    }
  })

  console.log(JSON.stringify(probe, null, 1))
  await browser.close()
})().catch(error => {
  console.error('PROBE_FAILED', error)
  process.exit(1)
})
