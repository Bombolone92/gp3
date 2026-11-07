import { STYLE_KEYS } from './style-resets.js';
import { readNativePivotLayout } from './native-pivot-layout.js';
import { nativePivotPaintDelta, nativePivotClearPaint } from './native-pivot-paint-delta.js';
import { nativePivotSelectionAreas } from './native-pivot-selection-areas.js';
import { applyNativePivotFormats } from './native-pivot-format-edit.js';
import { parseRefText, MAX_ROW, MAX_COL } from './refs.js';
import { cellKey } from './cell.js';
import { compactRangeRecords, forEachRangeRecordAt } from './range-records.js';

const fail = reason => { throw new Error(`Cannot format native pivot selection: ${reason}`); };

/** Own and validate a cell patch before composition can normalize its fields. */
export function prepareNativePivotCellPatch(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value) || typeof value.then === 'function') fail('synchronous style patch');
  const ownPatch = structuredClone(value), keys = Object.keys(ownPatch);
  // Region-wide inside edges are not individual cell styles.
  if (keys.some(key => /^(?:bh|bv)(?:Border)?$/.test(key))) fail('region borders are not cell patches');
  for (const key of ['btBorder', 'bbBorder', 'blBorder', 'brBorder']) {
    const pen = ownPatch[key];
    if (pen != null && (typeof pen !== 'object' || Array.isArray(pen)
      || Object.keys(pen).some(k => !['bs', 'bc'].includes(k) || pen[k] != null && typeof pen[k] !== 'string'))) fail('cell border pen');
  }
  return keys.length ? { ownPatch, keys } : null;
}

/** Format a finite multi-sheet selection with a UI-style patch or a pure,
 * synchronous (owner, row, column) patch resolver. A null/empty result skips a
 * cell; overlapping ranges resolve each cell once against the unchanged workbook.
 * All ordinary cells, semantic report selections and effective paint deltas are prepared
 * before the atomic edit boundary. This does not refresh source data or values.
 * Border patches describe resolved cell edges, not selection gestures. Whole-line
 * defaults and unsupported native selectors require their own editing semantics;
 * callers must not silently fall back after failure.
 */
