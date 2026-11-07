// Synthetic images for the retouching and selection tests.
import { rgba8, type Mask8, type RGBA8 } from '../src/imaging/types';
import { rng } from '../src/imaging/segment/filters';

export function disk(w: number, h: number, cx: number, cy: number, r: number, fg: number[], bg: number[], noise = 0, seed = 1): RGBA8 {
  const img = rgba8(w, h), rand = rng(seed);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r;
      const c = inside ? fg : bg, o = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) img.data[o + k] = c[k] + (rand() - 0.5) * 2 * noise;
      img.data[o + 3] = 255;
    }
  return img;
}

export function diskTruth(w: number, h: number, cx: number, cy: number, r: number) {
  const t = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[y * w + x] = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r ? 1 : 0;
  return t;
}

export function iou(m: Mask8 | Uint8Array, truth: Uint8Array, thr = 128) {
  const d = 'data' in m ? m.data : m, cut = 'data' in m ? thr : 1;
  let inter = 0, uni = 0;
  for (let i = 0; i < truth.length; i++) {
    const a = d[i] >= cut ? 1 : 0;
    inter += a & truth[i];
    uni += a | truth[i];
  }
  return uni ? inter / uni : 1;
}

// Vertical stripes with period `period`, `on` pixels dark per period.
export function stripes(w: number, h: number, period: number, on: number, a = [30, 40, 50], b = [220, 210, 190]): RGBA8 {
  const img = rgba8(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = x % period < on ? a : b, o = (y * w + x) * 4;
      img.data.set([c[0], c[1], c[2], 255], o);
    }
  return img;
}

// Photo-like content for timing: smooth gradients, a few soft blobs, edges and grain.
export function photoLike(w: number, h: number, seed = 5): RGBA8 {
  const img = rgba8(w, h), rand = rng(seed);
  const blobs = Array.from({ length: 12 }, () => ({ x: rand() * w, y: rand() * h, r: (0.05 + rand() * 0.2) * w, c: [rand() * 255, rand() * 255, rand() * 255] }));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 90 + (100 * x) / w, g = 120 + (80 * y) / h, b = 170 - (60 * y) / h;
      for (const k of blobs) {
        const d = Math.hypot(x - k.x, y - k.y);
        if (d < k.r) {
          const t = d > k.r - 2 ? (k.r - d) / 2 : 1;
          r += (k.c[0] - r) * t * 0.8; g += (k.c[1] - g) * t * 0.8; b += (k.c[2] - b) * t * 0.8;
        }
      }
      const tex = 12 * Math.sin(x * 0.21 + Math.sin(y * 0.05) * 3) + (rand() - 0.5) * 16;
      img.data.set([r + tex, g + tex, b + tex, 255], (y * w + x) * 4);
    }
  return img;
}

export function time<T>(fn: () => T): [T, number] {
  const t = performance.now();
  const v = fn();
  return [v, performance.now() - t];
}
