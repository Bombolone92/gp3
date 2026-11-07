import { parseRefText } from './refs.js';
import { colName } from './cell.js';

export const nativeSparklineFlags = ['dateAxis', 'markers', 'high', 'low', 'first', 'last', 'negative', 'displayXAxis', 'displayHidden', 'rightToLeft'];
export const nativeSparklineColors = ['colorSeries', 'colorNegative', 'colorAxis', 'colorMarkers', 'colorFirst', 'colorLast', 'colorHigh', 'colorLow'];
export const nativeSparklineChoices = { type: ['line', 'column', 'stacked'], displayEmptyCellsAs: ['zero', 'gap', 'span'], minAxisType: ['individual', 'group', 'custom'], maxAxisType: ['individual', 'group', 'custom'] };
const fail = field => { throw new Error(`Invalid native sparkline ${field}`); };
const numeric = (value, field, min = -Infinity, max = Infinity) => {
  const raw = String(value).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) fail(field);
  const number = Number(raw);
  if (!Number.isFinite(number) || number < min || number > max) fail(field);
  return number;
};
const integer = (value, field, max) => {
  if (!/^\+?\d+$/.test(String(value).trim())) fail(field);
  return numeric(value, field, 0, max);
};
const boolean = (value, field) => {
  if (value === true || value === false) return value;
  const raw = String(value).trim();
  if (!['0', '1', 'false', 'true'].includes(raw)) fail(field);
  return raw === '1' || raw === 'true';
};
const formula = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 32767 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail('formula');
  // Keep names, quoted sheets and external references intact. Resolution belongs
  // to the workbook, not this XML codec; do not turn them into cached values.
  return value;
};
function destination(value) {
  if (typeof value !== 'string') fail('destination');
  const ref = parseRefText(value.trim());
  if (!ref || ref.r1 !== ref.r2 || ref.c1 !== ref.c2) fail('destination');
  return colName(ref.c1) + (ref.r1 + 1);
}
function color(value) {
  const result = {};
  if (value.rgb != null) {
    if (!/^[\da-f]{8}$/i.test(value.rgb)) fail('color rgb');
    result.rgb = value.rgb.toUpperCase();
  }
  if (value.theme != null) result.theme = integer(value.theme, 'color theme', 11);
  if (value.indexed != null) result.indexed = integer(value.indexed, 'color indexed', 4294967295);
  if (value.tint != null) result.tint = numeric(value.tint, 'color tint', -1, 1);
  return result;
}
/** CT_SparklineGroup (MS-XLSX 2.6.7). Retain theme/indexed colors rather
 * than flattening them to the current theme. Groups remain separate from scalar cell values and formulas. */
export function normalizeNativeSparklineGroups(groups) {
  if (!Array.isArray(groups)) fail('groups');
  const occupied = new Set(), identities = new Set();
  const result = groups.map(group => {
    if (!group || typeof group !== 'object') fail('group');
    const out = {};
    for (const [field, allowed] of Object.entries(nativeSparklineChoices)) {
      out[field] = group[field] ?? allowed[0];
      if (!allowed.includes(out[field])) fail(field);
    }
    for (const field of nativeSparklineFlags) out[field] = group[field] == null ? false : boolean(group[field], field);
    out.lineWeight = numeric(group.lineWeight ?? 0.75, 'lineWeight', 0, 1584);
    // Some Excel files carry dormant manual bounds while using individual
    // scaling. They must not activate custom scaling; canonical export omits them.
    for (const [field, mode] of [['manualMin', 'minAxisType'], ['manualMax', 'maxAxisType']]) {
      if (out[mode] === 'custom') out[field] = numeric(group[field], field);
    }
    for (const field of nativeSparklineColors) if (group[field] != null) out[field] = color(group[field]);
    if (group.dateFormula != null) out.dateFormula = formula(group.dateFormula);
    if (group.uid != null) {
      if (!/^\{[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\}$/i.test(group.uid)) fail('uid');
      out.uid = group.uid.toUpperCase();
      if (identities.has(out.uid)) fail('duplicate uid');
      identities.add(out.uid);
    }
    if (!Array.isArray(group.sparklines) || !group.sparklines.length) fail('sparklines');
    out.sparklines = group.sparklines.map(spark => {
      if (!spark || typeof spark !== 'object') fail('sparkline');
      const ref = destination(spark.ref);
      if (occupied.has(ref)) fail('duplicate destination');
      occupied.add(ref);
      return { ...(spark.formula != null ? { formula: formula(spark.formula) } : {}), ref };
    });
    return out;
  });
  if (identities.size && identities.size !== result.length) fail('incomplete group identities');
  return result;
}

/** Rewrite source/date references independently of their destination cells.
 * Preserve object identity when unchanged for history and layout invalidation. */
export function mapNativeSparklineReferences(groups, rewrite) {
  let changed = false;
  const next = groups.map(group => {
    const dateFormula = group.dateFormula == null ? undefined : rewrite(group.dateFormula, group);
    let groupChanged = dateFormula !== group.dateFormula;
    const sparklines = group.sparklines.map(spark => {
      const formula = spark.formula == null ? undefined : rewrite(spark.formula, spark);
      if (formula === spark.formula) return spark;
      groupChanged = true;
      return { ...spark, formula };
    });
    if (!groupChanged) return group;
    changed = true;
    return { ...group, ...(dateFormula != null ? { dateFormula } : {}), sparklines };
  });
  return changed ? next : groups;
}

/** A deleted destination removes that sparkline, not other group members. */
export function mapNativeSparklineDestinations(groups, map) {
  let changed = false;
  const next = groups.flatMap(group => {
    let groupChanged = false;
    const sparklines = group.sparklines.flatMap(spark => {
      const ref = parseRefText(spark.ref), mapped = map(ref);
      if (!mapped) { groupChanged = true; return []; }
      const name = colName(mapped.c1) + (mapped.r1 + 1);
      if (name === spark.ref) return [spark];
      groupChanged = true; return [{ ...spark, ref: name }];
    });
    if (!groupChanged) return [group];
    changed = true;
    return sparklines.length ? [{ ...group, sparklines }] : [];
  });
  return changed ? next : groups;
}

/** Account for blank-cell metadata in the workbook's undo memory budget. */
export const nativeSparklineSize = groups => (groups || []).reduce((n, group) => n + 1 + group.sparklines.length, 0);
