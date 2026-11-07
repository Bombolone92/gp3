// Windows icon (ICO) and cursor (CUR) containers, from the ICONDIR /
// ICONDIRENTRY layout documented for Win32 resources. Entries are either a
// headerless DIB (with doubled height and a 1-bit AND mask) or a PNG file.
import type { RGBA8 } from '../types';
import { ByteWriter, CodecError, rethrowAsCodecError } from './bytes';
import { decodeDib } from './bmp';

export type IcoEntry = {
  width: number;
  height: number;
  bitCount: number;
  format: 'bmp' | 'png';
  // Cursor hotspot (CUR files only).
  hotspot?: { x: number; y: number };
  // Present for BMP entries, and for PNG entries when `decodePng` was given.
  rgba?: RGBA8;
  // The raw PNG file of a PNG entry, ready for createImageBitmap/ImageDecoder.
  png?: Uint8Array;
};
export type IcoDecodeResult = { type: 'ico' | 'cur'; entries: IcoEntry[] };
export type IcoDecodeOptions = {
  // Optional synchronous PNG decoder (for example the app's Wasm one).
  decodePng?: (png: Uint8Array) => RGBA8;
};

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (b: Uint8Array, o: number) => PNG_SIG.every((v, i) => b[o + i] === v);
const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

export function decodeIco(bytes: Uint8Array, opts: IcoDecodeOptions = {}): IcoDecodeResult {
  try {
    return decodeIcoImpl(bytes, opts);
  } catch (e) {
    rethrowAsCodecError(e, 'icon');
  }
}
function decodeIcoImpl(bytes: Uint8Array, opts: IcoDecodeOptions = {}): IcoDecodeResult {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 6 || dv.getUint16(0, true) !== 0) throw new CodecError('Not an icon file.');
  const kind = dv.getUint16(2, true);
  if (kind !== 1 && kind !== 2) throw new CodecError('Not an icon file.');
  const count = dv.getUint16(4, true);
  if (!count || 6 + count * 16 > bytes.length) throw new CodecError('Icon directory is empty or truncated.');
  const entries: IcoEntry[] = [];
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const size = dv.getUint32(e + 8, true);
    const offset = dv.getUint32(e + 12, true);
    if (offset >= bytes.length) continue;
    const end = Math.min(bytes.length, offset + size);
    const dirW = bytes[e] || 256;
    const dirH = bytes[e + 1] || 256;
    const fieldA = dv.getUint16(e + 4, true);
    const fieldB = dv.getUint16(e + 6, true);
    let entry: IcoEntry;
    if (isPng(bytes, offset)) {
      const png = bytes.slice(offset, end);
      const width = png.length >= 24 ? be32(png, 16) : dirW;
      const height = png.length >= 24 ? be32(png, 20) : dirH;
      entry = { width, height, bitCount: png.length > 24 ? png[24] * pngChannels(png[25]) : 32, format: 'png', png };
      if (opts.decodePng) entry.rgba = opts.decodePng(png);
    } else {
      const dib = decodeDib(bytes.subarray(0, end), offset, { icon: true });
      entry = { width: dib.width, height: dib.height, bitCount: dib.bitsPerPixel, format: 'bmp', rgba: dib.rgba8 };
    }
    if (kind === 2) entry.hotspot = { x: fieldA, y: fieldB };
    entries.push(entry);
  }
  if (!entries.length) throw new CodecError('The icon contains no readable images.');
  return { type: kind === 2 ? 'cur' : 'ico', entries };
}

function pngChannels(colorType: number) {
  return colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 1;
}

// The entry closest to `size` (largest by default), preferring more bits.
export function pickIcoEntry(result: IcoDecodeResult, size?: number): IcoEntry {
  const score = (e: IcoEntry) => (size ? -Math.abs(e.width - size) * 1000 : e.width * 1000) + e.bitCount;
  return result.entries.reduce((a, b) => (score(b) > score(a) ? b : a));
}

export type IcoEncodeEntry =
  // Caller-encoded PNG (recommended for 256 px and up); size read from IHDR.
  | { png: Uint8Array; hotspot?: { x: number; y: number } }
  // Uncompressed 32-bit BMP entry, no PNG encoder needed.
  | { rgba: RGBA8; hotspot?: { x: number; y: number } };
export type IcoEncodeOptions = { type?: 'ico' | 'cur' };

export function encodeIco(entries: IcoEncodeEntry[], opts: IcoEncodeOptions = {}): Uint8Array {
  if (!entries.length || entries.length > 65535) throw new CodecError('An icon needs 1-65535 images.');
  const cur = opts.type === 'cur';
  const blobs: { data: Uint8Array; width: number; height: number; hotspot?: { x: number; y: number } }[] = entries.map((e) => {
    if ('png' in e) {
      if (!isPng(e.png, 0) || e.png.length < 24) throw new CodecError('Icon entry is not a PNG file.');
      return { data: e.png, width: be32(e.png, 16), height: be32(e.png, 20), hotspot: e.hotspot };
    }
    const { width, height } = e.rgba;
    if (width > 256 || height > 256) throw new CodecError('BMP icon entries are limited to 256×256; use a PNG entry.');
    return { data: dibEntry(e.rgba), width, height, hotspot: e.hotspot };
  });
  let offset = 6 + 16 * blobs.length;
  let total = offset;
  for (const b of blobs) total += b.data.length;
  const w = new ByteWriter(total);
  w.u16le(0);
  w.u16le(cur ? 2 : 1);
  w.u16le(blobs.length);
  for (const b of blobs) {
    w.u8(b.width >= 256 ? 0 : b.width);
    w.u8(b.height >= 256 ? 0 : b.height);
    w.u8(0);
    w.u8(0);
    w.u16le(cur ? (b.hotspot?.x ?? 0) : 1);
    w.u16le(cur ? (b.hotspot?.y ?? 0) : 32);
    w.u32le(b.data.length);
    w.u32le(offset);
    offset += b.data.length;
  }
  for (const b of blobs) w.bytes(b.data);
  return w.result();
}

// BITMAPINFOHEADER (height doubled), bottom-up BGRA, then the AND mask.
function dibEntry(img: RGBA8): Uint8Array {
  const { width, height, data } = img;
  const maskStride = ((width + 31) >>> 5) << 2;
  const size = 40 + width * height * 4 + maskStride * height;
  const w = new ByteWriter(size);
  w.u32le(40);
  w.u32le(width);
  w.u32le(height * 2);
  w.u16le(1);
  w.u16le(32);
  w.u32le(0);
  w.u32le(width * height * 4 + maskStride * height);
  w.pad(16);
  for (let y = height - 1; y >= 0; y--)
    for (let x = 0, s = y * width * 4; x < width; x++, s += 4) {
      w.u8(data[s + 2]);
      w.u8(data[s + 1]);
      w.u8(data[s]);
      w.u8(data[s + 3]);
    }
  for (let y = height - 1; y >= 0; y--) {
    const row = new Uint8Array(maskStride);
    for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] === 0) row[x >> 3] |= 0x80 >> (x & 7);
    w.bytes(row);
  }
  return w.result();
}
