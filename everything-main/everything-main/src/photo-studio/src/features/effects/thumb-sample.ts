import type { RGBA8 } from '../../imaging/types';

// Sample shape for style swatches: a rounded square with anti-aliased edges.
export function thumbnailSample(size: number): RGBA8 {
  const data = new Uint8ClampedArray(size * size * 4);
  const m = Math.round(size * 0.2), r = size * 0.14;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const cx = Math.min(Math.max(x + 0.5, m + r), size - m - r), cy = Math.min(Math.max(y + 0.5, m + r), size - m - r);
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r;
      const i = (y * size + x) * 4;
      data[i] = 120; data[i + 1] = 150; data[i + 2] = 205; data[i + 3] = Math.min(1, Math.max(0, 0.5 - d)) * 255;
    }
  return { width: size, height: size, data };
}
