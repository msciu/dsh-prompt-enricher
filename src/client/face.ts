/**
 * The injected business face the prompt-enricher page receives.
 *
 * Every action closes over the page's own session id, so the component never
 * handles a session argument and cannot address the wrong session.
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PromptEnricherStore } from './store.ts'
import type { SentPrompt } from './sent.ts'

/** One skill offered by the editor's "/" picker. */
export interface SkillOption {
  readonly name: string
  readonly description: string
}

export interface PromptEnricherInjected {
  hooks: {
    /** Persisted panel state (drafts, editor buffers, mirrors). */
    promptEnricher: PromptEnricherStore
    /** Sent prompts derived from this session's event window. */
    promptSent: ObservableSnapshot<readonly SentPrompt[]>
  }
  /** Replace the editor buffer for this session. */
  setEditor(text: string): void
  /** Deliver the editor buffer to the session; resolves true when it was accepted. */
  sendEditor(): Promise<boolean>
  /** Persist the editor buffer as a draft (updating the loaded one when there is one). */
  saveDraft(): void
  /** Load one draft into the editor. */
  loadDraft(id: string): void
  /** Delete one draft. */
  deleteDraft(id: string): void
  /** Re-read the host's elicitation state for this session. */
  refresh(): void
  /** Switch this session's body to the board (the blank-session entry's action). */
  openBoard(): void
  /** Close the board opened from the blank-session entry. */
  closeBoard(): void
  /** Start an elicitation for one draft. */
  startElicitation(id: string): void
  /** Save the editor buffer as a draft, then start an elicitation on it. */
  elicitEditor(): void
  /** Read the skill catalog for the editor's "/" picker. */
  loadSkills(): Promise<readonly SkillOption[]>
  /** Deliver a ruling to the elicitation child. */
  answerElicitation(text: string): void
  /** Copy the final document back into the editor as a draft. */
  writeBack(): void
  /** Release the elicitation child. */
  finishElicitation(): void
}
