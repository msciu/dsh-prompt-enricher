# Changelog

## 0.2.0 — 2026-10-26

- **Sent history is now complete.** The panel used to derive "sent" prompts from
  the browser event window, which is one page of 50 messages; on a 9,065-event
  session that window contained 2 of 65 user prompts. A new host route,
  `GET /_dsh/prompt-enricher/sent?sessionId=`, reads the session's full
  append-only log (live `Session.events`, falling back to
  `sessionPersistence.inspect`) and folds it with the same rule the client uses.
- **The list no longer shrinks.** `SentFeed` merges by durable `seq` and only
  ever adds entries, so reopening a session, losing a binding, or a failed
  request cannot empty it. The newest 300 entries bootstrap from `localStorage`
  until the host response arrives.
- **No more churn while streaming.** Notifications are skipped unless the new
  events include a user message; assistant chunks no longer recompute or
  re-render the list.
- **Image-only prompts are kept** instead of being silently dropped from
  history; they render as `[N image prompt]`.

## 0.1.0 — 2026-10-23

Initial public release.

- Two entry points over one panel: a `conversation.view` tab in a populated
  session, and a dock chip in the composer row of a blank session.
- Sent + draft lists with filtering, folding, and bounded expansion; Markdown
  editor where Enter inserts a newline instead of sending; `/` skill
  completion.
- Grill-based prompt elicitation: a child session interrogates the draft with
  one question at a time, each carrying a recommended answer; decisions are
  folded back into a single de-ambiguated prompt and written back as a draft.
- Small-screen fix: the elicitation card's answer row is reachable at
  1366×640 and 1366×560 (the main column scrolls, the card action row is
  sticky, the editor compacts to 160px).
- "Back to chat" from the Prompt tab goes through the conversation store's
  `openView('chat')` selection path instead of `binding().activate()`.
