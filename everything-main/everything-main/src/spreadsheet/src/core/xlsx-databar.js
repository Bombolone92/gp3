import { conditionalThresholdIsFormula, readConditionalThreshold } from './conditional-scale.js';
import { duplicateSourceFormula } from './conditional-duplicates.js';
import { fromFileFormula } from './xlfn.js';
import { xlsxAttr as attr, xlsxElements as elements, xlsxColor, xlsxText } from './xlsx-styles.js';

const contents = tag => xlsxText(tag?.replace(/^<[^>]+>|<\/[^>]+>$/g, ''))?.trim();
const bool = (xml, key, fallback) => attr(xml, key) == null ? fallback : ['1', 'true'].includes(attr(xml, key));
export const dataBarLink = source => contents(elements(source, 'id')[0])?.toUpperCase();

/** A priority makes an extension standalone; otherwise its GUID links a fallback. */
export function extendedBarEntries(xml, parseRanges) {
  const entries = [];
  for (const block of elements(xml, 'conditionalFormatting')) {
    if (attr(block, 'sqref') != null) continue;
    const ranges = parseRanges(contents(elements(block, 'sqref')[0]));
    if (!ranges.length) continue;
    for (const source of elements(block, 'cfRule')) if (attr(source, 'type') === 'dataBar') {
      const id = attr(source, 'id')?.toUpperCase();
      const priority = attr(source, 'priority');
      if (priority != null && (!Number.isInteger(Number(priority)) || Number(priority) <= 0)) continue;
      if (id || priority != null) entries.push({ id, source, ranges, ...(['1', 'true'].includes(attr(block, 'pivot')) ? { pivot: true } : {}), priority: priority == null ? 0 : Number(priority) });
    }
  }
  return entries;
}

export function readExtendedBar(entry, fallbackColor, themes, definedNames) {
  const bar = elements(entry.source, 'dataBar')[0];
  if (!bar) return null;
  const thresholds = elements(bar, 'cfvo').map((tag, i) => {
    const type = attr(tag, 'type'), key = i ? 'barMaxFormula' : 'barMinFormula';
    const value = contents(elements(tag, 'f')[0]);
    const setting = readConditionalThreshold(key, type, value ?? '0', entry.ranges, true);
    if (setting && conditionalThresholdIsFormula(setting, key)) setting[key] = fromFileFormula(setting[key], definedNames);
    return setting;
  });
  const lengths = ['minLength', 'maxLength'].map((key, i) => attr(bar, key) == null ? [10, 90][i] : Number(attr(bar, key)));
  const color = name => xlsxColor(elements(bar, name)[0], themes);
  const fill = color('fillColor') || fallbackColor;
  const direction = attr(bar, 'direction') || 'context', axis = attr(bar, 'axisPosition') || 'automatic';
  if (!fill || thresholds.length !== 2 || thresholds.some(f => f == null) || !lengths.every(Number.isInteger)
    || lengths[0] < 0 || lengths[0] > lengths[1] || lengths[1] > 100
    || !['context', 'leftToRight', 'rightToLeft'].includes(direction) || !['automatic', 'middle', 'none'].includes(axis)) return null;
  const active = contents(elements(entry.source.replace(bar, ''), 'f')[0]);
  return { type: 'databar', barMode: 'extended', barColor: fill, barFullHeight: true,
    ...Object.assign({}, ...thresholds),
    ...(active ? { barActiveFormula: fromFileFormula(active, definedNames) } : {}),
    ...(thresholds.some(v => Object.keys(v).some(k => k.endsWith('Type'))) ? { statisticsRange: duplicateSourceFormula(entry.ranges) } : {}),
    barMinLength: lengths[0], barMaxLength: lengths[1],
    barDirection: direction, barAxisPosition: axis, barGradient: bool(bar, 'gradient', true), barBorder: bool(bar, 'border', false),
    barNegativeColorSame: bool(bar, 'negativeBarColorSameAsPositive', false),
    barNegativeBorderColorSame: bool(bar, 'negativeBarBorderColorSameAsPositive', true),
    barBorderColor: color('borderColor') || fill, barNegativeColor: color('negativeFillColor') || '#ff0000',
    barNegativeBorderColor: color('negativeBorderColor') || '#ff0000', barAxisColor: color('axisColor') || '#000000',
    ...(!bool(bar, 'showValue', true) ? { barOnly: true } : {}) };
}
