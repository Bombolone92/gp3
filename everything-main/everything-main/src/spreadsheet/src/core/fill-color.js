import { normalizeFontColor, fontColorCss, fontColorInPalette, sameFontColor } from './font-color.js';

/** Solid fills use the same theme/indexed reference identity as font colors.
 * Keep the reference in the style; resolve only at paint/export boundaries.
 * No fill is separate from an explicit white fill or a palette reference.
 */
export function normalizeFillColor(value) {
  if (value === 'transparent') return value;
  return value === 'windowtext' ? null : normalizeFontColor(value);
}
export function fillColorCss(value) {
  return value && typeof value === 'object' ? fontColorCss(normalizeFillColor(value)) : typeof value === 'string' ? value : null;
}
export function fillColorInPalette(value, palette) {
  const color = normalizeFillColor(value);
  return color === 'transparent' ? null : fontColorInPalette(color, palette);
}
export const sameFillColor = sameFontColor;
