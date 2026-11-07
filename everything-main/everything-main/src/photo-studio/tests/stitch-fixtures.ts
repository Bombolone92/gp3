// Synthetic scenes for the alignment, blending and HDR tests: random shapes
// over a smooth gradient give corners at many scales and orientations.
import { rgba8, type RGBA8 } from '../src/imaging/types';
import { rng } from '../src/imaging/segment/filters';

export function scene(w: number, h: number, seed = 3, shapes = 140): RGBA8 {
  const img = rgba8(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      d[o] = 60 + (120 * x) / w;
      d[o + 1] = 80 + (100 * y) / h;
      d[o + 2] = 140;
      d[o + 3] = 255;
    }
  const rand = rng(seed);
  for (let s = 0; s < shapes; s++) {
    const cx = rand() * w,
      cy = rand() * h,
      r = 4 + rand() * 22;
    const c = [rand() * 255, rand() * 255, rand() * 255];
    const square = rand() < 0.5;
    const a = rand() * Math.PI;
    const cos = Math.cos(a),
      sin = Math.sin(a);
    for (let y = Math.max(0, Math.floor(cy - r * 1.5)); y < Math.min(h, cy + r * 1.5); y++)
      for (let x = Math.max(0, Math.floor(cx - r * 1.5)); x < Math.min(w, cx + r * 1.5); x++) {
        const dx = x + 0.5 - cx,
          dy = y + 0.5 - cy;
        const u = dx * cos + dy * sin,
          v = -dx * sin + dy * cos;
        const inside = square ? Math.abs(u) < r && Math.abs(v) < r * 0.6 : u * u + v * v < r * r;
        if (!inside) continue;
        const o = (y * w + x) * 4;
        d[o] = c[0];
        d[o + 1] = c[1];
        d[o + 2] = c[2];
      }
  }
  return img;
}

export function crop(img: RGBA8, x: number, y: number, w: number, h: number): RGBA8 {
  const out = rgba8(w, h);
  for (let j = 0; j < h; j++) out.data.set(img.data.subarray(((y + j) * img.width + x) * 4, ((y + j) * img.width + x + w) * 4), j * w * 4);
  return out;
}

/** Multiply RGB by a gain (simulates an exposure difference). */
export function gain(img: RGBA8, g: number): RGBA8 {
  const out = rgba8(img.width, img.height);
  for (let i = 0; i < img.data.length; i += 4) {
    out.data[i] = img.data[i] * g;
    out.data[i + 1] = img.data[i + 1] * g;
    out.data[i + 2] = img.data[i + 2] * g;
    out.data[i + 3] = img.data[i + 3];
  }
  return out;
}
