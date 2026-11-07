// Layer → Harmonize: move a layer's color and tone toward the image beneath
// it. Statistical color transfer in CIE L*a*b* (Reinhard et al. 2001, as in
// Match Color): each channel is shifted and scaled so its mean and spread
// approach those of the layers below, with separate weights for luminance and
// color and an overall strength. Contrast changes are limited to a factor of
// two either way so a flat background cannot crush a detailed layer. The
// mapping is smooth, so it is baked into a 3D lookup table that a clipped
// Color Lookup adjustment layer (or a destructive apply) uses. No DOM.
import { bakeCubeLut, labToRgb, rgbToLab, serializeCubeLut, type CubeLut } from '../../imaging/adjust';
import type { IRect, RGBA8 } from '../../imaging/types';
import type { Layer } from '../../model/document';
import type { LabStats } from '../adjust/match-color';

export type HarmonizeOptions = {
  // 0..100: overall amount of the transfer.
  strength: number;
  // 0..100: weight of brightness and contrast matching.
  luminance: number;
  // 0..100: weight of color (cast and saturation) matching.
  color: number;
};
/** Layers Harmonize can match: visible, with pixels of their own. */
export const canHarmonize = (l: Layer | undefined) => !!l && l.kind !== 'group' && l.kind !== 'adjustment' && l.visible;
// Moderate defaults: the layer takes on the scene's light and cast but keeps
// its own colors (full color matching would pull it to the scene's average).
export const DEFAULT_HARMONIZE: HarmonizeOptions = { strength: 100, luminance: 50, color: 35 };

/** The area whose statistics the layer should match: its bounds grown by a
 * quarter on each side (the surroundings matter as much as what it covers),
 * clipped to the canvas. */
export function contextRect(bounds: IRect, width: number, height: number): IRect {
  const mx = Math.round(bounds.width * 0.25), my = Math.round(bounds.height * 0.25);
  const x = Math.max(0, bounds.x - mx), y = Math.max(0, bounds.y - my);
  return { x, y, width: Math.max(1, Math.min(width, bounds.x + bounds.width + mx) - x), height: Math.max(1, Math.min(height, bounds.y + bounds.height + my) - y) };
}

/** Color function mapping the layer's statistics toward the target's. */
export function harmonizeFunction(layer: LabStats, target: LabStats, o: HarmonizeOptions) {
  const s = o.strength / 100, wl = (o.luminance / 100) * s, wc = (o.color / 100) * s;
  const ratio = (k: number) => Math.min(2, Math.max(0.5, layer.std[k] > 1e-3 ? target.std[k] / layer.std[k] : 1));
  const r = [ratio(0), ratio(1), ratio(2)], w = [wl, wc, wc];
  const lab = [0, 0, 0], rgb = [0, 0, 0];
  return (R: number, G: number, B: number, out: Float64Array | number[]) => {
    rgbToLab(R, G, B, lab);
    for (let k = 0; k < 3; k++) {
      const t = (lab[k] - layer.mean[k]) * r[k] + target.mean[k];
      lab[k] += w[k] * (t - lab[k]);
    }
    labToRgb(Math.min(100, Math.max(0, lab[0])), lab[1], lab[2], rgb);
    for (let k = 0; k < 3; k++) out[k] = Math.min(1, Math.max(0, rgb[k]));
  };
}

/** The transfer as a 3D table (17 points per axis keeps saved projects small
 * while staying within about one code value of the exact mapping). */
export function harmonizeLut(layer: LabStats, target: LabStats, o: HarmonizeOptions, size = 17): CubeLut {
  const f = harmonizeFunction(layer, target, o);
  return bakeCubeLut((r, g, b, out) => f(r, g, b, out), size, 'Harmonize');
}
/** `.cube` text of the table for the Color Lookup adjustment layer. */
export function harmonizeCube(layer: LabStats, target: LabStats, o: HarmonizeOptions): string {
  return serializeCubeLut(harmonizeLut(layer, target, o), 5);
}

/** Apply the transfer to pixels directly (straight RGBA, alpha kept). */
export function harmonizePixels(img: RGBA8, layer: LabStats, target: LabStats, o: HarmonizeOptions): RGBA8 {
  const f = harmonizeFunction(layer, target, o), out = new Uint8ClampedArray(img.data), v = [0, 0, 0];
  for (let i = 0; i < out.length; i += 4) {
    if (!out[i + 3]) continue;
    f(out[i] / 255, out[i + 1] / 255, out[i + 2] / 255, v);
    out[i] = v[0] * 255;
    out[i + 1] = v[1] * 255;
    out[i + 2] = v[2] * 255;
  }
  return { width: img.width, height: img.height, data: out };
}
