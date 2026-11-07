// Feature detection (Shi–Tomasi minimum-eigenvalue corner response on the smoothed structure
// tensor) with border margin, threshold and minimum-distance suppression. Pure, worker-safe.

export interface DetectOptions {
  /** pixels from the frame border where no features are placed */
  margin: number;
  /** response threshold (default 0.5, lower finds weaker corners) */
  threshold: number;
  /** minimal distance between features in pixels */
  min_distance: number;
  /** optional cap on the number of features (strongest first) */
  max_count?: number;
}

export interface Feature {
  x: number;
  y: number;
  score: number;
}

/** Response units: a threshold of 1 corresponds to this minimum eigenvalue on 0..1 images. */
export const THRESHOLD_SCALE = 0.001;

function blur(src: Float32Array, w: number, h: number, kernel: number[]): Float32Array {
  const r = (kernel.length - 1) / 2;
  const tmp = new Float32Array(w * h),
    out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += kernel[k + r] * src[y * w + Math.max(0, Math.min(w - 1, x + k))];
      tmp[y * w + x] = s;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += kernel[k + r] * tmp[Math.max(0, Math.min(h - 1, y + k)) * w + x];
      out[y * w + x] = s;
    }
  return out;
}

function gaussian(sigma: number): number[] {
  const r = Math.max(1, Math.ceil(sigma * 2.5));
  const k: number[] = [];
  let s = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(v);
    s += v;
  }
  return k.map((v) => v / s);
}

/** Corner response image (minimum eigenvalue of the structure tensor). */
export function cornerResponse(gray: Float32Array, w: number, h: number): Float32Array {
  const img = blur(gray, w, h, [0.25, 0.5, 0.25]);
  const ixx = new Float32Array(w * h),
    iyy = new Float32Array(w * h),
    ixy = new Float32Array(w * h);
  const at = (x: number, y: number) => img[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) / 8;
      const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) / 8;
      const i = y * w + x;
      ixx[i] = gx * gx;
      iyy[i] = gy * gy;
      ixy[i] = gx * gy;
    }
  const g = gaussian(1.5);
  const a = blur(ixx, w, h, g),
    c = blur(iyy, w, h, g),
    b = blur(ixy, w, h, g);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const m = (a[i] + c[i]) / 2,
      d = Math.sqrt(((a[i] - c[i]) / 2) ** 2 + b[i] * b[i]);
    out[i] = m - d;
  }
  return out;
}

/** Detect features in a grayscale frame (values 0..1 or 0..255 for Uint8Array). Coordinates are pixel centers, top-left origin. */
export function detectFeatures(frame: { w: number; h: number; data: Float32Array | Uint8Array }, o: DetectOptions): Feature[] {
  const { w, h } = frame;
  const gray = frame.data instanceof Uint8Array ? Float32Array.from(frame.data, (v) => v / 255) : frame.data;
  const R = cornerResponse(gray, w, h);
  const thr = Math.max(1e-9, o.threshold * THRESHOLD_SCALE);
  const m = Math.max(1, Math.ceil(o.margin));
  const cands: Feature[] = [];
  for (let y = m; y < h - m; y++)
    for (let x = m; x < w - m; x++) {
      const v = R[y * w + x];
      if (v < thr) continue;
      // 5×5 non-maximum suppression (ties broken by scan order)
      let isMax = true;
      for (let dy = -2; dy <= 2 && isMax; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const u = R[yy * w + xx];
          if (u > v || (u === v && (dy < 0 || (dy === 0 && dx < 0)))) {
            isMax = false;
            break;
          }
        }
      if (isMax) cands.push({ x: x + 0.5, y: y + 0.5, score: v / THRESHOLD_SCALE });
    }
  cands.sort((a, b) => b.score - a.score);
  // greedy minimum distance with a bucket grid
  const md = Math.max(0, o.min_distance);
  const cell = Math.max(1, md);
  const grid = new Map<number, Feature[]>();
  const key = (gx: number, gy: number) => gy * 100003 + gx;
  const out: Feature[] = [];
  for (const f of cands) {
    if (o.max_count && out.length >= o.max_count) break;
    const gx = Math.floor(f.x / cell),
      gy = Math.floor(f.y / cell);
    let ok = true;
    if (md > 0)
      for (let yy = gy - 1; yy <= gy + 1 && ok; yy++)
        for (let xx = gx - 1; xx <= gx + 1 && ok; xx++)
          for (const q of grid.get(key(xx, yy)) ?? [])
            if ((q.x - f.x) ** 2 + (q.y - f.y) ** 2 < md * md) {
              ok = false;
              break;
            }
    if (!ok) continue;
    out.push(f);
    const k = key(gx, gy);
    const list = grid.get(k);
    if (list) list.push(f);
    else grid.set(k, [f]);
  }
  return out;
}
