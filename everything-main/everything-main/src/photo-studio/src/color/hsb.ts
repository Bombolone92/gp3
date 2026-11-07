// HSB (hue in degrees, saturation and brightness in percent) <-> 8-bit RGB.
export function rgbToHsb(r: number, g: number, b: number): { h: number; s: number; b: number } {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? (d / max) * 100 : 0, b: (max / 255) * 100 };
}
export function hsbToRgb(h: number, s: number, v: number): [number, number, number] {
  s /= 100;
  v /= 100;
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}