export function formatNativePivotSelection(wb, selections, patch, { maxCells = 1048576, maxFormats = 1048576,
  maxWork = 4 * 1048576, maxXmlLength = 16 * 1024 * 1024, defaultFont = null, defaultSize = null, locale, clearFormats = false, replaceStyles = false, prepareOnly = false } = {}) {
  const resolvePatch = typeof patch === 'function' ? patch : null;
  if (!(selections instanceof Map) || !resolvePatch && (!patch || typeof patch !== 'object' || Array.isArray(patch))
    || ![maxCells, maxFormats, maxWork, maxXmlLength].every(n => Number.isSafeInteger(n) && n >= 0)) fail('selection or limits');
  if (clearFormats && replaceStyles) fail('conflicting style modes');
  if (!wb.nativePivots) fail('missing native pivots');
  const empty = { ownPatch: {}, keys: [] };
  const uniform = clearFormats ? empty : resolvePatch ? null : prepareNativePivotCellPatch(patch) || (replaceStyles ? empty : null);
  if (!resolvePatch && !uniform || !selections.size) return false;
  const workBudget = { remaining: maxWork };
  const charge = n => { workBudget.remaining -= n; if (workBudget.remaining < 0) fail('work limit'); };
  const reports = new Map(), ordinaryEdits = new Map(), nativeCellEdits = new Map();
  let count = 0;
  for (const [owner, ranges] of selections) {
    const sheet = wb.sheet(owner);
    if (!sheet || sheet.kind === 'chart' || !Array.isArray(ranges)) fail('worksheet selection');
    if (sheet.protected || sheet.externalCache) fail('protected sheet');
    const candidates = wb.nativePivots.tables.filter(p => p.owner === owner).map(pivot => {
      const range = parseRefText(pivot.ref || '');
      if (!range) fail('report bounds');
      return { range, pivot };
    });
    const seen = new Set(), ordinary = [];
    for (const g of ranges) {
      charge(1);
      if (!g || g.scope && g.scope !== 'cells' || !['r1', 'c1', 'r2', 'c2'].every(k => Number.isSafeInteger(g[k]))
        || g.r1 < 0 || g.c1 < 0 || g.r2 > MAX_ROW || g.c2 > MAX_COL || g.r1 > g.r2 || g.c1 > g.c2) fail('finite cell range');
      if (clearFormats && wb._wholeLines(sheet, g)) fail('whole-line clear');
      charge((g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1));
      for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
        const key = cellKey(r, c);
        if (seen.has(key)) continue;
        seen.add(key); if (++count > maxCells) fail('cell limit');
        if (wb._protectedAt(sheet, r, c)) fail('protected range');
        const raw = resolvePatch && !clearFormats ? resolvePatch(owner, r, c) : null;
        const prepared = clearFormats ? uniform : resolvePatch ? prepareNativePivotCellPatch(raw) || (replaceStyles && raw != null ? empty : null) : uniform;
        if (!prepared) continue;
        const { ownPatch, keys } = prepared;
        if (replaceStyles && keys.some(k => k !== 'nolink' && !STYLE_KEYS.includes(k))) fail('unsupported replacement property');
        let pivot = null;
        forEachRangeRecordAt(candidates, r, c, record => { if (pivot) fail('overlapping native reports'); pivot = record.pivot; });
        if (!pivot) { ordinary.push({ r, c, patch: ownPatch }); continue; }
        if (!nativeCellEdits.has(owner)) nativeCellEdits.set(owner, []);
        nativeCellEdits.get(owner).push({ r, c, patch: ownPatch });
        let report = reports.get(pivot);
        if (!report) {
          const cache = wb.nativePivots.caches.find(cache => cache.key === pivot.cache);
          if (!cache) fail('missing cache');
          const layout = readNativePivotLayout(pivot, cache);
          // Saved axis XML omits these presentation flags. Derive outline
          // headers from the same field settings used by axis regeneration.
          const depth = layout.rows.fields.filter(field => field !== -2).length;
          layout.rows = { ...layout.rows, items: layout.rows.items.map(entry => {
            charge(1 + entry.members.length);
            if (entry.type !== 'data' || !entry.members.length || entry.members.length >= depth) return entry;
            const member = entry.members.at(-1), field = layout.fields[member.field];
            if (field?.outline === false || field?.items[member.item]?.details === false) return entry;
            return { ...entry, header: true, aggregate: field.defaultSubtotal !== false && field.subtotalTop !== false };
          }) };
          report = { pivot, layout, paints: new Map() }; reports.set(pivot, report);
        }
        const cellStyle = replaceStyles ? wb.replacedCellStyle(owner, r, c, ownPatch) : wb.patchedCellStyle(owner, r, c, ownPatch);
        const after = { ...wb._lineStyle(sheet, r, c), ...cellStyle };
        const style = clearFormats ? nativePivotClearPaint(wb, sheet, { defaultFont, defaultSize, locale })
          : nativePivotPaintDelta(after, replaceStyles ? STYLE_KEYS : keys, { defaultFont, defaultSize, locale });
        const identity = JSON.stringify(style);
        if (!report.paints.has(identity)) report.paints.set(identity, { style, cells: [] });
        report.paints.get(identity).cells.push({ range: { r1: r, r2: r, c1: c, c2: c } });
      }
    }
    if (ordinary.length) ordinaryEdits.set(owner, ordinary);
  }
  const updates = []; let areaCount = 0, xmlLength = 0;
  for (const { pivot, layout, paints } of reports.values()) {
    const edits = [];
    for (const { style, cells } of paints.values()) {
      charge(cells.length);
      // Editor patches name cell sides. outline=0 applies those sides to
      // every selected member, including interior cells of a semantic area.
      const paint = ['bt', 'bb', 'bl', 'br'].some(key => Object.hasOwn(style, key))
        ? { ...style, borderOutline: false } : style;
      const ranges = compactRangeRecords(cells, () => 0).map(record => record.range);
      const areas = nativePivotSelectionAreas(layout, ranges, { maxAreas: maxFormats - areaCount,
        maxWork: workBudget.remaining, maxXmlLength: maxXmlLength - xmlLength, workBudget });
      areaCount += areas.length;
      for (const area of areas) { xmlLength += area.length; edits.push({ area, style: paint }); }
    }
    updates.push({ pivot, layout, edits });
  }
  return applyNativePivotFormats(wb, updates, { ordinaryEdits, nativeCellEdits, defaultFont, defaultSize, locale, clearFormats, replaceStyles, prepareOnly,
    maxCells, maxFormats, maxXmlLength, maxWork: workBudget.remaining });
}

/** Clear a finite selection's direct, inherited and native report formatting together. */
export function clearNativePivotSelection(wb, selections, options = {}) {
  return formatNativePivotSelection(wb, selections, {}, { ...options, clearFormats: true });
}

/** Paste a complete style block with the ordinary format painter's tiling geometry. */
export function pasteNativePivotStyles(wb, owner, cells, r, c, target = null, options = {}) {
  if (!Array.isArray(cells) || !cells.length || !Array.isArray(cells[0]) || !cells[0].length
    || cells.some(row => !Array.isArray(row) || row.length !== cells[0].length)
    || !Number.isSafeInteger(r) || !Number.isSafeInteger(c) || r < 0 || c < 0) fail('style paste block');
  const range = wb.stylePasteRange(owner, cells, r, c, target);
  if (!range) return false;
  return formatNativePivotSelection(wb, new Map([[owner, [range]]]), (_, row, col) =>
    cells[(row - r) % cells.length][(col - c) % cells[0].length]?.s || {},
  { ...options, clearFormats: false, replaceStyles: true });
}

/** Clipboard format paste commits native paint and clipboard metadata together. */
export function pasteNativePivotClipboardStyles(wb, owner, cells, r, c, target = null, {
  merges = null, conditionalFormats = null, externalWorkbooks = null, ...options } = {}) {
  const prepared = pasteNativePivotStyles(wb, owner, cells, r, c, target, { ...options, prepareOnly: true });
  if (!prepared) return false;
  const extras = wb._prepareStylePasteExtras(owner, prepared.entries.get(owner), cells, r, c, target,
    { merges, conditionalFormats, externalWorkbooks, maxWork: prepared.remainingWork });
  if (!extras) return false;
  const label = 'Paste formatting';
  wb.transaction(label, () => {
    prepared.commit();
    if (extras.externalWorkbooks) wb._structural(label, () => { wb.externalWorkbooks = extras.externalWorkbooks; });
    if (extras.merges) wb._setMerges(extras.sheet, extras.merges, label);
    if (extras.rules) wb._setRules(extras.sheet, extras.rules, label);
  });
  return true;
}
