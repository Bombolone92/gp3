import { NATIVE_ICON_SETS, nativeIconChoice } from './native-icons.js';
import { conditionalThresholdIsFormula, readConditionalThreshold } from './conditional-scale.js';
import { duplicateSourceFormula } from './conditional-duplicates.js';
import { fromFileFormula } from './xlfn.js';
import { xlsxAttr as attr, xlsxElements as elements, xlsxText } from './xlsx-styles.js';

export const iconXmlContents = tag => xlsxText(tag?.replace(/^<[^>]+>|<\/[^>]+>$/g, ''))?.trim();
/** Office 2010 icon rules are standalone rules, not GUID-linked fallbacks. */
export function readXlsxIcons(source, ranges, definedNames, extended = false) {
  const icons = elements(source, 'iconSet')[0], iconSet = attr(icons, 'iconSet') || '3TrafficLights1';
  const set = NATIVE_ICON_SETS[iconSet], allLimits = elements(icons, 'cfvo');
  const custom = extended && ['1', 'true'].includes(attr(icons, 'custom'));
  if (!set || !extended && set.extended || (custom ? allLimits.length < set.count || allLimits.length > 5 : allLimits.length !== set.count)) return null;
  // Excel uses the base family's category count and ignores surplus custom
  // entries, even when cfvo and cfIcon counts agree with each other.
  const limits = allLimits.slice(0, set.count);
  const values = limits.map((tag, i) => {
    const key = `iconThreshold${i}`, type = attr(tag, 'type');
    if (!['num', 'percent', 'percentile', 'formula'].includes(type)) return null;
    const value = readConditionalThreshold(key, type, extended ? iconXmlContents(elements(tag, 'f')[0]) : attr(tag, 'val'), ranges);
    if (!value) return null;
    if (conditionalThresholdIsFormula(value, key)) value[key] = fromFileFormula(value[key], definedNames);
    return { ...value, ...(['0', 'false'].includes(attr(tag, 'gte')) ? { [`${key}Gte`]: false } : {}) };
  });
  if (!values.every(Boolean)) return null;
  const rule = { type: 'icons', iconSet, statisticsRange: duplicateSourceFormula(ranges), ...Object.assign({}, ...values),
    ...(['1', 'true'].includes(attr(icons, 'reverse')) ? { iconReverse: true } : {}),
    ...(['0', 'false'].includes(attr(icons, 'showValue')) ? { iconOnly: true } : {}),
    ...(attr(icons, 'percent') != null ? { iconPercent: ['1', 'true'].includes(attr(icons, 'percent')) } : {}) };
  if (custom) {
    const choices = elements(icons, 'cfIcon');
    if (choices.length !== allLimits.length) return null;
    rule.iconCustom = true;
    for (const [i, choice] of choices.slice(0, set.count).entries()) {
      rule[`icon${i}Set`] = attr(choice, 'iconSet');
      const raw = attr(choice, 'iconId');
      rule[`icon${i}Id`] = /^\d+$/.test(raw || '') ? Number(raw) : -1;
      if (!nativeIconChoice(rule, i)) return null;
    }
  }
  if (extended) {
    // Only the rule's direct formula is a predicate; cfvo formulas are bounds.
    const active = iconXmlContents(elements(source.replace(icons, ''), 'f')[0]);
    if (active) rule.iconActiveFormula = fromFileFormula(active, definedNames);
  }
  return rule;
}
