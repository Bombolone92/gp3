// Fitting generated images into the area they were made for, and the style
// and aspect presets of Generate Image. No DOM; runs in the worker and tests.
import { resize } from '../../imaging/filters/resample';
import type { RGBA8 } from '../../imaging/types';

export type FitMode = 'fill' | 'fit';

/** Scale `img` to cover (fill, centered crop) or fit inside (fit, centered
 * with transparent margins) a w x h box. */
export function fitImage(img: RGBA8, w: number, h: number, mode: FitMode): RGBA8 {
  const s = mode === 'fill' ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height);
  const sw = Math.max(1, Math.round(img.width * s)), sh = Math.max(1, Math.round(img.height * s));
  const scaled = sw === img.width && sh === img.height ? img : resize(img, sw, sh, 'lanczos');
  const out: RGBA8 = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  const ox = Math.round((w - sw) / 2), oy = Math.round((h - sh) / 2);
  for (let y = 0; y < h; y++) {
    const sy = y - oy;
    if (sy < 0 || sy >= sh) continue;
    const x0 = Math.max(0, ox), x1 = Math.min(w, ox + sw);
    if (x1 > x0) out.data.set(scaled.data.subarray((sy * sw + x0 - ox) * 4, (sy * sw + x1 - ox) * 4), (y * w + x0) * 4);
  }
  return out;
}

// Style presets add a short description to the prompt (original wording).
export const STYLES: { id: string; label: string; suffix: string }[] = [
  { id: 'none', label: 'No style', suffix: '' },
  { id: 'photo', label: 'Photograph', suffix: 'realistic photograph, natural light, fine detail' },
  { id: 'cinematic', label: 'Cinematic still', suffix: 'cinematic film still, dramatic lighting, shallow depth of field' },
  { id: 'painting', label: 'Digital painting', suffix: 'digital painting, visible brush strokes, rich color' },
  { id: 'watercolor', label: 'Watercolor', suffix: 'watercolor on textured paper, soft washes' },
  { id: 'ink', label: 'Ink drawing', suffix: 'black ink line drawing, clean linework, white background' },
  { id: 'flat', label: 'Flat illustration', suffix: 'flat vector illustration, simple shapes, limited palette' },
  { id: 'render', label: '3D render', suffix: 'studio 3D render, soft global illumination' },
  { id: 'pixel', label: 'Pixel art', suffix: 'pixel art, crisp pixels, limited palette' },
];
export function styledPrompt(prompt: string, style: string): string {
  const s = STYLES.find((x) => x.id === style);
  const p = prompt.trim().replace(/[.\s]+$/, '');
  return s?.suffix ? `${p}. Style: ${s.suffix}.` : p;
}

/** Provider-specific quality value for a Draft/Standard/High choice. */
export function qualityFor(model: string, q: string): string | undefined {
  if (!model || model.startsWith('gpt-image')) return q === 'draft' ? 'low' : q === 'high' ? 'high' : 'medium';
  if (model.startsWith('gemini')) return q === 'high' ? '2K' : '1K';
  return undefined;
}

// Aspect presets; 'target' follows the selection or canvas.
export const ASPECTS: { id: string; label: string; ratio?: [number, number] }[] = [
  { id: 'target', label: 'Match target' },
  { id: '1:1', label: 'Square 1:1', ratio: [1, 1] },
  { id: '4:3', label: 'Landscape 4:3', ratio: [4, 3] },
  { id: '3:2', label: 'Landscape 3:2', ratio: [3, 2] },
  { id: '16:9', label: 'Wide 16:9', ratio: [16, 9] },
  { id: '3:4', label: 'Portrait 3:4', ratio: [3, 4] },
  { id: '2:3', label: 'Portrait 2:3', ratio: [2, 3] },
  { id: '9:16', label: 'Tall 9:16', ratio: [9, 16] },
];
/** Request dimensions for an aspect preset and a target box. */
export function aspectSize(aspect: string, targetW: number, targetH: number): { width: number; height: number } {
  const r = ASPECTS.find((a) => a.id === aspect)?.ratio;
  if (!r) return { width: targetW, height: targetH };
  // Same area as the target, at the preset's proportions.
  const area = targetW * targetH, h = Math.sqrt((area * r[1]) / r[0]);
  return { width: Math.max(1, Math.round((h * r[0]) / r[1])), height: Math.max(1, Math.round(h)) };
}

// Upscale: document size limits.
export const MAX_SIDE = 8192, MAX_PIXELS = 24_000_000;
/** New size for a percentage, and whether it fits the document limits. */
export function upscaleSize(w: number, h: number, percent: number) {
  const nw = Math.max(1, Math.round((w * percent) / 100)), nh = Math.max(1, Math.round((h * percent) / 100));
  return { width: nw, height: nh, fits: nw <= MAX_SIDE && nh <= MAX_SIDE && nw * nh <= MAX_PIXELS };
}
/** Largest whole percentage that still fits the limits. */
export function maxPercent(w: number, h: number) {
  const f = Math.min(MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_PIXELS / (w * h)));
  let p = Math.floor(f * 100);
  while (p > 100 && !upscaleSize(w, h, p).fits) p--;
  return p;
}
