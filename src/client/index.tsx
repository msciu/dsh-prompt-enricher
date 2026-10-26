/**
 * dsh-prompt-enricher — browser half.
 *
 * Registers the two entries that open the same panel:
 *
 * - `conversation.input.dock` — the row above the composer card. Chosen over
 *   `conversation.hero.agentPreset` because that seat is single, already holds
 *   the create-mode chip, and only renders on a blank session; the dock row
 *   renders for blank AND active sessions, which is where long prompts are
 *   actually written (ConversationRoot.tsx renders it in both phases).
 * - `conversation.view` — the top tab, rendered as a real page.
 *
 * Sending does not drive the composer: `inputActions.setDraft` writes the
 * Lexical editor while `submit()` reads its projection, leaving a window where
 * the submitted text is stale. `session.prompt(content, 'queue')` commits the
 * content directly.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pull each feature package's Context merge (ctx.slots / ctx.sessions
// / ctx.locale) and the conversation SlotMap keys.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ElicitationState } from '../shared.ts'
import { normalizeSent, type SentPrompt } from '../sent-fold.ts'
import type { PromptEnricherInjected, SkillOption } from './face.ts'
import { PromptEntry, PromptEnricherPage } from './Panel.tsx'
import { en, NS, zh, type PromptEnricherKey } from './locales.ts'
import { SentFeed } from './sent.ts'
import { createPromptEnricherStore, type DraftRecord } from './store.ts'
import { installStyles } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy for the prompt workbench page. */
    promptEnricher: PromptEnricherKey
  }
}

/** Services this half requires. */
export const inject = ['slots', 'sessions', 'locale', 'uiConversation']

/** Route prefix owned by the host half. */
const ROUTE_BASE = '/_dsh/prompt-enricher'

