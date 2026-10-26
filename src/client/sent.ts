/**
 * The sent-prompt index: live tail from the event window, complete history from
 * the host, merged into one monotonic per-session list.
 *
 * Neither source alone is enough:
 *
 * - The client event window holds only the most recent page (50 messages —
 *   `PAGE_MESSAGES` in the session controller), so deriving the list from it
 *   alone silently dropped every older prompt. That is the reported "历史提示词
 *   数据不全".
 * - The window is *replaced* with a fresh page whenever a session reopens or a
 *   binding is swapped, so a window-only list also shrank at random — "不够稳定".
 *
 * The durable session log is authoritative and complete; the host half serves
 * it over `/_dsh/prompt-enricher/sent`. This class merges it into an index that
 * only ever grows, keyed by durable `seq`. The window then supplies just the
 * live tail, and a prompt can neither appear twice nor disappear because one
 * source lagged behind the other.
 *
 * See the folding rules in `../sent-fold.ts`.
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import {
  foldSentEvents,
  normalizeSent,
  type SentEventLike,
  type SentPrompt,
} from '../sent-fold.ts'

export type { SentPrompt }

/** Window entry: the transport keeps the coarse event/chunks discriminator. */
interface EntryLike {
  readonly type?: string
  readonly event?: SentEventLike
}

/** The latest synchronous window delta, as far as this module reads it. */
interface ChangeLike {
  readonly kind?: string
  readonly entries?: readonly unknown[]
}

/** The event-window shape read here (structurally typed; the window is owned elsewhere). */
interface EventWindowLike {
  readonly entries: readonly unknown[]
  /** Monotonic revision; lets a no-op notification be skipped. */
  readonly revision?: number
  readonly change?: ChangeLike
}

/** LocalStorage key prefix for the reload bootstrap. */
const STORAGE_PREFIX = 'dsh.prompt-enricher:sent:'

/**
 * How many entries survive a page reload. The in-memory index is never capped:
 * the host history is complete, and this only seeds the list while that request
 * is in flight.
 */
const STORED_LIMIT = 300

/**
 * Derive the sent list from one window snapshot.
 * @param window - current session event window.
 * @returns sent prompts, oldest first.
 */
export function deriveSent(window: EventWindowLike): readonly SentPrompt[] {
  return foldSentEvents(eventsOf(window.entries))
}

/** Keep only the durable `event` entries (compact chunks are not messages). */
function eventsOf(entries: readonly unknown[]): SentEventLike[] {
  const out: SentEventLike[] = []
  for (const raw of entries) {
    const entry = raw as EntryLike
    if (entry.type === 'event' && entry.event !== undefined) out.push(entry.event)
  }
  return out
}

/** Options for one session's feed. */
export interface SentFeedOptions {
  /** Owns the feed; also the storage key. */
  readonly sessionId: string
  /** Current window source, or undefined while the binding does not exist. */
  readonly resolve: () => ObservableSnapshot<EventWindowLike> | undefined
  /** Complete durable list from the host half; rejects when the route is down. */
  readonly loadHistory: () => Promise<readonly SentPrompt[]>
}

/**
 * A per-session observable over the merged sent list.
 *
 * Merge semantics, in one sentence: **add by seq, never remove**. A replaced
 * window, a session reopen, or a failed history request can therefore only
 * delay the list, never truncate it.
 */
export class SentFeed implements ObservableSnapshot<readonly SentPrompt[]> {
  private readonly listeners = new Set<() => void>()
  /** Complete merged list, oldest first. */
  private cache: readonly SentPrompt[] = []
  private source: ObservableSnapshot<EventWindowLike> | undefined
  private unsubscribe: (() => void) | undefined
  /** Last window revision folded, so a chunk-only notification does no work. */
  private revision: number | undefined = undefined
  /** In-flight history request, shared by overlapping refreshes. */
  private history: Promise<void> | undefined
  /** Set once storage rejected a write (quota); further writes are pointless. */
  private persistBroken = false

  /**
   * @param options - session id, window resolver, and durable-history loader.
   */
  constructor(private readonly options: SentFeedOptions) {
    this.cache = readStored(options.sessionId)
    this.attach()
    void this.loadHistory()
  }

