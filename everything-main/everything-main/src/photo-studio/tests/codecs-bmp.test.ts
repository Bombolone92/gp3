import { describe, expect, it } from 'vitest';
import { decodeBmp, encodeBmp } from '../src/imaging/codecs/bmp';
import { testImage } from './codecs-builders';

// Builds a BMP by hand: file header, BITMAPINFOHEADER-family header bytes,
// optional palette (BGRx) and pixel bytes.
function bmp(header: number[], palette: number[][], pixels: number[]): Uint8Array {
  const pal = palette.flatMap(([r, g, b]) => [b, g, r, 0]);
  const offset = 14 + header.length + pal.length;
  const size = offset + pixels.length;
  const le32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  return new Uint8Array([0x42, 0x4d, ...le32(size), 0, 0, 0, 0, ...le32(offset), ...header, ...pal, ...pixels]);
}
const le16 = (v: number) => [v & 255, (v >> 8) & 255];
const le32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
function infoHeader(w: number, h: number, bpp: number, compression: number, colors = 0, size = 40, extra: number[] = []): number[] {
  const base = [...le32(size), ...le32(w), ...le32(h), ...le16(1), ...le16(bpp), ...le32(compression), ...le32(0), ...le32(3780), ...le32(3780), ...le32(colors), ...le32(0)];
  const full = [...base, ...extra];
  while (full.length < size) full.push(0);
  return full;
}
const pixelAt = (r: { rgba8: { width: number; data: Uint8ClampedArray } }, x: number, y: number) => Array.from(r.rgba8.data.subarray((y * r.rgba8.width + x) * 4, (y * r.rgba8.width + x) * 4 + 4));
const grayPalette = Array.from({ length: 256 }, (_, i) => [i, 255 - i, i ^ 0x55]);

