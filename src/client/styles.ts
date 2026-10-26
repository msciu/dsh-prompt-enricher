/**
 * One stylesheet for the whole plugin, injected once at apply time.
 *
 * Deliberately not CSS Modules: a `.module.css` import would drag the build
 * into a CSS pipeline (lightningcss + a virtual-module plugin). Two surfaces
 * do not justify that, and a single tagged `<style>` keeps the bundle honest.
 * Every colour comes from a `--dsw-*` theme token so light/dark follow the shell.
 */

const TAG_ID = 'dsh-prompt-enricher/panel.css'

export const PANEL_CSS = `
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
`

/**
 * Inject the stylesheet once per document.
 * @param doc - the document to style (absent during any non-browser render).
 */
export function installStyles(doc: Document | undefined): void {
  if (doc === undefined) return
  if (doc.querySelector(`style[data-plugin-css=${JSON.stringify(TAG_ID)}]`) !== null) return
  const tag = doc.createElement('style')
  tag.dataset.plugin = 'dsh-prompt-enricher'
  tag.dataset.pluginCss = TAG_ID
  tag.textContent = PANEL_CSS
  doc.head.appendChild(tag)
}
