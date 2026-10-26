/**
 * The prompt workbench page.
 *
 * Rendered by the `prompt-enricher` conversation view. A conversation view only
 * replaces the session BODY — the composer seat renders beside it, outside the
 * view's subtree — so the page claims the whole conversation column instead of
 * flowing inside it: it measures `[data-conversation-scroll]` (the element that
 * contains both the transcript and the composer seat) and covers it with an
 * opaque fixed layer. The session header stays visible above it, so the tab
 * strip that got the user here remains reachable.
 *
 * Layout is two columns: history on the left (sent + drafts, filtered), the
 * Markdown editor and the elicitation block on the right. Enter never sends.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ElicitationQuestion, ElicitationState } from '../shared.ts'
import type { PromptEnricherInjected, SkillOption } from './face.ts'
import type { DraftRecord, PromptEnricherState } from './store.ts'
import type { SentPrompt } from './sent.ts'

/** Filter axis over the two prompt kinds. */
type Filter = 'all' | 'sent' | 'draft'

/** Props of the page entry. */
export type PromptEnricherPageProps =
  PropsRuntime<'conversation.view'>
  & InjectFace<PromptEnricherInjected>
  & PropsLocale<'promptEnricher'>

/** Props of the composer-dock entry. */
export type PromptEntryProps =
  PropsRuntime<'conversation.input.dock'>
  & InjectFace<PromptEnricherInjected>
  & PropsLocale<'promptEnricher'>

/** Shared translate signature. */
type Translate = PromptEnricherPageProps['t']

/**
 * The blank-session entry, and the board it opens.
 *
 * Why this exists twice: a conversation with no transcript renders NO view
 * tabs, and the shell renders the hero instead of any conversation view — so
 * `activate('prompt-enricher')` succeeds and shows nothing (verified against
 * 0.2.1). The chip therefore opens the SAME board as a column-covering layer
 * mounted from this slot, instead of navigating. Once the session has a
 * transcript the chip retires and the tab strip owns the entry.
 *
 * @param props - composed slot props.
 * @returns the chip, the covering board while open, or null.
 */
export function PromptEntry(props: PromptEntryProps) {
  const { sessionId, t, openBoard, closeBoard, useSession, usePromptEnricher, usePromptSent, refresh } = props
  const blank = useSession(snapshot => snapshot.blank)
  const state = usePromptEnricher(snapshot => snapshot)
  const sent = usePromptSent(snapshot => snapshot)
  const open = state.panelOpen?.[sessionId] === true

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  if (open) {
    return (
      <Board
        sessionId={sessionId}
        t={t}
        face={props}
        state={state}
        sent={sent}
        onBack={closeBoard}
      />
    )
  }
  // `blank` is the empty-log bit: true until the session logs its first event.
  if (blank !== true) return null
  return (
    <div className="pl-root">
      <button type="button" className="pl-chip" onClick={openBoard} title={t('entry.hint')}>
        {t('entry.label')}
      </button>
    </div>
  )
}

/**
 * The workbench page (the tab-strip host, for sessions that have a transcript).
 * @param props - composed slot props.
 * @returns the full-column panel.
 */
export function PromptEnricherPage(props: PromptEnricherPageProps) {
  const { sessionId, t, usePromptEnricher, usePromptSent, refresh, openView, completeViewRequest } = props
  const state = usePromptEnricher(snapshot => snapshot)
  const sent = usePromptSent(snapshot => snapshot)

  // Re-sync an elicitation that was running before the page was opened.
  useEffect(() => { refresh() }, [refresh])

  /**
   * Return to Chat by selecting the View in the Conversation store.
   *
   * `uiConversation.binding(id).activate()` only adds a snapshot target — it
   * never changes the rendered View — so a back action built on it silently
   * left the tab on this page. `openView` is the slot's supported selection
   * path (the header tabs use it), and it persists the same preference.
   */
  const backToChat = (): void => {
    openView('chat', '')
    // The focus request `openView` attaches is one-shot; Chat never consumes
    // it, so clear it instead of leaving a stale request in the store.
    completeViewRequest()
  }

  return (
    <Board
      sessionId={sessionId}
      t={t}
      face={props}
      state={state}
      sent={sent}
      onBack={backToChat}
    />
  )
}

