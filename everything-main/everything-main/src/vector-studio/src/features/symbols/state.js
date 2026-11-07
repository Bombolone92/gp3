/**
 * Per-document UI state for symbols: which symbols are selected in the
 * Symbols panel (the "current" symbol is what Place, Replace and the
 * Symbol Sprayer use).
 */
import { getDef, symbolDefs } from './model.js';

const states = new WeakMap();

export function symbolState(editor) {
  let s = states.get(editor);
  if (!s) {
    s = { selected: new Set(), current: null };
    states.set(editor, s);
  }
  return s;
}

/** Panel-selected symbol ids that still exist, in panel order. */
export function selectedSymbols(editor) {
  if (!editor) return [];
  const s = symbolState(editor);
  return symbolDefs(editor.doc).filter((d) => s.selected.has(d.id)).map((d) => d.id);
}

/** The symbol commands act on: the last one picked in the panel, else the first selected. */
export function currentSymbol(editor) {
  if (!editor) return null;
  const s = symbolState(editor);
  if (s.current && s.selected.has(s.current) && getDef(editor.doc, s.current)) return s.current;
  return selectedSymbols(editor)[0] || null;
}

export function setSymbolSelection(editor, ids, current = ids[ids.length - 1] || null) {
  const s = symbolState(editor);
  s.selected = new Set(ids);
  s.current = current;
  editor.emit('symbols');
}
