import { displayedFont, isBundledFont } from './font-availability.js';
import { measuredFaceMetrics } from './face-metrics.js';
import { nativeUnderlineMetrics } from './native-underline-metrics.js';
const nativeFaces = new Map();
export function clearNativeFaceMetrics() { nativeFaces.clear(); }
// Sample at a large em to avoid integer rounding of small native font boxes.
// CSS normal line height also exposes the face's external leading, which is
// placed above the baseline for automatic paragraph line spacing.
export function nativeFaceMetrics(font, family, style) {
  if (nativeFaces.has(font)) return nativeFaces.get(font);
  if (typeof document === 'undefined' || !document.body) return;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return;
  context.font = font;
  const box = context.measureText('Mg');
  if (!Number.isFinite(box.fontBoundingBoxAscent) || !Number.isFinite(box.fontBoundingBoxDescent)) return;
  const probe = document.createElement('div');
  probe.style.cssText = 'all:initial;position:absolute;visibility:hidden;white-space:nowrap;margin:0;padding:0;border:0';
  probe.style.font = font; probe.style.lineHeight = 'normal'; probe.textContent = 'Mg';
  document.body.append(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  if (!(height > 0)) return;
  const metrics = nativeUnderlineMetrics(family, style, measuredFaceMetrics(family, { ascent: (height - box.fontBoundingBoxDescent) / 2048, descent: box.fontBoundingBoxDescent / 2048 }));
  nativeFaces.set(font, metrics);
  return metrics;
}
// Metrics from both unmodified bundled Noto Sans fonts (head/hhea/post/OS/2 tables).
// Source and hashes: public/fonts/PROVENANCE.md. Sizes in points, output in CSS px.
export function fontMetrics(style, native, face) {
  // MVAR stro at wght=700/wdth=100, after avar remapping (both faces).
  const strikePosition = style.bold ? .3281000732198371 : .322;
  const em = (style.fontSize ?? 12) * 4 / 3;
  const result = { ascent: em * 1.069, descent: em * 0.293, underlineOffset: em * 0.1, underlineThickness: em * 0.05, strikeOffset: -em * strikePosition, strikeThickness: em * .05 };
  // Font bounding boxes are independent of the current letters (unlike ink
  // bounds). Empty paragraphs and spaces must have the same line metrics.
  if (!isBundledFont(displayedFont(style)) && Number.isFinite(native?.fontBoundingBoxAscent) && Number.isFinite(native?.fontBoundingBoxDescent)) {
    result.ascent = face ? face.ascent * em : native.fontBoundingBoxAscent;
    result.descent = face ? face.descent * em : native.fontBoundingBoxDescent;
    if (face?.underlineThickness !== undefined) {
      result.nativeUnderlineOffset = face.underlineOffset * em;
      result.nativeUnderlineThickness = face.underlineThickness * em;
    }
  }
  return result;
}
