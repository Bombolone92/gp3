/** Native statistical thresholds and explicit sheet formulas share one evaluator. */
import { parseFormula } from './formula/parser.js';
import { cellName } from './cell.js';
import { quoteSheet, shiftFormula, mapFormulaRefs, MAX_ROW, MAX_COL } from './refs.js';
import { duplicateSourceAreas } from './conditional-duplicates.js';
import { numberExpression } from './formula/number-expression.js';

export const BAR_FORMULAS = ['barMinFormula', 'barMaxFormula'];
export const ICON_FORMULAS = Array.from({ length: 5 }, (_, i) => `iconThreshold${i}`);
export const SCALE_FORMULAS = ['scaleMin', 'scaleMid', 'scaleMax'];
export const conditionalPredicateField = rule => rule.type === 'formula' ? 'value' : rule.type === 'icons' && rule.iconActiveFormula ? 'iconActiveFormula' : rule.type === 'databar' && rule.barActiveFormula ? 'barActiveFormula' : null;
export function rebaseConditionalPredicate(rule, dr, dc) {
  const key = conditionalPredicateField(rule);
  return key ? { ...rule, [key]: shiftFormula(rule[key], dr, dc) } : rule;
}
export const conditionalThresholdIsFormula = (rule, key) => typeof rule[key] === 'string' && !!rule[key].trim()
  && (!rule[`${key}Type`] || ['num', 'percent', 'percentile'].includes(rule[`${key}Type`]) && !Number.isFinite(Number(rule[key])));
function ownFormulaFields(rule) {
  if (rule.type === 'icons' && rule.iconSet) return [...(rule.iconActiveFormula ? ['iconActiveFormula'] : []), ...ICON_FORMULAS.filter(key => conditionalThresholdIsFormula(rule, key))];
  if (rule.type === 'databar') return [...(rule.barActiveFormula ? ['barActiveFormula'] : []), ...BAR_FORMULAS.filter(key => conditionalThresholdIsFormula(rule, key))];
  if (['dup', 'unique'].includes(rule.type) && typeof rule.duplicateRange === 'string') return ['duplicateRange'];
  return rule.type === 'formula' ? ['value'] : rule.type === 'scale' ? SCALE_FORMULAS.filter(key => conditionalThresholdIsFormula(rule, key)) : [];
}
export function conditionalFormulaFields(rule) {
  return [...ownFormulaFields(rule), ...['statisticsRange', 'bandOrigin'].filter(key => typeof rule[key] === 'string')];
}
export function mapConditionalFormulas(rule, map) {
  let out = rule;
  for (const key of conditionalFormulaFields(rule)) {
    const original = String(rule[key] || ''), value = map(original, key);
    if (value !== original) { if (out === rule) out = { ...rule }; out[key] = value; }
  }
  return out;
}
/** CFVO formulas are sheet-wide scalar bounds, never candidate-relative. */
export const absoluteThresholdFormula = (formula, base = { r1: 0, c1: 0 }) => mapFormulaRefs(formula, ref => {
  const out = { ...ref };
  // Malformed relative file thresholds use Excel's wrapped reference offsets
  // at A1. Ordinary formula copying must still produce #REF! outside the grid.
  for (const [axis, size, origin] of [['r', MAX_ROW + 1, base.r1], ['c', MAX_COL + 1, base.c1]]) {
    for (const end of [1, 2]) {
      const absolute = `abs${axis.toUpperCase()}${end}`, key = `${axis}${end}`;
      if (!ref[absolute]) out[key] = (ref[key] - origin + size) % size;
      out[absolute] = true;
    }
  }
  return out;
});
const absolute = (r, c) => cellName(r, c).replace(/([A-Z]+)(\d+)/, '$$$1$$$2');
/** Compile native thresholds against the complete sqref, including separate areas.
 * The number encoder preserves stored doubles in generated formulas. Version-one
 * sidecar fingerprints supply String to reproduce their historical projection. */
