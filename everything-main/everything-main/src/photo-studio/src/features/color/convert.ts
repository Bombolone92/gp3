// Pixel mappings behind profile and mode conversions. No DOM: these run on
// tiles and plain buffers so they are unit-tested in Node.
//
// Design note (image modes). Photo Studio's compositor, tiles, filters and
// painting all work on document RGB, so every mode keeps its pixels as RGB
// and a conversion *constrains* them to the mode's gamut instead of changing
// the storage format:
//   Grayscale  pixels become neutral (doc RGB -> gray profile -> doc RGB);
//   CMYK       pixels round-trip through the CMYK profile, so every color is
//              one the press can print;
//   Lab        a round trip through 8-bit CIELAB (practically lossless);
//   Indexed    the flattened image is mapped onto its palette;
//   Bitmap     the flattened gray image becomes pure black and white;
//   Duotone    pixels stay gray; the inks are applied at display time and
//              when exporting.
// The real channel data (gray, CMYK planes, palette indices, 1-bit) is
// recomputed from these pixels when exporting. The trade-off: later edits
// (filters, adjustment layers, layer styles) can leave the mode's gamut until
// the document is converted again, and blend modes always mix in RGB.
import type { RGBA8 } from '../../imaging/types';
import type { TileGrid, TileStore } from '../../model/tiles';
import {
  bakeLut3D,
  bakeLut4D,
  cachedTransform,
  cmykToRGBA8,
  duotoneTable,
  transformRGBA8,
  transformToCMYK,
  transformToGray,
  type DuotoneInk,
  type Intent,
  type Lut3D,
  type Profile,
} from '../../color/color-management';
import { decodeLab } from '../../color/color-math';

export type PixelMap = (img: RGBA8) => RGBA8;

const to8 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 255 : (x * 255 + 0.5) | 0);

/** Convert values from one RGB profile to another (Edit > Convert to Profile). */
export function profileMap(src: Profile, dst: Profile, intent: Intent, bpc: boolean): PixelMap {
  const t = cachedTransform(src, dst, intent, { bpc });
  // Matrix/TRC pairs take the exact shaper path; anything else a baked LUT.
  const via = t.shaper && t.outChannels === 3 ? t : bakeLut3D(t, 33);
  return (img) => transformRGBA8(img, via);
}

/** Doc RGB -> gray -> neutral doc RGB, one table lookup per gray level. */
export function grayMap(doc: Profile, gray: Profile, intent: Intent, bpc: boolean): PixelMap {
  const toGray = bakeLut3D(cachedTransform(doc, gray, intent, { bpc }), 33);
  const back = grayLevels(gray, doc, intent, bpc);
  return (img) => {
    const g = transformToGray(img, toGray);
    const out = new Uint8ClampedArray(img.data.length);
    for (let p = 0, i = 0; p < g.gray.length; p++, i += 4) {
      const v = back[g.gray[p]];
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = img.data[i + 3];
    }
    return { width: img.width, height: img.height, data: out };
  };
}
/** Neutral doc RGB value of each gray level (the mean of the converted
 * channels: matrix profiles map gray to R = G = B up to rounding). */
export function grayLevels(gray: Profile, doc: Profile, intent: Intent, bpc: boolean): Uint8Array {
  const t = cachedTransform(gray, doc, intent, { bpc });
  const levels = Float32Array.from({ length: 256 }, (_, i) => i / 255);
  const rgb = new Float32Array(256 * 3);
  t.apply(levels, rgb, 256);
  const out = new Uint8Array(256);
  for (let i = 0; i < 256; i++) out[i] = to8((rgb[i * 3] + rgb[i * 3 + 1] + rgb[i * 3 + 2]) / 3);
  return out;
}

/** Doc RGB -> CMYK -> doc RGB: the printable version of every color. */
export function cmykMap(doc: Profile, cmyk: Profile, intent: Intent, bpc: boolean): PixelMap {
  const fwd = bakeLut3D(cachedTransform(doc, cmyk, intent, { bpc }), 33);
  const back = bakeLut4D(cachedTransform(cmyk, doc, 'relative', { bpc }), 17);
  return (img) => cmykToRGBA8(transformToCMYK(img, fwd), back);
}

/** Round trip through 8-bit CIELAB (D50). */
export function labMap(doc: Profile, lab: Profile, intent: Intent): PixelMap {
  const fwd = cachedTransform(doc, lab, intent);
  const inv = cachedTransform(lab, doc, intent);
  // Quantize Lab to the 8-bit encoding inside one baked doc -> doc LUT.
  const quantized = {
    ...fwd,
    shaper: undefined,
    grayShaper: undefined,
    inChannels: 3,
    outChannels: 3,
    apply(input: ArrayLike<number>, output: Float32Array | Float64Array, count = input.length / 3) {
      const tmp = new Float32Array(count * 3);
      fwd.apply(input, tmp, count);
      for (let i = 0; i < tmp.length; i++) tmp[i] = Math.round(tmp[i] * 255) / 255;
      inv.apply(tmp, output, count);
    },
    one(v: ArrayLike<number>) {
      const o = new Float64Array(3);
      this.apply(v, o, 1);
      return [...o];
    },
  };
  const lut = bakeLut3D(quantized, 33);
  return (img) => transformRGBA8(img, lut);
}

/** Duotone appearance per gray level in document RGB: the inks overprint in
 * the gray encoding (so one black ink with a straight curve is the gray image
 * itself) and each channel then follows the gray profile's tone curve into
 * document values. */
