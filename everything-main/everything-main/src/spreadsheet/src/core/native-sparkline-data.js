import { tokenize } from './formula/tokenizer.js';
import { parseRefText } from './refs.js';
import { cellName } from './cell.js';
import { effectiveColorPalette, tintRgb } from './font-color.js';

// The workbook clears this cache for F9 and asynchronous recalculation too,
// even when no edit increments its saved version.
const CACHE = Symbol('native sparkline data');
function state(wb) {
  let cache = wb._statsCache.get(CACHE);
  if (!cache || cache.version !== wb.version) {
    cache = { version: wb.version, sheets: new Map(), groups: new WeakMap(), vectors: new Map(), palette: effectiveColorPalette(wb.colorPalette) };
    wb._statsCache.set(CACHE, cache);
  }
  return cache;
}
function index(wb, sheetId) {
  const cache = state(wb);
  if (!cache.sheets.has(sheetId)) {
    const entries = new Map();
    for (const group of wb.sheet(sheetId)?.sparklineGroups || []) for (const spark of group.sparklines) entries.set(spark.ref, { group, spark });
    cache.sheets.set(sheetId, entries);
  }
  return cache.sheets.get(sheetId);
}
export function nativeSparklineAt(wb, sheetId, r, c) {
  if (!wb.sheet(sheetId)?.sparklineGroups?.length) return null;
  return index(wb, sheetId).get(cellName(r, c)) || null;
}

export function nativeSparklineLocation(wb, sheetId, formula, anchor) {
  if (!formula) return null;
  try {
    const tokens = tokenize(formula);
    const owner = wb.sheet(sheetId);
    if (tokens.length !== 1) return wb.formulaLocation(formula, owner.name, anchor);
    const token = tokens[0];
    if (token.type === 'ref' && !token.sheetEnd) {
      const ref = parseRefText(token.text, token.sheet || owner.name);
      if (!ref) return null;
      if (token.spill) {
        const target = wb.sheetByName(ref.sheet);
        const area = target && wb.spillRangeAt(target.id, ref.r1, ref.c1);
        if (!area) return null;
        return { ...ref, ...area };
      }
      return ref;
    }
    if (token.type === 'name') return wb.namedLocation(token.value, token.sheet || owner.name, anchor);
    if (token.type === 'tref') return wb.formulaLocation(formula, owner.name, anchor);
  } catch { /* An unavailable binding is not replaced by a cached series. */ }
  return null;
}
/** Compare each member in the same caller context used to render its data.
 * Unknown imported bindings remain intact; only known vector mismatches fail. */
