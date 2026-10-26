/**
 * `/sent` route smoke test against the built host bundle.
 *
 * Exercises the real `apply()` registration with a fake Cordis context: a live
 * session's in-memory log, the persistence fallback for a non-live one, and the
 * no-reader 503. Run after a build:
 *
 *   node tools/sent-route.test.mjs
 */
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

const ROUTE = '/_dsh/prompt-enricher/sent'

/** One durable event, as the session log stores it. */
const event = (type, seq, extra = {}) => ({ type, seq, time: 1000 + seq, ...extra })

/** A live user prompt. */
const prompt = (seq, text) => event('user/message', seq, {
  surfaceOp: 'append',
  data: { content: [{ type: 'text', text }], source: { kind: 'user' } },
})

/** A compaction checkpoint, which must not count as a user prompt. */
const checkpoint = (seq) => event('user/message', seq, {
  surfaceOp: 'append',
  data: { content: [{ type: 'text', text: 'summary' }], source: { kind: 'plugin', plugin: 'compact' } },
})

const handlers = new Map()
const live = new Map([
  ['s1', { events: [prompt(0, 'first'), event('assistant/message', 1, { surfaceOp: 'append', data: { message: { content: [] } } }), prompt(2, 'second'), checkpoint(3)] }],
])
const stored = new Map([
  ['cold', { events: [prompt(5, 'only in the log')] }],
])
let persistence

const ctx = {
  effect: (fn) => fn(),
  on: () => () => {},
  inject: (_deps, callback) => { callback(ctx); return () => {} },
  get: (name) => {
    if (name === 'sessions') return { get: (id) => live.get(id) }
    if (name === 'sessionPersistence') return persistence
    return undefined
  },
  webServer: {
    register: ({ path, handler }) => {
      handlers.set(path, handler)
      return () => {}
    },
  },
  logger: { warn() {} },
}

apply(ctx)
const handler = handlers.get(ROUTE)
assert.ok(handler !== undefined, 'sent route is registered')

/** Call the route with a GET and return the parsed response. */
async function get(url) {
  const res = {
    status: 0,
    body: '',
    writableEnded: false,
    writeHead(status) { this.status = status },
    end(chunk) { this.body += String(chunk ?? ''); this.writableEnded = true },
  }
  await handler({ method: 'GET', url, headers: {} }, res)
  return { status: res.status, body: JSON.parse(res.body) }
}

// A live session: complete in-memory log, filtered to user prompts.
const liveResult = await get(`${ROUTE}?sessionId=s1`)
assert.equal(liveResult.status, 200)
assert.deepEqual(liveResult.body.prompts.map((item) => item.text), ['first', 'second'])
assert.deepEqual(liveResult.body.prompts.map((item) => item.seq), [0, 2], 'seq survives for the client merge')

// A non-live session falls back to the durable backend.
persistence = { inspect: async () => stored.get('cold') }
const coldResult = await get(`${ROUTE}?sessionId=cold`)
assert.equal(coldResult.status, 200)
assert.deepEqual(coldResult.body.prompts.map((item) => item.text), ['only in the log'])

// No reader at all is an explicit 503, never a silent empty list.
persistence = undefined
live.clear()
const missing = await get(`${ROUTE}?sessionId=gone`)
assert.equal(missing.status, 503)

// A missing session id is a 400.
const bad = await get(ROUTE)
assert.equal(bad.status, 400)

console.log('sent-route ok: live log / persistence fallback / 503 / 400')
