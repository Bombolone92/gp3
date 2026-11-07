import { replaceInheritedStyle } from './style-values.js';
export { replaceInheritedStyle } from './style-values.js';
import { xlsxAttr } from './xlsx-styles.js';
import { MAX_ROW, MAX_COL } from './refs.js';

// ISO 29500 §18.3.1.13: column formats apply to unallocated cells. A
// materialized <c> uses its own XF (zero when s is omitted), not a patch
// on the column. Rows with customFormat take precedence at intersections.
// Desktop Excel also ignores row s when customFormat is absent or false.
export function readXlsxLineStyles(xml, formats) {
  const cols = {}, rows = {};
  if (!xml || !formats?.length) return { cols, rows };
  xml = xml.replace(/<!--[\s\S]*?-->/g, '');
  const integer = value => /^\d+$/.test(value ?? '') ? Number(value) : NaN;
  const style = (tag, attr) => formats[integer(xlsxAttr(tag, attr))];
  const columns = xml.match(/<(?:\w+:)?cols\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cols>/)?.[1] || '';
  for (const [tag] of columns.matchAll(/<(?:\w+:)?col\b[^>]*>/g)) {
    const min = integer(xlsxAttr(tag, 'min')) - 1, max = integer(xlsxAttr(tag, 'max')) - 1;
    const s = style(tag, 'style');
    if (!s || min < 0 || max > MAX_COL || !(min <= max)) continue;
    for (let c = min; c <= max; c++) cols[c] = s;
  }
  const columnKeys = new Set(Object.values(cols).flatMap(Object.keys));
  const columnProperties = Object.fromEntries([...columnKeys].map(k => [k, true]));
  const data = xml.match(/<(?:\w+:)?sheetData\b[^>]*>([\s\S]*?)<\/(?:\w+:)?sheetData>/)?.[1] || '';
  for (const [tag] of data.matchAll(/<(?:\w+:)?row\b[^>]*>/g)) {
    if (!['1', 'true'].includes(xlsxAttr(tag, 'customFormat'))) continue;
    const r = integer(xlsxAttr(tag, 'r')) - 1, s = style(tag, 's');
    if (!s || !(r >= 0 && r <= MAX_ROW)) continue;
    rows[r] = replaceInheritedStyle(s, columnProperties);
  }
  return { cols, rows };
}

/** A row height without customHeight is an auto-fit cache, not a fixed size. */
export function readXlsxRowHeightModes(xml) {
  const modes = {};
  const data = String(xml || '').replace(/<!--[\s\S]*?-->/g, '').match(/<(?:\w+:)?sheetData\b[^>]*>([\s\S]*?)<\/(?:\w+:)?sheetData>/)?.[1] || '';
  let next = 0;
  for (const [tag] of data.matchAll(/<(?:\w+:)?row\b[^>]*>/g)) {
    const value = xlsxAttr(tag, 'r');
    const r = value == null ? next : /^\d+$/.test(value) ? Number(value) - 1 : -1;
    if (!(r >= 0 && r <= MAX_ROW)) continue;
    next = r + 1;
    const custom = xlsxAttr(tag, 'customHeight');
    if (custom == null || ['0', 'false'].includes(custom)) modes[r] = 'auto';
    else if (['1', 'true'].includes(custom)) modes[r] = 'fixed';
  }
  return modes;
}
