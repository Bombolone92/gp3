// Image mode conversions from RGB documents and back: Grayscale, CMYK, Lab,
// Indexed, Bitmap and Duotone. Color-managed steps go through the document
// and target profiles (relative colorimetric with black point compensation
// unless told otherwise, the usual editor default).
import type { RGBA8 } from '../imaging/types';
import type { Intent, Profile } from './icc-lut';
import { builtinProfile } from './builtin-profiles';
import {
  bakeLut3D,
  cachedTransform,
  cmykToRGBA8,
  lutRows,
  transformRGBA8,
  transformToCMYK,
  transformToGray,
  type CMYKPlanes,
} from './transform';
import { indexedToRGBA, toIndexed, type IndexedOptions, type IndexedResult } from './indexed';
import { grayToBitmap, type BitmapOptions, type BitmapResult } from './bitmap';
import { duotoneToRGBA, type DuotoneInk, type DuotoneResult } from './duotone';

export type ImageMode = 'grayscale' | 'cmyk' | 'lab' | 'indexed' | 'bitmap' | 'duotone';
export type ConvertOptions = {
  docProfile?: Profile;
  intent?: Intent;
  bpc?: boolean;
  grayProfile?: Profile;
  cmykProfile?: Profile;
  indexed?: IndexedOptions;
  bitmap?: BitmapOptions;
  // Inks for Duotone (1 = monotone ... 4 = quadtone).
  inks?: DuotoneInk[];
};

export type GrayResult = { mode: 'grayscale'; width: number; height: number; gray: Uint8Array; alpha: Uint8Array; profile: Profile };
export type CmykResult = { mode: 'cmyk'; planes: CMYKPlanes; profile: Profile; preview: RGBA8 };
export type LabResult = {
  mode: 'lab';
  width: number;
  height: number;
  // 8-bit ICC/PSD encoding: L 0-255 = 0-100, a/b offset by 128.
  L: Uint8Array;
  a: Uint8Array;
  b: Uint8Array;
  // Interleaved float L*, a*, b* (D50).
  float: Float32Array;
  alpha: Uint8Array;
};
export type ModeResult =
  | GrayResult
  | CmykResult
  | LabResult
  | ({ mode: 'indexed' } & IndexedResult)
  | ({ mode: 'bitmap' } & BitmapResult)
  | ({ mode: 'duotone' } & DuotoneResult);

const opt = (o: ConvertOptions) => ({
  doc: o.docProfile ?? builtinProfile('srgb'),
  intent: o.intent ?? ('relative' as Intent),
  bpc: o.bpc ?? true,
  gray: o.grayProfile ?? builtinProfile('gray-gamma-22'),
  cmyk: o.cmykProfile ?? builtinProfile('generic-coated-cmyk'),
});

function toGray(img: RGBA8, o: ConvertOptions) {
  const { doc, intent, bpc, gray } = opt(o);
  return transformToGray(img, cachedTransform(doc, gray, intent, { bpc }));
}

// Lab planes in the ICC 8-bit convention plus float values.
export function rgbToLab(img: RGBA8, doc: Profile = builtinProfile('srgb'), intent: Intent = 'relative'): LabResult {
  const lut = bakeLut3D(cachedTransform(doc, builtinProfile('lab-d50'), intent));
  const px = img.width * img.height;
  const res: LabResult = {
    mode: 'lab',
    width: img.width,
    height: img.height,
    L: new Uint8Array(px),
    a: new Uint8Array(px),
    b: new Uint8Array(px),
    float: new Float32Array(px * 3),
    alpha: new Uint8Array(px),
  };
  // The Lab profile's device values are the v4 encoding, so the 8-bit codes
  // are the normalized values times 255.
  const w = img.width;
  lutRows(img, lut, (y, v) => {
    for (let x = 0, p = y * w, o = 0; x < w; x++, p++, o += 4) {
      res.L[p] = to8(v[o]);
      res.a[p] = to8(v[o + 1]);
      res.b[p] = to8(v[o + 2]);
      res.float[p * 3] = v[o] * 100;
      res.float[p * 3 + 1] = v[o + 1] * 255 - 128;
      res.float[p * 3 + 2] = v[o + 2] * 255 - 128;
      res.alpha[p] = img.data[p * 4 + 3];
    }
  });
  return res;
}
const to8 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 255 : (x * 255 + 0.5) | 0);

