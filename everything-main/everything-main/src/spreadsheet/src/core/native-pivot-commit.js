import { forEachRangeRecordAt, forEachRangeRecordIn } from './range-records.js';
import { parseRefText, MAX_ROW, MAX_COL } from './refs.js';
import { MAX_FORMAT_CODE_LENGTH } from './numfmt.js';
import { cellKey, parseKey, MAX_TEXT } from './cell.js';
import { parseModelXml, modelChildren } from './data-model-metadata.js';
import { normalizeNativePivotSlicers } from './native-pivot-slicer-storage.js';
import { readNativePivotSlicerState } from './native-pivot-slicer-state.js';
import { normalizeNativePivots } from './native-pivots.js';
import { resolveNativePivotSlicers } from './native-pivot-slicer.js';
import { readNativePivotCache } from './native-pivot-cache.js';
import { readNativePivotLayout } from './native-pivot-layout.js';
import { normalizeDataModel } from './data-model.js';
import { inspectDataModel } from './xlsx-data-model.js';
import { modelConnectionId } from './data-model-bindings.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const overlap = (a, b) => a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;
const inside = (g, r, c) => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2;
const fail = reason => { throw new Error(`Cannot commit native pivot refresh: ${reason}`); };
function range(ref) {
  const g = parseRefText(ref || '');
  if (!g || !['cell', 'range'].includes(g.kind) || !['r1', 'c1', 'r2', 'c2'].every(k => Number.isSafeInteger(g[k]))
    || g.r1 < 0 || g.c1 < 0 || g.r2 > MAX_ROW || g.c2 > MAX_COL || g.r1 > g.r2 || g.c1 > g.c2) fail('invalid report range');
  return g;
}
const area = g => (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1);

