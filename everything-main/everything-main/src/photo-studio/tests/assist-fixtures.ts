// Synthetic images and metrics shared by the assisted-editing tests.
import { rgba8, type RGBA8 } from '../src/imaging/types';

export function lcg(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
/** Standard normal samples (Box-Muller). */
export function gauss(rand: () => number) {
  return () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rand()))) * Math.cos(2 * Math.PI * rand());
}

/** A test card: gradient background, flat shapes with hard edges and a disc. */
export function testCard(w = 128, h = 128): RGBA8 {
  const img = rgba8(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = 60 + (120 * x) / w, g = 80 + (80 * y) / h, b = 140;
      if (x > w * 0.15 && x < w * 0.45 && y > h * 0.2 && y < h * 0.5) [r, g, b] = [220, 200, 40];
      if (Math.hypot(x - w * 0.68, y - h * 0.62) < w * 0.18) [r, g, b] = [30, 40, 50];
      if (y > h * 0.8 && x % 16 < 8) [r, g, b] = [240, 240, 240];
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  return img;
}

export function addNoise(img: RGBA8, sigma: number, seed = 7, chroma = true): RGBA8 {
  const n = gauss(lcg(seed));
  const out = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  for (let i = 0; i < out.data.length; i += 4) {
    const common = n() * sigma;
    for (let c = 0; c < 3; c++) out.data[i + c] = img.data[i + c] + (chroma ? n() * sigma : common);
  }
  return out;
}

/** PSNR in dB over RGB, optionally ignoring a border. */
export function psnr(a: RGBA8, b: RGBA8, border = 0): number {
  let se = 0, n = 0;
  for (let y = border; y < a.height - border; y++)
    for (let x = border; x < a.width - border; x++) {
      const i = (y * a.width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const d = a.data[i + c] - b.data[i + c];
        se += d * d;
        n++;
      }
    }
  return 10 * Math.log10((255 * 255) / Math.max(1e-9, se / n));
}

export function gray(img: RGBA8, x: number, y: number) {
  const i = (y * img.width + x) * 4;
  return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
}
