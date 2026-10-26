window.__ModuleLoader__.load({
	id: "dsh-prompt-enricher",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
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
		/**
		* Validate and normalize a list that crossed a trust boundary (localStorage, an
		* HTTP route). Unusable entries are dropped instead of poisoning the index.
		* @param value - an untrusted value.
		* @returns valid prompts, sorted oldest first and deduplicated by seq.
		*/
		function normalizeSent(value) {
			if (!Array.isArray(value)) return [];
			const bySeq = /* @__PURE__ */ new Map();
			for (const item of value) {
				if (typeof item !== "object" || item === null) continue;
				const record = item;
				const seq = record["seq"];
				const time = record["time"];
				const text = record["text"];
				const images = record["images"];
				if (typeof seq !== "number" || typeof text !== "string") continue;
				const imageCount = typeof images === "number" && Number.isFinite(images) && images > 0 ? Math.floor(images) : 0;
				if (text.trim() === "" && imageCount === 0) continue;
				if (!bySeq.has(seq)) bySeq.set(seq, {
					seq,
					time: typeof time === "number" ? time : 0,
					text,
					...imageCount > 0 ? { images: imageCount } : {}
				});
			}
			return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
		}
		//#endregion
		//#region src/client/Panel.tsx
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
		function PromptEntry(props) {
			const { sessionId, t, openBoard, closeBoard, useSession, usePromptEnricher, usePromptSent, refresh } = props;
			const blank = useSession((snapshot) => snapshot.blank);
			const state = usePromptEnricher((snapshot) => snapshot);
			const sent = usePromptSent((snapshot) => snapshot);
			const open = state.panelOpen?.[sessionId] === true;
			(0, react.useEffect)(() => {
				if (open) refresh();
			}, [open, refresh]);
			if (open) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Board, {
				sessionId,
				t,
				face: props,
				state,
				sent,
				onBack: closeBoard
			});
			if (blank !== true) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "pl-root",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "pl-chip",
					onClick: openBoard,
					title: t("entry.hint"),
					children: t("entry.label")
				})
			});
		}
		/**
		* The workbench page (the tab-strip host, for sessions that have a transcript).
		* @param props - composed slot props.
		* @returns the full-column panel.
		*/
		function PromptEnricherPage(props) {
			const { sessionId, t, usePromptEnricher, usePromptSent, refresh, openView, completeViewRequest } = props;
			const state = usePromptEnricher((snapshot) => snapshot);
			const sent = usePromptSent((snapshot) => snapshot);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			/**
			* Return to Chat by selecting the View in the Conversation store.
			*
			* `uiConversation.binding(id).activate()` only adds a snapshot target — it
			* never changes the rendered View — so a back action built on it silently
			* left the tab on this page. `openView` is the slot's supported selection
			* path (the header tabs use it), and it persists the same preference.
			*/
			const backToChat = () => {
				openView("chat", "");
				completeViewRequest();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Board, {
				sessionId,
				t,
				face: props,
				state,
				sent,
				onBack: backToChat
			});
		}
		/**
		* The board itself: one component, two hosts.
		* @param props - resolved state plus the back action of the host.
		* @returns the column-covering panel.
		*/
		function Board({ sessionId, t, face, state, sent, onBack }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "pl-root pl-cover",
				style: useColumnCover(),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "pl-page",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Surface, {
						sessionId,
						t,
						face,
						state,
						sent,
						onBack
					})
				})
			});
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
		function Editor({ value, t, onChange, loadSkills }) {
			const [slash, setSlash] = (0, react.useState)(SLASH_CLOSED);
			const [skills, setSkills] = (0, react.useState)([]);
			const area = (0, react.useRef)(null);
			const candidates = slash.open ? skills.filter((skill) => slash.query === "" || skill.name.toLowerCase().includes(slash.query.toLowerCase())).slice(0, 8) : [];
			(0, react.useEffect)(() => {
				if (!slash.open || skills.length > 0) return;
				let cancelled = false;
				loadSkills().then((list) => {
					if (!cancelled) setSkills(list);
				}).catch(() => {});
				return () => {
					cancelled = true;
				};
			}, [
				slash.open,
				skills.length,
				loadSkills
			]);
			const pick = (skill) => {
				const caret = slash.start + 1 + slash.query.length;
				const next = `${value.slice(0, slash.start)}/${skill.name} ${value.slice(caret)}`;
				const at = slash.start + skill.name.length + 2;
				onChange(next);
				setSlash(SLASH_CLOSED);
				requestAnimationFrame(() => {
					const node = area.current;
					if (node === null) return;
					node.focus();
					node.setSelectionRange(at, at);
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "pl-editor-box",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
					ref: area,
					className: "pl-editor",
					value,
					spellCheck: false,
					placeholder: t("editor.placeholder"),
					onChange: (event) => {
						const next = event.target.value;
						const caret = event.target.selectionStart ?? next.length;
						onChange(next);
						const token = slashTokenAt(next, caret);
						setSlash(token === void 0 ? SLASH_CLOSED : {
							open: true,
							start: token.start,
							query: token.query,
							index: 0
						});
					},
					onKeyDown: (event) => {
						if (!slash.open) return;
						if (event.key === "ArrowDown") {
							event.preventDefault();
							setSlash((current) => ({
								...current,
								index: Math.min(current.index + 1, candidates.length - 1)
							}));
							return;
						}
						if (event.key === "ArrowUp") {
							event.preventDefault();
							setSlash((current) => ({
								...current,
								index: Math.max(current.index - 1, 0)
							}));
							return;
						}
						if (event.key === "Enter" || event.key === "Tab") {
							const candidate = candidates[slash.index];
							if (candidate !== void 0) {
								event.preventDefault();
								pick(candidate);
							}
							return;
						}
						if (event.key === "Escape") {
							event.preventDefault();
							setSlash(SLASH_CLOSED);
						}
					}
				}), slash.open && candidates.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "pl-slash",
					role: "listbox",
					children: candidates.map((skill, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						role: "option",
						"aria-selected": index === slash.index,
						className: index === slash.index ? "pl-slash-item pl-slash-active" : "pl-slash-item",
						onMouseDown: (event) => {
							event.preventDefault();
							pick(skill);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "pl-slash-name",
							children: ["/", skill.name]
						}), skill.description !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "pl-slash-desc",
							children: skill.description
						})]
					}, skill.name))
				})]
			});
		}
		const SLASH_CLOSED = {
			open: false,
			start: 0,
			query: "",
			index: 0
		};
		/**
		* Find the slash token that starts the word under the caret.
		* @param text - current editor text.
		* @param caret - selection start.
		* @returns token start offset and query, or undefined when the caret is not in
		*   a slash token.
		*/
		function slashTokenAt(text, caret) {
			const before = text.slice(0, caret);
			const match = /(?:^|\s)\/([^\s/]*)$/.exec(before);
			if (match === null) return void 0;
			const query = match[1] ?? "";
			return {
				start: caret - query.length - 1,
				query
			};
		}
		/**
		* Measure the conversation column so the page can cover it.
		*
		* `[data-conversation-scroll]` wraps the transcript AND the composer seat, so
		* its rect is exactly the area the user means by "the chat box". Re-measured on
		* resize and on the column's own size changes (sidebar toggles, right panel).
		* @returns fixed-position geometry for the cover layer.
		*/
		function useColumnCover() {
			const [rect, setRect] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				const measure = () => {
					const host = document.querySelector("[data-conversation-scroll]");
					if (!(host instanceof HTMLElement)) return;
					const box = host.getBoundingClientRect();
					if (box.width === 0 || box.height === 0) return;
					setRect((current) => current !== null && current.left === box.left && current.top === box.top && current.width === box.width && current.height === box.height ? current : {
						left: box.left,
						top: box.top,
						width: box.width,
						height: box.height
					});
				};
				const frame = requestAnimationFrame(measure);
				const host = document.querySelector("[data-conversation-scroll]");
				const observer = typeof ResizeObserver === "undefined" ? void 0 : new ResizeObserver(measure);
				if (host instanceof HTMLElement && observer !== void 0) observer.observe(host);
				window.addEventListener("resize", measure);
				return () => {
					cancelAnimationFrame(frame);
					observer?.disconnect();
					window.removeEventListener("resize", measure);
				};
			}, []);
			if (rect === null) return {
				position: "fixed",
				inset: 0
			};
			return {
				position: "fixed",
				left: `${rect.left}px`,
				top: `${rect.top}px`,
				width: `${rect.width}px`,
				height: `${rect.height}px`
			};
		}
		/**
		* The panel body.
		* @param props - resolved state plus the injected face.
		* @returns the two-column panel.
		*/
		function Surface({ sessionId, t, face, state, sent, onBack }) {
			const [query, setQuery] = (0, react.useState)("");
			const [filter, setFilter] = (0, react.useState)("all");
			const editor = state.editor[sessionId] ?? "";
			const loadedDraft = state.loadedDraft[sessionId];
			const elicitation = state.elicitation[sessionId];
			const busy = state.busy[sessionId] === true;
			const drafts = (0, react.useMemo)(() => state.drafts.filter((draft) => draft.sessionId === sessionId), [state.drafts, sessionId]);
			const needle = query.trim().toLowerCase();
			const showSent = filter !== "draft";
			const showDrafts = filter !== "sent";
			const visibleSent = showSent ? sent.filter((item) => matches(sentText(item, t), needle)).slice().reverse() : [];
			const visibleDrafts = showDrafts ? drafts.filter((draft) => matches(draft.text, needle)).slice().sort((left, right) => right.updatedAt - left.updatedAt) : [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "pl-col pl-col-list",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "pl-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "pl-title",
								children: t("panel.title")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "pl-head-spacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "pl-count",
								children: t("panel.count", {
									n: sent.length,
									d: drafts.length
								})
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "pl-tools",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "pl-input",
							type: "search",
							value: query,
							placeholder: t("search.placeholder"),
							onChange: (event) => {
								setQuery(event.target.value);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "pl-seg",
							role: "group",
							children: [
								"all",
								"sent",
								"draft"
							].map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								"data-on": filter === value,
								onClick: () => {
									setFilter(value);
								},
								children: t(`filter.${value}`)
							}, value))
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "pl-list",
						children: [showSent && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "pl-group-label",
							children: t("list.sent")
						}), visibleSent.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "pl-empty",
							children: needle === "" ? t("list.empty.sent") : t("list.empty")
						}) : visibleSent.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SentRow, {
							item,
							t
						}, item.seq))] }), showDrafts && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "pl-group-label",
							children: t("list.drafts")
						}), visibleDrafts.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "pl-empty",
							children: needle === "" ? t("list.empty.drafts") : t("list.empty")
						}) : visibleDrafts.map((draft) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DraftRow, {
							draft,
							t,
							active: loadedDraft === draft.id,
							onLoad: () => {
								face.loadDraft(draft.id);
							},
							onDelete: () => {
								face.deleteDraft(draft.id);
							},
							onElicit: () => {
								face.startElicitation(draft.id);
							}
						}, draft.id))] })]
					})
				]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "pl-col pl-col-main",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: elicitation === void 0 ? "pl-editor-wrap" : "pl-editor-wrap pl-editor-wrap-compact",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Editor, {
							value: editor,
							t,
							onChange: face.setEditor,
							loadSkills: face.loadSkills
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "pl-actions",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "pl-btn pl-btn-primary",
									disabled: busy || editor.trim() === "",
									onClick: () => {
										face.sendEditor().then((sent) => {
											if (sent) onBack?.();
										});
									},
									children: t("editor.send")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "pl-btn pl-btn-accent",
									disabled: busy || editor.trim() === "",
									onClick: face.elicitEditor,
									title: t("editor.elicitHint"),
									children: t("editor.elicit")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "pl-btn",
									disabled: editor.trim() === "",
									onClick: face.saveDraft,
									children: t("editor.save")
								}),
								onBack !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "pl-btn",
									onClick: onBack,
									children: t("panel.back")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "pl-hint",
									children: t("editor.hint")
								})
							]
						}),
						state.error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "pl-error",
							children: state.error
						})
					]
				}), elicitation !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ElicitationBlock, {
					state: elicitation,
					t,
					busy,
					onAnswer: face.answerElicitation,
					onWriteBack: face.writeBack,
					onFinish: face.finishElicitation
				})]
			})] });
		}
		/** Display text of one sent prompt: text, or the image label when it has none. */
		function sentText(item, t) {
			return item.text.trim() === "" ? t("sent.image", { n: item.images ?? 1 }) : item.text;
		}
		/** One sent prompt: collapsed to a few lines, expandable to a bounded scroll. */
		function SentRow({ item, t }) {
			const [open, setOpen] = (0, react.useState)(false);
			const stamp = item.time > 0 ? new Date(item.time).toLocaleTimeString() : "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "pl-item",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "pl-item-head",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "pl-item-time",
						children: stamp === "" ? "" : t("sent.time", { time: stamp })
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "pl-item-actions",
						children: item.text.trim() !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "pl-link",
							onClick: () => {
								setOpen((value) => !value);
							},
							children: t(open ? "sent.showLess" : "sent.showMore")
						})
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
					className: open ? "pl-text pl-expanded" : "pl-text pl-clamp",
					children: sentText(item, t)
				})]
			});
		}
		/** One draft: editable, sendable, and the entry point for elicitation. */
		function DraftRow({ draft, t, active, onLoad, onDelete, onElicit }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "pl-item",
				style: active ? { borderColor: "var(--pl-accent)" } : void 0,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "pl-item-head",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "pl-item-time",
						children: t("draft.updated", { time: new Date(draft.updatedAt).toLocaleTimeString() })
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "pl-item-actions",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "pl-link",
								onClick: onLoad,
								children: t("draft.load")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "pl-link",
								onClick: onElicit,
								children: t("draft.elicit")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "pl-link",
								onClick: onDelete,
								children: t("draft.delete")
							})
						]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
					className: "pl-text pl-clamp",
					children: draft.text
				})]
			});
		}
		/** The elicitation block: question card, prose fallback, or the final document. */
		function ElicitationBlock({ state, t, busy, onAnswer, onWriteBack, onFinish }) {
			const [answer, setAnswer] = (0, react.useState)("");
			const question = state.pending;
			const lastRaw = [...state.turns].reverse().find((turn) => turn.kind === "raw");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "pl-elicit",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "pl-elicit-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "pl-title",
								children: t("elicit.title")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "pl-head-spacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "pl-link",
								onClick: onFinish,
								children: t("elicit.finish")
							})
						]
					}),
					state.phase === "thinking" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "pl-hint",
						children: t("elicit.thinking")
					}),
					state.phase === "failed" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "pl-error",
						children: [t("elicit.failed"), state.error === null ? "" : `: ${state.error}`]
					}),
					state.phase === "awaiting" && question !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "pl-q",
							children: question.question
						}),
						question.rationale !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "pl-rationale",
							children: [
								t("elicit.rationale"),
								"：",
								question.rationale
							]
						}),
						question.options !== void 0 && question.options.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "pl-options",
							children: question.options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "pl-option",
								"data-on": answer === option,
								onClick: () => {
									setAnswer(option);
								},
								children: option
							}, option))
						}),
						question.recommended !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "pl-hint",
							children: [
								t("elicit.recommended"),
								"：",
								question.recommended,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "pl-link",
									style: { marginLeft: 8 },
									onClick: () => {
										setAnswer(question.recommended);
									},
									children: t("elicit.accept")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "pl-actions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "pl-input",
								value: answer,
								placeholder: t("elicit.answerPlaceholder"),
								onChange: (event) => {
									setAnswer(event.target.value);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "pl-btn pl-btn-primary",
								disabled: busy || answer.trim() === "",
								onClick: () => {
									onAnswer(answer);
									setAnswer("");
								},
								children: t("elicit.answer")
							})]
						})
					] }),
					state.phase === "awaiting" && question === null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "pl-hint",
							children: t("elicit.noQuestion")
						}),
						lastRaw !== void 0 && lastRaw.kind === "raw" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
							className: "pl-final-text",
							children: lastRaw.text
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "pl-actions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "pl-input",
								value: answer,
								placeholder: t("elicit.answerPlaceholder"),
								onChange: (event) => {
									setAnswer(event.target.value);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "pl-btn pl-btn-primary",
								disabled: busy || answer.trim() === "",
								onClick: () => {
									onAnswer(answer);
									setAnswer("");
								},
								children: t("elicit.answer")
							})]
						})
					] }),
					(state.phase === "final" || state.phase === "done") && state.final !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "pl-group-label",
							children: t("elicit.final")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
							className: "pl-final-text",
							children: state.final
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "pl-actions",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "pl-btn pl-btn-primary",
								onClick: onWriteBack,
								children: t("elicit.writeBack")
							})
						})
					] })
				]
			});
		}
		/** Case-insensitive substring match; an empty needle matches everything. */
		function matches(text, needle) {
			return needle === "" || text.toLowerCase().includes(needle);
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Copy for the prompt workbench page.
		*
		* `NS` is the locale namespace this plugin registers; the slot registration
		* carries it so the component receives a bound `t`.
		*/
		const NS = "promptEnricher";
		const en = {
			"view.label": "Prompts",
			"entry.label": "Prompts",
			"entry.hint": "Draft before you send",
			"panel.title": "Prompts",
			"panel.back": "Back to chat",
			"panel.count": "{n} sent · {d} drafts",
			"search.placeholder": "Filter prompts…",
			"filter.all": "All",
			"filter.sent": "Sent",
			"filter.draft": "Drafts",
			"list.sent": "Sent",
			"list.drafts": "Drafts",
			"list.empty": "No matching prompts.",
			"list.empty.sent": "Nothing sent in this session yet.",
			"list.empty.drafts": "No drafts yet.",
			"sent.showMore": "Show more",
			"sent.showLess": "Collapse",
			"sent.time": "sent {time}",
			"sent.image": "[{n} image prompt]",
			"draft.load": "Edit",
			"draft.delete": "Delete",
			"draft.elicit": "Clarify",
			"draft.updated": "edited {time}",
			"editor.placeholder": "Write the prompt in Markdown. Enter inserts a newline — nothing is sent from here.",
			"editor.new": "New",
			"editor.send": "Send",
			"editor.save": "Save draft",
			"editor.elicit": "Clarify",
			"editor.elicitHint": "Have a child session grill this prompt until it is unambiguous, then write the result back here.",
			"editor.hint": "Enter inserts a newline. Type / for skills.",
			"editor.empty": "Write something first.",
			"elicit.title": "Prompt elicitation",
			"elicit.thinking": "Working through the document…",
			"elicit.answer": "Answer",
			"elicit.answerPlaceholder": "Your ruling…",
			"elicit.recommended": "Recommended",
			"elicit.rationale": "Why",
			"elicit.accept": "Accept recommendation",
			"elicit.final": "Final document",
			"elicit.writeBack": "Write back as draft",
			"elicit.finish": "Finish",
			"elicit.cancel": "Cancel",
			"elicit.failed": "Elicitation failed",
			"elicit.noQuestion": "The child answered without a structured question. Reply in prose to continue.",
			"error.generic": "Something went wrong.",
			"error.send": "Could not send the prompt."
		};
		const zh = {
			"view.label": "提示词",
			"entry.label": "提示词",
			"entry.hint": "先写，再发",
			"panel.title": "提示词",
			"panel.back": "返回对话",
			"panel.count": "已发送 {n} · 草稿 {d}",
			"search.placeholder": "过滤提示词…",
			"filter.all": "全部",
			"filter.sent": "已发送",
			"filter.draft": "草稿",
			"list.sent": "已发送",
			"list.drafts": "草稿",
			"list.empty": "没有匹配的提示词。",
			"list.empty.sent": "本会话还没有发送过提示词。",
			"list.empty.drafts": "还没有草稿。",
			"sent.showMore": "展开",
			"sent.showLess": "收起",
			"sent.time": "发送于 {time}",
			"sent.image": "[{n} 张图片的提示词]",
			"draft.load": "编辑",
			"draft.delete": "删除",
			"draft.elicit": "澄清",
			"draft.updated": "编辑于 {time}",
			"editor.placeholder": "用 Markdown 书写提示词。回车仅换行，这里不会直接发送。",
			"editor.new": "新建",
			"editor.send": "发送",
			"editor.save": "保存为草稿",
			"editor.elicit": "澄清提升",
			"editor.elicitHint": "派一个子会话把这段提示词追问到没有歧义，再把结果回填到这里。",
			"editor.hint": "回车仅换行；输入 / 调出技能。",
			"editor.empty": "请先写点内容。",
			"elicit.title": "提示词澄清",
			"elicit.thinking": "正在梳理文档…",
			"elicit.answer": "回答",
			"elicit.answerPlaceholder": "你的裁定…",
			"elicit.recommended": "推荐",
			"elicit.rationale": "理由",
			"elicit.accept": "采纳推荐答案",
			"elicit.final": "最终文档",
			"elicit.writeBack": "回填为草稿",
			"elicit.finish": "结束",
			"elicit.cancel": "取消",
			"elicit.failed": "澄清失败",
			"elicit.noQuestion": "子会话没有给出结构化问题。用自然语言回答即可继续。",
			"error.generic": "出错了。",
			"error.send": "发送提示词失败。"
		};
		//#endregion
		//#region src/client/sent.ts
		/** LocalStorage key prefix for the reload bootstrap. */
		const STORAGE_PREFIX = "dsh.prompt-enricher:sent:";
		/**
		* Derive the sent list from one window snapshot.
		* @param window - current session event window.
		* @returns sent prompts, oldest first.
		*/
		function deriveSent(window) {
			return foldSentEvents(eventsOf(window.entries));
		}
		/** Keep only the durable `event` entries (compact chunks are not messages). */
		function eventsOf(entries) {
			const out = [];
			for (const raw of entries) {
				const entry = raw;
				if (entry.type === "event" && entry.event !== void 0) out.push(entry.event);
			}
			return out;
		}
		/**
		* A per-session observable over the merged sent list.
		*
		* Merge semantics, in one sentence: **add by seq, never remove**. A replaced
		* window, a session reopen, or a failed history request can therefore only
		* delay the list, never truncate it.
		*/
		var SentFeed = class {
			options;
			listeners = /* @__PURE__ */ new Set();
			/** Complete merged list, oldest first. */
			cache = [];
			source;
			unsubscribe;
			/** Last window revision folded, so a chunk-only notification does no work. */
			revision = void 0;
			/** In-flight history request, shared by overlapping refreshes. */
			history;
			/** Set once storage rejected a write (quota); further writes are pointless. */
			persistBroken = false;
			/**
			* @param options - session id, window resolver, and durable-history loader.
			*/
			constructor(options) {
				this.options = options;
				this.cache = readStored(options.sessionId);
				this.attach();
				this.loadHistory();
			}
			/** @returns the current merged list. */
			getSnapshot() {
				return this.cache;
			}
			/**
			* Subscribe to a recomputed list.
			* @param listener - invalidation callback.
			* @returns unsubscribe.
			*/
			subscribe(listener) {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			}
			/**
			* Re-resolve the window source (a session-list change or a reopen). An
			* identical source is a no-op; a replaced object folds from scratch but keeps
			* the entries it already had.
			*/
			refresh() {
				this.attach();
			}
			/**
			* Fetch and merge the complete durable list. Failures are swallowed on
			* purpose: the window tail plus whatever was already stored is still a usable
			* list, and the next open retries.
			* @returns completion, whether the request succeeded or not.
			*/
			loadHistory() {
				if (this.history !== void 0) return this.history;
				const pending = this.options.loadHistory().then((prompts) => {
					if (this.merge(prompts)) this.notify();
				}).catch(() => {}).finally(() => {
					if (this.history === pending) this.history = void 0;
				});
				this.history = pending;
				return pending;
			}
			/** Release the upstream subscription (called when a session scope dies). */
			dispose() {
				this.unsubscribe?.();
				this.unsubscribe = void 0;
				this.source = void 0;
				this.listeners.clear();
			}
			attach() {
				const next = this.options.resolve();
				if (next === this.source) {
					this.recompute();
					return;
				}
				this.unsubscribe?.();
				this.source = next;
				this.revision = void 0;
				this.unsubscribe = next?.subscribe(() => {
					this.recompute();
				});
				this.recompute();
			}
			recompute() {
				const window = this.source?.getSnapshot();
				if (window === void 0) return;
				if (typeof window.revision === "number") {
					if (window.revision === this.revision) return;
					this.revision = window.revision;
				}
				const change = window.change;
				if (change?.kind === "append" && Array.isArray(change.entries)) {
					if (this.merge(foldSentEvents(eventsOf(change.entries)))) this.notify();
					return;
				}
				if (this.merge(deriveSent(window))) this.notify();
			}
			/**
			* Merge entries by seq, keeping the newest copy of each.
			* @param next - prompts from either source.
			* @returns whether the list actually changed.
			*/
			merge(next) {
				if (next.length === 0) return false;
				const bySeq = /* @__PURE__ */ new Map();
				for (const item of this.cache) bySeq.set(item.seq, item);
				const before = bySeq.size;
				for (const item of next) if (!bySeq.has(item.seq)) bySeq.set(item.seq, item);
				if (bySeq.size === before) return false;
				this.cache = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
				this.persist();
				return true;
			}
			/** Persist the newest slice for the next page load (the request still wins). */
			persist() {
				if (this.persistBroken) return;
				const storage = storageOf();
				if (storage === void 0) return;
				try {
					storage.setItem(`${STORAGE_PREFIX}${this.options.sessionId}`, JSON.stringify(this.cache.slice(-300)));
				} catch {
					this.persistBroken = true;
				}
			}
			notify() {
				for (const listener of [...this.listeners]) listener();
			}
		};
		/** The browser's storage, or undefined when it is absent or blocked. */
		function storageOf() {
			try {
				return typeof localStorage === "undefined" ? void 0 : localStorage;
			} catch {
				return;
			}
		}
		/** Read the reload bootstrap; a corrupt entry degrades to an empty list. */
		function readStored(sessionId) {
			const storage = storageOf();
			if (storage === void 0) return [];
			try {
				return normalizeSent(JSON.parse(storage.getItem(`${STORAGE_PREFIX}${sessionId}`) ?? "[]"));
			} catch {
				return [];
			}
		}
		//#endregion
		//#region src/client/store.ts
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
		/** Empty state; also the shape persistence rehydrates into. */
		const INITIAL = {
			panelOpen: {},
			editor: {},
			loadedDraft: {},
			drafts: [],
			elicitation: {},
			links: {},
			busy: {},
			error: null
		};
		/** Storage key for the persisted panel. */
		const PERSIST_KEY = "dsh.prompt-enricher";
		/**
		* Key this panel used before it was renamed from `dsh-prompt-lines`.
		*
		* Renaming a package must not look like data loss: drafts written under the old
		* key are adopted once, when the new key is still empty. The old key is left in
		* place rather than deleted, so a downgrade still finds its drafts.
		*/
		const LEGACY_PERSIST_KEY = "dsh.prompt-lines";
		/**
		* Adopt drafts saved under the pre-rename key.
		*
		* A missing `localStorage` (tests, SSR) and a throwing one (quota, private mode)
		* both leave the store starting empty, which is the same behaviour as a first
		* run.
		*/
		function adoptLegacyStorage() {
			try {
				if (typeof localStorage === "undefined") return;
				if (localStorage.getItem(PERSIST_KEY) !== null) return;
				const legacy = localStorage.getItem(LEGACY_PERSIST_KEY);
				if (legacy === null) return;
				localStorage.setItem(PERSIST_KEY, legacy);
			} catch {}
		}
		/**
		* Create the panel store, restoring any persisted drafts.
		* @returns the shared store instance.
		*/
		function createPromptEnricherStore() {
			adoptLegacyStorage();
			return (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(INITIAL, { persist: { name: PERSIST_KEY } });
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* One stylesheet for the whole plugin, injected once at apply time.
		*
		* Deliberately not CSS Modules: a `.module.css` import would drag the build
		* into a CSS pipeline (lightningcss + a virtual-module plugin). Two surfaces
		* do not justify that, and a single tagged `<style>` keeps the bundle honest.
		* Every colour comes from a `--dsw-*` theme token so light/dark follow the shell.
		*/
		const TAG_ID = "dsh-prompt-enricher/panel.css";
		const PANEL_CSS = `
.pl-root {
  --pl-border: var(--dsw-alias-border-l2);
  --pl-border-soft: var(--dsw-alias-border-l1);
  --pl-bg: var(--dsw-alias-bg-layer-1);
  --pl-bg-soft: var(--dsw-alias-bg-layer-2);
  --pl-text: var(--dsw-alias-label-primary);
  --pl-dim: var(--dsw-alias-label-secondary);
  --pl-accent: var(--dsw-alias-brand-primary);
  color: var(--pl-text);
  font-size: 13px;
  line-height: 1.55;
  min-width: 0;
}
/* The cover layer: a conversation view only replaces the session body, so the
   page claims the whole conversation column (measured onto it) and paints over
   the composer seat it does not own. */
.pl-cover {
  z-index: 10;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
}
.pl-page {
  display: grid;
  grid-template-columns: minmax(240px, 360px) minmax(0, 1fr);
  gap: 14px;
  padding: 14px;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
}
/* Columns stretch to the measured page height so each can own its scroll.
   Without a definite height the overflow rule never engages, and a short
   viewport clipped the elicitation's answer row below the visible area. */
.pl-col { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; }
.pl-col-list { overflow: auto; }
.pl-col-main { overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; }
@media (max-width: 860px) {
  /* One column: the page itself scrolls. Keeping the two columns as grid rows
     would pin the second row to the leftover height and give it a nested
     scrollbar, so stack them as flex items instead. Declared after the base
     rules so these overrides win at equal specificity. */
  .pl-page {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .pl-col { flex: 0 0 auto; }
  .pl-col-main { overflow: visible; }
  .pl-col-list { max-height: 40vh; }
}
.pl-count { color: var(--pl-dim); font-size: 11px; font-variant-numeric: tabular-nums; }

/* Blank-session entry: a text control in the composer's own tool row, rendered
   right after the permission/mode control. Metrics mirror that control so the
   two read as one family: 13px / 500 / secondary label colour (measured there as
   rgb(97, 102, 107)). Hidden once the transcript starts (the tab strip takes
   over then). */
.pl-chip {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #61666b);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
}
.pl-chip:hover { background: var(--dsw-alias-interactive-bg-hover, var(--pl-bg-soft)); }

.pl-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--pl-border-soft);
}
.pl-title { font-weight: 600; }
.pl-head-spacer { margin-left: auto; }
.pl-link {
  border: 0;
  background: none;
  color: var(--pl-accent);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}
.pl-link:hover { text-decoration: underline; }

.pl-tools { display: flex; align-items: center; gap: 6px; padding: 0 12px 8px; flex-wrap: wrap; }
.pl-input {
  flex: 1 1 120px;
  min-width: 90px;
  box-sizing: border-box;
  border: 1px solid var(--pl-border);
  border-radius: 6px;
  background: var(--pl-bg-soft);
  color: var(--pl-text);
  font: inherit;
  font-size: 12px;
  padding: 4px 8px;
  outline: none;
}
.pl-input:focus { border-color: var(--pl-dim); }
.pl-seg { display: inline-flex; border: 1px solid var(--pl-border); border-radius: 999px; overflow: hidden; }
.pl-seg button {
  border: 0;
  background: transparent;
  color: var(--pl-dim);
  font: inherit;
  font-size: 11px;
  padding: 3px 9px;
  cursor: pointer;
}
.pl-seg button[data-on='true'] { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }

.pl-group-label {
  color: var(--pl-dim);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 6px 12px 2px;
}
.pl-list { display: flex; flex-direction: column; gap: 6px; padding: 0 12px 10px; }
.pl-item {
  border: 1px solid var(--pl-border-soft);
  border-radius: 8px;
  background: var(--pl-bg-soft);
  padding: 7px 9px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.pl-item-head { display: flex; align-items: baseline; gap: 8px; }
.pl-item-time { color: var(--pl-dim); font-size: 11px; white-space: nowrap; }
.pl-item-actions { margin-left: auto; display: inline-flex; gap: 8px; }
.pl-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
  font-family: inherit;
  font-size: 12px;
  color: var(--pl-text);
}
.pl-clamp {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pl-expanded {
  max-height: 200px;
  overflow: auto;
  border-top: 1px dashed var(--pl-border-soft);
  padding-top: 4px;
}
.pl-empty { color: var(--pl-dim); font-size: 12px; padding: 2px 12px 12px; }

.pl-editor-wrap { display: flex; flex-direction: column; gap: 6px; padding: 0 12px 12px; flex: 1 1 auto; min-height: 0; }
/* Positioning context for the "/" picker, which floats over the editor. */
.pl-editor-box { position: relative; display: flex; flex: 1 1 auto; min-height: 0; }
.pl-editor {
  box-sizing: border-box;
  width: 100%;
  min-height: 180px;
  max-height: 46vh;
  resize: vertical;
  border: 1px solid var(--pl-border);
  border-radius: 8px;
  background: var(--pl-bg);
  color: var(--pl-text);
  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12.5px;
  line-height: 1.6;
  padding: 10px 12px;
  outline: none;
}
.pl-editor:focus { border-color: var(--pl-accent); }
.pl-page .pl-editor { max-height: none; min-height: 320px; flex: 1 1 auto; }
/* While an elicitation card is open the editor yields height to it: on a short
   window a 320px floor pushed the card's answer row past the fold. It also
   stops growing, so the card follows the editor instead of sinking to the
   bottom of a tall column. */
.pl-editor-wrap-compact { flex: 0 0 auto; }
.pl-editor-wrap-compact .pl-editor { min-height: 160px; }
@media (max-height: 760px) {
  .pl-page .pl-editor { min-height: 160px; }
}
.pl-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pl-btn {
  border: 1px solid var(--pl-border);
  border-radius: 6px;
  background: var(--pl-bg);
  color: var(--pl-text);
  font: inherit;
  font-size: 12px;
  padding: 4px 12px;
  cursor: pointer;
}
.pl-btn:hover:not(:disabled) { border-color: var(--pl-dim); }
.pl-btn:disabled { opacity: 0.5; cursor: default; }
.pl-btn-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.pl-btn-accent {
  border-color: var(--pl-accent);
  color: var(--pl-accent);
  background: transparent;
}

/* "/" skill picker: a menu floating at the editor's bottom-left corner, over
   the text rather than pushing it. */
.pl-slash {
  position: absolute;
  left: 8px;
  bottom: 8px;
  right: 8px;
  z-index: 5;
  max-height: 220px;
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--pl-border);
  border-radius: 8px;
  background: var(--dsw-alias-bg-elevated, var(--pl-bg));
  box-shadow: var(--dsw-alias-shadow-menu, 0 8px 24px rgb(0 0 0 / 18%));
}
.pl-slash-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--pl-text);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.pl-slash-active, .pl-slash-item:hover { background: var(--dsw-alias-interactive-bg-hover, var(--pl-bg-soft)); }
.pl-slash-name { font-family: var(--dsw-font-family-mono, ui-monospace, monospace); }
.pl-slash-desc {
  color: var(--pl-dim);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pl-hint { color: var(--pl-dim); font-size: 11px; }
.pl-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; }

.pl-elicit {
  margin: 0 12px 12px;
  border: 1px solid var(--pl-border);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--pl-bg);
}
.pl-elicit-head { display: flex; align-items: baseline; gap: 8px; }
/* The answer row is the card's last control. Keeping it pinned to the bottom of
   the scroll viewport makes it reachable the moment an option is picked, even
   when a long question or a short window overflows the card. */
.pl-elicit .pl-actions {
  position: sticky;
  bottom: 0;
  z-index: 1;
  padding-top: 6px;
  background: var(--pl-bg);
}
.pl-q { font-weight: 600; white-space: pre-wrap; overflow-wrap: anywhere; }
.pl-rationale { color: var(--pl-dim); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.pl-options { display: flex; flex-wrap: wrap; gap: 6px; }
.pl-option {
  border: 1px solid var(--pl-border);
  border-radius: 999px;
  background: var(--pl-bg-soft);
  color: var(--pl-text);
  font: inherit;
  font-size: 12px;
  padding: 3px 10px;
  cursor: pointer;
}
.pl-option[data-on='true'] { border-color: var(--pl-accent); color: var(--pl-accent); }
.pl-final-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 260px;
  overflow: auto;
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--pl-border-soft);
  border-radius: 8px;
  background: var(--pl-bg-soft);
  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
}
`;
		/**
		* Inject the stylesheet once per document.
		* @param doc - the document to style (absent during any non-browser render).
		*/
		function installStyles(doc) {
			if (doc === void 0) return;
			if (doc.querySelector(`style[data-plugin-css=${JSON.stringify(TAG_ID)}]`) !== null) return;
			const tag = doc.createElement("style");
			tag.dataset.plugin = "dsh-prompt-enricher";
			tag.dataset.pluginCss = TAG_ID;
			tag.textContent = PANEL_CSS;
			doc.head.appendChild(tag);
		}
		//#endregion
		//#region src/client/index.tsx
		/** Services this half requires. */
		const inject = [
			"slots",
			"sessions",
			"locale",
			"uiConversation"
		];
		/** Route prefix owned by the host half. */
		const ROUTE_BASE = "/_dsh/prompt-enricher";
		/** Elicitation poll cadence while the child is thinking. */
		const POLL_MS = 1200;
		/**
		* Client plugin body.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-prompt-enricher: dictionaries");
			const t = ctx.locale.bind(NS);
			installStyles(typeof document === "undefined" ? void 0 : document);
			const store = createPromptEnricherStore();
			/** Per-session sent-prompt feeds, disposed with the plugin. */
			const feeds = /* @__PURE__ */ new Map();
			/** Per-session elicitation poll timers. */
			const timers = /* @__PURE__ */ new Map();
			ctx.effect(() => () => {
				for (const timer of timers.values()) clearTimeout(timer);
				timers.clear();
				for (const feed of feeds.values()) feed.dispose();
				feeds.clear();
			}, "dsh-prompt-enricher: session feeds");
			/**
			* Complete prompt history for one session, as served by the host half.
			*
			* The durable log is the only complete source: the client window is a 50-
			* message page. Validation is shared with the storage reader, so a malformed
			* response degrades instead of poisoning the list.
			* @param sessionId - session to read.
			* @returns user prompts, oldest first.
			*/
			const fetchSent = async (sessionId) => {
				return normalizeSent((await call(`/sent?sessionId=${encodeURIComponent(sessionId)}`)).prompts);
			};
			const feedFor = (sessionId) => {
				const cached = feeds.get(sessionId);
				if (cached !== void 0) return cached;
				const feed = new SentFeed({
					sessionId,
					resolve: () => ctx.sessions.binding(sessionId)?.eventSource,
					loadHistory: () => fetchSent(sessionId)
				});
				feeds.set(sessionId, feed);
				return feed;
			};
			ctx.effect(() => {
				const unsubscribe = ctx.sessions.list.subscribe(() => {
					for (const feed of feeds.values()) feed.refresh();
				});
				return () => {
					unsubscribe();
				};
			}, "dsh-prompt-enricher: sent feeds follow bindings");
			/** Skill catalog for the "/" picker; one fetch per session is enough. */
			const skillCache = /* @__PURE__ */ new Map();
			const loadSkills = (sessionId) => {
				const cached = skillCache.get(sessionId);
				if (cached !== void 0) return cached;
				const pending = call(`/skills?sessionId=${encodeURIComponent(sessionId)}`).then((value) => value.skills ?? []).catch((error) => {
					skillCache.delete(sessionId);
					throw error;
				});
				skillCache.set(sessionId, pending);
				return pending;
			};
			/** Open/close the in-place board used by the blank-session entry. */
			const setBoardOpen = (sessionId, open) => {
				store.update((draft) => {
					const flags = { ...draft.panelOpen ?? {} };
					flags[sessionId] = open;
					draft.panelOpen = flags;
					draft.error = null;
				});
			};
			const setEditor = (sessionId, text) => {
				store.update((draft) => {
					draft.editor[sessionId] = text;
					draft.error = null;
				});
			};
			/**
			* Save the editor buffer as a draft (updating the loaded one when there is
			* one).
			* @param sessionId - owning session.
			* @returns the draft id that now holds the editor text, or undefined when the
			*   editor is empty.
			*/
			const saveDraftNow = (sessionId) => {
				const state = store.getSnapshot();
				const text = state.editor[sessionId] ?? "";
				if (text.trim() === "") return void 0;
				const loaded = state.loadedDraft[sessionId];
				const now = Date.now();
				let result = loaded;
				store.update((draft) => {
					draft.error = null;
					const index = loaded === void 0 ? -1 : draft.drafts.findIndex((item) => item.id === loaded);
					if (index >= 0) {
						const existing = draft.drafts[index];
						draft.drafts[index] = {
							...existing,
							text,
							updatedAt: now
						};
						return;
					}
					const id = newDraftId(now);
					draft.drafts.push({
						id,
						sessionId,
						text,
						createdAt: now,
						updatedAt: now
					});
					draft.loadedDraft[sessionId] = id;
					result = id;
				});
				return result;
			};
			const saveDraft = (sessionId) => {
				saveDraftNow(sessionId);
			};
			/**
			* Deliver the editor buffer to the session.
			* @param sessionId - owning session.
			* @returns true when the prompt was accepted, so the host can leave the board.
			*/
			const sendEditor = async (sessionId) => {
				const state = store.getSnapshot();
				const text = state.editor[sessionId] ?? "";
				if (text.trim() === "") {
					store.update((draft) => {
						draft.error = t("editor.empty");
					});
					return false;
				}
				const session = ctx.sessions.binding(sessionId)?.session;
				if (session === void 0) {
					store.update((draft) => {
						draft.error = t("error.send");
					});
					return false;
				}
				store.update((draft) => {
					draft.busy[sessionId] = true;
				});
				try {
					const result = await session.prompt([{
						type: "text",
						text
					}], "queue");
					if (!result.ok) {
						store.update((draft) => {
							draft.error = `${t("error.send")} ${result.error.message}`;
						});
						return false;
					}
					const loaded = state.loadedDraft[sessionId];
					store.update((draft) => {
						draft.editor[sessionId] = "";
						draft.loadedDraft[sessionId] = void 0;
						if (loaded !== void 0) draft.drafts = draft.drafts.filter((item) => item.id !== loaded);
						draft.error = null;
					});
					setBoardOpen(sessionId, false);
					feedFor(sessionId).loadHistory();
					return true;
				} catch (error) {
					store.update((draft) => {
						draft.error = `${t("error.send")} ${messageOf(error)}`;
					});
					return false;
				} finally {
					store.update((draft) => {
						draft.busy[sessionId] = false;
					});
				}
			};
			const applyState = (sessionId, state) => {
				store.update((draft) => {
					draft.elicitation[sessionId] = state;
					draft.busy[sessionId] = state.phase === "thinking";
				});
			};
			const poll = (sessionId) => {
				const pending = timers.get(sessionId);
				if (pending !== void 0) clearTimeout(pending);
				const tick = async () => {
					try {
						const state = await call(`/state?sessionId=${encodeURIComponent(sessionId)}`);
						applyState(sessionId, state);
						if (state.phase === "thinking") timers.set(sessionId, setTimeout(() => {
							tick();
						}, POLL_MS));
						else timers.delete(sessionId);
					} catch {
						timers.delete(sessionId);
						store.update((draft) => {
							draft.busy[sessionId] = false;
						});
					}
				};
				tick();
			};
			/**
			* Start an elicitation straight from the editor.
			*
			* The draft row's own "澄清" link only exists once something is a draft, which
			* made the plugin's headline feature invisible to anyone who had just typed
			* into the editor. This saves the buffer first (so the child always has an
			* anchor to write back to) and then starts the same flow.
			* @param sessionId - owning session.
			*/
			const elicitEditor = async (sessionId) => {
				const draftId = saveDraftNow(sessionId);
				if (draftId === void 0) {
					store.update((draft) => {
						draft.error = t("editor.empty");
					});
					return;
				}
				await startElicitation(sessionId, draftId);
			};
			const startElicitation = async (sessionId, draftId) => {
				const target = store.getSnapshot().drafts.find((item) => item.id === draftId && item.sessionId === sessionId);
				if (target === void 0) return;
				store.update((draft) => {
					draft.busy[sessionId] = true;
					draft.error = null;
				});
				try {
					const next = await call("/start", {
						sessionId,
						document: target.text
					});
					store.update((draft) => {
						draft.elicitation[sessionId] = next;
						draft.links[sessionId] = {
							elicitationId: next.elicitationId,
							draftId,
							childSessionId: next.childSessionId
						};
						draft.busy[sessionId] = next.phase === "thinking";
					});
					if (next.phase === "thinking") poll(sessionId);
				} catch (error) {
					store.update((draft) => {
						draft.busy[sessionId] = false;
						draft.error = `${t("elicit.failed")}: ${messageOf(error)}`;
					});
				}
			};
			const answerElicitation = async (sessionId, answer) => {
				const current = store.getSnapshot().elicitation[sessionId];
				if (current === void 0) return;
				store.update((draft) => {
					draft.busy[sessionId] = true;
					draft.error = null;
				});
				try {
					const next = await call("/answer", {
						elicitationId: current.elicitationId,
						answer
					});
					applyState(sessionId, next);
					if (next.phase === "thinking") poll(sessionId);
				} catch (error) {
					store.update((draft) => {
						draft.busy[sessionId] = false;
						draft.error = messageOf(error);
					});
				}
			};
			const finishElicitation = async (sessionId) => {
				const current = store.getSnapshot().elicitation[sessionId];
				if (current === void 0) return;
				try {
					await call("/finish", { elicitationId: current.elicitationId });
				} catch {}
				store.update((draft) => {
					draft.elicitation[sessionId] = void 0;
					draft.links[sessionId] = void 0;
					draft.busy[sessionId] = false;
				});
			};
			const writeBack = (sessionId) => {
				const document = store.getSnapshot().elicitation[sessionId]?.final;
				if (document === null || document === void 0) return;
				const link = store.getSnapshot().links[sessionId];
				const now = Date.now();
				store.update((draft) => {
					draft.error = null;
					draft.editor[sessionId] = document;
					const index = link === void 0 ? -1 : draft.drafts.findIndex((item) => item.id === link.draftId);
					if (index >= 0) {
						const existing = draft.drafts[index];
						draft.drafts[index] = {
							...existing,
							text: document,
							updatedAt: now
						};
						draft.loadedDraft[sessionId] = existing.id;
						return;
					}
					const id = newDraftId(now);
					draft.drafts.push({
						id,
						sessionId,
						text: document,
						createdAt: now,
						updatedAt: now
					});
					draft.loadedDraft[sessionId] = id;
				});
				finishElicitation(sessionId);
			};
			const faceFor = (sessionId) => ({
				hooks: {
					promptEnricher: store,
					promptSent: feedFor(sessionId)
				},
				setEditor: (text) => {
					setEditor(sessionId, text);
				},
				sendEditor: () => sendEditor(sessionId),
				saveDraft: () => {
					saveDraft(sessionId);
				},
				loadDraft: (id) => {
					const target = store.getSnapshot().drafts.find((item) => item.id === id);
					if (target === void 0) return;
					store.update((draft) => {
						draft.editor[sessionId] = target.text;
						draft.loadedDraft[sessionId] = target.id;
						draft.error = null;
					});
				},
				deleteDraft: (id) => {
					store.update((draft) => {
						draft.drafts = draft.drafts.filter((item) => item.id !== id);
						if (draft.loadedDraft[sessionId] === id) draft.loadedDraft[sessionId] = void 0;
					});
				},
				refresh: () => {
					feedFor(sessionId).loadHistory();
					poll(sessionId);
				},
				openBoard: () => {
					setBoardOpen(sessionId, true);
				},
				closeBoard: () => {
					setBoardOpen(sessionId, false);
				},
				startElicitation: (id) => {
					startElicitation(sessionId, id);
				},
				elicitEditor: () => {
					elicitEditor(sessionId);
				},
				loadSkills: () => loadSkills(sessionId),
				answerElicitation: (text) => {
					answerElicitation(sessionId, text);
				},
				writeBack: () => {
					writeBack(sessionId);
				},
				finishElicitation: () => {
					finishElicitation(sessionId);
				}
			});
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "prompt-enricher-entry",
				order: 10,
				locale: NS,
				label: () => t("entry.label"),
				inject: (sessionId) => faceFor(String(sessionId))
			}, PromptEntry));
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "prompt-enricher",
				order: 30,
				locale: NS,
				label: () => t("view.label"),
				inject: (sessionId) => faceFor(String(sessionId))
			}, PromptEnricherPage));
		}
		/** One JSON call against this plugin's host routes. */
		async function call(path, body) {
			const response = body === void 0 ? await fetch(`${ROUTE_BASE}${path}`, { method: "GET" }) : await fetch(`${ROUTE_BASE}${path}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			});
			const text = await response.text();
			const parsed = text === "" ? {} : JSON.parse(text);
			if (!response.ok) {
				const reason = typeof parsed === "object" && parsed !== null && typeof parsed["error"] === "string" ? String(parsed["error"]) : `HTTP ${response.status}`;
				throw new Error(reason);
			}
			return parsed;
		}
		/** Stable-enough local draft identity (no uuid dependency in the browser bundle). */
		function newDraftId(now) {
			return `draft-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		}
		/** Human-readable error text. */
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
