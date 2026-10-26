import { randomUUID } from "node:crypto";
//#region src/grill-protocol.ts
/**
* The elicitation child's instruction set.
*
* `GRILL_BODY` is a VERBATIM copy of the body (everything after the YAML
* frontmatter) of `grill-me`'s SKILL.md. It is inlined rather than read from
* the skills registry on purpose: the child must get the same instruction on
* every host, even when the user has no local skill installed or a different
* version of it. Changing it changes the plugin's model behaviour contract, so
* `src/protocol.ts`'s parser must be re-checked in the same change.
*/
/** Verbatim body of `grill-me` (SKILL.md, frontmatter excluded). */
const GRILL_BODY = `围绕这个计划的每个方面持续追问我，直到我们达成共同理解。沿着 design tree 的每个分支走下去，一次解决一个决策之间的依赖。每个问题都提供你的推荐答案。

一次只问一个问题。

如果某个问题可以通过探索 codebase 回答，就去探索 codebase。`;
/**
* The envelope contract appended after {@link GRILL_BODY}.
*
* It exists because the panel renders questions as cards: the answer shape has
* to be machine-readable. It also names the exit condition, so the child knows
* when to stop asking and emit the final document.
*/
const ENVELOPE_CONTRACT = `## 输出格式

你正在帮助用户澄清一份**提示词文档**。用户会分多轮回答你的问题。

每次回复**只输出一个** \`\`\`json 代码块，不要输出任何其他文字。

提出下一个问题时：

\`\`\`json
{
  "kind": "question",
  "id": "q1",
  "question": "要问的问题，一次只问一个",
  "recommended": "你推荐的答案",
  "options": ["可选项一", "可选项二"],
  "rationale": "为什么这样推荐，引用文档里的具体依据"
}
\`\`\`

\`options\` 可以省略（开放式问题）。\`recommended\` 与 \`rationale\` 必填。

当所有影响实现的歧义都已消除，输出最终文档：

\`\`\`json
{
  "kind": "final",
  "document": "完整的、可直接使用的提示词文档全文（Markdown）"
}
\`\`\`

要求：

- 一次只问一个问题，问最有信息量的那个。
- 每个问题都要给出推荐答案和理由；不要只提问。
- 提问前先读用户给的文档；能从文档本身推断出来的，不要问用户。
- 只输出上述 JSON，不要有前后缀说明。
- \`final\` 里的 \`document\` 是完整文档，不是修改说明。`;
/** Build the child's opening message: the protocol, then the document under review. */
function elicitationSeed(document) {
	return [
		GRILL_BODY,
		"",
		ENVELOPE_CONTRACT,
		"",
		"<待澄清的提示词文档>",
		document,
		"</待澄清的提示词文档>",
		"",
		"现在开始：提出第一个问题。"
	].join("\n");
}
/** The instruction prepended to each user ruling delivered to the child. */
function answerPrompt(answer) {
	return `我的回答：${answer}\n\n请继续：提出下一个问题，或输出最终文档。`;
}
//#endregion
//#region src/protocol.ts
/** Fenced block, with or without a `json` language tag. */
const FENCE = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
/**
* Read one child message.
* @param text - the assistant message's concatenated text blocks.
* @returns the recognised envelope, or the `raw` degradation.
*/
function parseEnvelope(text) {
	const candidates = collectCandidates(text);
	for (let index = candidates.length - 1; index >= 0; index -= 1) {
		const envelope = recognise(candidates[index]);
		if (envelope !== null) return envelope;
	}
	return {
		kind: "raw",
		text
	};
}
/** Every substring that could be the envelope, in document order. */
function collectCandidates(text) {
	const candidates = [];
	for (const match of text.matchAll(FENCE)) {
		const body = match[1];
		if (body !== void 0 && body.trim() !== "") candidates.push(body.trim());
	}
	const trimmed = text.trim();
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) candidates.push(trimmed);
	return candidates;
}
/** Parse one candidate into an envelope, or null when it is not one. */
function recognise(candidate) {
	let value;
	try {
		value = JSON.parse(candidate);
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const record = value;
	if (record["kind"] === "question") {
		const question = readQuestion(record);
		return question === null ? null : {
			kind: "question",
			question,
			raw: candidate
		};
	}
	if (record["kind"] === "final") {
		const document = record["document"];
		if (typeof document !== "string" || document.trim() === "") return null;
		return {
			kind: "final",
			document
		};
	}
	return null;
}
/** Normalise one question object; missing `question` text disqualifies it. */
function readQuestion(record) {
	const text = record["question"];
	if (typeof text !== "string" || text.trim() === "") return null;
	const id = typeof record["id"] === "string" && record["id"] !== "" ? record["id"] : "q?";
	const recommended = typeof record["recommended"] === "string" ? record["recommended"] : void 0;
	const rationale = typeof record["rationale"] === "string" ? record["rationale"] : void 0;
	const options = Array.isArray(record["options"]) ? record["options"].filter((option) => typeof option === "string" && option.trim() !== "") : void 0;
	return {
		id,
		question: text,
		...recommended === void 0 ? {} : { recommended },
		...rationale === void 0 ? {} : { rationale },
		...options === void 0 || options.length === 0 ? {} : { options }
	};
}
/**
* Concatenate the text blocks of one message's content.
* @param content - message content blocks.
* @returns the visible text, blocks joined by a blank line.
*/
function textOf(content) {
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue;
		const record = block;
		if (record["type"] === "text" && typeof record["text"] === "string") parts.push(record["text"]);
	}
	return parts.join("\n\n");
}
//#endregion
//#region src/sent-fold.ts
/**
* Fold durable events into the sent list.
* @param events - events in seq order.
* @returns user prompts, oldest first.
*/
function foldSentEvents(events) {
	const out = [];
	for (const event of events) {
		if (event.type !== "user/message") continue;
		if (event.surfaceOp !== "append") continue;
		if (event.data?.source?.kind !== "user") continue;
		if (typeof event.seq !== "number") continue;
		const content = event.data.content;
		const text = textOfContent(content);
		const images = countImages(content);
		if (text.trim() === "" && images === 0) continue;
		out.push({
			seq: event.seq,
			time: typeof event.time === "number" ? event.time : 0,
			text,
			...images > 0 ? { images } : {}
		});
	}
	return out;
}
/**
* Concatenate the text blocks of one content array.
* @param content - a `PromptContentPart[]`-shaped value, or anything else.
* @returns the joined text, or an empty string.
*/
function textOfContent(content) {
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue;
		const record = block;
		if (record["type"] === "text" && typeof record["text"] === "string") parts.push(record["text"]);
	}
	return parts.join("\n\n");
}
/**
* Count image parts of one content array.
* @param content - a `PromptContentPart[]`-shaped value, or anything else.
* @returns the number of image blocks.
*/
function countImages(content) {
	if (!Array.isArray(content)) return 0;
	let images = 0;
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue;
		if (block["type"] === "image") images += 1;
	}
	return images;
}
//#endregion
//#region src/index.ts
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
/** Plugin id used by the loader row and by every diagnostic below. */
const name = "dsh-prompt-enricher";
/** Route prefix owned by this plugin. */
const ROUTE_BASE = "/_dsh/prompt-enricher";
/** Largest accepted request body; the document plus a ruling. */
const MAX_BODY_BYTES = 1 << 18;
/**
* Install the routes and the child-session fold.
* @param ctx - plugin context (root scope).
*/
function apply(ctx) {
	try {
		install(ctx);
	} catch (error) {
		ctx.logger?.warn?.(`dsh-prompt-enricher: 未启用（${messageOf(error)}）`);
	}
}
/**
* Register the session/event fold and the host routes.
* @param ctx - plugin context (root scope).
*/
function install(ctx) {
	const byId = /* @__PURE__ */ new Map();
	const byChild = /* @__PURE__ */ new Map();
	ctx.on("session/event", (session, event) => {
		const el = byChild.get(session.id);
		if (el === void 0) return;
		if (event.type === "turn/start") {
			el.phase = "thinking";
			el.absorbedThisTurn = false;
			return;
		}
		if (event.type === "assistant/message") {
			const text = textOf(event.data?.message?.content);
			if (text.trim() === "") return;
			el.absorbedThisTurn = true;
			absorb(el, text);
			return;
		}
		if (event.type === "turn/end") {
			if (el.phase === "thinking" && !el.absorbedThisTurn) {
				el.phase = "failed";
				el.error = "澄清会话结束了本轮但没有返回内容。";
			}
			return;
		}
	}, { global: true });
	ctx.inject(["webServer"], (webCtx) => {
		const register = (path, handler) => {
			webCtx.effect(() => webCtx.webServer.register({
				kind: "exact",
				path,
				handler
			}), `dsh-prompt-enricher: ${path}`);
		};
		register(`${ROUTE_BASE}/start`, async (req, res) => {
			if (guard(req, res, "POST")) return;
			const body = await readJson(req, res);
			if (body === void 0) return;
			const sessionId = stringField(body, "sessionId");
			const document = stringField(body, "document");
			if (sessionId === void 0 || document === void 0 || document.trim() === "") {
				send(res, 400, { error: "sessionId 与 document 都必须是非空字符串" });
				return;
			}
			const subagents = ctx.get("subagents");
			const agents = ctx.get("agents");
			if (subagents === void 0 || agents === void 0) {
				send(res, 503, { error: "subagents/agents 服务不可用，无法启动澄清会话" });
				return;
			}
			const parent = agents.get(sessionId);
			if (parent === void 0) {
				send(res, 409, { error: `会话 ${sessionId} 不在线，无法启动澄清` });
				return;
			}
			const provider = pickProvider(subagents.list());
			if (provider === void 0) {
				send(res, 503, { error: "没有已注册的 subagent provider" });
				return;
			}
			try {
				const start = subagents.startActivation ?? subagents.startContinuable;
				if (start === void 0) {
					send(res, 503, { error: "当前 DSH 的 subagents 服务既没有 startActivation 也没有 startContinuable；插件与该版本不兼容" });
					return;
				}
				const started = await start.call(subagents, {
					provider,
					label: "prompt-elicitation",
					request: {
						parent,
						prompt: [{
							type: "text",
							text: elicitationSeed(document)
						}]
					},
					signal: AbortSignal.timeout(3e4)
				});
				const el = {
					elicitationId: randomUUID(),
					parentSessionId: sessionId,
					childSessionId: started.childId,
					phase: "thinking",
					turns: [],
					pending: null,
					final: null,
					error: null,
					absorbedThisTurn: false
				};
				byId.set(el.elicitationId, el);
				byChild.set(el.childSessionId, el);
				send(res, 200, toState(el));
			} catch (error) {
				send(res, 500, { error: messageOf(error) });
			}
		});
		register(`${ROUTE_BASE}/answer`, async (req, res) => {
			if (guard(req, res, "POST")) return;
			const body = await readJson(req, res);
			if (body === void 0) return;
			const elicitationId = stringField(body, "elicitationId");
			const answer = stringField(body, "answer");
			if (elicitationId === void 0 || answer === void 0 || answer.trim() === "") {
				send(res, 400, { error: "elicitationId 与 answer 都必须是非空字符串" });
				return;
			}
			const el = byId.get(elicitationId);
			if (el === void 0) {
				send(res, 404, { error: "澄清会话不存在" });
				return;
			}
			if (el.phase !== "awaiting") {
				send(res, 409, { error: `当前阶段是 ${el.phase}，不能回答问题` });
				return;
			}
			const subagents = ctx.get("subagents");
			const parent = ctx.get("agents")?.get(el.parentSessionId);
			if (subagents === void 0 || parent === void 0) {
				send(res, 503, { error: "父会话不在线，无法继续澄清" });
				return;
			}
			try {
				await subagents.sendMessage(parent, el.childSessionId, [{
					type: "text",
					text: answerPrompt(answer)
				}], { signal: AbortSignal.timeout(3e4) });
				el.pending = null;
				el.phase = "thinking";
				el.absorbedThisTurn = false;
				send(res, 200, toState(el));
			} catch (error) {
				send(res, 500, { error: messageOf(error) });
			}
		});
		register(`${ROUTE_BASE}/finish`, async (req, res) => {
			if (guard(req, res, "POST")) return;
			const body = await readJson(req, res);
			if (body === void 0) return;
			const elicitationId = stringField(body, "elicitationId");
			if (elicitationId === void 0) {
				send(res, 400, { error: "elicitationId 必须是非空字符串" });
				return;
			}
			const el = byId.get(elicitationId);
			if (el === void 0) {
				send(res, 404, { error: "澄清会话不存在" });
				return;
			}
			el.phase = "done";
			el.pending = null;
			const subagents = ctx.get("subagents");
			const parent = ctx.get("agents")?.get(el.parentSessionId);
			if (subagents !== void 0 && parent !== void 0) {
				const drain = subagents.drainChildren ?? subagents.drainContinuableChildren;
				try {
					await drain?.call(subagents, parent, [el.childSessionId]);
				} catch {}
			}
			byChild.delete(el.childSessionId);
			send(res, 200, toState(el));
		});
		register(`${ROUTE_BASE}/state`, async (req, res) => {
			if (guard(req, res, "GET")) return;
			const url = new URL(String(req.url ?? ""), "http://localhost");
			const elicitationId = url.searchParams.get("elicitationId");
			const sessionId = url.searchParams.get("sessionId");
			const el = elicitationId !== null ? byId.get(elicitationId) : [...byId.values()].find((candidate) => candidate.parentSessionId === sessionId);
			if (el === void 0) {
				send(res, 404, { error: "澄清会话不存在" });
				return;
			}
			send(res, 200, toState(el));
		});
		register(`${ROUTE_BASE}/sent`, async (req, res) => {
			if (guard(req, res, "GET")) return;
			const sessionId = new URL(String(req.url ?? ""), "http://localhost").searchParams.get("sessionId");
			if (sessionId === null || sessionId === "") {
				send(res, 400, { error: "sessionId 必须是非空字符串" });
				return;
			}
			try {
				const events = await readSessionEvents(ctx, sessionId);
				if (events === void 0) {
					send(res, 503, { error: "当前 DSH 没有可读取会话日志的服务（sessions / sessionPersistence）" });
					return;
				}
				send(res, 200, { prompts: foldSentEvents(events) });
			} catch (error) {
				send(res, 500, { error: `读取会话历史失败: ${messageOf(error)}` });
			}
		});
		register(`${ROUTE_BASE}/skills`, async (req, res) => {
			if (guard(req, res, "GET")) return;
			const sessionId = new URL(String(req.url ?? ""), "http://localhost").searchParams.get("sessionId");
			const agents = ctx.get("agents");
			const agent = sessionId === null ? void 0 : agents?.get(sessionId);
			const presets = ctx.get("agentPresets");
			const registry = (agent === void 0 ? void 0 : presets?.serviceFor(agent, "skills")) ?? ctx.get("skills");
			if (registry?.list === void 0) {
				send(res, 503, { error: "当前 DSH 没有可用的 skills 服务" });
				return;
			}
			let cwd;
			if (agent !== void 0) {
				const workingDirectory = ctx.get("workingDirectory");
				try {
					cwd = await workingDirectory?.ensure(agent, AbortSignal.timeout(5e3));
				} catch {}
			}
			try {
				send(res, 200, { skills: (await registry.list({
					cwd,
					scope: agent
				})).filter((entry) => entry.invocation?.userInvocable === true).map((entry) => ({
					name: entry.name,
					description: typeof entry.description === "string" ? entry.description : ""
				})) });
			} catch (error) {
				send(res, 500, { error: `读取技能列表失败: ${messageOf(error)}` });
			}
		});
	});
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
async function readSessionEvents(ctx, sessionId) {
	const live = ctx.get("sessions")?.get(sessionId);
	if (Array.isArray(live?.events)) return live.events;
	const persistence = ctx.get("sessionPersistence");
	if (persistence?.inspect === void 0) return void 0;
	const inspection = await persistence.inspect(sessionId, AbortSignal.timeout(2e4));
	return Array.isArray(inspection.events) ? inspection.events : [];
}
/** Fold one absorbed child message into the record. */
function absorb(el, text) {
	const envelope = parseEnvelope(text);
	const seq = el.turns.length;
	if (envelope.kind === "question") {
		el.turns.push({
			seq,
			kind: "question",
			raw: envelope.raw,
			question: envelope.question
		});
		el.pending = envelope.question;
		el.phase = "awaiting";
		return;
	}
	if (envelope.kind === "final") {
		el.turns.push({
			seq,
			kind: "final",
			document: envelope.document
		});
		el.pending = null;
		el.final = envelope.document;
		el.phase = "final";
		return;
	}
	el.turns.push({
		seq,
		kind: "raw",
		text: envelope.text
	});
	el.pending = null;
	el.phase = "awaiting";
}
/** Project the internal record onto the wire shape. */
function toState(el) {
	return {
		elicitationId: el.elicitationId,
		childSessionId: el.childSessionId,
		phase: el.phase,
		turns: [...el.turns],
		pending: el.pending,
		final: el.final,
		error: el.error
	};
}
/** Prefer `spawn`: a fresh child never inherits the parent conversation. */
function pickProvider(names) {
	return names.includes("spawn") ? "spawn" : names[0];
}
/**
* Same-origin guard plus method check.
* @returns true when the response was already written (the caller must stop).
*/
function guard(req, res, method) {
	const site = String(req.headers["sec-fetch-site"] ?? "");
	if (site !== "" && site !== "same-origin" && site !== "none") {
		send(res, 403, { error: "cross-origin request rejected" });
		return true;
	}
	if (req.method !== method) {
		res.setHeader("Allow", method);
		send(res, 405, { error: `method must be ${method}` });
		return true;
	}
	return false;
}
/** Read and parse a JSON body; writes the failure response and returns undefined. */
async function readJson(req, res) {
	const chunks = [];
	let size = 0;
	try {
		for await (const chunk of req) {
			const buffer = chunk;
			size += buffer.length;
			if (size > MAX_BODY_BYTES) {
				send(res, 413, { error: "request body too large" });
				return;
			}
			chunks.push(buffer);
		}
	} catch {
		send(res, 400, { error: "could not read request body" });
		return;
	}
	if (chunks.length === 0) return {};
	try {
		const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			send(res, 400, { error: "body must be a JSON object" });
			return;
		}
		return parsed;
	} catch {
		send(res, 400, { error: "body must be valid JSON" });
		return;
	}
}
/** Write one JSON response. */
function send(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": String(Buffer.byteLength(body)),
		"cache-control": "no-store"
	});
	res.end(body);
}
/** Read an optional string field. */
function stringField(body, key) {
	const value = body[key];
	return typeof value === "string" ? value : void 0;
}
/** Human-readable error text for a route's failure response. */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
export { ROUTE_BASE, apply, name };
