/**
 * Layout probe for the elicited-answer row.
 *
 * The board covers the conversation column with a fixed-height layer, so its
 * content has to fit (or scroll) inside that height. On a short window the
 * elicitation card's answer row fell below the cover and was clipped: this
 * harness renders the real stylesheet against representative markup and
 * measures whether the "回答" button is inside the viewport.
 *
 * The cover height tracks the viewport (window minus a ~60px session header),
 * because that is how `useColumnCover` measures it.
 *
 * Usage: node tools/answer-visibility-probe.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const puppeteer = require(process.env.PUPPETEER_CORE ?? 'puppeteer-core')

const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(__dirname, 'probe-out')

/** Read the injected stylesheet out of the source module. */
function panelCss() {
  const source = fs.readFileSync(path.join(ROOT, 'src/client/styles.ts'), 'utf8')
  const match = /export const PANEL_CSS = `([\s\S]*?)`\n/.exec(source)
  if (match === null) throw new Error('PANEL_CSS not found')
  return match[1]
}

/** Rewrite the current rules back to the pre-fix shape. */
function legacyCss(css) {
  return css
    .replace('.pl-col-main { overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; }', '.pl-col-main { }')
    .replace('.pl-editor-wrap-compact { flex: 0 0 auto; }\n', '')
    .replace('.pl-editor-wrap-compact .pl-editor { min-height: 160px; }', '')
    .replace(/@media \(max-height: 760px\) \{\n  \.pl-page \.pl-editor \{ min-height: 160px; \}\n\}/, '')
    .replace(/@media \(max-width: 860px\) \{[\s\S]*?\n\}\n\.pl-count/, '@media (max-width: 860px) {\n  .pl-page { grid-template-columns: minmax(0, 1fr); }\n}\n.pl-count')
    .replace(/\.pl-elicit \.pl-actions \{[^}]*\}/, '.pl-elicit .pl-actions { }')
    .replace('  gap: 14px;\n  padding: 14px;', '  gap: 14px;\n  align-items: start;\n  padding: 14px;')
}

/** Markup mirroring Surface: list column + editor + elicitation card. */
function body(legacy, coverHeight) {
  const rightColumn = legacy ? 'pl-col' : 'pl-col pl-col-main'
  const editorWrap = legacy ? 'pl-editor-wrap' : 'pl-editor-wrap pl-editor-wrap-compact'
  const items = Array.from({ length: 6 }, (_, index) =>
    `<div class="pl-item"><div class="pl-item-head"><span class="pl-item-time">发送于 10:0${index}</span></div>`
    + `<pre class="pl-text pl-clamp">第 ${index + 1} 条提示词的正文，用来占位。</pre></div>`).join('')
  const options = ['结构化周报', '面向管理层的摘要', '三段式复盘', '带指标表格', '偏行动建议',
    '保持简短', '包含风险项', '按项目分组', '需要数据来源']
    .map(option => `<button type="button" class="pl-option" data-on="false">${option}</button>`).join('')
  return `
  <div class="pl-root pl-cover" style="position:fixed;left:0;top:0;width:100%;height:${coverHeight}px">
    <div class="pl-page">
      <div class="pl-col pl-col-list">
        <div class="pl-head"><span class="pl-title">提示词</span><span class="pl-head-spacer"></span>
          <span class="pl-count">已发送 6 · 草稿 2</span></div>
        <div class="pl-tools"><input class="pl-input" type="search" placeholder="过滤提示词…">
          <div class="pl-seg"><button data-on="true">全部</button><button>已发送</button><button>草稿</button></div></div>
        <div class="pl-list"><div class="pl-group-label">已发送</div>${items}</div>
      </div>
      <div class="${rightColumn}">
        <div class="${editorWrap}">
          <div class="pl-editor-box"><textarea class="pl-editor"></textarea></div>
          <div class="pl-actions">
            <button class="pl-btn pl-btn-primary">发送</button>
            <button class="pl-btn pl-btn-accent">澄清提升</button>
            <button class="pl-btn">保存为草稿</button>
            <button class="pl-btn">返回对话</button>
            <span class="pl-hint">回车仅换行；输入 / 调出技能。</span>
          </div>
        </div>
        <div class="pl-elicit">
          <div class="pl-elicit-head"><span class="pl-title">提示词澄清</span><span class="pl-head-spacer"></span>
            <button class="pl-link">结束</button></div>
          <div class="pl-q">这份提示词要交付给谁、覆盖哪些时间段、需要哪些指标口径？请确认受众、粒度与输出格式，`
    + `并说明哪些内容必须保留、哪些可以省略。还要确定数据来源与口径冲突时的处理方式。</div>
          <div class="pl-rationale">理由：受众与口径决定结构，先定这两项才能收敛其余细节；其余问题会依赖这两个答案。</div>
          <div class="pl-options">${options}</div>
          <div class="pl-hint">推荐：面向管理层的摘要 <button class="pl-link">采纳推荐答案</button></div>
          <div class="pl-actions">
            <input class="pl-input" placeholder="你的裁定…">
            <button id="answer" class="pl-btn pl-btn-primary">回答</button>
          </div>
        </div>
      </div>
    </div>
  </div>`
}

