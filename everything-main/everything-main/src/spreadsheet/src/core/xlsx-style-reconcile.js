import { FONT_KEYS, RECONCILED_STYLE_KEYS, xlsxFontProjection, xlsxStyleProjection } from './xlsx-style-projection.js';
import { normalFontStyle } from './normal-font.js';
import { readXlsxLineStyles } from './xlsx-line-styles.js';
import { styleResetAt } from './style-resets.js';
import { BORDER_STYLE_KEYS } from './style-values.js';
import { NUMBER_FORMAT_KEYS } from './format.js';
import { nativeFillProjection } from './native-fill.js';
import { sameFillColor } from './fill-color.js';

const same = (a, b) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-8 : (a && typeof a === 'object' || b && typeof b === 'object') ? JSON.stringify(a) === JSON.stringify(b) : a === b;
const withoutReconciled = style => Object.fromEntries(Object.entries(style || {}).filter(([k]) => !RECONCILED_STYLE_KEYS.includes(k)));
const groups = [FONT_KEYS, ['bg', 'nativeFill'], BORDER_STYLE_KEYS, NUMBER_FORMAT_KEYS, ['shrink']];

/** Native XFs contain complete style components. Private metadata retains inheritance only
 * while its displayed projection still agrees with the native file. */
export function createXlsxStyleReconciler({ cols, rows, resets, rowBase, normalFont, defaultStyle, xml, formats, fillBindingsKnown = true }) {
  const normal = { ...normalFontStyle(normalFont), ...defaultStyle };
  const native = readXlsxLineStyles(xml, formats);
  const nativeStyles = new WeakMap();
  const nativeStyle = style => {
    if (!nativeStyles.has(style)) nativeStyles.set(style, xlsxStyleProjection(style));
    return nativeStyles.get(style);
  };
  const patch = (own, inherited, actual, expected = xlsxStyleProjection({ ...inherited, ...own }), nativeNumbers = false) => {
    const style = nativeStyle(actual);
    const changed = RECONCILED_STYLE_KEYS.filter(k => !NUMBER_FORMAT_KEYS.includes(k)
      && (k !== 'nativeFill' || fillBindingsKnown) && !same(expected[k], style[k]));
    if (changed.some(k => k === 'bg' || k === 'nativeFill')) for (const k of ['bg', 'nativeFill']) if (!changed.includes(k)) changed.push(k);
    const numberChanged = nativeNumbers || NUMBER_FORMAT_KEYS.some(k => !same(expected[k], style[k]));
    // Earlier sidecars have no resource baseline. Adopt the native binding
    // without freezing an unchanged private color inherited from a line.
    // A differing actual resource still forms a complete cell/row override.
    let adopted = own;
    if (!fillBindingsKnown && !same(nativeFillProjection(actual.nativeFill), nativeFillProjection(inherited?.nativeFill))) {
      adopted = { ...own, nativeFill: actual.nativeFill ?? null,
        ...(!Object.hasOwn(own || {}, 'bg') ? { bg: style.bg } : {}) };
    } else if (!fillBindingsKnown && Object.hasOwn(own || {}, 'bg') && actual.nativeFill) {
      adopted = { ...own, nativeFill: actual.nativeFill };
    }
    if (!changed.length && !numberChanged) return adopted;
    const result = { ...adopted, ...Object.fromEntries(changed.map(k => [k, k === 'nativeFill' ? actual.nativeFill ?? null : style[k]])) };
    if (numberChanged) for (const k of NUMBER_FORMAT_KEYS) {
      // A numFmt is one complete component. Clear old details as well as fmt,
      // but do not allocate redundant resets on ordinary unformatted cells.
      if (style[k] != null && style[k] !== '' || inherited?.[k] != null || own?.[k] != null) result[k] = style[k];
      else delete result[k];
    }
    return Object.keys(result).length ? result : undefined;
  };
  // Native column runs often repeat across the whole grid, while JSON gives
  // each private column patch a separate object. Reuse only the reconciled delta;
  // other properties on those columns may differ.
  let lastLine;
  const patchLine = (own, actual, inherited = normal) => {
    if (lastLine?.actual === actual && RECONCILED_STYLE_KEYS.every(k => same(own?.[k], lastLine.own?.[k]))) {
      return lastLine.delta ? { ...own, ...lastLine.delta } : own;
    }
    const after = patch(own, inherited, actual);
    const delta = after === own ? null : Object.fromEntries(RECONCILED_STYLE_KEYS.filter(k => !same(own?.[k], after[k])).map(k => [k, after[k]]));
    lastLine = { own, actual, delta };
    return after;
  };
  const changedColumns = new Set();
  for (const c of new Set([...Object.keys(cols), ...Object.keys(native.cols)])) {
    const before = cols[c];
    const after = native.cols[c] ? patchLine(before, native.cols[c]) : withoutReconciled(before);
    if (after !== before) for (const k of RECONCILED_STYLE_KEYS) if ((k !== 'nativeFill' || fillBindingsKnown) && !same(before?.[k], after?.[k])) changedColumns.add(k);
    if (after && Object.keys(after).length) cols[c] = after; else delete cols[c];
  }
  const completeRowKeys = groups.filter(keys => keys.some(k => changedColumns.has(k))).flat();
  lastLine = null;
  // New exports record shared column properties baked into native row XFs.
  // Older files without this marker retain their original Normal baseline.
  const rowInherited = { ...normal, ...rowBase };
  if (!fillBindingsKnown && Object.hasOwn(rowBase || {}, 'bg')) {
    const columns = Object.values(native.cols), first = columns[0]?.nativeFill;
    if (first && sameFillColor(first.paint, rowBase.bg) && columns.every(style => style.nativeFill?.key === first.key)) rowInherited.nativeFill = first;
  }
  for (const r of new Set([...Object.keys(rows), ...Object.keys(native.rows)])) {
    const before = rows[r];
    // A native row XF takes precedence over columns. When a column was edited
    // externally, a partial row component could acquire the new column's
    // value instead of its own complete native value. Complete only affected
    // components: a fill edit must not freeze an unrelated font's inheritance.
    let after = native.rows[r] ? patchLine(before, native.rows[r], rowInherited) : withoutReconciled(before);
    if (native.rows[r] && completeRowKeys.length) {
      const actual = nativeStyle(native.rows[r]);
      after = { ...after, ...Object.fromEntries(completeRowKeys.map(k => [k, k === 'nativeFill' ? native.rows[r].nativeFill ?? null : actual[k]])) };
    }
    if (after && Object.keys(after).length) rows[r] = after; else delete rows[r];
  }
  // Reuse the importer's existing cell walk; do not allocate another address
  // map or perform a second parse of every cell in a large worksheet.
  let cachedRow;
  const inheritedStyles = new Map();
  return (r, c, own, index, { numberBase = null, nativeNumbers = false } = {}) => {
    const actual = formats[index];
    if (!actual) return own;
    const reset = styleResetAt(resets, r, c);
    if (!own && !reset && !numberBase) {
      // Dense columns repeat the same inherited style. Cache at most one row
      // style's column combinations, rather than an entry for every cell.
      if (cachedRow !== rows[r]) { cachedRow = rows[r]; inheritedStyles.clear(); }
      const col = cols[c];
      if (!inheritedStyles.has(col)) inheritedStyles.set(col, { expected: xlsxStyleProjection({ ...normal, ...col, ...cachedRow }) });
      const cached = inheritedStyles.get(col);
      if (cached.actual !== actual || cached.nativeNumbers !== nativeNumbers) {
        cached.actual = actual;
        cached.nativeNumbers = nativeNumbers;
        cached.patch = patch(own, { ...normal, ...col, ...cachedRow }, actual, cached.expected, nativeNumbers);
      }
      return cached.patch;
    }
    const inherited = { ...normal, ...cols[c], ...rows[r],
      ...(reset ? Object.fromEntries(Object.keys(reset).map(k => [k, reset[k] ?? normal?.[k] ?? null])) : {}), ...numberBase };
    return patch(own, inherited, actual, undefined, nativeNumbers);
  };
}

/** Plain app workbooks deliberately omit a Normal override. Keep that state
 * if Excel's Normal is still our exported default, but accept an actual edit. */
export function reconciledNormalFont(meta, native) {
  if (!meta || meta.normalFont) return native || meta?.normalFont || null;
  const actual = xlsxFontProjection(normalFontStyle(native) || {}), expected = xlsxFontProjection();
  // Older app writers put a minor binding on their generic font zero without
  // modeling it. Do not turn that historical default into a Normal override.
  if (!meta.themeFonts && actual.scheme === 'minor') expected.scheme = 'minor';
  return FONT_KEYS.some(k => !same(actual[k], expected[k])) ? native : null;
}
