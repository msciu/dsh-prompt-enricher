/**
 * dsh-prompt-enricher — host half.
 *
 * Owns everything the browser cannot: the elicitation child session. The
 * browser cannot create one (`subagents.startContinuable` is host-only and has
 * no Remote face) and cannot read its transcript (a subagent child is not a
 * listed session, so `ctx.sessions.binding` refuses it). So this half creates
 * the child, folds its messages into structured turns, and serves that fold
 * over a plugin-owned HTTP route — the same shape `dsh-vision-router` uses for
 * its `/_dsh/*` routes.
 *
 * The service faces below are declared structurally on purpose: this package
 * ships standalone, so it does not depend on the host type merges that only
 * exist inside the DSH monorepo.
 */
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { answerPrompt, elicitationSeed } from './grill-protocol.ts'
import { parseEnvelope, textOf } from './protocol.ts'
import { foldSentEvents, type SentEventLike } from './sent-fold.ts'
import type { ElicitationPhase, ElicitationQuestion, ElicitationState, ElicitationTurn } from './shared.ts'

/** Plugin id used by the loader row and by every diagnostic below. */
export const name = 'dsh-prompt-enricher'

/** Route prefix owned by this plugin. */
export const ROUTE_BASE = '/_dsh/prompt-enricher'

/** Largest accepted request body; the document plus a ruling. */
const MAX_BODY_BYTES = 1 << 18

/** A live text block in prompt content. */
interface TextPart {
  readonly type: 'text'
  readonly text: string
}

/** The direct parent Agent this plugin addresses. */
interface AgentLike {
  readonly id: string
}

/** The continuable-child start contract shared by both DSH generations. */
interface ActivationSpec {
  readonly provider: string
  readonly label: string
  readonly request: {
    readonly parent: AgentLike
    readonly prompt: readonly TextPart[]
  }
  readonly signal: AbortSignal
}

/**
 * Subagent operations this half uses.
 *
 * 0.2 renamed the lifecycle verbs (`startContinuable` → `startActivation`,
 * `drainContinuableChildren` → `drainChildren`) without changing their
 * arguments. Both spellings are declared optional and resolved at call time, so
 * one build runs on either host generation instead of throwing at the first
 * click. `sendMessage` kept its name and signature.
 */
interface SubagentsFace {
  /** Registered provider names; `spawn` is the fresh-child backend. */
  list(): readonly string[]
  /** 0.2 spelling. */
  startActivation?(spec: ActivationSpec): Promise<{ readonly childId: string }>
  /** 0.1 spelling, same arguments. */
  startContinuable?(spec: ActivationSpec): Promise<{ readonly childId: string }>
  sendMessage(
    sender: AgentLike,
    targetId: string,
    content: readonly TextPart[],
    options: { readonly signal: AbortSignal },
  ): Promise<unknown>
  /** 0.2 spelling. */
  drainChildren?(parent: AgentLike, childIds: readonly string[]): Promise<void>
  /** 0.1 spelling. */
  drainContinuableChildren?(parent: AgentLike, childIds: readonly string[]): Promise<void>
}

/** Live-agent lookup. */
interface AgentsFace {
  get(id: string): AgentLike | undefined
}