export function nativeSparklineDateMismatch(wb, sheetId, dateFormula, sparklines) {
  const size = ref => ref && !ref.sheetEnd && (ref.r1 === ref.r2 || ref.c1 === ref.c2)
    ? Math.max(ref.r2 - ref.r1 + 1, ref.c2 - ref.c1 + 1) : null;
  return sparklines.some(spark => {
    const p = parseRefText(spark.ref), anchor = { r: p.r1, c: p.c1 };
    const dates = size(nativeSparklineLocation(wb, sheetId, dateFormula, anchor));
    const values = size(nativeSparklineLocation(wb, sheetId, spark.formula, anchor));
    return dates != null && values != null && dates !== values;
  });
}
function vector(wb, sheetId, formula, anchor, cache) {
  const ref = nativeSparklineLocation(wb, sheetId, formula, anchor), sheet = ref && wb.sheetByName(ref.sheet);
  if (!sheet || ref.sheetEnd || ref.r1 !== ref.r2 && ref.c1 !== ref.c2) return null;
  const key = `${sheet.id}|${ref.r1},${ref.c1},${ref.r2},${ref.c2}`;
  if (cache.vectors.has(key)) return cache.vectors.get(key);
  const horizontal = ref.r1 === ref.r2, length = horizontal ? ref.c2 - ref.c1 + 1 : ref.r2 - ref.r1 + 1;
  const values = new Array(length);
  for (let i = 0; i < length; i++) {
    const r = ref.r1 + (horizontal ? 0 : i), c = ref.c1 + (horizontal ? i : 0);
    const value = wb.getValue(sheet.id, r, c);
    values[i] = { value: typeof value === 'number' && Number.isFinite(value) ? value : null,
      // Text, Boolean values and errors are not blank cells and never become
      // zero merely because blank cells are configured to plot as zero.
      blank: value == null, hidden: sheet.hiddenCols.has(c) || wb.isRowHidden(sheet.id, r) };
  }
  cache.vectors.set(key, values);
  return values;
}
const extrema = points => {
  let min = Infinity, max = -Infinity, count = 0;
  for (const point of points) if (point.value != null) { min = Math.min(min, point.value); max = Math.max(max, point.value); count++; }
  return { min: count ? min : null, max: count ? max : null, count };
};
export function nativeSparklineColorValues(group, palette) {
  return Object.fromEntries(['Series', 'Negative', 'Axis', 'Markers', 'First', 'Last', 'High', 'Low'].map(key => [key.toLowerCase(), paint(group[`color${key}`], palette)]));
}
function paint(color, palette) {
  const base = color?.theme != null ? palette.theme[color.theme] : color?.rgb ? `#${color.rgb.slice(-6)}` : color?.indexed != null ? palette.indexed[color.indexed] : null;
  const rgb = base || '#000000';
  return color?.tint ? `#${tintRgb(rgb.slice(1), color.tint)}` : rgb.toLowerCase();
}

/** Resolve native sources once per calculation version. Groups share axis
 * bounds, not cell values: getValue and formula evaluation remain unchanged. */
export function nativeSparklineData(wb, sheetId, r, c) {
  const entry = nativeSparklineAt(wb, sheetId, r, c);
  if (!entry) return null;
  const cache = state(wb), { group, spark } = entry;
  if (!cache.groups.has(group)) cache.groups.set(group, new Map());
  const series = cache.groups.get(group);
  if (!series.has(spark)) {
    let groupMin = Infinity, groupMax = -Infinity;
    const shared = group.minAxisType === 'group' || group.maxAxisType === 'group';
    const resolved = [];
    for (const member of shared ? group.sparklines : [spark]) {
      const dest = parseRefText(member.ref), anchor = { r: dest.r1, c: dest.c1 };
      const values = vector(wb, sheetId, member.formula, anchor, cache);
      const dates = group.dateAxis ? vector(wb, sheetId, group.dateFormula, anchor, cache) : null;
      const unavailable = !values || group.dateAxis && (!dates || dates.length !== values.length);
      const points = [];
      if (!unavailable) for (let i = 0; i < values.length; i++) {
        const datum = values[i], date = dates?.[i];
        if (!group.displayHidden && datum.hidden) continue;
        if (group.dateAxis && date?.value == null) continue;
        const value = datum.blank && group.displayEmptyCellsAs === 'zero' ? 0 : datum.value;
        points.push({ value, blank: datum.blank, x: group.dateAxis ? date.value : points.length, index: i });
      }
      const stats = extrema(points);
      if (stats.count) { groupMin = Math.min(groupMin, stats.min); groupMax = Math.max(groupMax, stats.max); }
      const result = { points, ...stats, unavailable: !!unavailable };
      series.set(member, result);
      resolved.push(result);
    }
    const colors = nativeSparklineColorValues(group, cache.palette);
    // Independent axes resolve lazily. Finalize only this batch, rather than
    // revisiting every cached member each time another cell becomes visible.
    // Shared axes resolve the entire group together in the batch above.
    for (const result of resolved) {
      result.minAxis = group.minAxisType === 'custom' ? group.manualMin : group.minAxisType === 'group' && Number.isFinite(groupMin) ? groupMin : result.min;
      result.maxAxis = group.maxAxisType === 'custom' ? group.manualMax : group.maxAxisType === 'group' && Number.isFinite(groupMax) ? groupMax : result.max;
      result.group = group; result.colors = colors;
    }
  }
  return cache.groups.get(group).get(spark);
}
