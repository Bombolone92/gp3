/**
 * The sample picture the Effect Gallery's filter thumbnails are made from:
 * a small landscape (sky, sun, hills, a tree and a flower bed) drawn
 * procedurally so it has soft gradients, hard edges, detail and color.
 */
import { createImg, clamp01, smoothstep, fbm, hash2 } from './img.js';

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The sample at w x h pixels (scene units are 0..1 across the width). */
export function sampleImage(w, h) {
  const img = createImg(w, h);
  const asp = h / w;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const v = ((y + 0.5) / h) * asp;
      // Sky with soft clouds.
      let c = mix([0.36, 0.6, 0.92], [0.93, 0.83, 0.7], clamp01(v / (asp * 0.62)));
      const cloud = smoothstep(0.55, 0.75, fbm(u * 5, v * 9, 3, 4));
      c = mix(c, [1, 1, 1], cloud * 0.7);
      // Sun with a halo.
      const ds = Math.hypot(u - 0.74, v - asp * 0.24);
      c = mix(c, [1, 0.93, 0.6], clamp01(1 - ds / 0.2) ** 2 * 0.6);
      if (ds < 0.075) c = [1, 0.84, 0.3];
      // Far and near hills.
      const far = asp * 0.55 - 0.06 * Math.sin(u * 7 + 1) - 0.03 * Math.sin(u * 17);
      if (v > far) c = mix([0.42, 0.55, 0.62], [0.3, 0.45, 0.5], clamp01((v - far) * 8));
      const near = asp * 0.68 - 0.05 * Math.sin(u * 4.5 + 2);
      if (v > near) {
        const g = fbm(u * 40, v * 40, 9, 3);
        c = mix([0.36, 0.62, 0.2], [0.18, 0.4, 0.12], clamp01((v - near) * 4 + (g - 0.5) * 0.6));
      }
      // Flower bed in the foreground.
      if (v > asp * 0.86) {
        const fx = Math.floor(u * 28);
        const fy = Math.floor(v * 28);
        const cx = (fx + 0.5) / 28 + (hash2(fx, fy, 1) - 0.5) * 0.02;
        const cy = (fy + 0.5) / 28;
        if (Math.hypot(u - cx, v - cy) < 0.012) c = hash2(fx, fy, 2) > 0.5 ? [0.92, 0.25, 0.32] : [0.98, 0.86, 0.3];
      }
      // A tree: trunk and round crown.
      if (Math.abs(u - 0.26) < 0.018 && v > asp * 0.48 && v < asp * 0.78) c = [0.36, 0.24, 0.14];
      const dc = Math.hypot((u - 0.26) * 1.1, v - asp * 0.42);
      if (dc < 0.13) {
        const leaf = fbm(u * 30, v * 30, 5, 3);
        c = mix([0.16, 0.42, 0.14], [0.45, 0.68, 0.22], clamp01(leaf * 1.4 - 0.2 - (dc / 0.13) * 0.3));
      }
      const i = y * w + x;
      img.r[i] = c[0];
      img.g[i] = c[1];
      img.b[i] = c[2];
      img.a[i] = 1;
    }
  }
  return img;
}