/** One exact-path registration seam. */
interface WebServerFace {
  register(route: {
    readonly kind: 'exact'
    readonly path: string
    readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** Cordis context surface used here (the parts this plugin touches). */
interface HostContext {
  effect(execute: () => () => void, label?: string): unknown
  on(event: string, listener: (...args: any[]) => void, options?: { global?: boolean }): () => void
  inject(deps: readonly string[], callback: (ctx: HostContext) => void): unknown
  get(key: string): unknown
  webServer?: WebServerFace
}

/** Host-side record of one elicitation. */
interface Elicitation {
  readonly elicitationId: string
  readonly parentSessionId: string
  readonly childSessionId: string
  phase: ElicitationPhase
  turns: ElicitationTurn[]
  pending: ElicitationQuestion | null
  final: string | null
  error: string | null
  /** Whether the current child turn produced a recognisable message yet. */
  absorbedThisTurn: boolean
}

/**
 * Install the routes and the child-session fold.
 * @param ctx - plugin context (root scope).
 */
export function apply(ctx: HostContext): void {
  // A third-party row must never be able to abort profile startup: whatever
  // happens in here (a host service that changed shape, an event name that no
  // longer exists) is this plugin's problem alone. The plugin simply stays
  // inert and its routes stay unregistered.
  try {
    install(ctx)
  } catch (error) {
    ctx.logger?.warn?.(`dsh-prompt-enricher: 未启用（${messageOf(error)}）`)
  }
}

/**
 * Register the session/event fold and the host routes.
 * @param ctx - plugin context (root scope).
 */
function install(ctx: HostContext): void {
  const byId = new Map<string, Elicitation>()
  const byChild = new Map<string, Elicitation>()

  // The child's transcript is folded here, not in the browser. A post-commit
  // append feed scoped globally so this root listener still sees a subagent
  // child's events.
  ctx.on('session/event', (session: { id: string }, event: { type: string; data?: any }) => {
    const el = byChild.get(session.id)
    if (el === undefined) return
    if (event.type === 'turn/start') {
      el.phase = 'thinking'
      el.absorbedThisTurn = false
      return
    }
    if (event.type === 'assistant/message') {
      const text = textOf(event.data?.message?.content)
      if (text.trim() === '') return
      el.absorbedThisTurn = true
      absorb(el, text)
      return
    }
    if (event.type === 'turn/end') {
      if (el.phase === 'thinking' && !el.absorbedThisTurn) {
        // The turn closed without producing anything usable. Surface it
        // instead of leaving the panel spinning forever.
        el.phase = 'failed'
        el.error = '澄清会话结束了本轮但没有返回内容。'
      }
      return
    }
  }, { global: true })

  ctx.inject(['webServer'], (webCtx) => {
    const register = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): void => {
      webCtx.effect(
        () => (webCtx.webServer as WebServerFace).register({ kind: 'exact', path, handler }),
        `dsh-prompt-enricher: ${path}`,
      )
    }

    register(`${ROUTE_BASE}/start`, async (req, res) => {
      if (guard(req, res, 'POST')) return
      const body = await readJson(req, res)
      if (body === undefined) return

      const sessionId = stringField(body, 'sessionId')
      const document = stringField(body, 'document')
      if (sessionId === undefined || document === undefined || document.trim() === '') {
        send(res, 400, { error: 'sessionId 与 document 都必须是非空字符串' })
        return
      }

      const subagents = ctx.get('subagents') as SubagentsFace | undefined
      const agents = ctx.get('agents') as AgentsFace | undefined
      if (subagents === undefined || agents === undefined) {
        send(res, 503, { error: 'subagents/agents 服务不可用，无法启动澄清会话' })
        return
      }
      const parent = agents.get(sessionId)
      if (parent === undefined) {
        send(res, 409, { error: `会话 ${sessionId} 不在线，无法启动澄清` })
        return
      }
      const provider = pickProvider(subagents.list())
      if (provider === undefined) {
        send(res, 503, { error: '没有已注册的 subagent provider' })
        return
      }

      try {
        const start = subagents.startActivation ?? subagents.startContinuable
        if (start === undefined) {
          send(res, 503, {
            error: '当前 DSH 的 subagents 服务既没有 startActivation 也没有 startContinuable；插件与该版本不兼容',
          })
          return
        }
        const started = await start.call(subagents, {
          provider,
          label: 'prompt-elicitation',
          request: {
            parent,
            prompt: [{ type: 'text', text: elicitationSeed(document) }],
          },
          signal: AbortSignal.timeout(30_000),
        })
        const el: Elicitation = {
          elicitationId: randomUUID(),
          parentSessionId: sessionId,
          childSessionId: started.childId,
          phase: 'thinking',
          turns: [],
          pending: null,
          final: null,
          error: null,
          absorbedThisTurn: false,
        }
        byId.set(el.elicitationId, el)
        byChild.set(el.childSessionId, el)
        send(res, 200, toState(el))
      } catch (error) {
        send(res, 500, { error: messageOf(error) })
      }
    })

    register(`${ROUTE_BASE}/answer`, async (req, res) => {
      if (guard(req, res, 'POST')) return
      const body = await readJson(req, res)
      if (body === undefined) return
      const elicitationId = stringField(body, 'elicitationId')
      const answer = stringField(body, 'answer')
      if (elicitationId === undefined || answer === undefined || answer.trim() === '') {
        send(res, 400, { error: 'elicitationId 与 answer 都必须是非空字符串' })
        return
      }
      const el = byId.get(elicitationId)
      if (el === undefined) {
        send(res, 404, { error: '澄清会话不存在' })
        return
      }
      if (el.phase !== 'awaiting') {
        send(res, 409, { error: `当前阶段是 ${el.phase}，不能回答问题` })
        return
      }

      const subagents = ctx.get('subagents') as SubagentsFace | undefined
      const agents = ctx.get('agents') as AgentsFace | undefined
      const parent = agents?.get(el.parentSessionId)
      if (subagents === undefined || parent === undefined) {
        send(res, 503, { error: '父会话不在线，无法继续澄清' })
        return
      }

      try {
        await subagents.sendMessage(
          parent,
          el.childSessionId,
          [{ type: 'text', text: answerPrompt(answer) }],
          { signal: AbortSignal.timeout(30_000) },
        )
        el.pending = null
        el.phase = 'thinking'
        el.absorbedThisTurn = false
        send(res, 200, toState(el))
      } catch (error) {
        send(res, 500, { error: messageOf(error) })
      }
    })

    register(`${ROUTE_BASE}/finish`, async (req, res) => {
      if (guard(req, res, 'POST')) return
      const body = await readJson(req, res)
      if (body === undefined) return
      const elicitationId = stringField(body, 'elicitationId')
      if (elicitationId === undefined) {
        send(res, 400, { error: 'elicitationId 必须是非空字符串' })
        return
      }
      const el = byId.get(elicitationId)
      if (el === undefined) {
        send(res, 404, { error: '澄清会话不存在' })
        return
      }
      el.phase = 'done'
      el.pending = null
      const subagents = ctx.get('subagents') as SubagentsFace | undefined
      const agents = ctx.get('agents') as AgentsFace | undefined
      const parent = agents?.get(el.parentSessionId)
      if (subagents !== undefined && parent !== undefined) {
        // Releasing is best-effort: the child may already be gone, and the
        // user's outcome must not depend on it.
        const drain = subagents.drainChildren ?? subagents.drainContinuableChildren
        try {
          await drain?.call(subagents, parent, [el.childSessionId])
        } catch {
          /* the reply is the user's, not the release outcome's */
        }
      }
      byChild.delete(el.childSessionId)
      send(res, 200, toState(el))
    })

    register(`${ROUTE_BASE}/state`, async (req, res) => {
      if (guard(req, res, 'GET')) return
      const url = new URL(String((req as { url?: string }).url ?? ''), 'http://localhost')
      const elicitationId = url.searchParams.get('elicitationId')
      const sessionId = url.searchParams.get('sessionId')
      const el = elicitationId !== null
        ? byId.get(elicitationId)
        : [...byId.values()].find(candidate => candidate.parentSessionId === sessionId)
      if (el === undefined) {
        send(res, 404, { error: '澄清会话不存在' })
        return
      }
      send(res, 200, toState(el))
    })

    // The complete prompt history, read from the session's own log.
    //
    // The browser's event window only holds the most recent page (50 messages,
    // `PAGE_MESSAGES`), so a panel that derived "sent" from the window alone
    // lost every older prompt — the reported 数据不全. The host owns the whole
    // log: a live Session exposes its frozen append-only `events` (including
    // the tail the write-behind has not flushed), and a non-live one is read
    // from sessionPersistence. Both fold through the same rule the browser uses
    // (`src/sent-fold.ts`), so merging the two sources cannot double-count.
    register(`${ROUTE_BASE}/sent`, async (req, res) => {
      if (guard(req, res, 'GET')) return
      const url = new URL(String((req as { url?: string }).url ?? ''), 'http://localhost')
      const sessionId = url.searchParams.get('sessionId')
      if (sessionId === null || sessionId === '') {
        send(res, 400, { error: 'sessionId 必须是非空字符串' })
        return
      }
      try {
        const events = await readSessionEvents(ctx, sessionId)
        if (events === undefined) {
          send(res, 503, { error: '当前 DSH 没有可读取会话日志的服务（sessions / sessionPersistence）' })
          return
        }
        send(res, 200, { prompts: foldSentEvents(events) })
      } catch (error) {
        send(res, 500, { error: `读取会话历史失败: ${messageOf(error)}` })
      }
    })

    // The skills registry is a Host Service with no Model-facing Remote face on
    // this surface, so the browser half cannot reach it directly. This route is
    // the only path that makes the editor's "/" picker show the same catalog the
    // composer does.
    //
    // The catalog is session-addressed: a Session's cwd and agent preset select
    // which skill layers are visible, and an agent preset may mount its own
    // registry. Mirroring that here is what keeps the picker from degrading to
    // the built-in skills only.
    register(`${ROUTE_BASE}/skills`, async (req, res) => {
      if (guard(req, res, 'GET')) return
      const url = new URL(String((req as { url?: string }).url ?? ''), 'http://localhost')
      const sessionId = url.searchParams.get('sessionId')
      const agents = ctx.get('agents') as AgentsFace | undefined
      const agent = sessionId === null ? undefined : agents?.get(sessionId as never)

      // An agent preset can shadow the host registry for its own Sessions.
      const presets = ctx.get('agentPresets') as PresetsFace | undefined
      const scoped = agent === undefined ? undefined : presets?.serviceFor(agent, 'skills')
      const registry = (scoped ?? ctx.get('skills')) as SkillsFace | undefined
      if (registry?.list === undefined) {
        send(res, 503, { error: '当前 DSH 没有可用的 skills 服务' })
        return
      }

      let cwd: string | undefined
      if (agent !== undefined) {
        const workingDirectory = ctx.get('workingDirectory') as WorkingDirectoryFace | undefined
        try {
          cwd = await workingDirectory?.ensure(agent, AbortSignal.timeout(5_000))
        } catch {
          /* the catalog falls back to its own default directory */
        }
      }

      try {
        const entries = await registry.list({ cwd, scope: agent })
        send(res, 200, {
          skills: entries
            .filter(entry => entry.invocation?.userInvocable === true)
            .map(entry => ({
              name: entry.name,
              description: typeof entry.description === 'string' ? entry.description : '',
            })),
        })
      } catch (error) {
        send(res, 500, { error: `读取技能列表失败: ${messageOf(error)}` })
      }
    })
  })
}

/** The slice of the Host skills registry this half reads. */
interface SkillsFace {
  list(options: { cwd?: string; scope?: unknown }): Promise<readonly SkillEntryLike[]>
}

/** Live SessionStore face: one live session exposes its complete in-memory log. */
interface SessionsFace {
  get(id: unknown): { readonly events?: readonly SentEventLike[] } | undefined
}

/** Durable log reader for a session that is not live in this process. */
interface SessionPersistenceFace {
  inspect(id: unknown, signal?: AbortSignal): Promise<{ readonly events?: readonly SentEventLike[] }>
}

/**
 * Read one session's complete event log.
 *
 * A live Session wins: `events` is the whole append-only log, already frozen,
 * and includes events the write-behind has not flushed yet. A session that is
 * not live falls back to the durable backend; without either reader the route
 * reports 503 and the browser keeps the tail it already has.
 * @param ctx - plugin context.
 * @param sessionId - session to read.
 * @returns events, or undefined when this host exposes no reader.
 */
async function readSessionEvents(ctx: HostContext, sessionId: string): Promise<readonly SentEventLike[] | undefined> {
  const live = (ctx.get('sessions') as SessionsFace | undefined)?.get(sessionId)
  if (Array.isArray(live?.events)) return live.events
  const persistence = ctx.get('sessionPersistence') as SessionPersistenceFace | undefined
  if (persistence?.inspect === undefined) return undefined
  const inspection = await persistence.inspect(sessionId, AbortSignal.timeout(20_000))
  return Array.isArray(inspection.events) ? inspection.events : []
}

/** One skill, as far as the picker needs it. */
interface SkillEntryLike {
  readonly name: string
  readonly description?: unknown
  readonly invocation?: { readonly userInvocable?: boolean }
}

/** Agent-preset registry lookup. */
interface PresetsFace {
  serviceFor(agent: unknown, name: 'skills'): SkillsFace | undefined
}

/** Live-agent lookup. */
interface AgentsFaceLike {
  get(id: unknown): unknown
}

/** Effective working directory of one agent. */
interface WorkingDirectoryFace {
  ensure(agent: unknown, signal?: AbortSignal): Promise<string>
}

/** Fold one absorbed child message into the record. */
function absorb(el: Elicitation, text: string): void {
  const envelope = parseEnvelope(text)
  const seq = el.turns.length
  if (envelope.kind === 'question') {
    el.turns.push({ seq, kind: 'question', raw: envelope.raw, question: envelope.question })
    el.pending = envelope.question
    el.phase = 'awaiting'
    return
  }
  if (envelope.kind === 'final') {
    el.turns.push({ seq, kind: 'final', document: envelope.document })
    el.pending = null
    el.final = envelope.document
    el.phase = 'final'
    return
  }
  // Degradation arm: prose instead of the agreed envelope. The flow stays
  // operable — the panel renders it and the user can still answer.
  el.turns.push({ seq, kind: 'raw', text: envelope.text })
  el.pending = null
  el.phase = 'awaiting'
}

/** Project the internal record onto the wire shape. */
function toState(el: Elicitation): ElicitationState {
  return {
    elicitationId: el.elicitationId,
    childSessionId: el.childSessionId,
    phase: el.phase,
    turns: [...el.turns],
    pending: el.pending,
    final: el.final,
    error: el.error,
  }
}

/** Prefer `spawn`: a fresh child never inherits the parent conversation. */
function pickProvider(names: readonly string[]): string | undefined {
  return names.includes('spawn') ? 'spawn' : names[0]
}

/**
 * Same-origin guard plus method check.
 * @returns true when the response was already written (the caller must stop).
 */
function guard(req: IncomingMessage, res: ServerResponse, method: 'GET' | 'POST'): boolean {
  const site = String(req.headers['sec-fetch-site'] ?? '')
  if (site !== '' && site !== 'same-origin' && site !== 'none') {
    send(res, 403, { error: 'cross-origin request rejected' })
    return true
  }
  if (req.method !== method) {
    res.setHeader('Allow', method)
    send(res, 405, { error: `method must be ${method}` })
    return true
  }
  return false
}

/** Read and parse a JSON body; writes the failure response and returns undefined. */
async function readJson(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of req) {
      const buffer = chunk as Buffer
      size += buffer.length
      if (size > MAX_BODY_BYTES) {
        send(res, 413, { error: 'request body too large' })
        return undefined
      }
      chunks.push(buffer)
    }
  } catch {
    send(res, 400, { error: 'could not read request body' })
    return undefined
  }
  if (chunks.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      send(res, 400, { error: 'body must be a JSON object' })
      return undefined
    }
    return parsed as Record<string, unknown>
  } catch {
    send(res, 400, { error: 'body must be valid JSON' })
    return undefined
  }
}

/** Write one JSON response. */
function send(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** Read an optional string field. */
function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  return typeof value === 'string' ? value : undefined
}

/** Human-readable error text for a route's failure response. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
