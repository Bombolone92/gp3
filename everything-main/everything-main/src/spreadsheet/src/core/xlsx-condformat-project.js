/** Expand app rules into native rules without changing the editable model. */
import { scaleThresholdFormula } from './conditional-scale.js';
import { cellName } from './cell.js';
import { duplicateSourceAreas, duplicateSourceFormula } from './conditional-duplicates.js';
import { numberExpression } from './formula/number-expression.js';
import { projectAppIcons } from './xlsx-condformat-icons.js';

export function projectXlsxConditionalFormats(sheet) {
  const rules = [], sources = [];
  const append = (rule, source) => { rules.push(rule); sources.push(source); };
  sheet.rules.forEach((rule, source) => {
    const icons = projectAppIcons(rule);
    if (icons) { icons.forEach(native => append(native, source)); return; }
    if (rule.type !== 'databar' || ['legacy', 'extended'].includes(rule.barMode)) { append(rule, source); return; }
    const scope = rule.statisticsRange && duplicateSourceAreas(rule.statisticsRange);
    const ranges = scope || [rule.range];
    // Excel rejects literal unions in conditional formulas; pass areas as arguments.
    const hasStatistics = !rule.statisticsRange ? null : scope?.length ? `COUNT(${scope.map(range => duplicateSourceFormula([range])).join(',')})>0` : 'FALSE';
    const low = Number.isFinite(rule.barMin) ? numberExpression(rule.barMin) : `MIN(0,${scaleThresholdFormula('min', null, ranges)})`;
    const high = Number.isFinite(rule.barMax) ? numberExpression(rule.barMax) : scaleThresholdFormula('max', null, ranges);
    // App bars fill every numeric candidate when the bounds coincide or are
    // reversed. A native equal-bound bar instead uses its midpoint. Separate
    // live conditions preserve this distinction without perturbing the bounds.
    // Direct comparisons round to 15 significant digits, which can collapse
    // distinct nearby stops. Compare their difference with zero; if the span
    // overflows, the endpoints are far enough apart for direct comparison.
    const full = `IFERROR((${high})-(${low})<=0,IFERROR((${high})<=(${low}),FALSE))`;
    const active = condition => {
      // Even explicit bounds require numeric statistics in the app. A copied
      // rule can count a different range which later becomes empty or invalid.
      if (hasStatistics) condition = `IF(${hasStatistics},${condition},FALSE)`;
      return rule.barActiveFormula ? `IF(${rule.barActiveFormula},${condition},FALSE)` : condition;
    };
    const native = { ...rule, barMode: 'extended', barGradient: false, barAxisPosition: 'none',
      barDirection: 'leftToRight', barNegativeColorSame: true, barBorder: false, barFullHeight: true,
      // App bars do not stop later fills/fonts or other kinds of visual rule.
      stopIfTrue: false };
    delete native.barMinFormulaType; delete native.barMaxFormulaType;
    append({ ...native, barMinLength: 100, barMaxLength: 100, barMinFormula: '0', barMaxFormula: '0',
      barMinFormulaType: 'num', barMaxFormulaType: 'num', barActiveFormula: active(full) }, source);
    const overflow = `ISERROR((${high})-(${low}))`;
    append({ ...native, barMinLength: 0, barMaxLength: 100, barMinFormula: low, barMaxFormula: high,
      barActiveFormula: active(`AND(NOT(${full}),NOT(${overflow}))`) }, source);
    // Excel's native axis-less interpolation collapses an overflowing span to
    // a half bar. Split only that span into two finite intervals; their joined
    // 0–50–100 lengths retain the same continuous scale and live source bounds.
    const middle = `(${low})/2+(${high})/2`, cell = cellName(rule.range.r1, rule.range.c1);
    append({ ...native, barMinLength: 0, barMaxLength: 50, barMinFormula: low, barMaxFormula: middle,
      barActiveFormula: active(`AND(NOT(${full}),${overflow},${cell}<=(${middle}))`) }, source);
    append({ ...native, barMinLength: 50, barMaxLength: 100, barMinFormula: middle, barMaxFormula: high,
      barActiveFormula: active(`AND(NOT(${full}),${overflow},${cell}>(${middle}))`) }, source);
  });
  return { sheet: { ...sheet, rules }, sources };
}