/** Elicitation poll cadence while the child is thinking. */
const POLL_MS = 1200

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-prompt-enricher: dictionaries')
  const t = ctx.locale.bind(NS)
  installStyles(typeof document === 'undefined' ? undefined : document)

  const store = createPromptEnricherStore()
  /** Per-session sent-prompt feeds, disposed with the plugin. */
  const feeds = new Map<string, SentFeed>()
  /** Per-session elicitation poll timers. */
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  ctx.effect(() => () => {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    for (const feed of feeds.values()) feed.dispose()
    feeds.clear()
  }, 'dsh-prompt-enricher: session feeds')

  /**
   * Complete prompt history for one session, as served by the host half.
   *
   * The durable log is the only complete source: the client window is a 50-
   * message page. Validation is shared with the storage reader, so a malformed
   * response degrades instead of poisoning the list.
   * @param sessionId - session to read.
   * @returns user prompts, oldest first.
   */
  const fetchSent = async (sessionId: string): Promise<readonly SentPrompt[]> => {
    const value = await call(`/sent?sessionId=${encodeURIComponent(sessionId)}`) as { prompts?: unknown }
    return normalizeSent(value.prompts)
  }

  const feedFor = (sessionId: string): SentFeed => {
    const cached = feeds.get(sessionId)
    if (cached !== undefined) return cached
    // Resolve the window lazily: a session-scoped slot can materialize before
    // its binding does, and a reopened session hands out a different window.
    // Re-attachment happens on every session-list change (see below).
    //
    // The window only carries the live tail; `loadHistory` adds the complete
    // durable list and the feed merges the two by seq.
    const feed = new SentFeed({
      sessionId,
      resolve: () => ctx.sessions.binding(sessionId as never)?.eventSource as
        | { getSnapshot: () => { entries: readonly unknown[] }, subscribe: (fn: () => void) => () => void }
        | undefined,
      loadHistory: () => fetchSent(sessionId),
    })
    feeds.set(sessionId, feed)
    return feed
  }

  // A binding that appears later (or is replaced when the session reopens) must
  // reach every feed; otherwise the list freezes on an earlier snapshot.
  ctx.effect(() => {
    const unsubscribe = ctx.sessions.list.subscribe(() => {
      for (const feed of feeds.values()) feed.refresh()
    })
    return () => { unsubscribe() }
  }, 'dsh-prompt-enricher: sent feeds follow bindings')

  /** Skill catalog for the "/" picker; one fetch per session is enough. */
  const skillCache = new Map<string, Promise<readonly SkillOption[]>>()
  const loadSkills = (sessionId: string): Promise<readonly SkillOption[]> => {
    const cached = skillCache.get(sessionId)
    if (cached !== undefined) return cached
    const pending = call(`/skills?sessionId=${encodeURIComponent(sessionId)}`)
      .then((value) => (value as { skills?: SkillOption[] }).skills ?? [])
      .catch((error: unknown) => {
        // A missing catalog must not break typing: the picker just stays empty.
        skillCache.delete(sessionId)
        throw error
      })
    skillCache.set(sessionId, pending)
    return pending
  }

  /** Open/close the in-place board used by the blank-session entry. */
  const setBoardOpen = (sessionId: string, open: boolean): void => {
    store.update((draft) => {
      // A state rehydrated from the pre-rename key has no `panelOpen` field.
      const flags: Record<string, boolean> = { ...(draft.panelOpen ?? {}) }
      flags[sessionId] = open
      draft.panelOpen = flags
      draft.error = null
    })
  }

  const setEditor = (sessionId: string, text: string): void => {
    store.update((draft) => {
      draft.editor[sessionId] = text
      draft.error = null
    })
  }

  /**
   * Save the editor buffer as a draft (updating the loaded one when there is
   * one).
   * @param sessionId - owning session.
   * @returns the draft id that now holds the editor text, or undefined when the
   *   editor is empty.
   */
  const saveDraftNow = (sessionId: string): string | undefined => {
    const state = store.getSnapshot()
    const text = state.editor[sessionId] ?? ''
    if (text.trim() === '') return undefined
    const loaded = state.loadedDraft[sessionId]
    const now = Date.now()
    let result = loaded
    store.update((draft) => {
      draft.error = null
      const index = loaded === undefined ? -1 : draft.drafts.findIndex(item => item.id === loaded)
      if (index >= 0) {
        const existing = draft.drafts[index] as DraftRecord
        draft.drafts[index] = { ...existing, text, updatedAt: now }
        return
      }
      const id = newDraftId(now)
      draft.drafts.push({ id, sessionId, text, createdAt: now, updatedAt: now })
      draft.loadedDraft[sessionId] = id
      result = id
    })
    return result
  }

  const saveDraft = (sessionId: string): void => {
    saveDraftNow(sessionId)
  }

  /**
   * Deliver the editor buffer to the session.
   * @param sessionId - owning session.
   * @returns true when the prompt was accepted, so the host can leave the board.
   */
  const sendEditor = async (sessionId: string): Promise<boolean> => {
    const state = store.getSnapshot()
    const text = state.editor[sessionId] ?? ''
    if (text.trim() === '') {
      store.update((draft) => { draft.error = t('editor.empty') })
      return false
    }
    const session = ctx.sessions.binding(sessionId as never)?.session
    if (session === undefined) {
      store.update((draft) => { draft.error = t('error.send') })
      return false
    }
    store.update((draft) => { draft.busy[sessionId] = true })
    try {
      const result = await session.prompt([{ type: 'text', text }], 'queue')
      if (!result.ok) {
        store.update((draft) => { draft.error = `${t('error.send')} ${result.error.message}` })
        return false
      }
      // The draft retires together with the send: a prompt must not exist as
      // both a draft and a sent entry after a reload.
      const loaded = state.loadedDraft[sessionId]
      store.update((draft) => {
        draft.editor[sessionId] = ''
        draft.loadedDraft[sessionId] = undefined
        if (loaded !== undefined) draft.drafts = draft.drafts.filter(item => item.id !== loaded)
        draft.error = null
      })
      // Only the in-place host is closed here. A tab host switches to Chat by
      // selecting the View in the Conversation store, which this half does not
      // own — the page does that with `openView` once this resolves true.
      setBoardOpen(sessionId, false)
      // The new prompt reaches the window as an append, but the durable list is
      // the one that survives replaces; refresh it while the host log is fresh.
      void feedFor(sessionId).loadHistory()
      return true
    } catch (error) {
      store.update((draft) => { draft.error = `${t('error.send')} ${messageOf(error)}` })
      return false
    } finally {
      store.update((draft) => { draft.busy[sessionId] = false })
    }
  }

  const applyState = (sessionId: string, state: ElicitationState): void => {
    store.update((draft) => {
      draft.elicitation[sessionId] = state
      draft.busy[sessionId] = state.phase === 'thinking'
    })
  }

  const poll = (sessionId: string): void => {
    const pending = timers.get(sessionId)
    if (pending !== undefined) clearTimeout(pending)
    const tick = async (): Promise<void> => {
      try {
        const state = await call(`/state?sessionId=${encodeURIComponent(sessionId)}`) as ElicitationState
        applyState(sessionId, state)
        if (state.phase === 'thinking') {
          timers.set(sessionId, setTimeout(() => { void tick() }, POLL_MS))
        } else {
          timers.delete(sessionId)
        }
      } catch {
        timers.delete(sessionId)
        store.update((draft) => { draft.busy[sessionId] = false })
      }
    }
    void tick()
  }

  /**
   * Start an elicitation straight from the editor.
   *
   * The draft row's own "澄清" link only exists once something is a draft, which
   * made the plugin's headline feature invisible to anyone who had just typed
   * into the editor. This saves the buffer first (so the child always has an
   * anchor to write back to) and then starts the same flow.
   * @param sessionId - owning session.
   */
  const elicitEditor = async (sessionId: string): Promise<void> => {
    const draftId = saveDraftNow(sessionId)
    if (draftId === undefined) {
      store.update((draft) => { draft.error = t('editor.empty') })
      return
    }
    await startElicitation(sessionId, draftId)
  }

  const startElicitation = async (sessionId: string, draftId: string): Promise<void> => {
    const state = store.getSnapshot()
    const target = state.drafts.find(item => item.id === draftId && item.sessionId === sessionId)
    if (target === undefined) return
    store.update((draft) => {
      draft.busy[sessionId] = true
      draft.error = null
    })
    try {
      const next = await call('/start', { sessionId, document: target.text }) as ElicitationState
      store.update((draft) => {
        draft.elicitation[sessionId] = next
        draft.links[sessionId] = {
          elicitationId: next.elicitationId,
          draftId,
          childSessionId: next.childSessionId,
        }
        draft.busy[sessionId] = next.phase === 'thinking'
      })
      if (next.phase === 'thinking') poll(sessionId)
    } catch (error) {
      store.update((draft) => {
        draft.busy[sessionId] = false
        draft.error = `${t('elicit.failed')}: ${messageOf(error)}`
      })
    }
  }

  const answerElicitation = async (sessionId: string, answer: string): Promise<void> => {
    const current = store.getSnapshot().elicitation[sessionId]
    if (current === undefined) return
    store.update((draft) => {
      draft.busy[sessionId] = true
      draft.error = null
    })
    try {
      const next = await call('/answer', { elicitationId: current.elicitationId, answer }) as ElicitationState
      applyState(sessionId, next)
      if (next.phase === 'thinking') poll(sessionId)
    } catch (error) {
      store.update((draft) => {
        draft.busy[sessionId] = false
        draft.error = messageOf(error)
      })
    }
  }

  const finishElicitation = async (sessionId: string): Promise<void> => {
    const current = store.getSnapshot().elicitation[sessionId]
    if (current === undefined) return
    try {
      await call('/finish', { elicitationId: current.elicitationId })
    } catch {
      /* releasing is best-effort; the local outcome below still applies */
    }
    store.update((draft) => {
      draft.elicitation[sessionId] = undefined
      draft.links[sessionId] = undefined
      draft.busy[sessionId] = false
    })
  }

  const writeBack = (sessionId: string): void => {
    const current = store.getSnapshot().elicitation[sessionId]
    const document = current?.final
    if (document === null || document === undefined) return
    const link = store.getSnapshot().links[sessionId]
    const now = Date.now()
    store.update((draft) => {
      draft.error = null
      draft.editor[sessionId] = document
      const index = link === undefined ? -1 : draft.drafts.findIndex(item => item.id === link.draftId)
      if (index >= 0) {
        const existing = draft.drafts[index] as DraftRecord
        draft.drafts[index] = { ...existing, text: document, updatedAt: now }
        draft.loadedDraft[sessionId] = existing.id
        return
      }
      const id = newDraftId(now)
      draft.drafts.push({ id, sessionId, text: document, createdAt: now, updatedAt: now })
      draft.loadedDraft[sessionId] = id
    })
    void finishElicitation(sessionId)
  }

  const faceFor = (sessionId: string): PromptEnricherInjected => ({
    hooks: {
      promptEnricher: store,
      promptSent: feedFor(sessionId),
    },
    setEditor: (text: string) => { setEditor(sessionId, text) },
    sendEditor: () => sendEditor(sessionId),
    saveDraft: () => { saveDraft(sessionId) },
    loadDraft: (id: string) => {
      const target = store.getSnapshot().drafts.find(item => item.id === id)
      if (target === undefined) return
      store.update((draft) => {
        draft.editor[sessionId] = target.text
        draft.loadedDraft[sessionId] = target.id
        draft.error = null
      })
    },
    deleteDraft: (id: string) => {
      store.update((draft) => {
        draft.drafts = draft.drafts.filter(item => item.id !== id)
        if (draft.loadedDraft[sessionId] === id) draft.loadedDraft[sessionId] = undefined
      })
    },
    refresh: () => {
      // Opening the board also re-reads the durable history: it is the only
      // complete source, and a reopen may have happened while it was closed.
      void feedFor(sessionId).loadHistory()
      poll(sessionId)
    },
    openBoard: () => { setBoardOpen(sessionId, true) },
    closeBoard: () => { setBoardOpen(sessionId, false) },
    startElicitation: (id: string) => { void startElicitation(sessionId, id) },
    elicitEditor: () => { void elicitEditor(sessionId) },
    loadSkills: () => loadSkills(sessionId),    answerElicitation: (text: string) => { void answerElicitation(sessionId, text) },
    writeBack: () => { writeBack(sessionId) },
    finishElicitation: () => { void finishElicitation(sessionId) },
  })

  // Entry for the state the tab strip does not cover: a conversation with no
  // transcript yet renders no view tabs at all (verified against 0.2.1), so the
  // board would otherwise be unreachable until the first prompt is sent.
  //
  // `conversation.input.left` is the tool row's list seat that renders right
  // AFTER the permission/mode control (measured: the `.tools` row is "+", then
  // the modes group, then this slot). `input.right` landed the chip in the
  // right-anchored group beside the model selector, leaving a large gap that
  // read as "too far from the permission selector".
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'prompt-enricher-entry',
    order: 10,
    locale: NS,
    label: () => t('entry.label'),
    inject: (sessionId: never) => faceFor(String(sessionId)),
  }, PromptEntry))

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'prompt-enricher',
    order: 30,
    locale: NS,
    label: () => t('view.label'),
    inject: (sessionId: never) => faceFor(String(sessionId)),
  }, PromptEnricherPage))
}

/** One JSON call against this plugin's host routes. */
async function call(path: string, body?: unknown): Promise<unknown> {
  const response = body === undefined
    ? await fetch(`${ROUTE_BASE}${path}`, { method: 'GET' })
    : await fetch(`${ROUTE_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const text = await response.text()
  const parsed: unknown = text === '' ? {} : JSON.parse(text)
  if (!response.ok) {
    const reason = typeof parsed === 'object' && parsed !== null && typeof (parsed as Record<string, unknown>)['error'] === 'string'
      ? String((parsed as Record<string, unknown>)['error'])
      : `HTTP ${response.status}`
    throw new Error(reason)
  }
  return parsed
}

/** Stable-enough local draft identity (no uuid dependency in the browser bundle). */
function newDraftId(now: number): string {
  return `draft-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Human-readable error text. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
