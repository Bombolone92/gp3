// Trapping for print: where two colors meet, the lighter color is spread a
// few pixels under the darker one so small plate misregistration does not
// open white gaps. Ink coverage is the complement of RGB, so overlapping
// inks are the channel-wise minimum of the two colors.
import { checkCancelled, type Progress, type RGBA8 } from '../types';

const luma = (d: Uint8ClampedArray, o: number) => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];

/** Spread lighter colors into darker neighbours by `width` pixels. */
export function trap(img: RGBA8, width: number, progress?: Progress): RGBA8 {
  const r = Math.max(1, Math.round(width));
  const { width: w, height: h, data } = img;
  const out: RGBA8 = { width: w, height: h, data: new Uint8ClampedArray(data) };
  const L = new Float32Array(w * h);
  for (let i = 0; i < L.length; i++) L[i] = luma(data, i * 4);
  for (let y = 0; y < h; y++) {
    if ((y & 63) === 0) {
      checkCancelled(progress);
      progress?.report?.(y / h);
    }
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i * 4 + 3] < 128) continue;
      // The lightest visible neighbour within the radius that differs enough.
      let best = -1,
        bestL = L[i] + 12;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || dx * dx + dy * dy > r * r) continue;
          const j = yy * w + xx;
          if (L[j] > bestL && data[j * 4 + 3] >= 128) {
            bestL = L[j];
            best = j;
          }
        }
      }
      if (best < 0) continue;
      for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.min(data[i * 4 + c], data[best * 4 + c]);
    }
  }
  progress?.report?.(1);
  return out;
}
