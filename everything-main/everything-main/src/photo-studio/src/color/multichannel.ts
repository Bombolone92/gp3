// Multichannel: the image as separate grayscale ink channels (0 = full ink,
// 255 = paper), each printed with its own ink color. The shown composite
// overprints the inks multiplicatively, as duotone previews do, so RGB
// converted to cyan, magenta and yellow inks reproduces the RGB image.
import type { RGBA8 } from '../imaging/types';
import { curveTable } from './duotone';

export type Ink = { name: string; color: [number, number, number] };
export const RGB_INKS: Ink[] = [
  { name: 'Cyan', color: [0, 255, 255] },
  { name: 'Magenta', color: [255, 0, 255] },
  { name: 'Yellow', color: [255, 255, 0] },
];
export const CMYK_INKS: Ink[] = [...RGB_INKS, { name: 'Black', color: [0, 0, 0] }];
export const GRAY_INK: Ink = { name: 'Black', color: [0, 0, 0] };

/** Cyan, magenta and yellow channels of an opaque RGB image (the R, G and B
 * values: white is no ink). */
export function splitRgb(img: RGBA8): Uint8Array[] {
  const n = img.width * img.height;
  const planes = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
  for (let p = 0; p < n; p++) for (let c = 0; c < 3; c++) planes[c][p] = img.data[p * 4 + c];
  return planes;
}

/** Ink channels from CMYK ink amounts (4 floats per pixel in 0..1). */
export function splitCmyk(ink: ArrayLike<number>, pixels: number): Uint8Array[] {
  const planes = [0, 1, 2, 3].map(() => new Uint8Array(pixels));
  for (let p = 0; p < pixels; p++)
    for (let c = 0; c < 4; c++) planes[c][p] = Math.round((1 - Math.max(0, Math.min(1, ink[p * 4 + c]))) * 255);
  return planes;
}

/** One channel per duotone ink (gray tone through each ink's curve), or the
 * gray itself for a single straight black ink. */
export function splitGray(img: RGBA8, curves: ([number, number][] | undefined)[] = [undefined]): Uint8Array[] {
  const n = img.width * img.height;
  const gray = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    gray[p] = Math.round(0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]);
  }
  return curves.map((c) => {
    if (!c) return gray.slice();
    const t = curveTable(c);
    const plane = new Uint8Array(n);
    for (let p = 0; p < n; p++) plane[p] = Math.round((1 - t[255 - gray[p]]) * 255);
    return plane;
  });
}

/** Opaque RGB composite of ink channels (hidden channels pass null). */
export function inkComposite(planes: (ArrayLike<number> | null)[], inks: Ink[], width: number, height: number): RGBA8 {
  const n = width * height;
  const data = new Uint8ClampedArray(n * 4);
  const active = planes.map((p, i) => (p ? { p, f: inks[i].color.map((v) => 1 - v / 255) } : null)).filter((x) => !!x);
  for (let p = 0; p < n; p++) {
    let r = 1, g = 1, b = 1;
    for (const { p: plane, f } of active) {
      const k = 1 - plane[p] / 255;
      r *= 1 - k * f[0];
      g *= 1 - k * f[1];
      b *= 1 - k * f[2];
    }
    const i = p * 4;
    data[i] = Math.round(r * 255);
    data[i + 1] = Math.round(g * 255);
    data[i + 2] = Math.round(b * 255);
    data[i + 3] = 255;
  }
  return { width, height, data };
}
