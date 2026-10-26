/**
 * SentFeed merge test.
 *
 * Two reported defects drive this suite:
 *
 * - 「历史提示词数据不全」— the event window is a 50-message page, so a window-only
 *   list dropped every older prompt. The durable host history must merge in.
 * - 「不够稳定」— replaces (reopen) and failed requests shrank or emptied the
 *   list. The index must only ever grow, keyed by durable seq.
 *
 * Run: node_modules/.bin/tsx tools/sent-feed.test.ts
 */
import assert from 'node:assert/strict'
import { foldSentEvents, normalizeSent, type SentPrompt } from '../src/sent-fold.ts'
import { SentFeed, deriveSent } from '../src/client/sent.ts'

type Listener = () => void

/** One durable user message. */
function message(seq: number, text: string) {
  return {
    type: 'user/message',
    seq,
    time: 1000 + seq,
    surfaceOp: 'append',
    data: { content: [{ type: 'text', text }], source: { kind: 'user' } },
  }
}

/** One image-only durable user message. */
function imageMessage(seq: number) {
  return {
    type: 'user/message',
    seq,
    time: 1000 + seq,
    surfaceOp: 'append',
    data: {
      content: [{ type: 'image', attachment: { attachmentId: 'sha256:x', mediaType: 'image/png' } }],
      source: { kind: 'user' },
    },
  }
}

/** One window entry. */
const entry = (event: object) => ({ type: 'event' as const, event })

/** Minimal observable window stand-in with append/replace and revision/change. */
function makeWindow(seqs: readonly number[], texts?: readonly string[]) {
  let revision = 0
  let entries = seqs.map((seq, index) => entry(message(seq, texts?.[index] ?? `p${seq}`)))
  let change: { kind: string; entries: readonly unknown[] } = { kind: 'replace', entries }
  const listeners = new Set<Listener>()
  const publish = (nextChange: { kind: string; entries: readonly unknown[] }) => {
    change = nextChange
    revision += 1
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => ({ entries, revision, change }),
    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    append(event: object) {
      const live = [entry(event)]
      entries = [...entries, ...live]
      publish({ kind: 'append', entries: live })
    },
    replace(seqsNext: readonly number[]) {
      entries = seqsNext.map(seq => entry(message(seq, `p${seq}`)))
      publish({ kind: 'replace', entries })
    },
  }
}

// 1. Folding: only real, durable user messages.
assert.deepEqual(
  foldSentEvents([
    message(0, 'real'),
    imageMessage(1),
    { ...message(2, 'checkpoint'), data: { content: [{ type: 'text', text: 'checkpoint' }], source: { kind: 'plugin' } } },
    { ...message(3, 'replaced'), surfaceOp: { op: 'replace', start: 0, end: 0 } },
    { type: 'user/message', surfaceOp: 'append', data: { content: [{ type: 'text', text: 'no seq' }], source: { kind: 'user' } } },
    { ...message(4, '   '), data: { content: [{ type: 'text', text: '   ' }], source: { kind: 'user' } } },
  ]).map(item => item.text),
  ['real', ''],
  'appended user messages count; an image-only prompt keeps its place',
)
assert.equal(foldSentEvents([imageMessage(1)])[0]?.images, 1, 'image count is preserved')

// 2. A source that does not exist yet is picked up by refresh().
const first = makeWindow([0, 1])
let current: ReturnType<typeof makeWindow> | undefined
let history: Promise<readonly SentPrompt[]> = Promise.reject(new Error('no host route'))
const feed = new SentFeed({
  sessionId: 'test-session',
  resolve: () => current,
  loadHistory: () => history,
})
// Settle the bootstrap request so the late list below starts clean.
await feed.loadHistory()
assert.equal(feed.getSnapshot().length, 0, 'no source yet: empty list')
current = first
feed.refresh()
assert.deepEqual(feed.getSnapshot().map(item => item.seq), [0, 1], 'late source attaches')

// 3. Streaming output must not recompute or notify: only user prompts matter.
let notifications = 0
feed.subscribe(() => { notifications += 1 })
first.append({ type: 'assistant/message', seq: 2, time: 0, surfaceOp: 'append', data: { message: { content: [{ type: 'text', text: 'hi' }] } } })
assert.equal(notifications, 0, 'assistant append does not notify')
assert.equal(feed.getSnapshot().length, 2, 'assistant append does not change the list')
first.append(message(3, 'three'))
assert.equal(notifications, 1, 'user append notifies exactly once')
assert.deepEqual(feed.getSnapshot().map(item => item.seq), [0, 1, 3])

// 4. A REPLACED page (session reopen) must not drop prompts already seen.
first.replace([3])
assert.deepEqual(feed.getSnapshot().map(item => item.seq), [0, 1, 3], 'replace keeps earlier entries')

// 5. The durable host list fills in prompts the window never loaded, once.
history = Promise.resolve([
  { seq: 0, time: 1000, text: 'p0' },
  { seq: 1, time: 1001, text: 'p1' },
  { seq: 3, time: 1003, text: 'p3' },
  { seq: 4, time: 1004, text: 'old prompt only in the log' },
])
await feed.loadHistory()
assert.deepEqual(feed.getSnapshot().map(item => item.seq), [0, 1, 3, 4], 'history merges the durable tail')
assert.equal(feed.getSnapshot().filter(item => item.seq === 3).length, 1, 'seq deduplicates the two sources')

// 6. A replaced window source object (session reopened) keeps history and
//    follows the new window.
const second = makeWindow([4, 5])
current = second
feed.refresh()
assert.deepEqual(feed.getSnapshot().map(item => item.seq), [0, 1, 3, 4, 5], 'replaced source merges')
first.append(message(6, 'stale'))
assert.equal(feed.getSnapshot().some(item => item.seq === 6), false, 'old source no longer drives the feed')
second.append(message(7, 'seven'))
assert.equal(feed.getSnapshot().some(item => item.seq === 7), true, 'new source drives the feed')

// 7. Losing the binding keeps the last known list (stability under reopen).
current = undefined
feed.refresh()
assert.deepEqual(feed.getSnapshot().map(item => item.seq), [0, 1, 3, 4, 5, 7], 'binding loss keeps history')

// 8. A failing history request keeps the window data instead of emptying it.
history = Promise.reject(new Error('host route down'))
const third = makeWindow([8])
current = third
feed.refresh()
await feed.loadHistory()
assert.deepEqual(feed.getSnapshot().map(item => item.seq), [0, 1, 3, 4, 5, 7, 8], 'history failure is non-destructive')

// 9. deriveSent reads only the window it is given (still exported for probes).
assert.equal(deriveSent({ entries: [entry(message(9, 'nine'))] }).length, 1)

// 10. Untrusted lists (route response, storage) are validated and deduplicated.
assert.deepEqual(
  normalizeSent([
    { seq: 1, time: 1, text: 'a' },
    { seq: 1, time: 2, text: 'dup' },
    { seq: 2, text: ' ' },
    { seq: 3, time: 3, text: '', images: 2 },
    null,
    'junk',
  ]).map(item => item.text),
  ['a', ''],
  'normalize drops duplicates, blanks and junk but keeps image-only prompts',
)

console.log('sent-feed ok: fold / late attach / tail only / replace keeps / history merge / dedupe / detach / failure')