export function duotoneLevels(doc: Profile, gray: Profile, inks: DuotoneInk[], intent: Intent = 'relative', bpc = true): Uint8Array {
  const table = duotoneTable(inks);
  const levels = grayLevels(gray, doc, intent, bpc);
  const out = new Uint8Array(256 * 3);
  for (let i = 0; i < out.length; i++) out[i] = levels[table[i]];
  return out;
}
/** Gray pixels -> duotone appearance (inks overprinted). */
export function duotoneMap(doc: Profile, gray: Profile, inks: DuotoneInk[], intent: Intent = 'relative', bpc = true): PixelMap {
  const toGray = bakeLut3D(cachedTransform(doc, gray, intent, { bpc }), 33);
  const table = duotoneLevels(doc, gray, inks, intent, bpc);
  return (img) => {
    const g = transformToGray(img, toGray);
    const out = new Uint8ClampedArray(img.data.length);
    for (let p = 0, i = 0; p < g.gray.length; p++, i += 4) {
      const k = g.gray[p] * 3;
      out[i] = table[k];
      out[i + 1] = table[k + 1];
      out[i + 2] = table[k + 2];
      out[i + 3] = img.data[i + 3];
    }
    return { width: img.width, height: img.height, data: out };
  };
}
/** The duotone appearance as a 3D LUT on document RGB (for display). */
export function duotoneLut(doc: Profile, gray: Profile, inks: DuotoneInk[], size = 33): Lut3D {
  const t = cachedTransform(doc, gray, 'relative', { bpc: true });
  const table = duotoneLevels(doc, gray, inks);
  const n = size,
    total = n * n * n;
  const input = new Float32Array(total * 3);
  for (let b = 0, i = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++, i += 3) {
        input[i] = r / (n - 1);
        input[i + 1] = g / (n - 1);
        input[i + 2] = b / (n - 1);
      }
  const grayOut = new Float32Array(total);
  t.apply(input, grayOut, total);
  const data = new Float32Array(total * 4);
  for (let i = 0; i < total; i++) {
    const x = Math.max(0, Math.min(1, grayOut[i])) * 255,
      k = Math.min(254, Math.floor(x)),
      f = x - k;
    for (let c = 0; c < 3; c++) data[i * 4 + c] = (table[k * 3 + c] * (1 - f) + table[(k + 1) * 3 + c] * f) / 255;
    data[i * 4 + 3] = 1;
  }
  return { size: n, outChannels: 3, data };
}

/** Compose a document-RGB LUT with a transform applied to its outputs. */
export function composeLut(first: Lut3D, then: { apply(i: ArrayLike<number>, o: Float32Array, n?: number): void; outChannels: number }): Lut3D {
  const total = first.size ** 3;
  const rgb = new Float32Array(total * 3);
  for (let i = 0; i < total; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = first.data[i * 4 + c];
  const out = new Float32Array(total * then.outChannels);
  then.apply(rgb, out, total);
  const data = new Float32Array(total * 4);
  for (let i = 0; i < total; i++) {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = out[i * then.outChannels + c];
    data[i * 4 + 3] = 1;
  }
  return { size: first.size, outChannels: 3, data };
}

/** Map every stored tile of an RGBA grid; tiles are immutable, so mapped
 * tiles are new entries and the returned grid shares nothing it changed. */
export function mapGrid(store: TileStore, grid: TileGrid, map: PixelMap): TileGrid {
  if (grid.channels !== 4) throw new Error('Only RGBA grids hold colors.');
  const tiles: Record<string, string> = {};
  for (const [key, id] of Object.entries(grid.tiles)) {
    const data = store.get(id);
    const side = Math.round(Math.sqrt(data.length / 4));
    const out = map({ width: side, height: side, data });
    tiles[key] = store.add(new Uint8ClampedArray(out.data.buffer, out.data.byteOffset, out.data.length));
  }
  return { ...grid, tiles, bounds: grid.bounds && { ...grid.bounds } };
}

export function mapHex(map: PixelMap, hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const out = map({ width: 1, height: 1, data: new Uint8ClampedArray([v >> 16, (v >> 8) & 255, v & 255, 255]) }).data;
  return '#' + [out[0], out[1], out[2]].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** Nearest palette color (squared RGB distance) for painting colors. */
export function nearestPaletteHex(palette: string[], hex: string): string {
  const parse = (h: string) => {
    const v = parseInt(h.slice(1), 16);
    return [v >> 16, (v >> 8) & 255, v & 255];
  };
  const [r, g, b] = parse(hex);
  let best = palette[0],
    dist = Infinity;
  for (const p of palette) {
    const [pr, pg, pb] = parse(p);
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (d < dist) {
      dist = d;
      best = p;
    }
  }
  return best;
}

/** Composite straight-alpha RGBA over a solid matte. */
export function flattenOn(img: RGBA8, matte: [number, number, number] = [255, 255, 255]): RGBA8 {
  const data = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = img.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) data[i + c] = img.data[i + c] * a + matte[c] * (1 - a);
    data[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data };
}

/** Lab (D50) of a doc RGB color as L 0-100, a/b signed. */
export function labOf(doc: Profile, lab: Profile, rgb: ArrayLike<number>): [number, number, number] {
  const n = cachedTransform(doc, lab, 'relative').one([rgb[0] / 255, rgb[1] / 255, rgb[2] / 255]);
  const v = decodeLab(n, 'v4');
  return [v[0], v[1], v[2]];
}
