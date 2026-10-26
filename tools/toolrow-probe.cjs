/**
 * Inspect the composer tool row: what the permission control looks like
 * (colour, size) and which slot containers sit where, so the entry can be placed
 * next to it and styled to match.
 *
 * Usage: node toolrow-probe.cjs <url-with-token>
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

  const info = await page.evaluate(() => {
    const rectOf = (node) => {
      const box = node.getBoundingClientRect()
      return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) }
    }
    const describe = (node) => {
      const style = getComputedStyle(node)
      return {
        tag: node.tagName.toLowerCase(),
        cls: (node.className ?? '').toString().slice(0, 40),
        slot: node.getAttribute?.('data-slot') ?? null,
        text: (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24),
        rect: rectOf(node),
        color: style.color,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        background: style.backgroundColor,
        border: style.border,
        padding: style.padding,
        margin: style.margin,
      }
    }
    const tools = document.querySelector('[data-slot="conversation.input.permission"]')
    const toolsRow = tools?.closest('.RlGAzG_tools') ?? tools?.parentElement ?? null
    const permissionButton = tools?.querySelector('button') ?? null
    const chip = document.querySelector('.pl-chip')
    return {
      toolsRow: toolsRow === null ? null : describe(toolsRow),
      toolsRowChildren: toolsRow === null ? [] : [...toolsRow.children].map(describe),
      permissionSlot: tools === null ? null : describe(tools),
      permissionButton: permissionButton === null ? null : describe(permissionButton),
      chip: chip === null ? null : describe(chip),
      chipSlot: chip?.closest('[data-slot]')?.getAttribute('data-slot') ?? null,
    }
  })

  console.log(JSON.stringify(info, null, 1))
  await browser.close()
})().catch(error => {
  console.error('PROBE_FAILED', error)
  process.exit(1)
})
