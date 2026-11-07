// File encoders that honor the image mode: CMYK and CIELab TIFF (TIFF 6.0
// photometric 5 and 8), grayscale TIFF/PNG, 1-bit and palette PNG (PNG
// specification, ISO/IEC 15948). No DOM.
import { deflate } from 'pako';
import type { RGBA8 } from '../../imaging/types';
import { encodeTiff } from '../../imaging/codecs/tiff';
import { crc32 } from '../../imaging/codecs/bytes';
import type { CMYKPlanes } from '../../color/color-management';

type TiffCompression = 'none' | 'lzw' | 'deflate';

// encodeTiff writes 4 interleaved channels as RGB + unassociated alpha. For
// CMYK the samples are identical in layout, so the IFD is patched in place:
// PhotometricInterpretation 2 -> 5 (separated) and the ExtraSamples entry
// (tag 338) becomes InkSet (tag 332) = 1 (CMYK), which keeps tags sorted.
function patchIfd(bytes: Uint8Array, edit: (tag: number, entry: number, view: DataView) => void) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0) !== 0x4949) throw new Error('Expected a little-endian TIFF.');
  const ifd = view.getUint32(4, true);
  const count = view.getUint16(ifd, true);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    edit(view.getUint16(entry, true), entry, view);
  }
}

export function encodeCmykTiff(planes: CMYKPlanes, opts: { icc?: Uint8Array; dpi?: number; compression?: TiffCompression } = {}): Uint8Array {
  const { width, height } = planes;
  const px = width * height;
  const data = new Uint8Array(px * 4);
  for (let p = 0, i = 0; p < px; p++, i += 4) {
    data[i] = planes.c[p];
    data[i + 1] = planes.m[p];
    data[i + 2] = planes.y[p];
    data[i + 3] = planes.k[p];
  }
  const out = encodeTiff({ width, height, data, channels: 4 }, { compression: opts.compression ?? 'lzw', predictor: true, icc: opts.icc, dpi: opts.dpi });
  let photometric = false,
    extra = false;
  patchIfd(out, (tag, entry, view) => {
    if (tag === 262) {
      view.setUint16(entry + 8, 5, true);
      photometric = true;
    } else if (tag === 338) {
      view.setUint16(entry, 332, true);
      view.setUint16(entry + 8, 1, true);
      extra = true;
    }
  });
  if (!photometric || !extra) throw new Error('Unexpected TIFF layout while writing CMYK.');
  return out;
}

/** CIELab TIFF (photometric 8): L 0-255 = 0-100, a/b as signed bytes. */
export function encodeLabTiff(lab: { width: number; height: number; L: Uint8Array; a: Uint8Array; b: Uint8Array }, opts: { dpi?: number; compression?: TiffCompression } = {}): Uint8Array {
  const px = lab.width * lab.height;
  const data = new Uint8Array(px * 3);
  for (let p = 0, i = 0; p < px; p++, i += 3) {
    data[i] = lab.L[p];
    // ICC 8-bit a/b are offset by 128; TIFF stores two's complement.
    data[i + 1] = lab.a[p] ^ 0x80;
    data[i + 2] = lab.b[p] ^ 0x80;
  }
  // No predictor: horizontal differencing on signed samples is still
  // modular and lossless, but some readers mishandle it for photometric 8.
  const out = encodeTiff({ width: lab.width, height: lab.height, data, channels: 3 }, { compression: opts.compression ?? 'lzw', dpi: opts.dpi });
  let found = false;
  patchIfd(out, (tag, entry, view) => {
    // SampleFormat stays 1 for all samples: libtiff rejects mixed formats
    // and reads photometric 8 a/b as signed anyway.
    if (tag === 262) {
      view.setUint16(entry + 8, 8, true);
      found = true;
    }
  });
  if (!found) throw new Error('Unexpected TIFF layout while writing Lab.');
  return out;
}

export function encodeGrayTiff(gray: Uint8Array, alpha: Uint8Array | null, width: number, height: number, opts: { icc?: Uint8Array; dpi?: number; compression?: TiffCompression } = {}): Uint8Array {
  const px = width * height;
  let data: Uint8Array = gray;
  if (alpha) {
    data = new Uint8Array(px * 2);
    for (let p = 0; p < px; p++) {
      data[p * 2] = gray[p];
      data[p * 2 + 1] = alpha[p];
    }
  }
  return encodeTiff({ width, height, data, channels: alpha ? 2 : 1 }, { compression: opts.compression ?? 'lzw', predictor: true, icc: opts.icc, dpi: opts.dpi });
}