/**
 * The board itself: one component, two hosts.
 * @param props - resolved state plus the back action of the host.
 * @returns the column-covering panel.
 */
function Board({ sessionId, t, face, state, sent, onBack }: {
  readonly sessionId: string
  readonly t: Translate
  readonly face: PromptEnricherInjected
  readonly state: PromptEnricherState
  readonly sent: readonly SentPrompt[]
  readonly onBack: () => void
}) {
  const cover = useColumnCover()
  return (
    <div className="pl-root pl-cover" style={cover}>
      <div className="pl-page">
        <Surface
          sessionId={sessionId}
          t={t}
          face={face}
          state={state}
          sent={sent}
          onBack={onBack}
        />
      </div>
    </div>
  )
}

/**
 * The Markdown editor, with a `/` picker for skills.
 *
 * The composer's own trigger pipeline (`ui-input-trigger`) is wired to the
 * composer's editor and renders into `conversation.input.overlay`, so it cannot
 * be reused here; this is the same affordance, scoped to this textarea. Picking
 * inserts `/name ` as text — it does not execute the skill, because this editor
 * sends a plain prompt.
 */
function Editor({ value, t, onChange, loadSkills }: {
  readonly value: string
  readonly t: Translate
  readonly onChange: (text: string) => void
  readonly loadSkills: () => Promise<readonly SkillOption[]>
}) {
  const [slash, setSlash] = useState<SlashState>(SLASH_CLOSED)
  const [skills, setSkills] = useState<readonly SkillOption[]>([])
  const area = useRef<HTMLTextAreaElement | null>(null)

  const candidates = slash.open
    ? skills
      .filter(skill => slash.query === '' || skill.name.toLowerCase().includes(slash.query.toLowerCase()))
      .slice(0, 8)
    : []

  // The catalog is fetched the first time the picker opens, not on mount: most
  // editing sessions never type a slash.
  useEffect(() => {
    if (!slash.open || skills.length > 0) return
    let cancelled = false
    void loadSkills()
      .then((list) => { if (!cancelled) setSkills(list) })
      .catch(() => { /* no catalog: the picker simply shows nothing */ })
    return () => { cancelled = true }
  }, [slash.open, skills.length, loadSkills])

  const pick = (skill: SkillOption): void => {
    const caret = slash.start + 1 + slash.query.length
    const next = `${value.slice(0, slash.start)}/${skill.name} ${value.slice(caret)}`
    const at = slash.start + skill.name.length + 2
    onChange(next)
    setSlash(SLASH_CLOSED)
    requestAnimationFrame(() => {
      const node = area.current
      if (node === null) return
      node.focus()
      node.setSelectionRange(at, at)
    })
  }

  return (
    <div className="pl-editor-box">
      <textarea
        ref={area}
        className="pl-editor"
        value={value}
        spellCheck={false}
        placeholder={t('editor.placeholder')}
        onChange={(event) => {
          const next = event.target.value
          const caret = event.target.selectionStart ?? next.length
          onChange(next)
          const token = slashTokenAt(next, caret)
          setSlash(token === undefined
            ? SLASH_CLOSED
            : { open: true, start: token.start, query: token.query, index: 0 })
        }}
        onKeyDown={(event) => {
          if (!slash.open) return
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setSlash(current => ({ ...current, index: Math.min(current.index + 1, candidates.length - 1) }))
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setSlash(current => ({ ...current, index: Math.max(current.index - 1, 0) }))
            return
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            const candidate = candidates[slash.index]
            if (candidate !== undefined) {
              event.preventDefault()
              pick(candidate)
            }
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setSlash(SLASH_CLOSED)
          }
        }}
      />
      {slash.open && candidates.length > 0 && (
        <div className="pl-slash" role="listbox">
          {candidates.map((skill, index) => (
            <button
              type="button"
              key={skill.name}
              role="option"
              aria-selected={index === slash.index}
              className={index === slash.index ? 'pl-slash-item pl-slash-active' : 'pl-slash-item'}
              onMouseDown={(event) => { event.preventDefault(); pick(skill) }}
            >
              <span className="pl-slash-name">/{skill.name}</span>
              {skill.description !== '' && <span className="pl-slash-desc">{skill.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Open state of the `/` picker and the token it belongs to. */
interface SlashState {
  readonly open: boolean
  readonly start: number
  readonly query: string
  readonly index: number
}

const SLASH_CLOSED: SlashState = { open: false, start: 0, query: '', index: 0 }

/**
 * Find the slash token that starts the word under the caret.
 * @param text - current editor text.
 * @param caret - selection start.
 * @returns token start offset and query, or undefined when the caret is not in
 *   a slash token.
 */
function slashTokenAt(text: string, caret: number): { start: number; query: string } | undefined {
  const before = text.slice(0, caret)
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(before)
  if (match === null) return undefined
  const query = match[1] ?? ''
  return { start: caret - query.length - 1, query }
}

/**
 * Measure the conversation column so the page can cover it.
 *
 * `[data-conversation-scroll]` wraps the transcript AND the composer seat, so
 * its rect is exactly the area the user means by "the chat box". Re-measured on
 * resize and on the column's own size changes (sidebar toggles, right panel).
 * @returns fixed-position geometry for the cover layer.
 */
function useColumnCover(): CSSProperties {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  useEffect(() => {
    const measure = (): void => {
      const host = document.querySelector('[data-conversation-scroll]')
      if (!(host instanceof HTMLElement)) return
      const box = host.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) return
      setRect(current => (
        current !== null
        && current.left === box.left
        && current.top === box.top
        && current.width === box.width
        && current.height === box.height
          ? current
          : { left: box.left, top: box.top, width: box.width, height: box.height }
      ))
    }
    const frame = requestAnimationFrame(measure)
    const host = document.querySelector('[data-conversation-scroll]')
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    if (host instanceof HTMLElement && observer !== undefined) observer.observe(host)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  if (rect === null) return { position: 'fixed', inset: 0 }
  return {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  }
}

/**
 * The panel body.
 * @param props - resolved state plus the injected face.
 * @returns the two-column panel.
 */
function Surface({ sessionId, t, face, state, sent, onBack }: {
  readonly sessionId: string
  readonly t: Translate
  readonly face: PromptEnricherInjected
  readonly state: PromptEnricherState
  readonly sent: readonly SentPrompt[]
  readonly onBack?: () => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const editor = state.editor[sessionId] ?? ''
  const loadedDraft = state.loadedDraft[sessionId]
  const elicitation = state.elicitation[sessionId]
  const busy = state.busy[sessionId] === true

  const drafts = useMemo(
    () => state.drafts.filter(draft => draft.sessionId === sessionId),
    [state.drafts, sessionId],
  )
  const needle = query.trim().toLowerCase()
  const showSent = filter !== 'draft'
  const showDrafts = filter !== 'sent'
  // Newest first: the prompt just sent is what a reader looks for, and the
  // ascending log order buried it at the bottom of a scrolling list.
  const visibleSent = showSent
    ? sent.filter(item => matches(sentText(item, t), needle)).slice().reverse()
    : []
  const visibleDrafts = showDrafts
    ? drafts
      .filter(draft => matches(draft.text, needle))
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt)
    : []

  return (
    <>
      <div className="pl-col pl-col-list">
        <div className="pl-head">
          <span className="pl-title">{t('panel.title')}</span>
          <span className="pl-head-spacer" />
          <span className="pl-count">{t('panel.count', { n: sent.length, d: drafts.length })}</span>
        </div>

        <div className="pl-tools">
          <input
            className="pl-input"
            type="search"
            value={query}
            placeholder={t('search.placeholder')}
            onChange={event => { setQuery(event.target.value) }}
          />
          <div className="pl-seg" role="group">
            {(['all', 'sent', 'draft'] as const).map(value => (
              <button
                key={value}
                type="button"
                data-on={filter === value}
                onClick={() => { setFilter(value) }}
              >
                {t(`filter.${value}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="pl-list">
          {showSent && (
            <>
              <div className="pl-group-label">{t('list.sent')}</div>
              {visibleSent.length === 0
                ? <div className="pl-empty">{needle === '' ? t('list.empty.sent') : t('list.empty')}</div>
                : visibleSent.map(item => (
                  <SentRow key={item.seq} item={item} t={t} />
                ))}
            </>
          )}
          {showDrafts && (
            <>
              <div className="pl-group-label">{t('list.drafts')}</div>
              {visibleDrafts.length === 0
                ? <div className="pl-empty">{needle === '' ? t('list.empty.drafts') : t('list.empty')}</div>
                : visibleDrafts.map(draft => (
                  <DraftRow
                    key={draft.id}
                    draft={draft}
                    t={t}
                    active={loadedDraft === draft.id}
                    onLoad={() => { face.loadDraft(draft.id) }}
                    onDelete={() => { face.deleteDraft(draft.id) }}
                    onElicit={() => { face.startElicitation(draft.id) }}
                  />
                ))}
            </>
          )}
        </div>
      </div>

      <div className="pl-col pl-col-main">
        <div className={elicitation === undefined ? 'pl-editor-wrap' : 'pl-editor-wrap pl-editor-wrap-compact'}>
          <Editor
            value={editor}
            t={t}
            onChange={face.setEditor}
            loadSkills={face.loadSkills}
          />
          <div className="pl-actions">
            <button
              type="button"
              className="pl-btn pl-btn-primary"
              disabled={busy || editor.trim() === ''}
              onClick={() => {
                void face.sendEditor().then((sent) => { if (sent) onBack?.() })
              }}
            >
              {t('editor.send')}
            </button>
            <button
              type="button"
              className="pl-btn pl-btn-accent"
              disabled={busy || editor.trim() === ''}
              onClick={face.elicitEditor}
              title={t('editor.elicitHint')}
            >
              {t('editor.elicit')}
            </button>
            <button
              type="button"
              className="pl-btn"
              disabled={editor.trim() === ''}
              onClick={face.saveDraft}
            >
              {t('editor.save')}
            </button>
            {/* "New" only cleared the editor, which read as a no-op next to
                Save; the slot is better spent on the way out of the board. */}
            {onBack !== undefined && (
              <button type="button" className="pl-btn" onClick={onBack}>{t('panel.back')}</button>
            )}
            <span className="pl-hint">{t('editor.hint')}</span>
          </div>
          {state.error !== null && <div className="pl-error">{state.error}</div>}
        </div>
        {elicitation !== undefined && (
          <ElicitationBlock
            state={elicitation}
            t={t}
            busy={busy}
            onAnswer={face.answerElicitation}
            onWriteBack={face.writeBack}
            onFinish={face.finishElicitation}
          />
        )}
      </div>
    </>
  )
}

/** Display text of one sent prompt: text, or the image label when it has none. */
function sentText(item: SentPrompt, t: Translate): string {
  return item.text.trim() === '' ? t('sent.image', { n: item.images ?? 1 }) : item.text
}

/** One sent prompt: collapsed to a few lines, expandable to a bounded scroll. */
function SentRow({ item, t }: { readonly item: SentPrompt; readonly t: Translate }) {
  const [open, setOpen] = useState(false)
  const stamp = item.time > 0 ? new Date(item.time).toLocaleTimeString() : ''
  return (
    <div className="pl-item">
      <div className="pl-item-head">
        <span className="pl-item-time">{stamp === '' ? '' : t('sent.time', { time: stamp })}</span>
        <span className="pl-item-actions">
          {item.text.trim() !== '' && (
            <button type="button" className="pl-link" onClick={() => { setOpen(value => !value) }}>
              {t(open ? 'sent.showLess' : 'sent.showMore')}
            </button>
          )}
        </span>
      </div>
      <pre className={open ? 'pl-text pl-expanded' : 'pl-text pl-clamp'}>{sentText(item, t)}</pre>
    </div>
  )
}

/** One draft: editable, sendable, and the entry point for elicitation. */
function DraftRow({
  draft, t, active, onLoad, onDelete, onElicit,
}: {
  readonly draft: DraftRecord
  readonly t: Translate
  readonly active: boolean
  readonly onLoad: () => void
  readonly onDelete: () => void
  readonly onElicit: () => void
}) {
  return (
    <div className="pl-item" style={active ? { borderColor: 'var(--pl-accent)' } : undefined}>
      <div className="pl-item-head">
        <span className="pl-item-time">{t('draft.updated', { time: new Date(draft.updatedAt).toLocaleTimeString() })}</span>
        <span className="pl-item-actions">
          <button type="button" className="pl-link" onClick={onLoad}>{t('draft.load')}</button>
          <button type="button" className="pl-link" onClick={onElicit}>{t('draft.elicit')}</button>
          <button type="button" className="pl-link" onClick={onDelete}>{t('draft.delete')}</button>
        </span>
      </div>
      <pre className="pl-text pl-clamp">{draft.text}</pre>
    </div>
  )
}

/** The elicitation block: question card, prose fallback, or the final document. */
function ElicitationBlock({
  state, t, busy, onAnswer, onWriteBack, onFinish,
}: {
  readonly state: ElicitationState
  readonly t: Translate
  readonly busy: boolean
  readonly onAnswer: (text: string) => void
  readonly onWriteBack: () => void
  readonly onFinish: () => void
}) {
  const [answer, setAnswer] = useState('')
  const question: ElicitationQuestion | null = state.pending
  const lastRaw = [...state.turns].reverse().find(turn => turn.kind === 'raw')

  return (
    <div className="pl-elicit">
      <div className="pl-elicit-head">
        <span className="pl-title">{t('elicit.title')}</span>
        <span className="pl-head-spacer" />
        <button type="button" className="pl-link" onClick={onFinish}>{t('elicit.finish')}</button>
      </div>

      {state.phase === 'thinking' && <div className="pl-hint">{t('elicit.thinking')}</div>}

      {state.phase === 'failed' && (
        <div className="pl-error">{t('elicit.failed')}{state.error === null ? '' : `: ${state.error}`}</div>
      )}

      {state.phase === 'awaiting' && question !== null && (
        <>
          <div className="pl-q">{question.question}</div>
          {question.rationale !== undefined && (
            <div className="pl-rationale">{t('elicit.rationale')}：{question.rationale}</div>
          )}
          {question.options !== undefined && question.options.length > 0 && (
            <div className="pl-options">
              {question.options.map(option => (
                <button
                  key={option}
                  type="button"
                  className="pl-option"
                  data-on={answer === option}
                  onClick={() => { setAnswer(option) }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          {question.recommended !== undefined && (
            <div className="pl-hint">
              {t('elicit.recommended')}：{question.recommended}
              <button type="button" className="pl-link" style={{ marginLeft: 8 }} onClick={() => { setAnswer(question.recommended as string) }}>
                {t('elicit.accept')}
              </button>
            </div>
          )}
          <div className="pl-actions">
            <input
              className="pl-input"
              value={answer}
              placeholder={t('elicit.answerPlaceholder')}
              onChange={event => { setAnswer(event.target.value) }}
            />
            <button
              type="button"
              className="pl-btn pl-btn-primary"
              disabled={busy || answer.trim() === ''}
              onClick={() => {
                onAnswer(answer)
                setAnswer('')
              }}
            >
              {t('elicit.answer')}
            </button>
          </div>
        </>
      )}

      {state.phase === 'awaiting' && question === null && (
        <>
          <div className="pl-hint">{t('elicit.noQuestion')}</div>
          {lastRaw !== undefined && lastRaw.kind === 'raw' && (
            <pre className="pl-final-text">{lastRaw.text}</pre>
          )}
          <div className="pl-actions">
            <input
              className="pl-input"
              value={answer}
              placeholder={t('elicit.answerPlaceholder')}
              onChange={event => { setAnswer(event.target.value) }}
            />
            <button
              type="button"
              className="pl-btn pl-btn-primary"
              disabled={busy || answer.trim() === ''}
              onClick={() => {
                onAnswer(answer)
                setAnswer('')
              }}
            >
              {t('elicit.answer')}
            </button>
          </div>
        </>
      )}

      {(state.phase === 'final' || state.phase === 'done') && state.final !== null && (
        <>
          <div className="pl-group-label">{t('elicit.final')}</div>
          <pre className="pl-final-text">{state.final}</pre>
          <div className="pl-actions">
            <button type="button" className="pl-btn pl-btn-primary" onClick={onWriteBack}>
              {t('elicit.writeBack')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** Case-insensitive substring match; an empty needle matches everything. */
function matches(text: string, needle: string): boolean {
  return needle === '' || text.toLowerCase().includes(needle)
}
