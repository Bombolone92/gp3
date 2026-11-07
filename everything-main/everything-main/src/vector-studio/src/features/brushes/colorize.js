/**
 * Brush colorization: recolor scatter, art and pattern brush artwork with
 * the stroke color of the path it paints.
 *
 *   none          the artwork keeps its own colors
 *   tints         dark becomes the stroke color, light becomes white
 *                 (the artwork's lightness picks the tint)
 *   tintsShades   black stays black and white stays white; the middle
 *                 tones become the stroke color
 *   hueShift      the key color becomes the stroke color and every other
 *                 color turns its hue by the same amount
 */
import { hexToRgb, rgbToHex, rgbToHsb, hsbToRgb, mix } from '../../lib/color.js';

/** The representative color of a stroke paint (first stop for gradients), or null. */
export function strokeColorOf(paint) {
  if (!paint) return null;
  if (paint.type === 'solid') return paint.color;
  if (paint.stops?.length) return paint.stops[0].color;
  return null;
}

function lightness(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** One color through a colorization method. */
export function colorizeColor(hex, method, stroke, key = '#000000') {
  if (!stroke || !method || method === 'none') return hex;
  switch (method) {
    case 'tints':
      return mix(stroke, '#ffffff', lightness(hex));
    case 'tintsShades': {
      const l = lightness(hex);
      return l < 0.5 ? mix('#000000', stroke, l / 0.5) : mix(stroke, '#ffffff', (l - 0.5) / 0.5);
    }
    case 'hueShift': {
      const k = rgbToHsb(hexToRgb(key));
      const s = rgbToHsb(hexToRgb(stroke));
      const c = rgbToHsb(hexToRgb(hex));
      if (hex.toLowerCase() === key.toLowerCase()) return stroke;
      // Grays have no hue to turn.
      if (c.s < 1) return hex;
      return rgbToHex(hsbToRgb({ h: c.h + (s.h - k.h), s: c.s, v: c.v }));
    }
    default:
      return hex;
  }
}

/** A paint (solid or gradient) through a colorization method. */
export function colorizePaint(paint, method, stroke, key) {
  if (!paint || !stroke || !method || method === 'none') return paint;
  if (paint.type === 'solid') return { ...paint, color: colorizeColor(paint.color, method, stroke, key) };
  if (paint.stops) return { ...paint, stops: paint.stops.map((st) => ({ ...st, color: colorizeColor(st.color, method, stroke, key) })) };
  return paint;
}
