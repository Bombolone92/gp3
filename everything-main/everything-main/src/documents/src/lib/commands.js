/**
 * Commands the app adds to the UI controller on top of its built-in
 * catalog. Registering them there (rather than calling the Document API from
 * buttons directly) keeps every toolbar control on one path: state comes from
 * `ui.commands.get(id)`, clicks go through `executeAsync`.
 *
 * Superscript, subscript, and all caps are run properties (`w:vertAlign`,
 * `w:caps`) the built-in catalog does not expose. The Document API writes
 * them, but neither it nor the selection slice reads them back, so the
 * pressed state comes from how the page painter renders the selection: a
 * raised or lowered run carries an inline `vertical-align` offset, and a
 * caps run an inline `text-transform: uppercase`.
 */

/** 'superscript' | 'subscript' | null from a CSS vertical-align value. */
export function parseVerticalAlign(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v || v === 'baseline') return null;
  if (v.startsWith('super') || v === 'text-top') return 'superscript';
  if (v.startsWith('sub') || v === 'text-bottom') return 'subscript';
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 'superscript' : 'subscript';
}

/** Whether a CSS text-transform value paints text in capitals. */
export function parseCaps(value) {
  return String(value || '').trim().toLowerCase() === 'uppercase';
}

/**
 * Inspect the painted run at the start of the current selection with
 * `read(element)`, walking up a few levels. Returns the first non-null
 * reading, null for plain text, or undefined when the selection is scrolled
 * out of view and cannot be inspected.
 */
export function inspectSelection(ui, host, read) {
  let rects;
  try { rects = ui.selection.getRects?.(); } catch { return undefined; }
  const r = rects?.[0];
  if (!r || !r.width) return null;
  const x = r.left + Math.min(4, r.width / 2);
  const y = r.top + r.height / 2;
  if (host) {
    const h = host.getBoundingClientRect();
    if (x < h.left || x > h.right || y < h.top || y > h.bottom) return undefined;
  }
  let el = document.elementFromPoint(x, y);
  if (!el || (host && !host.contains(el))) return undefined;
  for (let i = 0; el && i < 4 && el !== host; i++, el = el.parentElement) {
    const found = read(el);
    if (found) return found;
  }
  return null;
}

/** 'superscript', 'subscript', null, or undefined (see inspectSelection). */
export function vertAlignAtSelection(ui, host) {
  return inspectSelection(ui, host, (el) => parseVerticalAlign(el.style?.verticalAlign));
}

/** true when the selection starts in an all-caps run, null otherwise, undefined when unreadable. */
export function capsAtSelection(ui, host) {
  return inspectSelection(ui, host, (el) => (parseCaps(el.style?.textTransform) ? true : null));
}

/**
 * Command state for a run property: enabled with a range in an editable
 * document. Without a range it reports the same `range-selection-required`
 * reason the built-in inline formats do, so menus and toolbar buttons treat
 * it as usable while the engine's selection read is still settling.
 */
function rangeState(ctx, active) {
  const sel = ctx.selection;
  const editable = ctx.documentMode !== 'viewing';
  const hasRange = !!sel?.selectionTarget && !sel.empty;
  const state = { enabled: editable && hasRange, active };
  if (editable && !hasRange) state.reason = 'range-selection-required';
  return state;
}

/**
 * Register the app's commands. Returns a function that unregisters them.
 * `probe()` reports the vertical alignment and `probeCaps()` the caps state
 * at the selection (both injectable for tests).
 */
export function registerAppCommands(ui, { host = null, probe = () => vertAlignAtSelection(ui, host), probeCaps = () => capsAtSelection(ui, host) } = {}) {
  const regs = [];
  // When the selection cannot be inspected (scrolled away), keep the last
  // reading rather than flickering the buttons off.
  let known = null;
  const current = () => { const p = probe(); if (p !== undefined) known = p; return known; };
  let knownCaps = false;
  const currentCaps = () => { const p = probeCaps(); if (p !== undefined) knownCaps = !!p; return knownCaps; };
  // The engine asks every command for its state on each of its recomputes, several per caret move,
  // with the same selection snapshot each time: the page is inspected once per snapshot.
  let inspected = null;
  const inspect = (ctx) => {
    const selection = ctx?.selection ?? null;
    if (selection && selection === inspected) return;
    inspected = selection;
    current();
    currentCaps();
  };
  regs.push(ui.commands.register({
    id: 'all-caps',
    getState: (ctx) => { inspect(ctx); return rangeState(ctx, knownCaps); },
    execute: (ctx) => {
      const target = ctx.selection?.selectionTarget;
      // Unlike bold, these run properties have no pending form for the next
      // typed text: the engine refuses an empty target, so say what is needed.
      if (!target || ctx.selection?.empty || !ctx.doc?.format?.apply) return { success: false, failure: { code: 'UNAVAILABLE', message: 'Select the text to change first' } };
      inspect(ctx);
      const value = !knownCaps;
      knownCaps = value;
      return ctx.doc.format.apply({ target, inline: { caps: value } });
    },
  }));
  for (const kind of ['superscript', 'subscript']) {
    regs.push(ui.commands.register({
      id: kind,
      getState: (ctx) => { inspect(ctx); return rangeState(ctx, known === kind); },
      execute: (ctx) => {
        const target = ctx.selection?.selectionTarget;
        if (!target || ctx.selection?.empty || !ctx.doc?.format?.vertAlign) return { success: false, failure: { code: 'UNAVAILABLE', message: 'Select the text to change first' } };
        // Clicking the active script clears it; otherwise the pick replaces
        // whichever script is there (a run cannot be both).
        inspect(ctx);
        const value = known === kind ? null : kind;
        known = value;
        return ctx.doc.format.vertAlign({ target, value });
      },
    }));
  }
  return () => { for (const r of regs) { try { r.unregister?.(); } catch { /* controller gone */ } } };
}
