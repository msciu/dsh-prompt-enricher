/**
 * Explain why a margin on the entry has no effect: dump the chip's ancestor
 * chain with the flex properties that decide its position.
 *
 * Usage: node chip-layout.cjs <url-with-token>
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
  await sleep(2500)

  const chain = await page.evaluate(() => {
    const chip = document.querySelector('.pl-chip')
    if (chip === null) return null
    const out = []
    let node = chip
    for (let depth = 0; depth < 5 && node !== null; depth += 1) {
      const style = getComputedStyle(node)
      const box = node.getBoundingClientRect()
      out.push({
        tag: node.tagName.toLowerCase(),
        cls: (node.className ?? '').toString().slice(0, 40),
        display: style.display,
        justify: style.justifyContent,
        grow: style.flexGrow,
        marginLeft: style.marginLeft,
        marginRight: style.marginRight,
        gap: style.gap,
        rect: { x: Math.round(box.x), w: Math.round(box.width) },
        children: [...node.children].map(child => {
          const s = getComputedStyle(child)
          const b = child.getBoundingClientRect()
          return {
            cls: (child.className ?? '').toString().slice(0, 30),
            x: Math.round(b.x),
            w: Math.round(b.width),
            ml: s.marginLeft,
            grow: s.flexGrow,
          }
        }),
      })
      node = node.parentElement
    }
    return out
  })

  console.log(JSON.stringify(chain, null, 1))
  await browser.close()
})().catch(error => {
  console.error('PROBE_FAILED', error)
  process.exit(1)
})
