// Color-driven selections: Magic Wand and Color Range.
import { mask8, type Mask8, type RGBA8 } from '../types';

export type MagicWandOptions = { contiguous?: boolean; antiAlias?: boolean; connectivity?: 4 | 8 };

// Premultiplied max-channel distance test against the seed color.
function matches(d: Uint8ClampedArray, p: number, sr: number, sg: number, sb: number, sa: number, tol: number) {
  const i = p * 4, a = d[i + 3];
  if (a - sa > tol || sa - a > tol) return false;
  const k = a / 255, t = tol + 1e-9;
  const r = d[i] * k - sr, g = d[i + 1] * k - sg, b = d[i + 2] * k - sb;
  return r <= t && r >= -t && g <= t && g >= -t && b <= t && b >= -t;
}

// Pixels whose largest per-channel difference from the clicked pixel is within
// `tolerance` (0-255). Colors are compared premultiplied, so all fully transparent
// pixels match each other regardless of their hidden color.
export function magicWand(img: RGBA8, x: number, y: number, tolerance: number, opts: MagicWandOptions = {}): Mask8 {
  const { width: w, height: h, data: d } = img, { contiguous = true, antiAlias = true, connectivity = 4 } = opts;
  const out = mask8(w, h);
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return out;
  const si = (y * w + x) * 4, sa = d[si + 3];
  const sr = (d[si] * sa) / 255, sg = (d[si + 1] * sa) / 255, sb = (d[si + 2] * sa) / 255;
  const tol = Math.max(0, tolerance), sel = out.data;
  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (matches(d, p, sr, sg, sb, sa, tol)) sel[p] = 255;
  } else {
    // Scanline flood fill: fill whole runs, then queue run starts in the rows
    // above and below. `seen` marks pixels already tested.
    let stack = new Int32Array(1024), sp = 0;
    const seen = new Uint8Array(w * h);
    stack[sp++] = y * w + x;
    while (sp) {
      const p0 = stack[--sp];
      if (seen[p0]) continue;
      seen[p0] = 1;
      if (!matches(d, p0, sr, sg, sb, sa, tol)) continue;
      const cy = (p0 / w) | 0, row = cy * w, cx = p0 - row;
      let l = cx, r = cx;
      while (l > 0 && !seen[row + l - 1] && matches(d, row + l - 1, sr, sg, sb, sa, tol)) seen[row + --l] = 1;
      while (r < w - 1 && !seen[row + r + 1] && matches(d, row + r + 1, sr, sg, sb, sa, tol)) seen[row + ++r] = 1;
      sel.fill(255, row + l, row + r + 1);
      const lo = connectivity === 8 ? Math.max(0, l - 1) : l, hi = connectivity === 8 ? Math.min(w - 1, r + 1) : r;
      for (let ny = cy - 1; ny <= cy + 1; ny += 2) {
        if (ny < 0 || ny >= h) continue;
        const nr = ny * w;
        let inRun = false;
        for (let i = lo; i <= hi; i++) {
          const q = nr + i, ok = !seen[q] && matches(d, q, sr, sg, sb, sa, tol);
          if (!ok) {
            if (!seen[q]) seen[q] = 1;
          } else if (!inRun) {
            if (sp === stack.length) {
              const grown = new Int32Array(sp * 2);
              grown.set(stack);
              stack = grown;
            }
            stack[sp++] = q;
          }
          inRun = ok;
        }
      }
    }
  }
  return antiAlias ? antiAliasMask(out) : out;
}

// One-pixel tent filter on the hard result: only pixels touching the boundary
// change, interior and exterior stay at 255 and 0.
export function antiAliasMask(m: Mask8): Mask8 {
  const { width: w, height: h, data } = m, o = mask8(w, h), od = o.data;
  for (let y = 0; y < h; y++) {
    const inner = y > 0 && y < h - 1;
    for (let x = 0; x < w; x++) {
      const p = y * w + x, v = data[p];
      if (inner && x > 0 && x < w - 1) {
        const l = data[p - 1], r = data[p + 1], u = data[p - w], dn = data[p + w];
        const a = data[p - w - 1], b = data[p - w + 1], c = data[p + w - 1], e = data[p + w + 1];
        if (l === v && r === v && u === v && dn === v && a === v && b === v && c === v && e === v) od[p] = v;
        else od[p] = Math.round((4 * v + 2 * (l + r + u + dn) + a + b + c + e) / 16);
        continue;
      }
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          s += data[yy * w + xx] * (dx ? 1 : 2) * (dy ? 1 : 2);
        }
      }
      od[p] = s === v * 16 ? v : Math.round(s / 16);
    }
  }
  return o;
}

