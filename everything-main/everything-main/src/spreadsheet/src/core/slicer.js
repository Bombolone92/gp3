import { normalizeSlicerFormat } from './slicer-format.js';
import { tokenize } from './formula/tokenizer.js';
import { parseTableSpec, renderTableSpec, resolveTableSpec } from './tables.js';
import { filterTable } from './sheet-filters.js';
import { readNativePivotSlicerState } from './native-pivot-slicer-state.js';
import { resolveNativePivotSlicers } from './native-pivot-slicer.js';
import { setNativePivotSlicerSelection } from './native-pivot-slicer-edit.js';
import { formatValue } from './format.js';
import { sheetKey } from './refs.js';
import { nativePivotSlicerAvailability } from './native-pivot-slicer-availability.js';
import { pivotDateSerial } from './timeline.js';

export function slicerPivotCache(wb, control) {
  if (typeof control?.pivotCache !== 'string') return null;
  return wb.nativePivots?.slicers?.find(cache => sheetKey(cache.name) === sheetKey(control.pivotCache)) || null;
}

// Definitions are immutable across edits, so multiple views share one decoded
// member list until selection, report metadata or source-cache data changes.
const pivotViews = new WeakMap();
function pivotSlicerItems(wb, control) {
  const cache = slicerPivotCache(wb, control);
  if (!cache) return null;
  let decoded = pivotViews.get(wb.nativePivots);
  if (!decoded) { decoded = new Map(); pivotViews.set(wb.nativePivots, decoded); }
  if (!decoded.has(cache)) {
    const state = readNativePivotSlicerState(cache);
    const binding = resolveNativePivotSlicers([state], wb.nativePivots, wb.sheets).get(state);
    let hidden = null;
    if (state.crossFilter === 'none' && state.hideItemsWithNoData) {
      const contexts = [...nativePivotSlicerAvailability([cache], wb.nativePivots, wb.sheets).get(cache).values()];
      if (!contexts.length || contexts.some(items => items.some((item, i) => item.hidden !== contexts[0][i].hidden))) throw new Error('Shared slicer visibility across different report contexts is not implemented');
      hidden = new Set(contexts[0].filter(item => item.hidden).map(item => item.index));
    }
    decoded.set(cache, { state, field: binding.field, hidden });
  }
  const { state, field, hidden } = decoded.get(cache);
  const code = field.numFmtId == null ? null : wb.nativePivots.formats[field.numFmtId];
  return state.items.map(item => {
    const member = field.items[item.index];
    // A date member is a native date-time; it reads as the field's format shows it, else as a short date.
    const date = member.caption == null && member.type === 'date' ? pivotDateSerial(member.value) : null;
    if (member.caption == null && member.type === 'date' && date == null) throw new Error('Native slicer date member is invalid');
    if (member.caption == null && date == null && field.numFmtId != null && field.numFmtId !== 0 && typeof code !== 'string') throw new Error('Native slicer member number format is unavailable');
    const value = member.caption ?? (member.type === 'blank' ? '' : date != null ? formatValue(date, { fmt: 'custom', code: typeof code === 'string' && code ? code : 'm/d/yyyy' })
      : formatValue(member.value, code == null ? {} : { fmt: 'custom', code }));
    return { key: item.index, value, selected: item.selected, available: !item.noData,
      hidden: hidden ? hidden.has(item.index) : !state.showMissing && field.unused[item.index] || state.hideItemsWithNoData && item.noData };
  });
}

/** Use the formula grammar so header punctuation and escapes have one representation. */
export function slicerTableReference(tableName, columnName) {
  return `${tableName}[${renderTableSpec({ rows: 'data', cols: [columnName, columnName] })}]`;
}

/** A slicer refers to exactly one named table column, never an arbitrary cell range. */
export function slicerTarget(wb, control) {
  if (typeof control?.tableRef !== 'string') return null;
  let tokens;
  try { tokens = tokenize(control.tableRef); } catch { return null; }
  if (tokens.length !== 1 || tokens[0].type !== 'tref' || !tokens[0].table) return null;
  const { table, spec } = tokens[0], parsed = parseTableSpec(spec);
  if (!parsed || parsed.rows !== 'data' || !parsed.cols || parsed.cols[0] !== parsed.cols[1]) return null;
  const found = wb.tableByName(table);
  if (!found) return null;
  const { sheet } = found;
  const range = resolveTableSpec(found.table, wb.tableColumns(sheet.id, found.table), spec);
  if (range.error || range.c1 !== range.c2) return null;
  const filter = wb.filtersForSheet(sheet.id).find(f => filterTable(sheet, f)?.id === found.table.id);
  return filter ? { sheetId: sheet.id, table: found.table, col: range.c1, filter } : null;
}