export function labToRGB(lab: LabResult, doc: Profile = builtinProfile('srgb'), intent: Intent = 'relative'): RGBA8 {
  const px = lab.width * lab.height;
  const enc: RGBA8 = { width: lab.width, height: lab.height, data: new Uint8ClampedArray(px * 4) };
  for (let p = 0; p < px; p++) {
    enc.data[p * 4] = lab.L[p];
    enc.data[p * 4 + 1] = lab.a[p];
    enc.data[p * 4 + 2] = lab.b[p];
    enc.data[p * 4 + 3] = lab.alpha[p];
  }
  return transformRGBA8(enc, cachedTransform(builtinProfile('lab-d50'), doc, intent));
}

export function convertMode(img: RGBA8, from: 'rgb', to: ImageMode, o: ConvertOptions = {}): ModeResult {
  void from;
  const { doc, intent, bpc, gray, cmyk } = opt(o);
  switch (to) {
    case 'grayscale': {
      const g = toGray(img, o);
      return { mode: 'grayscale', width: img.width, height: img.height, ...g, profile: gray };
    }
    case 'cmyk': {
      const planes = transformToCMYK(img, cachedTransform(doc, cmyk, intent, { bpc }));
      const preview = cmykToRGBA8(planes, cachedTransform(cmyk, doc, intent, { bpc }));
      return { mode: 'cmyk', planes, profile: cmyk, preview };
    }
    case 'lab':
      return rgbToLab(img, doc, intent);
    case 'indexed':
      return { mode: 'indexed', ...toIndexed(img, o.indexed) };
    case 'bitmap': {
      // Composite over white first: Bitmap has no transparency.
      const flat = flattenOnWhite(img);
      const g = toGray(flat, o);
      return { mode: 'bitmap', ...grayToBitmap(g.gray, img.width, img.height, o.bitmap) };
    }
    case 'duotone': {
      const g = toGray(img, o);
      const inks = o.inks?.length ? o.inks.slice(0, 4) : [{ name: 'Black', color: [0, 0, 0] as [number, number, number] }];
      return { mode: 'duotone', width: img.width, height: img.height, gray: g.gray, alpha: g.alpha, inks };
    }
  }
}

export function convertModeToRGB(res: ModeResult, o: ConvertOptions = {}): RGBA8 {
  const { doc, intent, bpc } = opt(o);
  switch (res.mode) {
    case 'grayscale': {
      const px = res.width * res.height;
      const g: RGBA8 = { width: res.width, height: res.height, data: new Uint8ClampedArray(px * 4) };
      for (let p = 0; p < px; p++) {
        g.data.fill(res.gray[p], p * 4, p * 4 + 3);
        g.data[p * 4 + 3] = res.alpha[p];
      }
      return grayToRGB(res, doc, intent, bpc);
    }
    case 'cmyk':
      return cmykToRGBA8(res.planes, cachedTransform(res.profile, doc, intent, { bpc }));
    case 'lab':
      return labToRGB(res, doc, intent);
    case 'indexed':
      return indexedToRGBA(res);
    case 'bitmap': {
      const px = res.width * res.height;
      const data = new Uint8ClampedArray(px * 4);
      for (let p = 0; p < px; p++) {
        const v = res.bits[p] ? 0 : 255;
        data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = v;
        data[p * 4 + 3] = 255;
      }
      return { width: res.width, height: res.height, data };
    }
    case 'duotone':
      return duotoneToRGBA(res);
  }
}

// Gray -> RGB through a 256-entry table (exact per gray level).
function grayToRGB(res: GrayResult, doc: Profile, intent: Intent, bpc: boolean): RGBA8 {
  const t = cachedTransform(res.profile, doc, intent, { bpc });
  const levels = Float32Array.from({ length: 256 }, (_, i) => i / 255);
  const rgb = new Float32Array(256 * 3);
  t.apply(levels, rgb, 256);
  const px = res.width * res.height;
  const data = new Uint8ClampedArray(px * 4);
  for (let p = 0; p < px; p++) {
    const g = res.gray[p] * 3;
    data[p * 4] = to8(rgb[g]);
    data[p * 4 + 1] = to8(rgb[g + 1]);
    data[p * 4 + 2] = to8(rgb[g + 2]);
    data[p * 4 + 3] = res.alpha[p];
  }
  return { width: res.width, height: res.height, data };
}

function flattenOnWhite(img: RGBA8): RGBA8 {
  const data = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = img.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) data[i + c] = img.data[i + c] * a + 255 * (1 - a);
    data[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data };
}
