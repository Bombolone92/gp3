import { normalizeFontColor } from './font-color.js';
import { fontName, fontKeyFor, fontStack } from './format.js';
import { MAX_COL } from './refs.js';

/** The workbook's Normal font is the basis of native XLSX column units. */
export function normalizeNormalFont(value) {
  if (!value || typeof value !== 'object') return null;
  const name = fontName(typeof value.name === 'string' ? `font:${value.name}` : null);
  if (!name || !Number.isFinite(value.sz) || value.sz <= 0 || value.sz > 409) return null;
  const font = { name, sz: value.sz };
  if (['major', 'minor'].includes(value.scheme)) font.scheme = value.scheme;
  for (const key of ['bold', 'italic', 'strike', 'outline', 'shadow', 'condense', 'extend']) if (value[key] === true) font[key] = true;
  if (['single', 'double', 'singleAccounting', 'doubleAccounting'].includes(value.underline)) font.underline = value.underline;
  if (['superscript', 'subscript'].includes(value.vertAlign)) font.vertAlign = value.vertAlign;
  if (Number.isInteger(value.family) && value.family >= 0 && value.family <= 5) font.family = value.family;
  if (Number.isInteger(value.charset) && value.charset >= 0 && value.charset <= 255) font.charset = value.charset;
  const color = normalizeFontColor(value.color);
  if (color) font.color = color;
  return font;
}

/** The supported text properties inherited by otherwise unformatted cells. */
export function normalFontStyle(font) {
  if (!font) return null;
  const style = { font: fontKeyFor(font.name, { literal: true }), size: font.sz * 4 / 3 };
  for (const key of ['bold', 'italic', 'strike', 'color', 'scheme']) if (font[key] != null) style[key] = font[key];
  if (font.underline) style.underline = true;
  return style;
}

/** The Normal face also supplies the spaces used by alignment.indent. */
export function normalFontCss(font) {
  if (!font) return null;
  const style = normalFontStyle(font);
  return `${font.italic ? 'italic ' : ''}${font.bold ? '600 ' : ''}${style.size}px ${fontStack(style.font)}`;
}

// Space advances from the fonts' hmtx tables, in em. The bundled Carlito and
// Caladea faces preserve Calibri/Cambria metrics. These advances are identical
// across their regular, bold, italic and bold-italic faces. Keeping known
// metrics available without a canvas also serves headless HTML export.
const SPACE_EM = new Map([
  ['arial', 569 / 2048], ['courier new', 1229 / 2048], ['times new roman', 1 / 4],
  ['calibri', 463 / 2048], ['carlito', 463 / 2048],
  ['cambria', 0.22], ['caladea', 0.22],
  ['open sans', 532 / 2048], ['open sans regular', 532 / 2048],
]);

/** One indent level in CSS pixels (before zoom).
 * ISO 29500 §18.3.1.4 uses three spaces of the workbook's Normal font, never
 * the cell font. The layout rounds the Normal size, then each
 * space advance, to whole points before multiplying, with a one-point
 * minimum for the resulting indent. Fractional-size controls on both sides
 * of .5 boundaries and proportional/monospaced fonts verify these steps.
 * Unavailable unknown faces use the same Arial fallback as fontStack; their
 * stored font and logical indent remain untouched for native round trips.
 */
export function normalIndentUnit(font, measureText = null) {
  if (!font || !Number.isFinite(font.sz) || font.sz <= 0) return 12;
  const points = Math.max(1, Math.round(font.sz));
  const css = () => normalFontCss({ ...font, sz: points });
  let spacePoints;
  const em = SPACE_EM.get(font.name?.toLowerCase());
  if (em != null) spacePoints = em * points;
  else if (measureText) spacePoints = measureText(' ', css()) * 3 / 4;
  else if (typeof document !== 'undefined' && document.defaultView?.CanvasRenderingContext2D) {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) { ctx.font = css(); spacePoints = ctx.measureText(' ').width * 3 / 4; }
  }
  if (!Number.isFinite(spacePoints) || spacePoints < 0) spacePoints = SPACE_EM.get('arial') * points;
  return Math.max(1, Math.round(spacePoints) * 3) * 4 / 3;
}

/** Keep native units alongside the pixels they produced. Unchanged dimensions
 * can retain their precision even when the source font is unavailable locally.
 */
export function normalizeNativeWidths(value) {
  const font = normalizeNormalFont(value?.font);
  if (!font) return null;
  const cols = {};
  const validWidth = n => Number.isFinite(n) && n >= 0 && n <= 255;
  for (const [key, entry] of Object.entries(value.cols || {})) {
    if (!/^\d+$/.test(key) || Number(key) > MAX_COL || !validWidth(entry?.width) || !Number.isFinite(entry.pixels) || entry.pixels <= 0) continue;
    cols[key] = { width: entry.width, pixels: entry.pixels };
  }
  const def = value.default;
  const out = { font, cols };
  if (def && Number.isFinite(def.pixels) && def.pixels > 0) {
    out.default = { pixels: def.pixels };
    if (validWidth(def.width)) out.default.width = def.width;
    if (Number.isInteger(def.base) && def.base >= 0 && def.base <= 255) out.default.base = def.base;
  }
  return out;
}

export function mapNativeWidths(sheet, map) {
  if (!sheet.nativeWidths) return;
  sheet.nativeWidths.cols = Object.fromEntries(Object.entries(sheet.nativeWidths.cols).flatMap(([key, value]) => {
    const c = map(Number(key));
    return Number.isInteger(c) && c >= 0 && c <= MAX_COL ? [[c, value]] : [];
  }));
}