function pageHtml(css, legacy, coverHeight) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; height: 100%; background: #fff; }
    ${css}
  </style></head><body>${body(legacy, coverHeight)}</body></html>`
}

/** Open one document at one viewport and measure the answer control. */
async function measure(browser, css, legacy, width, height) {
  const coverHeight = height - 60
  const page = await browser.newPage()
  await page.setViewport({ width, height })
  await page.setContent(pageHtml(css, legacy, coverHeight), { waitUntil: 'load' })
  const data = await page.evaluate(() => {
    const answer = document.querySelector('#answer')
    const main = document.querySelector('.pl-col-main')
    const cover = document.querySelector('.pl-cover')
    const pageEl = document.querySelector('.pl-page')
    const coverBox = cover.getBoundingClientRect()
    /** Is the control fully inside the covered column? */
    const visible = () => {
      const box = answer.getBoundingClientRect()
      return box.top >= 0 && box.bottom <= coverBox.bottom
    }
    const before = visible()
    // Stacked (single-column) layouts scroll the page itself; a tall card is
    // allowed to need one scroll, so record whether it becomes visible.
    pageEl.scrollTop = pageEl.scrollHeight
    if (main !== null) main.scrollTop = main.scrollHeight
    const afterScroll = visible()
    pageEl.scrollTop = 0
    if (main !== null) main.scrollTop = 0
    const box = answer.getBoundingClientRect()
    return {
      viewport: { w: innerWidth, h: innerHeight },
      answer: { top: Math.round(box.top), bottom: Math.round(box.bottom) },
      inViewport: before,
      reachable: before || afterScroll,
      column: main === null ? null : { client: main.clientHeight, scroll: main.scrollHeight },
      page: { client: pageEl.clientHeight, scroll: pageEl.scrollHeight },
      cover: {
        h: Math.round(coverBox.height),
        scroll: cover.scrollHeight,
        canScroll: cover.scrollHeight > cover.clientHeight,
      },
    }
  })
  if (width === 1366 && height === 560) {
    await page.screenshot({ path: path.join(OUT, `answer-${legacy ? 'before' : 'after'}-1366x560.png`) })
  }
  await page.close()
  return data
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const current = panelCss()
  const prior = legacyCss(current)
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  })
  const results = []
  for (const [name, css, legacy] of [['before', prior, true], ['after', current, false]]) {
    for (const [width, height] of [[1500, 900], [1366, 768], [1366, 640], [1366, 560], [820, 640]]) {
      results.push({ variant: name, size: `${width}x${height}`, ...await measure(browser, css, legacy, width, height) })
    }
  }
  await browser.close()
  console.log(JSON.stringify(results, null, 1))
})().catch(error => { console.error('PROBE_FAILED', error); process.exit(1) })