describe('BMP', () => {
  it('round trips 32-bit with alpha and 24-bit at odd widths', () => {
    for (const [w, h] of [
      [1, 1],
      [7, 5],
      [33, 2],
    ]) {
      const data = testImage(w, h, 4) as Uint8ClampedArray;
      const r32 = decodeBmp(encodeBmp({ width: w, height: h, data }, { bits: 32, dpi: 144 }));
      expect(r32.headerSize).toBe(108);
      expect(r32.hasAlpha).toBe(true);
      expect(Array.from(r32.rgba8.data)).toEqual(Array.from(data));
      expect(r32.dpi).toEqual({ x: 144, y: 144 });
      const r24 = decodeBmp(encodeBmp({ width: w, height: h, data }, { bits: 24 }));
      const opaque = Uint8ClampedArray.from(data);
      for (let i = 3; i < opaque.length; i += 4) opaque[i] = 255;
      expect(Array.from(r24.rgba8.data)).toEqual(Array.from(opaque));
      expect(r24.hasAlpha).toBe(false);
    }
  });

  it('decodes the RLE8 example from the BITMAPINFOHEADER documentation', () => {
    const rle = [0x03, 0x04, 0x05, 0x06, 0x00, 0x03, 0x45, 0x56, 0x67, 0x00, 0x02, 0x78, 0x00, 0x02, 0x05, 0x01, 0x02, 0x78, 0x00, 0x00, 0x09, 0x1e, 0x00, 0x01];
    const r = decodeBmp(bmp(infoHeader(20, 3, 8, 1, 256), grayPalette, rle));
    const idx = (x: number, y: number) => {
      const p = pixelAt(r, x, y);
      return p[3] === 0 ? -1 : p[0];
    };
    // Bottom-up: stream row 0 is image row 2.
    const row2 = Array.from({ length: 20 }, (_, x) => idx(x, 2));
    expect(row2).toEqual([4, 4, 4, 6, 6, 6, 6, 6, 0x45, 0x56, 0x67, 0x78, 0x78, -1, -1, -1, -1, -1, -1, -1]);
    const row1 = Array.from({ length: 20 }, (_, x) => idx(x, 1));
    expect(row1).toEqual([...new Array(18).fill(-1), 0x78, 0x78]);
    const row0 = Array.from({ length: 20 }, (_, x) => idx(x, 0));
    expect(row0).toEqual([...new Array(9).fill(0x1e), ...new Array(11).fill(-1)]);
    expect(pixelAt(r, 0, 2)).toEqual([4, 251, 4 ^ 0x55, 255]);
    expect(r.hasAlpha).toBe(true);
  });

  it('decodes the RLE4 example from the documentation', () => {
    const rle = [0x03, 0x04, 0x05, 0x06, 0x00, 0x06, 0x45, 0x56, 0x67, 0x00, 0x04, 0x78, 0x00, 0x02, 0x05, 0x01, 0x04, 0x78, 0x00, 0x00, 0x09, 0x1e, 0x00, 0x01];
    const r = decodeBmp(bmp(infoHeader(27, 3, 4, 2, 16), grayPalette.slice(0, 16), rle));
    const idx = (x: number, y: number) => (pixelAt(r, x, y)[3] ? pixelAt(r, x, y)[0] : -1);
    expect(Array.from({ length: 27 }, (_, x) => idx(x, 2))).toEqual([0, 4, 0, 0, 6, 0, 6, 0, 4, 5, 5, 6, 6, 7, 7, 8, 7, 8, ...new Array(9).fill(-1)]);
    expect(Array.from({ length: 27 }, (_, x) => idx(x, 1))).toEqual([...new Array(23).fill(-1), 7, 8, 7, 8]);
    expect(Array.from({ length: 27 }, (_, x) => idx(x, 0))).toEqual([1, 14, 1, 14, 1, 14, 1, 14, 1, ...new Array(18).fill(-1)]);
  });

  it('decodes 1-bit and 4-bit palettes, top-down rows and the core header', () => {
    // 1-bit 3x2 top-down: rows padded to 4 bytes.
    const r1 = decodeBmp(bmp(infoHeader(3, -2, 1, 0, 2), [[0, 0, 0], [255, 255, 255]], [0b10100000, 0, 0, 0, 0b01000000, 0, 0, 0]));
    expect(r1.topDown).toBe(true);
    expect([0, 1, 2].map((x) => pixelAt(r1, x, 0)[0])).toEqual([255, 0, 255]);
    expect([0, 1, 2].map((x) => pixelAt(r1, x, 1)[0])).toEqual([0, 255, 0]);
    // 4-bit 3x1.
    const r4 = decodeBmp(bmp(infoHeader(3, 1, 4, 0, 16), grayPalette.slice(0, 16), [0x12, 0x30, 0, 0]));
    expect([0, 1, 2].map((x) => pixelAt(r4, x, 0)[0])).toEqual([1, 2, 3]);
    // BITMAPCOREHEADER, 24-bit, 2x1.
    const core = [...le32(12), ...le16(2), ...le16(1), ...le16(1), ...le16(24)];
    const rc = decodeBmp(bmp(core, [], [10, 20, 30, 40, 50, 60, 0, 0]));
    expect(pixelAt(rc, 0, 0)).toEqual([30, 20, 10, 255]);
    expect(pixelAt(rc, 1, 0)).toEqual([60, 50, 40, 255]);
  });

  it('decodes 16-bit 555 and 565 bitfields and V5 alpha masks', () => {
    // Default 16-bit is 5-5-5: pure red 0x7c00, white 0x7fff.
    const r555 = decodeBmp(bmp(infoHeader(2, 1, 16, 0), [], [...le16(0x7c00), ...le16(0x7fff)]));
    expect(pixelAt(r555, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(r555, 1, 0)).toEqual([255, 255, 255, 255]);
    // BI_BITFIELDS 5-6-5 with masks after a 40-byte header: green 0x07e0, mid-blue 0x0010.
    const header = [...infoHeader(2, 1, 16, 3), ...le32(0xf800), ...le32(0x07e0), ...le32(0x001f)];
    const r565 = decodeBmp(bmp(header, [], [...le16(0x07e0), ...le16(0x0010)]));
    expect(pixelAt(r565, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(r565, 1, 0)).toEqual([0, 0, Math.round((16 * 255) / 31), 255]);
    // V5 header (124 bytes) with an ARGB layout and alpha mask.
    const v5 = infoHeader(1, 1, 32, 3, 0, 124, [...le32(0x0000ff00), ...le32(0x00ff0000), ...le32(0xff000000), ...le32(0x000000ff)]);
    const rv5 = decodeBmp(bmp(v5, [], [0x80, 0x30, 0x20, 0x10]));
    expect(pixelAt(rv5, 0, 0)).toEqual([0x30, 0x20, 0x10, 0x80]);
  });

  it('treats an all-zero fourth byte in 32-bit BI_RGB as opaque', () => {
    const r = decodeBmp(bmp(infoHeader(2, 1, 32, 0), [], [1, 2, 3, 0, 4, 5, 6, 0]));
    expect(r.hasAlpha).toBe(false);
    expect(pixelAt(r, 0, 0)).toEqual([3, 2, 1, 255]);
    const r2 = decodeBmp(bmp(infoHeader(2, 1, 32, 0), [], [1, 2, 3, 0, 4, 5, 6, 9]));
    expect(r2.hasAlpha).toBe(true);
    expect(pixelAt(r2, 1, 0)).toEqual([6, 5, 4, 9]);
  });

  it('rejects non-BMP input', () => {
    expect(() => decodeBmp(new Uint8Array(30))).toThrow();
  });
});
