import { MAX_COL } from './refs.js';
import { FONT_KEYS, xlsxFontProjection, xlsxSolidColor } from './xlsx-style-projection.js';

const valueOf = (key, value) => FONT_KEYS.includes(key) ? xlsxFontProjection({ [key]: value })[key]
  : key === 'bg' ? xlsxSolidColor(value) : value == null ? null : JSON.stringify(value);
const same = (key, a, b) => JSON.stringify(valueOf(key, a)) === JSON.stringify(valueOf(key, b));

/** A row XF replaces, rather than patches, the column XF. Properties shared by
 * every column can be included in each native row XF without changing cells
 * outside the model's used extent. Never infer this from only used columns. */
export function xlsxRowStyleBase(sheet) {
  if (!sheet.rowStyles.size || sheet.colStyles.size !== MAX_COL + 1) return null;
  const first = sheet.colStyles.values().next().value;
  const base = { ...first };
  for (const col of sheet.colStyles.values()) {
    for (const key of Object.keys(base)) {
      if (!Object.hasOwn(col, key) || !same(key, base[key], col[key])) delete base[key];
    }
    if (!Object.keys(base).length) return null;
  }
  return base;
}

/** Blank intersections need composite cell XFs for column properties absent
 * from the row patch. Group rows by property ownership, so repeated complete
 * imported row XFs do not incur a row-by-column scan producing no cells. */
export function* xlsxLineIntersectionCells(sheet, normal = null, base = null) {
  if (!sheet.rowStyles.size || !sheet.colStyles.size) return;
  const inherited = { ...normal, ...base };
  const columns = [];
  const properties = new Set();
  for (const [c, style] of sheet.colStyles) {
    const keys = Object.keys(style).filter(k => !same(k, style[k], inherited[k]));
    if (!keys.length) continue;
    columns.push({ c, keys });
    for (const k of keys) properties.add(k);
  }
  if (!columns.length) return;
  const keys = [...properties], groups = new Map();
  for (const [r, style] of sheet.rowStyles) {
    const signature = keys.map(k => Object.hasOwn(style, k) ? '1' : '0').join('');
    if (!groups.has(signature)) groups.set(signature, { style, rows: [] });
    groups.get(signature).rows.push(r);
  }
  for (const { style, rows } of groups.values()) {
    for (const { c, keys } of columns) {
      if (keys.every(k => Object.hasOwn(style, k))) continue;
      for (const r of rows) yield { r, c };
    }
  }
}
