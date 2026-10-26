/**
 * Envelope parser for the elicitation child's output.
 *
 * The child is instructed to answer with exactly one JSON code block
 * (see `grill-protocol.ts`). Models drift, so this parser is written to
 * degrade rather than throw: anything it cannot recognise becomes a `raw`
 * turn, which the panel renders as prose and still lets the user answer.
 * Stalling the flow on a formatting slip is the one failure this plugin must
 * not have.
 */
import type { ElicitationQuestion } from './shared.ts'

/** What one child message was understood to be. */
export type Envelope =
  | { readonly kind: 'question'; readonly question: ElicitationQuestion; readonly raw: string }
  | { readonly kind: 'final'; readonly document: string }
  | { readonly kind: 'raw'; readonly text: string }

/** Fenced block, with or without a `json` language tag. */
const FENCE = /```(?:json|JSON)?\s*([\s\S]*?)```/g

/**
 * Read one child message.
 * @param text - the assistant message's concatenated text blocks.
 * @returns the recognised envelope, or the `raw` degradation.
 */
export function parseEnvelope(text: string): Envelope {
  const candidates = collectCandidates(text)
  // Last recognised block wins: the child may restate an earlier question
  // before asking the next one, and only the tail is the live instruction.
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const envelope = recognise(candidates[index] as string)
    if (envelope !== null) return envelope
  }
  return { kind: 'raw', text }
}

/** Every substring that could be the envelope, in document order. */
function collectCandidates(text: string): string[] {
  const candidates: string[] = []
  for (const match of text.matchAll(FENCE)) {
    const body = match[1]
    if (body !== undefined && body.trim() !== '') candidates.push(body.trim())
  }
  // A child that forgot the fence but emitted a bare object still counts.
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) candidates.push(trimmed)
  return candidates
}

/** Parse one candidate into an envelope, or null when it is not one. */
function recognise(candidate: string): Envelope | null {
  let value: unknown
  try {
    value = JSON.parse(candidate)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record['kind'] === 'question') {
    const question = readQuestion(record)
    return question === null ? null : { kind: 'question', question, raw: candidate }
  }
  if (record['kind'] === 'final') {
    const document = record['document']
    if (typeof document !== 'string' || document.trim() === '') return null
    return { kind: 'final', document }
  }
  return null
}

/** Normalise one question object; missing `question` text disqualifies it. */
function readQuestion(record: Record<string, unknown>): ElicitationQuestion | null {
  const text = record['question']
  if (typeof text !== 'string' || text.trim() === '') return null
  const id = typeof record['id'] === 'string' && record['id'] !== '' ? record['id'] : 'q?'
  const recommended = typeof record['recommended'] === 'string' ? record['recommended'] : undefined
  const rationale = typeof record['rationale'] === 'string' ? record['rationale'] : undefined
  const options = Array.isArray(record['options'])
    ? record['options'].filter((option): option is string => typeof option === 'string' && option.trim() !== '')
    : undefined
  return {
    id,
    question: text,
    ...(recommended === undefined ? {} : { recommended }),
    ...(rationale === undefined ? {} : { rationale }),
    ...(options === undefined || options.length === 0 ? {} : { options }),
  }
}

/**
 * Concatenate the text blocks of one message's content.
 * @param content - message content blocks.
 * @returns the visible text, blocks joined by a blank line.
 */
export function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const record = block as Record<string, unknown>
    if (record['type'] === 'text' && typeof record['text'] === 'string') parts.push(record['text'])
  }
  return parts.join('\n\n')
}