// ---------------------------------------------------------------------------
// Color Range

export type ColorRangePreset = 'sampled' | 'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas' | 'highlights' | 'midtones' | 'shadows' | 'skin';
export type ColorRangeOptions = {
  range?: ColorRangePreset;
  localized?: { x: number; y: number; radius: number };
  invert?: boolean;
};

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const fLab = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
// sRGB (D65) to CIE L*a*b*.
export function rgbToLab(r: number, g: number, b: number, out: Float32Array | number[] = [0, 0, 0]) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const x = fLab((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = fLab(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = fLab((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  out[0] = 116 * y - 16;
  out[1] = 500 * (x - y);
  out[2] = 200 * (y - z);
  return out;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const HUES: Partial<Record<ColorRangePreset, number>> = { reds: 0, yellows: 60, greens: 120, cyans: 180, blues: 240, magentas: 300 };

// Soft selection by color. For 'sampled', coverage falls smoothly from 1 at the
// sampled colors to 0 at a CIE76 distance equal to `fuzziness` (0-200).
export function colorRange(img: RGBA8, sampleColors: [number, number, number][], fuzziness: number, opts: ColorRangeOptions = {}): Mask8 {
  const { width: w, height: h, data: d } = img, range = opts.range ?? 'sampled', out = mask8(w, h);
  const samples = sampleColors.map(([r, g, b]) => rgbToLab(r & 255, g & 255, b & 255, new Float32Array(3)));
  const half = Math.max(fuzziness / 2, 0.5), lab = new Float32Array(3), hue = HUES[range];
  // Coverage per color, memoized on a 7-bit-per-channel grid (2 MB; 255 = not
  // yet computed): photos repeat colors heavily and Lab conversion is the cost.
  const lut = range === 'sampled' ? new Uint8Array(1 << 21).fill(255) : null;
  const loc = opts.localized;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x, i = p * 4, r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (!a) continue;
      let c = 0;
      if (lut) {
        const k = ((r >> 1) << 14) | ((g >> 1) << 7) | (b >> 1);
        let v = lut[k];
        if (v === 255) {
          rgbToLab(r & 254, g & 254, b & 254, lab);
          let best = Infinity;
          for (const s of samples) {
            const dl = lab[0] - s[0], da = lab[1] - s[1], db = lab[2] - s[2];
            best = Math.min(best, dl * dl + da * da + db * db);
          }
          const t = Math.sqrt(best) / half;
          v = lut[k] = Math.round(254 * (t <= 1 ? 1 - (t * t) / 2 : t <= 2 ? ((2 - t) * (2 - t)) / 2 : 0));
        }
        c = v / 254;
      } else if (hue !== undefined) {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), ch = mx - mn;
        if (ch > 0) {
          let hh = mx === r ? ((g - b) / ch) * 60 : mx === g ? ((b - r) / ch) * 60 + 120 : ((r - g) / ch) * 60 + 240;
          if (hh < 0) hh += 360;
          let dh = Math.abs(hh - hue);
          if (dh > 180) dh = 360 - dh;
          c = (1 - smoothstep(20, 45, dh)) * smoothstep(10, 40, ch);
        }
      } else {
        const Y = 0.299 * r + 0.587 * g + 0.114 * b;
        if (range === 'highlights') c = smoothstep(150, 210, Y);
        else if (range === 'shadows') c = 1 - smoothstep(45, 105, Y);
        else if (range === 'midtones') c = smoothstep(40, 100, Y) * (1 - smoothstep(155, 215, Y));
        else {
          // Skin: soft box in CbCr (Chai and Ngan 1999), widened by fuzziness.
          const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
          const m = 4 + fuzziness / 8;
          c = smoothstep(77 - m, 77 + m, cb) * (1 - smoothstep(127 - m, 127 + m, cb)) * smoothstep(133 - m, 133 + m, cr) * (1 - smoothstep(173 - m, 173 + m, cr));
          if (c > 0) c *= smoothstep(30, 60, Y);
        }
      }
      if (loc && c > 0) {
        const dist = Math.hypot(x + 0.5 - loc.x, y + 0.5 - loc.y);
        c *= 1 - smoothstep(loc.radius * 0.5, loc.radius, dist);
      }
      out.data[p] = Math.round(c * a);
    }
  }
  if (opts.invert) for (let p = 0; p < out.data.length; p++) out.data[p] = (d[p * 4 + 3] ? 255 : 0) - out.data[p];
  return out;
}
