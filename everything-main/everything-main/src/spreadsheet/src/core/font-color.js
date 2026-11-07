export const INDEXED_COLORS = ('000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF '
  + '000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF '
  + '800000 008000 000080 808000 800080 008080 C0C0C0 808080 '
  + '9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF '
  + '000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF '
  + '00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 '
  + '3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 '
  + '003366 339966 003300 333300 993300 993366 333399 333333').split(' ');

/** Font colors retain reference identity: theme black is not an RGB override. */
export const DEFAULT_FONT_COLOR = Object.freeze({ theme: 1, base: '#000000', rgb: '#000000' });
const normalizedColors = new WeakSet();
const HEX = /^#[\da-f]{6}$/i;
export function normalizeFontColor(value) {
  if (value && typeof value === 'object' && normalizedColors.has(value)) return value;
  if (value === 'windowtext') return value;
  if (typeof value === 'string') return HEX.test(value) ? value : null;
  if (!value || typeof value !== 'object' || typeof value.rgb !== 'string' || typeof value.base !== 'string' || !HEX.test(value.rgb) || !HEX.test(value.base)) return null;
  const key = Object.hasOwn(value, 'theme') ? 'theme' : 'indexed';
  const index = value[key];
  if (!Number.isInteger(index) || index < 0 || index >= (key === 'theme' ? 12 : 64)) return null;
  if (value.tint != null && (!Number.isFinite(value.tint) || value.tint < -1 || value.tint > 1)) return null;
  const base = value.base.toLowerCase(), tint = value.tint || 0;
  const color = Object.freeze({ [key]: index, base, rgb: tint ? `#${tintRgb(base.slice(1), tint)}` : base, ...(tint ? { tint } : {}) });
  normalizedColors.add(color);
  return color;
}
export function fontColorCss(value) {
  if (value && typeof value === 'object') return typeof value.rgb === 'string' && HEX.test(value.rgb) ? value.rgb : null;
  // Existing in-memory CSS colors can also use shorthand or alpha hex. Native
  // font references remain opaque RGB, while these paints retain their meaning.
  return typeof value === 'string' && (value === 'windowtext' || /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) ? value : null;
}
export function sameFontColor(a, b) {
  if (a === b) return true;
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  return a.theme === b.theme && a.indexed === b.indexed && a.base === b.base && (a.tint || 0) === (b.tint || 0);
}
/** A reference copied from a different palette becomes explicit source RGB.
 * Reusing its index in the destination would silently change the text color. */
export function fontColorInPalette(value, palette) {
  const c = normalizeFontColor(value);
  if (!c || typeof c !== 'object') return c;
  const key = 'theme' in c ? 'theme' : 'indexed';
  return (palette?.[key]?.[c[key]] || DEFAULT_COLOR_PALETTE[key][c[key]]) === c.base ? c : c.rgb;
}
export function normalizeColorPalette(value) {
  if (!value || typeof value !== 'object') return null;
  const out = {};
  for (const key of ['theme', 'indexed']) {
    if (!Array.isArray(value[key])) continue;
    const limit = key === 'theme' ? 12 : 64;
    out[key] = value[key].slice(0, limit).map(c => typeof c === 'string' && HEX.test(c) ? c.toLowerCase() : null);
  }
  return Object.keys(out).length ? out : null;
}

// Tint applies to HSL luminance, rather than to each RGB channel.
export function tintRgb(hex, tint) {
  const rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const hi = Math.max(...rgb), lo = Math.min(...rgb), delta = hi - lo, light = (hi + lo) / 2;
  const sat = delta ? delta / (1 - Math.abs(2 * light - 1)) : 0;
  const hue = !delta ? 0 : hi === rgb[0] ? ((rgb[1] - rgb[2]) / delta + 6) % 6 : hi === rgb[1] ? (rgb[2] - rgb[0]) / delta + 2 : (rgb[0] - rgb[1]) / delta + 4;
  const l = tint < 0 ? light * (1 + tint) : light + (1 - light) * tint;
  const chroma = (1 - Math.abs(2 * l - 1)) * sat, x = chroma * (1 - Math.abs(hue % 2 - 1)), m = l - chroma / 2;
  const channels = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][Math.floor(hue) % 6];
  return channels.map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}


// The default theme written for a new workbook; indexed colors are the standard
// SpreadsheetML palette. An omitted palette and these defaults are equivalent.
export const DEFAULT_COLOR_PALETTE = Object.freeze({
  theme: Object.freeze('FFFFFF 000000 EEECE1 1F497D 4F81BD C0504D 9BBB59 8064A2 4BACC6 F79646 0000FF 800080'.split(' ').map(c => `#${c.toLowerCase()}`)),
  indexed: Object.freeze(INDEXED_COLORS.map(c => `#${c.toLowerCase()}`)),
});
export function effectiveColorPalette(value) {
  const palette = normalizeColorPalette(value);
  return Object.fromEntries(Object.entries(DEFAULT_COLOR_PALETTE).map(([key, defaults]) => [key, defaults.map((color, i) => palette?.[key]?.[i] || color)]));
}
