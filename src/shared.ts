/**
 * Wire vocabulary shared by both halves of dsh-prompt-enricher.
 *
 * Types only — no runtime identity — so both the Node bundle and the browser
 * bundle can inline this module without duplicating state.
 */

/** Lifecycle of one elicitation, as the host tracks it. */
export type ElicitationPhase =
  /** The child is (or is about to be) producing its next message. */
  | 'thinking'
  /** A structured question is on screen, waiting for the user's ruling. */
  | 'awaiting'
  /** The child produced the final document. */
  | 'final'
  /** The child was released after the user accepted the outcome. */
  | 'done'
  /** Something failed; `error` carries the reason. */
  | 'failed'

/** One structured question emitted by the elicitation child. */
export interface ElicitationQuestion {
  readonly id: string
  readonly question: string
  /** The answer the model recommends; pre-selected in the panel. */
  readonly recommended?: string
  /** Closed choices, when the question is enumerable. */
  readonly options?: readonly string[]
  /** Why the recommendation holds — shown as secondary text. */
  readonly rationale?: string
}

/**
 * One turn of the elicitation transcript.
 *
 * `raw` is the degradation arm: the model answered with prose instead of the
 * agreed envelope. It must render (and be answerable) rather than stall the
 * flow.
 */
export type ElicitationTurn =
  | { readonly seq: number; readonly kind: 'question'; readonly raw: string; readonly question: ElicitationQuestion }
  | { readonly seq: number; readonly kind: 'final'; readonly document: string }
  | { readonly seq: number; readonly kind: 'raw'; readonly text: string }

/** Complete client-facing state of one elicitation. */
export interface ElicitationState {
  readonly elicitationId: string
  readonly childSessionId: string
  readonly phase: ElicitationPhase
  readonly turns: readonly ElicitationTurn[]
  /** The question awaiting an answer, when `phase` is `awaiting`. */
  readonly pending: ElicitationQuestion | null
  /** The final prompt document, when `phase` is `final` or `done`. */
  readonly final: string | null
  readonly error: string | null
}

/** Progress marker persisted in the browser, linking a draft to its child session. */
export interface ElicitationLink {
  readonly elicitationId: string
  readonly draftId: string
  readonly childSessionId: string
}