export function scaleThresholdFormula(type, value, ranges, number = numberExpression) {
  const refs = ranges.map(g => `${g.sheet ? `${quoteSheet(g.sheet)}!` : ''}${absolute(g.r1, g.c1)}:${absolute(g.r2, g.c2)}`);
  // Excel rejects literal union operators in conditional-format thresholds.
  // Reference aggregates accept separate arguments; percentile's array form
  // needs one flattened array, with blanks/errors removed before stacking.
  const range = refs.length === 1 ? refs[0] : `VSTACK(${refs.map(ref => `TOCOL(${ref},3)`).join(',')})`;
  const min = `AGGREGATE(5,6,${refs.join(',')})`, max = `AGGREGATE(4,6,${refs.join(',')})`;
  if (type === 'autoMin') return `MIN(0,${min})`;
  if (type === 'autoMax') return `MAX(0,${max})`;
  if (type === 'min') return min;
  if (type === 'max') return max;
  if (type === 'formula') return typeof value === 'string' && value.trim() ? value.trim().replace(/^=/, '') : null;
  if (value == null || !String(value).trim()) return null;
  if (!Number.isFinite(Number(value))) {
    if (!['num', 'percent', 'percentile'].includes(type)) return null;
    const expression = String(value).trim().replace(/^=/, '');
    try { parseFormula(expression); } catch { return null; }
    // MS-XLSX CT_Cfvo's f is an expression for every parameterized type.
    // Keep the native type so copied statistical domains remain independent.
    if (type === 'num') return expression;
    const result = type === 'percent' ? `${min}+(${max}-${min})*(_cfvo/100)` : `AGGREGATE(16,6,${range},_cfvo/100)`;
    return `LET(_cfvo,(${expression}),IF(AND(ISNUMBER(_cfvo),_cfvo>=0,_cfvo<=100),${result},SQRT(-1)))`;
  }
  const n = Number(value);
  if (type === 'num') return number(n);
  if (n < 0 || n > 100) return null;
  if (type === 'percent') return `${min}+(${max}-${min})*${number(n / 100)}`;
  if (type === 'percentile') return `AGGREGATE(16,6,${range},${number(n / 100)})`;
  return null;
}

/** Keep native range-based thresholds distinct from explicit sheet formulas. */
export function readConditionalThreshold(key, type, value, ranges, extended = false) {
  if (!extended && ['autoMin', 'autoMax'].includes(type)) return null;
  if (scaleThresholdFormula(type, value, ranges) == null) return null;
  if (type === 'formula') return { [key]: String(value).trim().replace(/^=/, '') };
  return { [`${key}Type`]: type, ...(['num', 'percent', 'percentile'].includes(type) ? { [key]: Number.isFinite(Number(value)) ? String(Number(value)) : String(value).trim().replace(/^=/, '') } : {}) };
}
const thresholdCache = new WeakMap();
export function conditionalThresholdFormula(rule, key) {
  const type = rule[`${key}Type`];
  if (!type) return typeof rule[key] === 'string' && rule[key].trim() ? rule[key].trim().replace(/^=/, '').trim() : null;
  let cache = thresholdCache.get(rule);
  if (!cache) thresholdCache.set(rule, cache = new Map());
  const scope = rule.statisticsRange || `${rule.range.r1},${rule.range.c1},${rule.range.r2},${rule.range.c2}`;
  const old = cache.get(key);
  if (old?.type === type && old.value === rule[key] && old.scope === scope) return old.formula;
  const ranges = rule.statisticsRange && duplicateSourceAreas(rule.statisticsRange) || [rule.range];
  const formula = scaleThresholdFormula(type, rule[key], ranges);
  cache.set(key, { type, value: rule[key], scope, formula });
  return formula;
}

/** The app's automatic midpoint is halfway between its actual bounds. The
 * formula returns #NUM! if their difference overflows; halve first only in that case.
 * Keep native percent/percentile stops distinct from this automatic default. */
export function scaleMidpointFormula(low, high) {
  return `IFERROR((${low})+((${high})-(${low}))/2,(${low})/2+(${high})/2)`;
}
