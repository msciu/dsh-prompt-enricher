/**
 * Fold one real persisted session log and report what the panel will show.
 *
 * Diagnostic for the "history incomplete" report: it counts every
 * `user/message` in the durable log and compares that with the sent list the
 * plugin folds out of it, so a missing prompt is traceable to the filter instead
 * of the source.
 *
 * Usage: tsx tools/sent-log-check.ts "<path to session.v4.jsonl.zstd>"
 */
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { foldSentEvents, type SentEventLike } from '../src/sent-fold.ts'

/** Zstandard frame magic, little-endian. */
const ZSTD_MAGIC = 0xFD2FB528

/**
 * Locate complete frames in a concatenated Zstandard container.
 *
 * The JSONL backend appends one frame per batch, so a plain one-shot
 * `zstdDecompressSync` only returns the header frame — the mistake this
 * diagnostic exists to avoid. Structure follows
 * `packages/session/session-persistence-jsonl/src/zstd.ts`.
 * @param buffer - complete artifact bytes.
 * @returns frame byte ranges.
 */
function scanFrames(buffer: Buffer): Array<{ start: number; end: number }> {
  const frames: Array<{ start: number; end: number }> = []
  let offset = 0
  while (offset + 4 <= buffer.length) {
    const start = offset
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`bad frame magic at ${offset}`)
    offset += 4
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    for (;;) {
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      offset += blockType === 0x01 ? 1 : blockSize
      if (lastBlock) break
    }
    if (checksum) offset += 4
    frames.push({ start, end: offset })
  }
  return frames
}

const file = process.argv[2]
if (file === undefined) {
  console.error('usage: tsx tools/sent-log-check.ts <session log>')
  process.exit(1)
}

const source = readFileSync(file)
const parts = scanFrames(source).map(frame => zstdDecompressSync(source.subarray(frame.start, frame.end)))
const raw = Buffer.concat(parts).toString('utf8')
const lines = raw.split('\n').filter(line => line.trim() !== '')
const header = JSON.parse(lines[0] as string) as { type?: string }
console.log('header type:', header.type)
const events: SentEventLike[] = []
const counts = new Map<string, number>()
for (const line of lines.slice(1)) {
  // Persisted lines ARE events (`type` is the event type); only line 1 is the
  // header. This is exactly the shape `Session.events` exposes to the host.
  const event = JSON.parse(line) as SentEventLike
  const type = event.type ?? '?'
  counts.set(type, (counts.get(type) ?? 0) + 1)
  events.push(event)
}
console.log('log lines:', lines.length - 1, 'events:', events.length)
const userMessages = events.filter(event => event.type === 'user/message')
console.log('user/message:', userMessages.length)
const bySource = new Map<string, number>()
for (const event of userMessages) {
  const kind = event.data?.source?.kind ?? '(none)'
  bySource.set(kind, (bySource.get(kind) ?? 0) + 1)
}
console.log('user/message by source:', Object.fromEntries(bySource))
console.log('by surfaceOp:', userMessages.reduce<Record<string, number>>((acc, event) => {
  const key = typeof event.surfaceOp === 'string' ? event.surfaceOp : JSON.stringify(event.surfaceOp)
  acc[key] = (acc[key] ?? 0) + 1
  return acc
}, {}))
const prompts = foldSentEvents(events)
console.log('folded prompts:', prompts.length, 'first seq:', prompts[0]?.seq, 'last seq:', prompts.at(-1)?.seq)
for (const prompt of prompts.slice(0, 3)) {
  console.log(`  #${prompt.seq} ${prompt.text.slice(0, 40).replace(/\n/g, ' ')}`)
}
