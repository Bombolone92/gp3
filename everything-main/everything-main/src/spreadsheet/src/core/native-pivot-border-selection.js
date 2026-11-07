import { formatNativePivotSelection, prepareNativePivotCellPatch } from './native-pivot-style-selection.js';
import { cellBorderGesturePatch } from './border-regions.js';
import { cellKey } from './cell.js';
import { MAX_ROW, MAX_COL } from './refs.js';

const kinds = new Set(['all', 'outer', 'inner', 'horizontal', 'vertical', 'top', 'bottom', 'left', 'right', 'none', 'restyle']);
const fail = reason => { throw new Error(`Cannot format native pivot borders: ${reason}`); };

/** Prepare a style patch followed by border actions as one native edit.
 * Ranges are ordered, already split at filter-hidden rows by the caller. An
 * overlapping cell accumulates each range's patch and gestures in command order.
 * Whole-line defaults and merged-cell border summaries need separate semantics.
 */
export function formatNativePivotStyleAndBorders(wb, selections, patch, borders, {
  maxCells = 1048576, maxWork = 4 * 1048576, ...options } = {}) {
  if (!(selections instanceof Map) || !patch || typeof patch !== 'object' || Array.isArray(patch) || typeof patch.then === 'function'
    || !Array.isArray(borders) || borders.some(b => !b || !kinds.has(b.kind))
    || ![maxCells, maxWork].every(n => Number.isSafeInteger(n) && n >= 0) || borders.length > maxWork) fail('selection or limits');
  const ownPatch = prepareNativePivotCellPatch(patch)?.ownPatch || {}, actions = structuredClone(borders);
  if (!actions.length) return formatNativePivotSelection(wb, selections, ownPatch, { ...options, maxCells, maxWork });
  const prepared = new Map(); let count = 0, remaining = maxWork - actions.length;
  for (const [owner, ranges] of selections) {
    const sheet = wb.sheet(owner);
    if (!sheet || !Array.isArray(ranges)) fail('worksheet');
    const cells = new Map(); prepared.set(owner, cells);
    for (const g of ranges) {
      if (!g || g.scope && g.scope !== 'cells' || !['r1', 'r2', 'c1', 'c2'].every(k => Number.isSafeInteger(g[k]))
        || g.r1 < 0 || g.c1 < 0 || g.r1 > g.r2 || g.c1 > g.c2 || g.r2 > MAX_ROW || g.c2 > MAX_COL) fail('finite range');
      remaining -= 1 + (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1) * (1 + actions.length);
      if (remaining < 0) fail('work limit');
      if (wb.mergesIn(owner, g).length) fail('merged cells');
      for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
        const key = cellKey(r, c); let entry = cells.get(key);
        if (!entry) {
          if (++count > maxCells) fail('cell limit');
          entry = { style: wb.getCell(owner, r, c)?.s, keys: new Set() }; cells.set(key, entry);
        }
        const apply = delta => {
          if (!delta) return;
          entry.style = wb.patchedCellStyle(owner, r, c, delta, { baseStyle: entry.style });
          for (const k of Object.keys(delta)) entry.keys.add(k);
        };
        apply(ownPatch);
        for (const action of actions) {
          const effective = { ...wb._lineStyle(sheet, r, c), ...entry.style };
          apply(cellBorderGesturePatch(effective, g, r, c, action.kind, action));
        }
      }
    }
  }
  return formatNativePivotSelection(wb, selections, (owner, r, c) => {
    const entry = prepared.get(owner)?.get(cellKey(r, c));
    if (!entry) return null;
    // Apply final side descriptors after shared pen edits. Keep explicit reset
    // provenance even when the prepared sparse cell style no longer owns a key.
    const keys = [...new Set(['bc', 'bs', ...entry.keys])].filter(k => entry.keys.has(k));
    return Object.fromEntries(keys.map(k => [k, entry.style?.[k] ?? null]));
  }, { ...options, maxCells, maxWork: remaining });
}

export function formatNativePivotBorders(wb, selections, kind, { color, style, ...options } = {}) {
  return formatNativePivotStyleAndBorders(wb, selections, {}, [{ kind, color, style }], options);
}