  /** @returns the current merged list. */
  getSnapshot(): readonly SentPrompt[] {
    return this.cache
  }

  /**
   * Subscribe to a recomputed list.
   * @param listener - invalidation callback.
   * @returns unsubscribe.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Re-resolve the window source (a session-list change or a reopen). An
   * identical source is a no-op; a replaced object folds from scratch but keeps
   * the entries it already had.
   */
  refresh(): void {
    this.attach()
  }

  /**
   * Fetch and merge the complete durable list. Failures are swallowed on
   * purpose: the window tail plus whatever was already stored is still a usable
   * list, and the next open retries.
   * @returns completion, whether the request succeeded or not.
   */
  loadHistory(): Promise<void> {
    if (this.history !== undefined) return this.history
    const pending = this.options.loadHistory()
      .then((prompts) => {
        if (this.merge(prompts)) this.notify()
      })
      .catch(() => {
        /* The host route may be unavailable on an older build; keep the tail. */
      })
      .finally(() => {
        if (this.history === pending) this.history = undefined
      })
    this.history = pending
    return pending
  }

  /** Release the upstream subscription (called when a session scope dies). */
  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.source = undefined
    this.listeners.clear()
  }

  private attach(): void {
    const next = this.options.resolve()
    if (next === this.source) {
      this.recompute()
      return
    }
    this.unsubscribe?.()
    this.source = next
    this.revision = undefined
    this.unsubscribe = next?.subscribe(() => { this.recompute() })
    this.recompute()
  }

  private recompute(): void {
    const window = this.source?.getSnapshot()
    if (window === undefined) return
    // Older hosts may omit `revision`; then every notification folds the window,
    // which is correct if less efficient.
    if (typeof window.revision === 'number') {
      if (window.revision === this.revision) return
      this.revision = window.revision
    }

    // Streaming assistant output appends dozens of events per turn. Folding just
    // the delta keeps that path O(1) — no list can change when none of the new
    // entries is a user prompt.
    const change = window.change
    if (change?.kind === 'append' && Array.isArray(change.entries)) {
      if (this.merge(foldSentEvents(eventsOf(change.entries)))) this.notify()
      return
    }
    // `prepend` (older page) and `replace` (reopen) can both introduce entries
    // this feed has not seen; fold the whole window.
    if (this.merge(deriveSent(window))) this.notify()
  }

  /**
   * Merge entries by seq, keeping the newest copy of each.
   * @param next - prompts from either source.
   * @returns whether the list actually changed.
   */
  private merge(next: readonly SentPrompt[]): boolean {
    if (next.length === 0) return false
    const bySeq = new Map<number, SentPrompt>()
    for (const item of this.cache) bySeq.set(item.seq, item)
    const before = bySeq.size
    for (const item of next) {
      if (!bySeq.has(item.seq)) bySeq.set(item.seq, item)
    }
    if (bySeq.size === before) return false
    this.cache = [...bySeq.values()].sort((a, b) => a.seq - b.seq)
    this.persist()
    return true
  }

  /** Persist the newest slice for the next page load (the request still wins). */
  private persist(): void {
    if (this.persistBroken) return
    const storage = storageOf()
    if (storage === undefined) return
    try {
      storage.setItem(`${STORAGE_PREFIX}${this.options.sessionId}`, JSON.stringify(this.cache.slice(-STORED_LIMIT)))
    } catch {
      // Quota or a disabled storage: the in-memory list is unaffected, and a
      // retry on the next merge would re-stringify the same oversized payload.
      this.persistBroken = true
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

/** The browser's storage, or undefined when it is absent or blocked. */
function storageOf(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** Read the reload bootstrap; a corrupt entry degrades to an empty list. */
function readStored(sessionId: string): SentPrompt[] {
  const storage = storageOf()
  if (storage === undefined) return []
  try {
    return normalizeSent(JSON.parse(storage.getItem(`${STORAGE_PREFIX}${sessionId}`) ?? '[]'))
  } catch {
    return []
  }
}