/** Read through to the table's filter; selection is shared by every view of this column. */
export function slicerItems(wb, control) {
  if (control?.pivotCache != null) return pivotSlicerItems(wb, control);
  const target = slicerTarget(wb, control);
  if (!target) return null;
  const { sheetId, col, filter } = target;
  // Collect counts and filter state together. Slicer identity is always
  // case-insensitive, including after Clear removes the column criterion.
  let items = wb.filterValues(sheetId, col, filter, { withState: true, caseSensitive: false });
  // Hiding is independent of no-data paint: none suppresses the paint, but
  // must not erase the availability used by the hide-no-data extension.
  if (control.hideItemsWithNoData) items = items.map(item => ({ ...item, hidden: !item.available }));
  if (control.crossFilter === 'none') items = items.map(item => ({ ...item, available: true }));
  if (control.sortOrder === 'descending') items = items.filter(i => i.value !== '').reverse().concat(items.filter(i => i.value === ''));
  // MS-XLSX ST_SlicerCacheCrossFilter: 'none' also suppresses no-data paint.
  if (control.crossFilter === 'showItemsWithDataAtTop') items.sort((a, b) => Number(b.available) - Number(a.available));
  return items;
}

/** One table-filter edit, undoable without changing the active filter-menu context. null clears it. */
export function setSlicerSelection(wb, sheetId, id, values) {
  const control = wb.chartById(sheetId, id), owner = wb.sheet(sheetId);
  if (control?.type !== 'slicer' || !owner || wb._locked(owner)) return false;
  if (control.pivotCache != null) {
    const cache = slicerPivotCache(wb, control);
    return cache ? setNativePivotSlicerSelection(wb, cache, values) : false;
  }
  const target = slicerTarget(wb, control);
  if (!target || wb._gridLocked(wb.sheet(target.sheetId))) return false;
  if (values !== null && (!Array.isArray(values) || values.some(v => typeof v !== 'string'))) return false;
  // Reject stale item choices rather than turning a changed list into an accidental empty filter.
  if (values !== null) {
    const items = new Set(wb.filterValues(target.sheetId, target.col, target.filter).map(i => i.value));
    if (values.some(v => !items.has(v))) return false;
  }
  wb.setFilterCriteria(target.sheetId, target.col, values === null ? null : { values: [...new Set(values)], caseSensitive: false }, target.filter);
  return true;
}

export function normalizeSlicer(raw) {
  if (!raw?.anchor) return null;
  const pivot = raw.pivotCache != null;
  if (pivot ? typeof raw.pivotCache !== 'string' || !raw.pivotCache || raw.pivotCache.length > 8192 || raw.tableRef != null
    : typeof raw.tableRef !== 'string' || !raw.tableRef || raw.tableRef.length > 8192) return null;
  const names = {};
  for (const [key, limit] of [['nativeName', 32767], ['nativeCacheName', 255]]) if (raw[key] != null) {
    if (typeof raw[key] !== 'string' || !raw[key] || raw[key].length > limit * 2 || [...raw[key]].length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(raw[key])) throw new Error('Invalid stored slicer name');
    names[key] = raw[key];
  }
  const finite = (v, fallback) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const anchor = { r: Math.max(0, Math.min(1048575, Math.trunc(finite(raw.anchor.r, 0)))), c: Math.max(0, Math.min(16383, Math.trunc(finite(raw.anchor.c, 0)))) };
  return { id: raw.id, type: 'slicer', anchor, ...names,
    range: { r1: anchor.r, c1: anchor.c, r2: anchor.r, c2: anchor.c },
    ...(raw.paint != null ? { paint: normalizeSlicerFormat(raw.paint) } : {}),
    ...(pivot ? { pivotCache: raw.pivotCache } : { tableRef: raw.tableRef }), title: typeof raw.title === 'string' ? raw.title.slice(0, 32767) : '',
    description: typeof raw.description === 'string' ? raw.description.slice(0, 32767) : '',
    dx: finite(raw.dx, 0), dy: finite(raw.dy, 0), w: Math.max(0, finite(raw.w, 160)), h: Math.max(0, finite(raw.h, 200)),
    ...(raw.anchorMode === 'absolute' ? { anchorMode: 'absolute' } : {}),
    columnCount: Math.max(1, Math.min(20000, Math.trunc(finite(raw.columnCount, 1)))),
    rowHeight: Math.max(0, Math.min(4294967295, Math.trunc(finite(raw.rowHeight, 20 * 9525)))),
    startItem: Math.max(0, Math.min(4294967295, Math.trunc(finite(raw.startItem, 0)))),
    showCaption: raw.showCaption !== false, lockedPosition: raw.lockedPosition === true,
    print: raw.print !== false, hidden: raw.hidden === true,
    sortOrder: raw.sortOrder === 'descending' ? 'descending' : 'ascending',
    customListSort: raw.customListSort !== false,
    hideItemsWithNoData: raw.hideItemsWithNoData === true,
    crossFilter: ['none', 'showItemsWithNoData'].includes(raw.crossFilter) ? raw.crossFilter : 'showItemsWithDataAtTop',
  };
}
