import { NATIVE_ICON_SETS } from './native-icons.js';
import { cellName } from './cell.js';
import { scaleThresholdFormula } from './conditional-scale.js';
import { duplicateSourceAreas, duplicateSourceFormula } from './conditional-duplicates.js';
import { numberExpression } from './formula/number-expression.js';

// CT_CfIcon selects built-in artwork, not arbitrary glyphs or colors. Preserve
// the three ordered categories using the corresponding native icon family;
// unchanged private metadata retains the app's original glyph presentation.
const families = { arrows: '3Arrows', traffic: '3TrafficLights1', flags: '3Flags', stars: '3Stars', checks: '3Symbols2' };

/** App icons classify the computed percentage, rather than comparing values
 * with interpolated native stops. Those operations can disagree at a boundary,
 * on constant domains, and when the span overflows. Three mutually exclusive
 * predicates preserve the live classification and allow independent copying.
 */
export function projectAppIcons(rule) {
  if (rule.type !== 'icons' || NATIVE_ICON_SETS[rule.iconSet]) return null;
  const scope = rule.statisticsRange && duplicateSourceAreas(rule.statisticsRange);
  const ranges = scope || [rule.range];
  const count = rule.statisticsRange && !scope?.length ? '0'
    : `COUNT(${ranges.map(range => duplicateSourceFormula([range])).join(',')})`;
  const min = scaleThresholdFormula('min', null, ranges), max = scaleThresholdFormula('max', null, ranges);
  const cell = cellName(rule.range.r1, rule.range.c1), span = `(${max})-(${min})`;
  const scale = `MAX(ABS(${min}),ABS(${max}))`;
  const normalized = `((${cell}/(${scale})-(${min})/(${scale}))/((${max})/(${scale})-(${min})/(${scale})))*100`;
  const fraction = `(${cell}-(${min}))/(${span})`;
  // Native division flushes subnormal results. Match the app's direct percent
  // calculation in that branch, without changing ordinary cutoff rounding.
  const ordinary = `IF((${fraction})=0,(${cell}-(${min}))*100/(${span}),(${fraction})*100)`;
  const pct = `IF(IFERROR((${span})=0,FALSE),100,IF(ISERROR(${span}),${normalized},${ordinary}))`;
  const atLeast = value => {
    const number = Number(value);
    if (Number.isNaN(number)) return 'FALSE';
    if (number === -Infinity) return 'TRUE';
    // An overflowing candidate percentage has the sign of its distance from
    // the source range. It still classifies in the app instead of disappearing.
    const positiveOverflow = `${cell}>(${max})`;
    if (number === Infinity) return `AND(ISERROR(${pct}),${positiveOverflow})`;
    return `IFERROR((${pct})-(${numberExpression(number)})>=0,${positiveOverflow})`;
  };
  const high = atLeast(rule.hi ?? 67), low = atLeast(rule.lo ?? 33);
  const gates = [`AND(NOT(${high}),NOT(${low}))`, `AND(NOT(${high}),${low})`, high];
  const iconSet = Object.hasOwn(families, rule.set) ? families[rule.set] : families.arrows;
  return gates.map((gate, index) => {
    let active = `IF(${count}>0,${gate},FALSE)`;
    if (rule.iconActiveFormula) active = `IF(${rule.iconActiveFormula},${active},FALSE)`;
    // Every selected rule must cover every finite candidate: the first CFVO
    // is a genuine lower boundary, even when all custom choices are the same.
    return { ...rule, iconSet, iconCustom: true, iconReverse: false, iconPercent: false, stopIfTrue: false,
      iconActiveFormula: active,
      ...Object.fromEntries(Array.from({ length: 3 }, (_, i) => [
        [`iconThreshold${i}`, String(-Number.MAX_VALUE)], [`iconThreshold${i}Type`, 'num'], [`iconThreshold${i}Gte`, true],
        [`icon${i}Set`, iconSet], [`icon${i}Id`, index],
      ]).flat()),
    };
  });
}