function cacheSource(cache) {
  const root = parseModelXml(cache.xml), sources = modelChildren(root, 'cacheSource', MAIN);
  if (sources.length !== 1) fail('missing or ambiguous cache source');
  const signature = node => [node.namespaceURI, node.localName,
    Array.from(node.attributes).filter(a => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/')
      .map(a => [a.namespaceURI || '', a.localName, a.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    Array.from(node.childNodes).filter(n => n.nodeType === 1 || [3, 4].includes(n.nodeType) && n.nodeValue.trim())
      .map(n => n.nodeType === 1 ? signature(n) : n.nodeValue)];
  return { node: sources[0], signature: JSON.stringify(signature(sources[0])) };
}

/** Internal commit boundary for fully materialized report plans. Each update
 * supplies the original pivot/cache objects, a replacement pivot definition and
 * one cell entry for every position in its new rectangle (including blanks),
 * plus explicit entries for stored vacated cells.
 * Formatting provenance, typed values and conditional-rule recipes must already
 * have been resolved by the planner. This does not refresh source caches, infer
 * styles or implement slicer controls. Rules are final per-sheet lists, allowing
 * several connected reports on a sheet to update without overwriting each other.
 * slicerUpdates maps current shared cache objects to prepared replacements;
 * changing a selection requires every declared report in the same batch.
 * All validation/cloning happens before the first write; no caller code runs in
 * the mutation phase. Ordinary edits must continue through Workbook.setCells.
 * cacheUpdates maps current cache objects to prepared replacements. Every
 * connected report and slicer must be supplied in the same batch. dataModelUpdate
 * supplies { previous, next } for an existing model archive with unchanged
 * binding XML; all model caches/reports must participate. Callers still own
 * model computation, member remapping, formatting and materialization.
 */
export function commitNativePivotReports(wb, updates, { rules = new Map(), slicerUpdates = new Map(), cacheUpdates = new Map(),
  dataModelUpdate = null, maxCells = 1048576, maxCacheCells = 4 * 1048576 } = {}) {
  if (!Array.isArray(updates)) return false;
  if (!Number.isSafeInteger(maxCells) || maxCells < 0 || !Number.isSafeInteger(maxCacheCells) || maxCacheCells < 0 || maxCacheCells > 16 * 1048576
    || !(rules instanceof Map) || !(slicerUpdates instanceof Map) || !(cacheUpdates instanceof Map)) fail('invalid commit options');
  if (!updates.length && !slicerUpdates.size && !cacheUpdates.size && dataModelUpdate === null) return false;
  const previous = wb.nativePivots;
  if (!previous) fail('missing native pivots');
  const previousModel = wb.dataModel;
  let nextModel = previousModel, modelSchema = null, remainingCacheCells = maxCacheCells;
  if (dataModelUpdate !== null) {
    if (!previousModel || dataModelUpdate?.previous !== previousModel) fail('stale Data Model');
    nextModel = normalizeDataModel(dataModelUpdate.next);
    if (!nextModel || nextModel.modelXml !== previousModel.modelXml || nextModel.connectionsXml !== previousModel.connectionsXml) fail('invalid or changed model bindings');
    modelSchema = inspectDataModel(nextModel); // Validate the staged archive before any worksheet write.
  }
  const nextCaches = new Map(), currentCaches = new Set(previous.caches);
  for (const [cache, replacement] of cacheUpdates) {
    if (!currentCaches.has(cache) || replacement?.key !== cache.key) fail('stale or changed cache identity');
    const normalized = normalizeNativePivots({ version: 1, caches: [replacement], tables: [] })?.caches[0];
    if (!normalized || ['sourceWorkbook', 'sourceSheetId', 'sourceRef', 'scope'].some(key =>
      (normalized[key] ?? (key === 'sourceRef' ? '' : key === 'scope' ? 'main' : null)) !== (cache[key] ?? (key === 'sourceRef' ? '' : key === 'scope' ? 'main' : null)))
      || cacheSource(cache).signature !== cacheSource(normalized).signature) fail('changed cache source');
    const parsed = readNativePivotCache(normalized, { maxCells: remainingCacheCells });
    remainingCacheCells -= parsed.fields.reduce((n, f) => n + 1 + f.items.length, 0)
      + (parsed.records?.length || 0) * Math.max(1, parsed.recordFields.length);
    nextCaches.set(cache, normalized);
  }
  const seen = new Set(), prepared = [], sheets = new Map();
  const reportRanges = new Map();
  for (const pivot of previous.tables) if (pivot.owner != null) {
    if (!reportRanges.has(pivot.owner)) reportRanges.set(pivot.owner, []);
    reportRanges.get(pivot.owner).push({ range: range(pivot.ref), pivot });
  }
  let count = 0;
  for (const update of updates) {
    const { pivot, cache, next, cells } = update;
    if (!previous.tables.includes(pivot) || !previous.caches.includes(cache) || pivot.cache !== cache.key || seen.has(pivot)) fail('stale or duplicate report');
    seen.add(pivot);
    if (!next || next.name !== pivot.name || next.owner !== pivot.owner || next.cache !== pivot.cache) fail('changed report identity');
    if (nextCaches.has(cache)) readNativePivotLayout(next, nextCaches.get(cache));
    const sheet = wb.sheet(pivot.owner);
    if (!sheet || sheet.kind === 'chart') fail('missing worksheet');
    if (sheet.protected) fail('protected sheet');
    const oldRange = range(pivot.ref), newRange = range(next.ref);
    if (oldRange.r1 !== newRange.r1 || oldRange.c1 !== newRange.c1) fail('refresh moved report origin');
    const root = parseModelXml(next.xml), locations = modelChildren(root, 'location', MAIN);
    if (root.namespaceURI !== MAIN || root.localName !== 'pivotTableDefinition' || locations.length !== 1) fail('invalid report definition');
    if (root.getAttribute('name') !== next.name) fail('inconsistent report name');
    const savedRange = range(locations[0].getAttribute('ref'));
    if (['r1', 'c1', 'r2', 'c2'].some(k => newRange[k] !== savedRange[k])) fail('inconsistent report location');
    if (!Array.isArray(cells) || area(newRange) > cells.length || (count += cells.length) > maxCells) fail('incomplete or oversized cell plan');
    const keys = new Set(), entries = [];
    let covered = 0;
    for (const entry of cells) {
      const { r, c, cell } = entry;
      if (!Number.isInteger(r) || !Number.isInteger(c) || (!inside(newRange, r, c) && !inside(oldRange, r, c)) || keys.has(cellKey(r, c))) fail('invalid or duplicate cell position');
      keys.add(cellKey(r, c));
      if (inside(newRange, r, c)) covered++;
      if (cell != null) {
        if (typeof cell !== 'object' || Array.isArray(cell) || cell.f != null || cell.array != null || cell.richText != null || cell.hyperlink != null) fail('unmaterialized cell');
        if (cell.s != null && (typeof cell.s !== 'object' || Array.isArray(cell.s))) fail('invalid cell style');
        if (cell.s?.fmt === 'custom' && (typeof cell.s.code !== 'string' || cell.s.code.length > MAX_FORMAT_CODE_LENGTH)) fail('invalid number format');
        const v = cell.v;
        if (v != null && !['string', 'boolean', 'number'].includes(typeof v) && !(typeof v === 'object' && typeof v.error === 'string' && Object.keys(v).length === 1)) fail('invalid cell value');
        if (typeof v === 'number' && !Number.isFinite(v) || typeof v === 'string' && v.length > MAX_TEXT) fail('invalid cell value');
      }
      entries.push({ r, c, cell: cell == null ? null : structuredClone(cell) });
    }
    if (covered !== area(newRange)) fail('incomplete new rectangle');
    const regions = [oldRange, newRange];
    for (const protectedRange of sheet.protectedRanges) if (regions.some(g => overlap(g, protectedRange.range))) fail('protected range');
    for (const g of regions) {
      if (sheet.tables.some(t => overlap(g, t.range))) fail('table overlap');
      if (sheet.merges.some(m => overlap(g, m))) fail('merged cells');
      if (wb._fixedArrays(sheet).overlapping(g).next().value) fail('array formula');
      forEachRangeRecordIn(reportRanges.get(sheet.id) || [], g, record => { if (record.pivot !== pivot) fail('another pivot report'); });
    }
    if ([root, parseModelXml(pivot.xml)].some(node => modelChildren(node, 'conditionalFormats', MAIN).length) && !rules.has(sheet.id)) fail('missing conditional rule plan');
    sheets.set(sheet.id, sheet);
    prepared.push({ pivot, next: structuredClone(next), sheet, oldRange, newRange, entries, keys });
  }
  const bySheet = new Map();
  for (const p of prepared) {
    if (!bySheet.has(p.sheet.id)) bySheet.set(p.sheet.id, []);
    bySheet.get(p.sheet.id).push(p);
  }
  for (const [id, reports] of bySheet) {
    const sheet = sheets.get(id);
    const regions = reports.flatMap(report => [{ range: report.oldRange, report }, { range: report.newRange, report }]);
    const destinations = reports.map(report => ({ range: report.newRange, report }));
    for (const record of destinations) forEachRangeRecordIn(destinations, record.range, other => {
      if (record !== other) fail('overlapping refreshed reports');
    });
    // One sparse scan per affected sheet, indexed against report rectangles.
    // The caller owns vacated formatting; no direct style is erased by inference.
    for (const [key, cell] of sheet.cells) {
      const { r, c } = parseKey(key);
      forEachRangeRecordAt(regions, r, c, ({ report: p }) => {
        if (inside(p.oldRange, r, c) && !inside(p.newRange, r, c) && !p.keys.has(key)) fail('missing vacated cell plan');
        if (inside(p.newRange, r, c) && !inside(p.oldRange, r, c) && (cell.v != null || cell.f != null || cell.richText || cell.hyperlink)) fail('occupied expansion');
      });
    }
    // Discover array candidates once, rather than calculating every unrelated
    // scalar formula for each report. Anchors outside the output still matter.
    for (const spill of wb._ensureSpills(sheet).anchors.values()) {
      const g = { r1: spill.r, c1: spill.c, r2: spill.r + spill.rows - 1, c2: spill.c + spill.cols - 1 };
      forEachRangeRecordIn(regions, g, () => fail('spill formula'));
    }
  }
  const nextRules = new Map();
  for (const [id, list] of rules) {
    if (!sheets.has(id) || !Array.isArray(list)) fail('invalid conditional rule plan');
    nextRules.set(id, structuredClone(list));
  }
  const replacements = new Map(prepared.map(p => [p.pivot, p.next]));
  if (modelSchema) {
    const ids = new Set(), counts = new Map();
    for (const connection of modelSchema.bindings.connections) {
      const id = modelConnectionId(connection.id); counts.set(id, (counts.get(id) || 0) + 1);
    }
    for (const connection of modelSchema.bindings.connections.filter(c => c.model)) {
      const id = modelConnectionId(connection.id);
      if (id === null || counts.get(id) !== 1) fail('ambiguous model connection');
      ids.add(id);
    }
    for (const cache of previous.caches) {
      const { node } = cacheSource(cache);
      if (node.getAttribute('type') === 'external' && ids.has(modelConnectionId(node.getAttribute('connectionId'))) && !nextCaches.has(cache)) fail('missing model cache update');
    }
  }
  const changedCacheKeys = new Set([...nextCaches.keys()].map(c => c.key));
  if (previous.tables.some(p => changedCacheKeys.has(p.cache) && !seen.has(p))) fail('missing connected report update');
  if (previous.slicers?.some(s => changedCacheKeys.has(s.cache) && !slicerUpdates.has(s))) fail('missing connected slicer update');
  const next = { ...previous, tables: previous.tables.map(p => replacements.get(p) || p),
    ...(nextCaches.size ? { caches: previous.caches.map(c => nextCaches.get(c) || c) } : {}) };
  if (slicerUpdates.size) {
    const currentSlicers = new Set(previous.slicers), preparedSlicers = new Map(), states = [];
    for (const slicer of slicerUpdates.keys()) if (!currentSlicers.has(slicer)) fail('stale slicer cache');
    const normalizedSlicers = normalizeNativePivotSlicers([...slicerUpdates.values()], next);
    const identity = p => JSON.stringify([p.owner, p.name]);
    const connectedReports = new Map(previous.tables.map(p => [identity(p), p]));
    let index = 0;
    for (const slicer of slicerUpdates.keys()) {
      const normalized = normalizedSlicers[index++];
      const oldState = readNativePivotSlicerState(slicer), newState = readNativePivotSlicerState(normalized);
      states.push(newState);
      if (normalized.name !== slicer.name || normalized.cache !== slicer.cache || oldState.sourceName !== newState.sourceName
        || JSON.stringify(normalized.connections) !== JSON.stringify(slicer.connections)) fail('changed slicer identity');
      const oldItems = new Set(oldState.items.filter(item => item.selected).map(item => item.index));
      const newItems = new Set(newState.items.filter(item => item.selected).map(item => item.index));
      if (oldItems.size !== newItems.size || [...oldItems].some(index => !newItems.has(index))) {
        // A shared selection cannot advance while any connected report still
        // displays its previous selection. Availability-only edits need no cells.
        for (const connection of slicer.connections) if (!seen.has(connectedReports.get(identity(connection)))) fail('missing connected report update');
      }
      preparedSlicers.set(slicer, normalized);
    }
    resolveNativePivotSlicers(states, next, wb.sheets);
    next.slicers = previous.slicers.map(slicer => preparedSlicers.get(slicer) || slicer);
    if (!normalizeNativePivots(next)) fail('invalid slicer storage');
  }
  if (nextCaches.size && !normalizeNativePivots(next)) fail('invalid cache storage');
  const label = 'Refresh pivot reports';
  wb.transaction(label, () => {
    for (const p of prepared) wb._writeCells(p.sheet, p.entries, label);
    for (const [id, list] of nextRules) wb._setRules(sheets.get(id), list, label);
    const apply = (value, model) => { wb.nativePivots = value; if (dataModelUpdate !== null) wb.dataModel = model; wb._changed('pivots'); };
    apply(next, nextModel);
    wb._push({ label, undo: () => apply(previous, previousModel), redo: () => apply(next, nextModel) });
  });
  return true;
}
