// Separable image resampling for export (nearest, bilinear, bicubic, Lanczos).
// Downscaling widens the kernel by the scale factor so it also low-pass filters
// (Schumacher, "General Filtered Image Rescaling", Graphics Gems III, 1992).
// Colors are weighted by alpha so transparent pixels do not bleed.
import { checkCancelled, type Progress } from '../../imaging/types';

export type ResampleMethod = 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';
type Samples = Uint8ClampedArray | Uint16Array;

const kernels: Record<Exclude<ResampleMethod, 'nearest'>, { support: number; f: (x: number) => number }> = {
  bilinear: { support: 1, f: (x) => Math.max(0, 1 - Math.abs(x)) },
  // Keys cubic convolution with a = -0.5 (Catmull-Rom).
  bicubic: {
    support: 2,
    f: (x) => {
      x = Math.abs(x);
      return x < 1 ? 1.5 * x ** 3 - 2.5 * x ** 2 + 1 : x < 2 ? -0.5 * x ** 3 + 2.5 * x ** 2 - 4 * x + 2 : 0;
    },
  },
  lanczos: {
    support: 3,
    f: (x) => {
      if (x === 0) return 1;
      if (Math.abs(x) >= 3) return 0;
      const p = Math.PI * x;
      return (3 * Math.sin(p) * Math.sin(p / 3)) / (p * p);
    },
  },
};

// Contributions of source pixels to each destination pixel along one axis.
function weights(src: number, dst: number, method: Exclude<ResampleMethod, 'nearest'>) {
  const k = kernels[method];
  const scale = dst / src;
  const widen = scale < 1 ? 1 / scale : 1;
  const support = k.support * widen;
  const start = new Int32Array(dst),
    count = new Int32Array(dst);
  const taps = Math.ceil(support) * 2 + 1;
  const w = new Float32Array(dst * taps);
  for (let i = 0; i < dst; i++) {
    const center = (i + 0.5) / scale - 0.5;
    const lo = Math.max(0, Math.ceil(center - support)),
      hi = Math.min(src - 1, Math.floor(center + support));
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += k.f((j - center) / widen);
    start[i] = lo;
    count[i] = Math.min(taps, hi - lo + 1);
    for (let j = 0; j < count[i]; j++) w[i * taps + j] = sum ? k.f((lo + j - center) / widen) / sum : 0;
    if (!sum && count[i]) w[i * taps] = 1;
  }
  return { start, count, w, taps };
}

/** Resample straight RGBA samples (8- or 16-bit) to `nw` × `nh`. */
export function resampleRGBA<T extends Samples>(data: T, width: number, height: number, nw: number, nh: number, method: ResampleMethod = 'bicubic', progress?: Progress): T {
  const Ctor = data.constructor as { new (n: number): T };
  if (nw === width && nh === height) return data.slice() as T;
  const out = new Ctor(nw * nh * 4);
  if (method === 'nearest') {
    const xs = new Int32Array(nw);
    for (let x = 0; x < nw; x++) xs[x] = Math.min(width - 1, Math.floor(((x + 0.5) * width) / nw));
    for (let y = 0; y < nh; y++) {
      const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / nh));
      for (let x = 0; x < nw; x++) {
        const s = (sy * width + xs[x]) * 4,
          d = (y * nw + x) * 4;
        out[d] = data[s];
        out[d + 1] = data[s + 1];
        out[d + 2] = data[s + 2];
        out[d + 3] = data[s + 3];
      }
    }
    return out;
  }
  const max = data instanceof Uint16Array ? 65535 : 255;
  // Horizontal pass into premultiplied float rows.
  const h = weights(width, nw, method);
  const mid = new Float32Array(nw * height * 4);
  for (let y = 0; y < height; y++) {
    if (!(y & 63)) checkCancelled(progress);
    const row = y * width * 4;
    for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      const base = x * h.taps;
      for (let j = 0; j < h.count[x]; j++) {
        const s = row + (h.start[x] + j) * 4,
          wa = h.w[base + j] * data[s + 3];
        r += data[s] * wa;
        g += data[s + 1] * wa;
        b += data[s + 2] * wa;
        a += wa;
      }
      const d = (y * nw + x) * 4;
      mid[d] = r;
      mid[d + 1] = g;
      mid[d + 2] = b;
      mid[d + 3] = a;
    }
    progress?.report?.((y / height) * 0.5);
  }
  const v = weights(height, nh, method);
  for (let y = 0; y < nh; y++) {
    if (!(y & 63)) checkCancelled(progress);
    const base = y * v.taps;
    for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < v.count[y]; j++) {
        const s = ((v.start[y] + j) * nw + x) * 4,
          w = v.w[base + j];
        r += mid[s] * w;
        g += mid[s + 1] * w;
        b += mid[s + 2] * w;
        a += mid[s + 3] * w;
      }
      const d = (y * nw + x) * 4;
      // Negative lobes can overshoot; alpha is clamped before dividing.
      const alpha = Math.max(0, Math.min(max, a));
      if (alpha > 0) {
        out[d] = Math.round(Math.max(0, Math.min(max, r / a)));
        out[d + 1] = Math.round(Math.max(0, Math.min(max, g / a)));
        out[d + 2] = Math.round(Math.max(0, Math.min(max, b / a)));
      }
      out[d + 3] = Math.round(alpha);
    }
    progress?.report?.(0.5 + (y / nh) * 0.5);
  }
  return out;
}
