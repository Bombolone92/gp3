// Other > HSB/HSL: re-encode the color channels between RGB and the
// hue/saturation/brightness (HSB) or hue/saturation/lightness (HSL) models.
// Hue (0-360°) and the two other components (0-1) are stored in the red,
// green and blue channels scaled to 0-255; alpha is untouched.
import { defineOp, newImage, str, tick } from './common';

export type ChannelModel = 'rgb' | 'hsb' | 'hsl';

/** RGB in [0, 1] to [h, s, b] with h in [0, 1) of a turn. */
export function rgbToHsb(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  return [hue(r, g, b, max, d), max > 0 ? d / max : 0, max];
}
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [hue(r, g, b, max, d), Math.min(1, s), l];
}
function hue(r: number, g: number, b: number, max: number, d: number) {
  if (d === 0) return 0;
  let h = max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return h < 0 ? h + 1 : h;
}
export function hsbToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  return fromChroma(h, c, v - c);
}
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  return fromChroma(h, c, l - c / 2);
}
function fromChroma(h: number, c: number, m: number): [number, number, number] {
  const hp = (((h % 1) + 1) % 1) * 6, x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

/** Convert one encoded pixel (0-255 channels) between models. */
export function convertChannels(r: number, g: number, b: number, from: ChannelModel, to: ChannelModel): [number, number, number] {
  if (from === to) return [r, g, b];
  let rgb: [number, number, number] = [r / 255, g / 255, b / 255];
  // Hue wraps at 256 codes so 255 sits just below a full turn.
  if (from === 'hsb') rgb = hsbToRgb(r / 256, g / 255, b / 255);
  else if (from === 'hsl') rgb = hslToRgb(r / 256, g / 255, b / 255);
  if (to === 'rgb') return [rgb[0] * 255, rgb[1] * 255, rgb[2] * 255];
  const [h, s, v] = to === 'hsb' ? rgbToHsb(rgb[0], rgb[1], rgb[2]) : rgbToHsl(rgb[0], rgb[1], rgb[2]);
  return [Math.round(h * 256) % 256, s * 255, v * 255];
}

const models = [
  { value: 'rgb', label: 'RGB' },
  { value: 'hsb', label: 'HSB' },
  { value: 'hsl', label: 'HSL' },
];

export const hsbHsl = defineOp({
  id: 'hsb-hsl',
  label: 'HSB/HSL',
  category: 'Other',
  support: () => 0,
  params: [
    { key: 'input', label: 'Input Mode', type: 'select', options: models, default: 'rgb' },
    { key: 'output', label: 'Output Mode', type: 'select', options: models, default: 'hsb' },
  ],
  run(src, p, _ctx, progress) {
    const from = str(p, 'input') as ChannelModel, to = str(p, 'output') as ChannelModel;
    const out = newImage(src);
    const s = src.data, o = out.data, w = src.width, h = src.height;
    for (let y = 0; y < h; y++) {
      tick(progress, y, h);
      for (let i = y * w * 4, e = (y + 1) * w * 4; i < e; i += 4) {
        const [r, g, b] = convertChannels(s[i], s[i + 1], s[i + 2], from, to);
        o[i] = r;
        o[i + 1] = g;
        o[i + 2] = b;
        o[i + 3] = s[i + 3];
      }
    }
    return out;
  },
});