// --- PNG ---------------------------------------------------------------------

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}
export type PngImage = {
  width: number;
  height: number;
  // 0 gray, 2 RGB, 3 palette, 4 gray + alpha, 6 RGBA.
  colorType: 0 | 2 | 3 | 4 | 6;
  bitDepth: 1 | 8;
  // Unfiltered scanlines without filter bytes (packed for bit depth 1).
  rows: Uint8Array;
  palette?: Uint8Array;
  // Alpha per palette entry (tRNS).
  paletteAlpha?: Uint8Array;
  icc?: { name: string; bytes: Uint8Array };
  dpi?: number;
};
export function encodePng(img: PngImage): Uint8Array {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[img.colorType];
  const stride = Math.ceil((img.width * channels * img.bitDepth) / 8);
  if (img.rows.length !== stride * img.height) throw new Error('PNG scanline data has the wrong length.');
  // Filter type 0 per row; the "up"/"paeth" filters gain little on the
  // flat images these modes produce.
  const raw = new Uint8Array((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) raw.set(img.rows.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, img.width);
  v.setUint32(4, img.height);
  ihdr[8] = img.bitDepth;
  ihdr[9] = img.colorType;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  if (img.icc) {
    const name = new TextEncoder().encode(img.icc.name.replace(/[^\x20-\x7e]/g, '').slice(0, 79) || 'ICC');
    const z = deflate(img.icc.bytes);
    const body = new Uint8Array(name.length + 2 + z.length);
    body.set(name);
    body.set(z, name.length + 2);
    parts.push(chunk('iCCP', body));
  }
  if (img.dpi && img.dpi > 0) {
    const ppm = Math.round(img.dpi / 0.0254);
    const phys = new Uint8Array(9);
    const pv = new DataView(phys.buffer);
    pv.setUint32(0, ppm);
    pv.setUint32(4, ppm);
    phys[8] = 1;
    parts.push(chunk('pHYs', phys));
  }
  if (img.palette) parts.push(chunk('PLTE', img.palette));
  if (img.paletteAlpha) parts.push(chunk('tRNS', img.paletteAlpha));
  parts.push(chunk('IDAT', deflate(raw, { level: 9 })), chunk('IEND', new Uint8Array(0)));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function grayPng(gray: Uint8Array, alpha: Uint8Array | null, width: number, height: number, icc?: { name: string; bytes: Uint8Array }, dpi?: number) {
  const px = width * height;
  let rows: Uint8Array = gray;
  if (alpha) {
    rows = new Uint8Array(px * 2);
    for (let p = 0; p < px; p++) {
      rows[p * 2] = gray[p];
      rows[p * 2 + 1] = alpha[p];
    }
  }
  return encodePng({ width, height, colorType: alpha ? 4 : 0, bitDepth: 8, rows, icc, dpi });
}
/** 1-bit PNG; bits use 1 = black as in Bitmap mode, PNG gray 0 = black. */
export function bitmapPng(bits: Uint8Array, width: number, height: number, dpi?: number) {
  const stride = Math.ceil(width / 8);
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) if (!bits[y * width + x]) rows[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
  return encodePng({ width, height, colorType: 0, bitDepth: 1, rows, dpi });
}
export function palettePng(indices: Uint8Array, palette: Uint8Array, transparentIndex: number, width: number, height: number, dpi?: number) {
  const n = palette.length / 3;
  let paletteAlpha: Uint8Array | undefined;
  if (transparentIndex >= 0 && transparentIndex < n) {
    paletteAlpha = new Uint8Array(transparentIndex + 1).fill(255);
    paletteAlpha[transparentIndex] = 0;
  }
  return encodePng({ width, height, colorType: 3, bitDepth: 8, rows: indices, palette, paletteAlpha, dpi });
}
export function rgbaPng(img: RGBA8, icc?: { name: string; bytes: Uint8Array }, dpi?: number) {
  return encodePng({ width: img.width, height: img.height, colorType: 6, bitDepth: 8, rows: new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.length), icc, dpi });
}
