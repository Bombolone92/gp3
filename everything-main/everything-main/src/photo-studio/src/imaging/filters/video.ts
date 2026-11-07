// Video filters: removing one field of interlaced video frames, and limiting
// colors to the signal range of analog broadcast (composite) video.
import { copyImage, defineOp, num, str } from './common';

// Rows are counted from 0: the even field holds rows 0, 2, 4... and the odd
// field rows 1, 3, 5...
export const deinterlace = defineOp({
  id: 'deinterlace',
  label: 'De-Interlace',
  category: 'Video',
  params: [
    { key: 'remove', label: 'Remove', type: 'select', options: [{ value: 'odd', label: 'Odd lines' }, { value: 'even', label: 'Even lines' }], default: 'odd' },
    { key: 'fill', label: 'Replace with', type: 'select', options: [{ value: 'duplicate', label: 'Copies of the kept lines' }, { value: 'interpolate', label: 'Interpolated lines' }], default: 'interpolate' },
  ],
  run(src, p) {
    const out = copyImage(src);
    const { width: w, height: h } = src;
    if (h < 2) return out;
    const s = src.data,
      o = out.data;
    const parity = str(p, 'remove') === 'even' ? 0 : 1;
    const interpolate = str(p, 'fill') === 'interpolate';
    const row = w * 4;
    for (let y = parity; y < h; y += 2) {
      const above = y - 1,
        below = y + 1 < h ? y + 1 : -1;
      const at = y * row;
      if (!interpolate || above < 0 || below < 0) {
        // Duplicate the kept line above (or below at the top edge).
        const from = (above >= 0 ? above : below) * row;
        o.set(s.subarray(from, from + row), at);
        continue;
      }
      // Average the kept neighbors with alpha weighting so transparent
      // pixels do not darken the result.
      const a0 = above * row,
        b0 = below * row;
      for (let x = 0; x < row; x += 4) {
        const aa = s[a0 + x + 3],
          ba = s[b0 + x + 3],
          sum = aa + ba;
        for (let c = 0; c < 3; c++) o[at + x + c] = sum ? (s[a0 + x + c] * aa + s[b0 + x + c] * ba) / sum : (s[a0 + x + c] + s[b0 + x + c]) / 2;
        o[at + x + 3] = (sum + 1) >> 1;
      }
    }
    return out;
  },
});

// Composite video carries luma plus a chroma subcarrier whose amplitude is the
// length of the chroma vector (I/Q for NTSC, U/V for PAL). Colors whose peak
// excursion Y ± C leaves the legal range are pulled back by scaling their
// chroma (keeps brightness) or shifting their luma (keeps saturation).
type Standard = { setup: number; scale: number; chroma: (r: number, g: number, b: number, y: number) => number };
const standards: Record<string, Standard> = {
  // NTSC: 7.5 IRE setup, FCC YIQ.
  ntsc: {
    setup: 7.5,
    scale: 92.5,
    chroma: (r, g, b) => Math.hypot(0.596 * r - 0.274 * g - 0.322 * b, 0.211 * r - 0.523 * g + 0.312 * b),
  },
  // PAL: no setup, YUV.
  pal: {
    setup: 0,
    scale: 100,
    chroma: (r, _g, b, y) => Math.hypot(0.492 * (b - y), 0.877 * (r - y)),
  },
};
/** Largest and smallest legal luma ± chroma, in units where white is 1. */
export function signalLimits(standard: string, maxIre: number, minIre = -20) {
  const s = standards[standard] ?? standards.ntsc;
  return { hi: (maxIre - s.setup) / s.scale, lo: (minIre - s.setup) / s.scale };
}
/** Peak composite level of a color in IRE. */
export function compositePeak(standard: string, r: number, g: number, b: number) {
  const s = standards[standard] ?? standards.ntsc;
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const y = 0.299 * R + 0.587 * G + 0.114 * B;
  const c = s.chroma(R, G, B, y);
  return { high: s.setup + s.scale * (y + c), low: s.setup + s.scale * (y - c) };
}

export const broadcastSafe = defineOp({
  id: 'broadcast-safe',
  label: 'Broadcast-Safe Colors',
  category: 'Video',
  support: () => 0,
  params: [
    { key: 'standard', label: 'Standard', type: 'select', options: [{ value: 'ntsc', label: 'NTSC (YIQ, 7.5 IRE setup)' }, { value: 'pal', label: 'PAL (YUV)' }], default: 'ntsc' },
    { key: 'method', label: 'Reduce', type: 'select', options: [{ value: 'saturation', label: 'Saturation' }, { value: 'luminance', label: 'Luminance' }], default: 'saturation' },
    { key: 'max', label: 'Maximum signal', type: 'number', min: 100, max: 120, step: 1, default: 110, unit: 'IRE' },
  ],
  run(src, p) {
    const standard = str(p, 'standard');
    const s = standards[standard] ?? standards.ntsc;
    const { hi, lo } = signalLimits(standard, num(p, 'max'));
    const keepLuma = str(p, 'method') !== 'luminance';
    const out = copyImage(src),
      d = out.data;
    // 8-bit colors map to themselves, so cache results per color.
    const cache = new Map<number, number>();
    for (let i = 0; i < d.length; i += 4) {
      const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      let v = cache.get(key);
      if (v === undefined) {
        v = legalize(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, s, hi, lo, keepLuma);
        cache.set(key, v);
      }
      if (v !== key) {
        d[i] = v >> 16;
        d[i + 1] = (v >> 8) & 255;
        d[i + 2] = v & 255;
      }
    }
    return out;
  },
});

function legalize(r: number, g: number, b: number, s: Standard, hi: number, lo: number, keepLuma: boolean): number {
  const pack = (R: number, G: number, B: number) => {
    const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
    return (c(R) << 16) | (c(G) << 8) | c(B);
  };
  let y = 0.299 * r + 0.587 * g + 0.114 * b;
  const c = s.chroma(r, g, b, y);
  // Rounding back to 8 bits can push a color a hair over the limit; aim just inside it.
  const eps = 0.5 / 255;
  if (y + c <= hi && y - c >= lo) return pack(r, g, b);
  if (!keepLuma) {
    // Shift luma so the excursion fits; chroma (R-Y etc.) is unchanged.
    const target = y + c > hi ? hi - c - eps : lo + c + eps;
    const ny = Math.max(0, Math.min(1, target));
    r += ny - y;
    g += ny - y;
    b += ny - y;
    y = ny;
    // Out-of-gamut results fall back to reducing chroma below.
    if (y + c <= hi && y - c >= lo && Math.min(r, g, b) >= 0 && Math.max(r, g, b) <= 1) return pack(r, g, b);
  }
  // Chroma is linear in (R-Y, G-Y, B-Y), so scaling those scales its amplitude.
  // Rounding to 8 bits can land just outside the limit; tighten until it fits.
  let out = 0;
  for (let margin = eps, tries = 0; tries < 6; tries++, margin += 1 / 255) {
    const room = Math.max(0, Math.min(hi - y, y - lo) - margin);
    const k = c > 0 ? Math.min(1, room / c) : 1;
    out = pack(y + (r - y) * k, y + (g - y) * k, y + (b - y) * k);
    const R = (out >> 16) / 255,
      G = ((out >> 8) & 255) / 255,
      B = (out & 255) / 255;
    const ny = 0.299 * R + 0.587 * G + 0.114 * B,
      nc = s.chroma(R, G, B, ny);
    if (ny + nc <= hi && ny - nc >= lo) break;
  }
  return out;
}
