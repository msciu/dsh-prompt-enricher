/**
 * The one folding rule for "prompts the user has already sent", shared by both
 * halves of the plugin.
 *
 * The browser derives the live tail from its event window; the host derives the
 * complete list from the session log. Both sources feed the same per-session
 * index, so they MUST agree on which events count — otherwise one prompt would
 * appear twice or vanish depending on which source landed first.
 *
 * Three conditions are load-bearing:
 *
 * - `surfaceOp === 'append'` — a replacement event (compaction checkpoint)
 *   rewrites an earlier range rather than appending a new prompt.
 * - `data.source.kind === 'user'` — compaction checkpoints are `user/message`
 *   events too, but their source is the `compact` plugin; without this filter
 *   they would masquerade as something the user typed.
 * - a numeric `seq` — it is the identity used to merge the two sources and to
 *   deduplicate across reloads. Events without one are not durable history and
 *   are skipped.
 */

/** One prompt the user has already delivered to the session. */
export interface SentPrompt {
  /** Durable event seq: identity across the window, the log, and storage. */
  readonly seq: number
  /** Event time, milliseconds since the epoch (0 when the host omitted it). */
  readonly time: number
  /** Concatenated text blocks of the prompt (empty for an image-only prompt). */
  readonly text: string
  /** Image parts, when the prompt carried any. */
  readonly images?: number
}

/** One durable event, as far as this folder reads it. */
export interface SentEventLike {
  readonly type?: string
  readonly seq?: number
  readonly time?: number
  readonly surfaceOp?: unknown
  readonly data?: {
    readonly content?: unknown
    readonly source?: { readonly kind?: string }
  }
}

/**
 * Fold durable events into the sent list.
 * @param events - events in seq order.
 * @returns user prompts, oldest first.
 */
export function foldSentEvents(events: readonly SentEventLike[]): SentPrompt[] {
  const out: SentPrompt[] = []
  for (const event of events) {
    if (event.type !== 'user/message') continue
    if (event.surfaceOp !== 'append') continue
    if (event.data?.source?.kind !== 'user') continue
    if (typeof event.seq !== 'number') continue
    const content = event.data.content
    const text = textOfContent(content)
    const images = countImages(content)
    // An image-only prompt is still history: dropping it is what "数据不全"
    // looks like when the user pasted a screenshot.
    if (text.trim() === '' && images === 0) continue
    out.push({
      seq: event.seq,
      time: typeof event.time === 'number' ? event.time : 0,
      text,
      ...(images > 0 ? { images } : {}),
    })
  }
  return out
}

/**
 * Concatenate the text blocks of one content array.
 * @param content - a `PromptContentPart[]`-shaped value, or anything else.
 * @returns the joined text, or an empty string.
 */
export function textOfContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const record = block as Record<string, unknown>
    if (record['type'] === 'text' && typeof record['text'] === 'string') parts.push(record['text'])
  }
  return parts.join('\n\n')
}

/**
 * Count image parts of one content array.
 * @param content - a `PromptContentPart[]`-shaped value, or anything else.
 * @returns the number of image blocks.
 */
export function countImages(content: unknown): number {
  if (!Array.isArray(content)) return 0
  let images = 0
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    if ((block as Record<string, unknown>)['type'] === 'image') images += 1
  }
  return images
}

/**
 * Validate and normalize a list that crossed a trust boundary (localStorage, an
 * HTTP route). Unusable entries are dropped instead of poisoning the index.
 * @param value - an untrusted value.
 * @returns valid prompts, sorted oldest first and deduplicated by seq.
 */
export function normalizeSent(value: unknown): SentPrompt[] {
  if (!Array.isArray(value)) return []
  const bySeq = new Map<number, SentPrompt>()
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const seq = record['seq']
    const time = record['time']
    const text = record['text']
    const images = record['images']
    if (typeof seq !== 'number' || typeof text !== 'string') continue
    const imageCount = typeof images === 'number' && Number.isFinite(images) && images > 0 ? Math.floor(images) : 0
    if (text.trim() === '' && imageCount === 0) continue
    // Keep the first occurrence, matching SentFeed's merge rule: a later
    // duplicate must not overwrite an entry already shown.
    if (!bySeq.has(seq)) {
      bySeq.set(seq, {
        seq,
        time: typeof time === 'number' ? time : 0,
        text,
        ...(imageCount > 0 ? { images: imageCount } : {}),
      })
    }
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}
