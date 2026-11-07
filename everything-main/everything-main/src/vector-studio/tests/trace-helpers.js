// Synthetic images for the tracing tests.

/** RGBA image from fn(x, y) -> [r, g, b, a?], supersampled for antialiased edges. */
export function makeImage(w, h, fn, ss = 1) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = fn(x + (sx + 0.5) / ss, y + (sy + 0.5) / ss);
          acc[0] += c[0];
          acc[1] += c[1];
          acc[2] += c[2];
          acc[3] += c[3] ?? 255;
        }
      }
      const i = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) data[i + k] = acc[k] / (ss * ss);
    }
  }
  return { width: w, height: h, data };
}
