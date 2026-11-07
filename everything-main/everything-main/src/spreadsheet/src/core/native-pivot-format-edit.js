import { nativePivotPaintDelta, nativePivotClearPaint } from './native-pivot-paint-delta.js';
import { writeNativePivotPaint } from './native-pivot-paint-xml.js';
import { readNativePivotLayout } from './native-pivot-layout.js';
import { appendNativePivotFormats } from './native-pivot-format-write.js';
import { readNativePivotFormats, nativePivotFormatLayers } from './native-pivot-formats.js';
import { nativePivotPaintLayers } from './native-pivot-paint.js';
import { layerDifferentialStyle } from './style-values.js';
import { effectiveColorPalette } from './font-color.js';
import { patchRichText, richTextValue } from './rich-text.js';
import { cellKey } from './cell.js';
import { parseRefText, MAX_ROW, MAX_COL } from './refs.js';
import { STYLE_KEYS, removeStyleResets } from './style-resets.js';
import { compactRangeRecords, forEachRangeRecordIn } from './range-records.js';

const fail = reason => { throw new Error(`Cannot edit native pivot formats: ${reason}`); };
const overlaps = (a, b) => a.r1 <= b.r2 && a.r2 >= b.r1 && a.c1 <= b.c2 && a.c2 >= b.c1;

/** Apply resolved semantic area edits to saved cells and native metadata together.
 * Callers supply the current report's rebuilt semantic layout, not a refreshed
 * or filtered replacement layout. Area generation from a worksheet selection is
 * a separate operation. We retain dormant rules and do not refresh report values
 * or infer persistent overrides from the old flattened cell formats.
 *
 * Workbook.transaction groups history but does not roll back exceptions. Resolve,
 * bound, authorize and clone the entire multi-report batch before the first write.
 * ordinaryEdits maps worksheet IDs to finite { r, c, patch } edits outside native
 * reports. They retain the normal editor patch/line-inheritance semantics and
 * share the same authorization, cell/work budgets and undo transaction.
 * Optional nativeCellEdits retains editor patch intent for every painted native
 * cell, but only after its resolved delta matches the complete authored paint.
 * clearFormats restores worksheet defaults and removes rich text plus inherited
 * exceptions; its complete reset paint must match every authored native cell.
 * replaceStyles uses complete format-paste semantics and retains target rich text
 * and link markers; omitted source properties clear direct/inherited formats.
 */
