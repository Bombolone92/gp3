// Channel arithmetic for Apply Image and Calculations: blend a source image
// or single channel into a target with any separable blend mode, or add and
// subtract with a scale and offset, limited by opacity and an optional mask.
import { blendChannel, blendModeIndex, blendModes, isSeparable, type BlendMode } from '../blend/modes';
import type { RGBA8 } from '../types';

export type ChannelBlend = BlendMode | 'add' | 'subtract';
export type SourceChannel = 'rgb' | 'r' | 'g' | 'b' | 'gray' | 'alpha';
export type TargetChannel = 'rgb' | 'r' | 'g' | 'b';
export type ChannelOptions = {
  blend: ChannelBlend;
  // 0..1.
  opacity: number;
  invert?: boolean;
  // Add and Subtract: result = (backdrop ± source) / scale + offset (codes).
  scale?: number;
  offset?: number;
  // Limits the effect: 0..255 per pixel, same size as the target.
  mask?: Uint8Array;
  // Only change visible target pixels (alpha stays as it is).
  preserveTransparency?: boolean;
};

/** Blend modes Apply Image and Calculations offer, in menu order. */
export const channelBlends: { id: ChannelBlend; label: string; group: number }[] = [
  ...blendModes.filter((m) => isSeparable(m.id) && m.id !== 'dissolve' && m.id !== 'linear-dodge').map((m) => ({ id: m.id as ChannelBlend, label: m.label, group: m.group })),
  { id: 'add', label: 'Add', group: 6 },
  { id: 'subtract', label: 'Subtract', group: 6 },
];

/** One blended code value (0..255) for backdrop b and source s. */
export function blendCodes(blend: ChannelBlend, b: number, s: number, scale = 1, offset = 0): number {
  if (blend === 'add' || blend === 'subtract') {
    const v = ((blend === 'add' ? b + s : b - s) / Math.max(1, scale)) + offset;
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return blendChannel(blendModeIndex(blend), b / 255, s / 255) * 255;
}

const LR = 0.299,
  LG = 0.587,
  LB = 0.114;

/** One channel of an image as a plane of codes. `gray` is luma; color
 * channels of transparent pixels read as they are stored. */
export function channelPlane(img: RGBA8, ch: Exclude<SourceChannel, 'rgb'>): Uint8Array {
  const n = img.width * img.height;
  const out = new Uint8Array(n);
  const d = img.data;
  const k = ch === 'r' ? 0 : ch === 'g' ? 1 : ch === 'b' ? 2 : ch === 'alpha' ? 3 : -1;
  for (let i = 0; i < n; i++) out[i] = k >= 0 ? d[i * 4 + k] : Math.round(LR * d[i * 4] + LG * d[i * 4 + 1] + LB * d[i * 4 + 2]);
  return out;
}

/** Apply Image: blend `source` (an RGBA image of the same size, or a single
 * plane applied to every target channel) into `target`. Returns a new image. */
export function applyImage(target: RGBA8, source: RGBA8 | Uint8Array, targetChannel: TargetChannel, o: ChannelOptions): RGBA8 {
  const n = target.width * target.height;
  const out: RGBA8 = { width: target.width, height: target.height, data: new Uint8ClampedArray(target.data) };
  const t = target.data,
    d = out.data;
  const plane = source instanceof Uint8Array ? source : null;
  const rgb = plane ? null : (source as RGBA8).data;
  const channels = targetChannel === 'rgb' ? [0, 1, 2] : [targetChannel === 'r' ? 0 : targetChannel === 'g' ? 1 : 2];
  const opacity = Math.max(0, Math.min(1, o.opacity));
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    let as = opacity * (o.mask ? o.mask[i] / 255 : 1) * (rgb ? rgb[p + 3] / 255 : 1);
    if (as <= 0) continue;
    const ab = t[p + 3] / 255;
    if (o.preserveTransparency) {
      if (ab <= 0) continue;
      for (const c of channels) {
        let s = plane ? plane[i] : rgb![p + c];
        if (o.invert) s = 255 - s;
        const B = blendCodes(o.blend, t[p + c], s, o.scale, o.offset);
        d[p + c] = t[p + c] + (B - t[p + c]) * as;
      }
      continue;
    }
    // Ordinary compositing of the blended source over the target.
    if (as > 1) as = 1;
    const ao = as + ab * (1 - as);
    for (let c = 0; c < 3; c++) {
      let s = plane ? plane[i] : rgb![p + c];
      if (o.invert) s = 255 - s;
      const cb = t[p + c];
      // Channels outside the target keep the backdrop's color.
      const B = channels.includes(c) ? blendCodes(o.blend, cb, s, o.scale, o.offset) : cb;
      const src = channels.includes(c) ? s : cb;
      const co = (1 - as) * ab * cb + (1 - ab) * as * src + as * ab * B;
      d[p + c] = ao > 0 ? co / ao : cb;
    }
    d[p + 3] = ao * 255;
  }
  return out;
}

/** Calculations: blend plane `a` (source 1) onto plane `b` (source 2, the
 * backdrop) into a new channel of codes. */
export function calculate(a: Uint8Array, b: Uint8Array, o: ChannelOptions & { invertB?: boolean }): Uint8Array {
  const out = new Uint8Array(b.length);
  const opacity = Math.max(0, Math.min(1, o.opacity));
  for (let i = 0; i < out.length; i++) {
    const s = o.invert ? 255 - a[i] : a[i];
    const bb = o.invertB ? 255 - b[i] : b[i];
    const k = opacity * (o.mask ? o.mask[i] / 255 : 1);
    const B = blendCodes(o.blend, bb, s, o.scale, o.offset);
    out[i] = Math.round(bb + (B - bb) * k);
  }
  return out;
}
