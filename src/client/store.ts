/**
 * The prompt-panel store.
 *
 * One root-scoped instance shared by both surfaces (the composer dock chip and
 * the full-page view), persisted to localStorage. Drafts are the only prompt
 * data the plugin owns; "sent" prompts are derived from the session log by
 * `sent.ts` and never stored here.
 *
 * Session keys (`panelOpen`, `editor`, per-session elicitation) are plain
 * records so one store can serve every session the user visits.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ElicitationLink, ElicitationState } from '../shared.ts'

/** One saved-but-unsent prompt. */
export interface DraftRecord {
  readonly id: string
  /** Owning session; the panel shows only the current session's drafts. */
  readonly sessionId: string
  /** Markdown body. */
  readonly text: string
  readonly createdAt: number
  readonly updatedAt: number
}

/** Complete persisted panel state. */
export interface PromptEnricherState {
  /**
   * Per-session flag for the board opened from the blank-session entry.
   * Blank sessions render no conversation view, so that host cannot navigate —
   * it mounts the board in place instead.
   */
  readonly panelOpen: Readonly<Record<string, boolean>>
  /** Per-session editor buffer, so an accidental reload never loses work. */
  readonly editor: Readonly<Record<string, string>>
  /** The draft currently loaded into the editor, per session. */
  readonly loadedDraft: Readonly<Record<string, string | undefined>>
  readonly drafts: readonly DraftRecord[]
  /** Per-session elicitation snapshot mirrored from the host route. */
  readonly elicitation: Readonly<Record<string, ElicitationState | undefined>>
  /** Per-session draft↔child link, the only thing a resume needs. */
  readonly links: Readonly<Record<string, ElicitationLink | undefined>>
  /** Per-session in-flight flag for host calls. */
  readonly busy: Readonly<Record<string, boolean>>
  /** Last user-visible failure. */
  readonly error: string | null
}

/** Empty state; also the shape persistence rehydrates into. */
const INITIAL: PromptEnricherState = {
  panelOpen: {},
  editor: {},
  loadedDraft: {},
  drafts: [],
  elicitation: {},
  links: {},
  busy: {},
  error: null,
}

/** Storage key for the persisted panel. */
const PERSIST_KEY = 'dsh.prompt-enricher'

/**
 * Key this panel used before it was renamed from `dsh-prompt-lines`.
 *
 * Renaming a package must not look like data loss: drafts written under the old
 * key are adopted once, when the new key is still empty. The old key is left in
 * place rather than deleted, so a downgrade still finds its drafts.
 */
const LEGACY_PERSIST_KEY = 'dsh.prompt-lines'

/**
 * Adopt drafts saved under the pre-rename key.
 *
 * A missing `localStorage` (tests, SSR) and a throwing one (quota, private mode)
 * both leave the store starting empty, which is the same behaviour as a first
 * run.
 */
function adoptLegacyStorage(): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (localStorage.getItem(PERSIST_KEY) !== null) return
    const legacy = localStorage.getItem(LEGACY_PERSIST_KEY)
    if (legacy === null) return
    localStorage.setItem(PERSIST_KEY, legacy)
  } catch {
    /* unreadable storage: start empty instead of failing the plugin */
  }
}

/** The store handle type every surface shares. */
export type PromptEnricherStore = SnapshotStore<PromptEnricherState>

/**
 * Create the panel store, restoring any persisted drafts.
 * @returns the shared store instance.
 */
export function createPromptEnricherStore(): PromptEnricherStore {
  adoptLegacyStorage()
  return createSnapshotStore<PromptEnricherState>(INITIAL, { persist: { name: PERSIST_KEY } })
}

/** Read one session's stored draft count without subscribing. */
export function draftCount(state: PromptEnricherState, sessionId: string): number {
  return state.drafts.filter(draft => draft.sessionId === sessionId).length
}

/** Read the editor buffer for one session. */
export function editorText(state: PromptEnricherState, sessionId: string): string {
  return state.editor[sessionId] ?? ''
}
