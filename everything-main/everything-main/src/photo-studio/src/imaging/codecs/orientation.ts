// Applies an EXIF/TIFF orientation (1-8, TIFF 6.0 tag 274) so pixels display
// upright. 5-8 swap width and height.
import type { RGBA8 } from '../types';

export function applyOrientation(img: RGBA8, orientation: number | undefined): RGBA8 {
  const o = orientation ?? 1;
  if (o <= 1 || o > 8) return img;
  const { width: W, height: H, data } = img;
  const swap = o >= 5;
  const w = swap ? H : W;
  const h = swap ? W : H;
  const src = new Uint32Array(data.buffer.slice(data.byteOffset, data.byteOffset + W * H * 4));
  const dst = new Uint32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sx: number, sy: number;
      switch (o) {
        case 2: sx = W - 1 - x; sy = y; break;
        case 3: sx = W - 1 - x; sy = H - 1 - y; break;
        case 4: sx = x; sy = H - 1 - y; break;
        case 5: sx = y; sy = x; break;
        case 6: sx = y; sy = H - 1 - x; break;
        case 7: sx = W - 1 - y; sy = H - 1 - x; break;
        default: sx = W - 1 - y; sy = x; break;
      }
      dst[y * w + x] = src[sy * W + sx];
    }
  return { width: w, height: h, data: new Uint8ClampedArray(dst.buffer) };
}