export function applyNativePivotFormats(wb, updates, { maxCells = 1048576, maxFormats = 1048576,
  maxWork = 4 * 1048576, maxXmlLength = 16 * 1024 * 1024, ordinaryEdits = new Map(), nativeCellEdits = new Map(),
  defaultFont = null, defaultSize = null, locale, clearFormats = false, replaceStyles = false, prepareOnly = false } = {}) {
  if (![maxCells, maxFormats, maxWork, maxXmlLength].every(n => Number.isSafeInteger(n) && n >= 0)
    || !Array.isArray(updates) || updates.length > maxFormats || !(ordinaryEdits instanceof Map) || !(nativeCellEdits instanceof Map)) fail('limits');
  if (!updates.length && !ordinaryEdits.size && !nativeCellEdits.size) return false;
  if (clearFormats && replaceStyles) fail('conflicting style modes');
  if ((clearFormats || replaceStyles) && updates.some(update => update.edits?.length) && !nativeCellEdits.size) fail('replacement requires native cell intent');
  const previous = wb.nativePivots;
  if (!previous) fail('missing native pivots');
  const palette = effectiveColorPalette(wb.colorPalette);
  const themes = { fontTheme: wb.fontTheme, themeElements: { clrScheme: palette.theme.map(rgb => ({ rgb: rgb?.slice(1) })) }, indexedColors: palette.indexed.map(rgb => rgb?.slice(1)) };
  const seen = new Set(), bySheet = new Map(), reports = new Map(), workBudget = { remaining: maxWork };
  const owners = new Set([...updates.map(update => update?.pivot?.owner), ...ordinaryEdits.keys()]);
  for (const pivot of previous.tables) {
    if (!owners.has(pivot.owner)) continue;
    if (!reports.has(pivot.owner)) reports.set(pivot.owner, []);
    const range = parseRefText(pivot.ref || '');
    if (!range) fail('report bounds');
    reports.get(pivot.owner).push({ range, pivot });
  }
  let next = previous, cellCount = 0;
  for (const { pivot, layout, edits } of updates) {
    if (!previous.tables.includes(pivot) || seen.has(pivot)) fail('stale or duplicate report');
    seen.add(pivot);
    const sheet = wb.sheet(pivot.owner);
    if (!sheet || sheet.kind === 'chart') fail('missing worksheet');
    if (sheet.protected || sheet.externalCache) fail('protected sheet');
    const cache = previous.caches.find(c => c.key === pivot.cache);
    if (!cache) fail('missing report cache');
    const saved = readNativePivotLayout(pivot, cache);
    const signature = axis => ({ fields: axis.fields, items: axis.items.map(item => ({ type: item.type, measure: item.measure,
      members: item.members.map(member => ({ field: member.field, item: member.item, index: member.index, type: member.type })) })) });
    // A recalculated/filtered layout can retain its outer rectangle while moving
    // members. Never paint the saved worksheet using those new coordinates.
    const layoutWork = saved.rows.items.length + saved.columns.items.length
      + saved.fields.reduce((n, f) => n + f.items.length, 0) + saved.cacheFields.reduce((n, f) => n + f.items.length, 0);
    if (layoutWork > workBudget.remaining) fail('work limit');
    workBudget.remaining -= layoutWork;
    for (const key of ['firstDataRow', 'firstDataCol', 'indent', 'mergeItem', 'fields', 'cacheFields', 'measures']) {
      if (JSON.stringify(layout[key]) !== JSON.stringify(saved[key])) fail('stale report layout');
    }
    for (const key of ['rows', 'columns']) if (JSON.stringify(signature(layout[key])) !== JSON.stringify(signature(saved[key]))) fail('stale report axes');
    const beforeCount = readNativePivotFormats(pivot, next, { maxFormats }).length;
    next = appendNativePivotFormats(next, pivot, layout, edits, { palette, themes, maxFormats, maxWork, maxXmlLength, workBudget });
    if (!edits.length) continue;
    const replacement = next.tables[previous.tables.indexOf(pivot)];
    const rules = readNativePivotFormats(replacement, next, { maxFormats }).slice(beforeCount);
    const layers = nativePivotPaintLayers(nativePivotFormatLayers(layout, rules, { maxRanges: maxFormats, maxWork, workBudget }), themes, { numberFormats: next.formats });
    if (!bySheet.has(sheet)) bySheet.set(sheet, new Map());
    const cells = bySheet.get(sheet);
    for (const layer of layers) {
      const g = layer.range, size = (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1);
      if (size > workBudget.remaining) fail('work limit');
      workBudget.remaining -= size;
      if (sheet.protectedRanges.some(p => overlaps(g, p.range))) fail('protected range');
      if (sheet.merges.some(m => overlaps(g, m))) fail('merged cells');
      forEachRangeRecordIn(reports.get(sheet.id), g, record => { if (record.pivot !== pivot) fail('overlapping report'); });
      for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
        const key = cellKey(r, c);
        let entry = cells.get(key);
        if (!entry) {
          if (++cellCount > maxCells) fail('cell limit');
          const cell = structuredClone(sheet.cells.get(key) || { v: null, f: null });
          cell.s = { ...cell.s };
          entry = { r, c, cell, ...(nativeCellEdits.size ? { paint: {} } : {}) }; cells.set(key, entry);
        }
        layerDifferentialStyle(entry.cell.s, layer.style, g, r, c);
        if (entry.paint) layerDifferentialStyle(entry.paint, layer.style, g, r, c);
        if (entry.cell.richText) entry.cell.richText = patchRichText(entry.cell.richText, richTextValue(entry.cell.richText), layer.style);
      }
    }
  }
  if (nativeCellEdits.size) {
    let matched = 0;
    const encoded = new Map();
    const encode = paint => {
      const key = JSON.stringify(paint);
      if (!encoded.has(key)) encoded.set(key, writeNativePivotPaint(paint, { palette, numberFormatId: 0 }));
      return encoded.get(key);
    };
    for (const [owner, edits] of nativeCellEdits) {
      const sheet = wb.sheet(owner), cells = bySheet.get(sheet), seen = new Set();
      if (!sheet || !Array.isArray(edits)) fail('native cell patches');
      for (const { r, c, patch } of edits) {
        if (--workBudget.remaining < 0) fail('work limit');
        const key = cellKey(r, c), entry = cells?.get(key);
        if (!Number.isSafeInteger(r) || !Number.isSafeInteger(c) || !entry || seen.has(key)) fail('missing or duplicate native cell patch');
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail('native cell patch');
        seen.add(key); matched++;
        const ownPatch = structuredClone(patch), style = replaceStyles ? wb.replacedCellStyle(owner, r, c, ownPatch) : wb.patchedCellStyle(owner, r, c, ownPatch);
        const after = { ...wb._lineStyle(sheet, r, c), ...style };
        const delta = clearFormats ? nativePivotClearPaint(wb, sheet, { defaultFont, defaultSize, locale })
          : nativePivotPaintDelta(after, replaceStyles ? STYLE_KEYS : Object.keys(ownPatch), { defaultFont, defaultSize, locale });
        if (encode(delta) !== encode(entry.paint)) fail('native rule and editor patch disagree');
        // Retain named formats, inactive editor details and sparse inheritance
        // resets instead of storing the DXF's always-custom number-format form.
        const cell = structuredClone(sheet.cells.get(key) || { v: null, f: null });
        if (style) cell.s = structuredClone(style); else delete cell.s;
        if (cell.richText && !replaceStyles) cell.richText = patchRichText(cell.richText, richTextValue(cell.richText), ownPatch);
        entry.cell = cell;
      }
    }
    if (matched !== cellCount) fail('incomplete native cell patches');
  }
  for (const [owner, edits] of ordinaryEdits) {
    const sheet = wb.sheet(owner);
    if (!sheet || sheet.kind === 'chart' || !Array.isArray(edits)) fail('ordinary worksheet edits');
    if (sheet.protected || sheet.externalCache) fail('protected sheet');
    if (!bySheet.has(sheet)) bySheet.set(sheet, new Map());
    const cells = bySheet.get(sheet);
    for (const { r, c, patch } of edits) {
      if (--workBudget.remaining < 0) fail('work limit');
      if (!Number.isSafeInteger(r) || !Number.isSafeInteger(c) || r < 0 || c < 0 || r > MAX_ROW || c > MAX_COL) fail('ordinary cell bounds');
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail('ordinary style patch');
      const key = cellKey(r, c);
      if (cells.has(key)) fail('duplicate ordinary cell');
      forEachRangeRecordIn(reports.get(owner) || [], { r1: r, r2: r, c1: c, c2: c }, () => fail('ordinary edit overlaps native report'));
      if (wb._protectedAt(sheet, r, c)) fail('protected range');
      if (++cellCount > maxCells) fail('cell limit');
      // The workbook owns patch semantics, including explicit inherited resets
      // and spill number formats. Never accept replacement cell content here.
      const ownPatch = structuredClone(patch);
      const cell = structuredClone(sheet.cells.get(key) || { v: null, f: null });
      const style = replaceStyles ? wb.replacedCellStyle(owner, r, c, ownPatch) : wb.patchedCellStyle(owner, r, c, ownPatch);
      if (style) cell.s = structuredClone(style); else delete cell.s;
      if (cell.richText && !replaceStyles) cell.richText = patchRichText(cell.richText, richTextValue(cell.richText), ownPatch);
      cells.set(key, { r, c, cell });
    }
  }
  if (next === previous && !cellCount) return false;
  const prepared = [...bySheet].map(([sheet, cells]) => ({ sheet, entries: [...cells.values()] }));
  if (clearFormats) for (const batch of prepared) {
    const { sheet, entries } = batch;
    // Sparse inherited exceptions must be replaced as well as cell styles.
    // Prepare every record before mutation, using the same finite-range reset
    // semantics as Clear formats. Future whole-line formatting can remove these
    // exceptions; storing permanent null overrides on cells would prevent that.
    let resets = sheet.styleResets;
    const ranges = compactRangeRecords(entries.map(({ r, c }) => ({ range: { r1: r, r2: r, c1: c, c2: c } })), () => 0);
    for (const { range } of ranges) {
      workBudget.remaining -= 1 + resets.length + sheet.colStyles.size + sheet.rowStyles.size;
      if (workBudget.remaining < 0) fail('work limit');
      const keys = new Set();
      for (const [c, style] of sheet.colStyles) if (c >= range.c1 && c <= range.c2) for (const k of Object.keys(style)) keys.add(k);
      for (const [r, style] of sheet.rowStyles) if (r >= range.r1 && r <= range.r2) for (const k of Object.keys(style)) keys.add(k);
      resets = removeStyleResets(resets, range);
      if (keys.size) resets = [...resets, { range, keys: [...keys] }];
    }
    batch.resets = resets;
    for (const entry of entries) {
      const old = sheet.cells.get(cellKey(entry.r, entry.c));
      entry.cell = old ? structuredClone(old) : null;
      if (entry.cell) {
        delete entry.cell.richText;
        if (old.s?.nolink) entry.cell.s = { nolink: true }; else delete entry.cell.s;
      }
    }
  }
  for (const { sheet, entries } of prepared) if (wb._fixedWritesBlocked(sheet, entries)) fail('array formula');
  const label = 'Format pivot reports', version = wb.version;
  let committed = false;
  const commit = () => {
    if (committed || wb.version !== version || wb.nativePivots !== previous) fail('stale prepared format');
    committed = true;
    wb.transaction(label, () => {
      for (const { sheet, entries, resets } of prepared) {
        if (resets) wb._setStyleResets(sheet, resets, label);
        wb._writeCells(sheet, entries, label);
      }
      const apply = value => { wb.nativePivots = value; wb._changed('pivots'); };
      if (next !== previous) {
        apply(next);
        wb._push({ label, undo: () => apply(previous), redo: () => apply(next) });
      }
    });
    return true;
  };
  // Clipboard metadata needs these accepted cells for its own preparation.
  // Return copies so consumers cannot alter the validated cell write plan.
  return prepareOnly ? { commit, entries: new Map(prepared.map(({ sheet, entries }) => [sheet.id, structuredClone(entries)])),
    remainingWork: workBudget.remaining } : commit();
}
