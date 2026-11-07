// Accept a subpixel mixture of nearby native raster colors. Bounds/coverage
// must be checked separately: this comparison does not establish geometry.
export function matchesNativePalette(actual, palette, tolerance) {
  for (let i = 0; i < palette.length; i++) for (let j = i; j < palette.length; j++) {
    let lo = 0, hi = 1;
    for (let channel = 0; channel < 3 && lo <= hi; channel++) {
      const a = palette[i][channel], delta = palette[j][channel] - a;
      if (!delta) { if (Math.abs(actual[channel] - a) > tolerance) hi = -1; continue; }
      const x = (actual[channel] - tolerance - a) / delta, y = (actual[channel] + tolerance - a) / delta;
      lo = Math.max(lo, Math.min(x, y)); hi = Math.min(hi, Math.max(x, y));
    }
    if (lo <= hi) return true;
  }
  return false;
}
