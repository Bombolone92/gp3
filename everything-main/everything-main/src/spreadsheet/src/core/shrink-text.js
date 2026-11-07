import { maxLineWidth } from './textfit.js';
import { measureFormatParts } from './format-layout.js';
import { richTextMeasure, largestRichTextSize } from './rich-text-font.js';

/** Fit displayed glyphs without changing the stored font or format. Measurement
 * includes rich runs and format padding; fill characters use the remaining room. */
export function shrinkCellText({ text, parts, font, zoom = 1, width, angle = 0, measure }) {
  const originalSize = Number(/([\d.]+)px/.exec(font)?.[1]);
  const scaledFont = scale => font.replace(/([\d.]+)px/, (_, size) => `${Number(size) * scale}px`);
  const measured = scale => richTextMeasure(scaledFont(scale), measure, zoom * scale);
  const radians = Math.abs(angle) * Math.PI / 180;
  const extent = scale => {
    const m = measured(scale);
    const natural = parts ? measureFormatParts(parts, m) : maxLineWidth(text, line => m(line));
    return natural * Math.cos(radians) + largestRichTextSize(parts, originalSize / zoom) * zoom * scale * 1.2 * Math.sin(radians);
  };
  let scale = 1;
  if (width > 0 && Number.isFinite(width) && originalSize > 0) {
    const natural = extent(1);
    if (Number.isFinite(natural) && natural > width) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (extent(mid) <= Math.max(0, width - 0.1)) lo = mid; else hi = mid;
      }
      scale = Math.max(lo, 0.00001);
    }
  }
  return { scale, font: scaledFont(scale), zoom: zoom * scale, measure: measured(scale) };
}
