import { describe, expect, it } from 'vitest';
import { decodeIco, encodeIco, pickIcoEntry } from '../src/imaging/codecs/ico';
import { decodeTga, encodeTga } from '../src/imaging/codecs/tga';
import { decodeNetpbm, encodeNetpbm } from '../src/imaging/codecs/netpbm';
import type { RGBA8 } from '../src/imaging/types';
import { testImage } from './codecs-builders';

const img = (w: number, h: number, seed = 1): RGBA8 => ({ width: w, height: h, data: testImage(w, h, 4, 8, seed) as Uint8ClampedArray });
// A syntactically valid PNG header + IHDR is all the container needs.
function fakePng(w: number, h: number, colorType = 6): Uint8Array {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  b[24] = 8;
  b[25] = colorType;
  return b;
}

describe('ICO/CUR', () => {
  it('writes and reads multi-entry icons with BMP and PNG entries', () => {
    const small = img(16, 16);
    // Binary alpha so the AND mask is meaningful; plus partial alpha.
    small.data[3] = 0;
    small.data[7] = 77;
    const mid = img(33, 20, 2);
    const png = fakePng(256, 256);
    const ico = encodeIco([{ rgba: small }, { rgba: mid }, { png }]);
    const res = decodeIco(ico);
    expect(res.type).toBe('ico');
    expect(res.entries.map((e) => [e.format, e.width, e.height])).toEqual([
      ['bmp', 16, 16],
      ['bmp', 33, 20],
      ['png', 256, 256],
    ]);
    expect(Array.from(res.entries[0].rgba!.data)).toEqual(Array.from(small.data));
    expect(Array.from(res.entries[1].rgba!.data)).toEqual(Array.from(mid.data));
    expect(Array.from(res.entries[2].png!)).toEqual(Array.from(png));
    expect(res.entries[2].rgba).toBeUndefined();
    // Directory stores 256 as 0.
    expect(ico[6 + 32]).toBe(0);
    expect(pickIcoEntry(res).width).toBe(256);
    expect(pickIcoEntry(res, 32).width).toBe(33);
  });

  it('uses a caller-provided PNG decoder and keeps cursor hotspots', () => {
    const cur = encodeIco([{ png: fakePng(32, 32), hotspot: { x: 5, y: 9 } }], { type: 'cur' });
    const res = decodeIco(cur, { decodePng: (png) => ({ width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4).fill(png.length & 255) }) });
    expect(res.type).toBe('cur');
    expect(res.entries[0].hotspot).toEqual({ x: 5, y: 9 });
    expect(res.entries[0].rgba!.data[0]).toBe(40);
  });

  it('applies the AND mask to icons without alpha', () => {
    // Hand-built 24-bit 2x2 icon: AND mask marks the top-left pixel transparent.
    const dib: number[] = [];
    const le32 = (v: number) => dib.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
    le32(40);
    le32(2);
    le32(4);
    dib.push(1, 0, 24, 0);
    for (let i = 0; i < 6; i++) le32(0);
    // XOR rows bottom-up, 2 px * 3 bytes + 2 pad.
    dib.push(1, 2, 3, 4, 5, 6, 0, 0, 7, 8, 9, 10, 11, 12, 0, 0);
    // AND rows bottom-up, 4-byte stride: bottom row opaque, top row first pixel transparent.
    dib.push(0, 0, 0, 0, 0x80, 0, 0, 0);
    const head = [0, 0, 1, 0, 1, 0, 2, 2, 0, 0, 1, 0, 24, 0, ...[dib.length, 0, 0, 0], 22, 0, 0, 0];
    const res = decodeIco(new Uint8Array([...head, ...dib]));
    const d = res.entries[0].rgba!.data;
    expect(Array.from(d.subarray(0, 4))).toEqual([9, 8, 7, 0]);
    expect(Array.from(d.subarray(4, 8))).toEqual([12, 11, 10, 255]);
    expect(Array.from(d.subarray(8, 12))).toEqual([3, 2, 1, 255]);
  });

  it('rejects bad input', () => {
    expect(() => decodeIco(new Uint8Array([0, 0, 3, 0, 1, 0]))).toThrow();
    expect(() => encodeIco([{ rgba: img(300, 10) }])).toThrow();
  });
});

describe('TGA', () => {
  it('round trips 24/32-bit, raw/RLE and both origins', () => {
    const src = img(19, 7);
    // Add runs so RLE packets are exercised.
    for (let x = 0; x < 10; x++) src.data.set([1, 2, 3, 4], x * 4);
    for (const bits of [24, 32] as const)
      for (const rle of [false, true])
        for (const origin of ['top-left', 'bottom-left'] as const) {
          const res = decodeTga(encodeTga(src, { bits, rle, origin }));
          expect(res.rle).toBe(rle);
          expect(res.origin).toBe(origin);
          expect(res.hasAlpha).toBe(bits === 32);
          for (let i = 0; i < src.data.length; i++) expect(res.rgba8.data[i]).toBe(i % 4 === 3 && bits === 24 ? 255 : src.data[i]);
        }
    const flat = { width: 300, height: 1, data: new Uint8ClampedArray(1200).fill(9) };
    expect(encodeTga(flat, { rle: true }).length).toBeLessThan(60);
  });

  it('reads hand-built color-mapped RLE, grayscale and right-to-left 16-bit images', () => {
    // Type 9 (RLE color-mapped), 3x1, 24-bit map of 2 entries, run of 3 index 1.
    const cm = new Uint8Array([0, 1, 9, 0, 0, 2, 0, 24, 0, 0, 0, 0, 3, 0, 1, 0, 8, 0x20, 0, 0, 255, 0, 255, 0, 0x82, 1]);
    const r = decodeTga(cm);
    expect(Array.from(r.rgba8.data)).toEqual([0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255]);
    // Type 3 grayscale 2x2 bottom-left: first stored row is the bottom row.
    const g = decodeTga(new Uint8Array([0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 8, 0, 10, 20, 30, 40]));
    expect([0, 1, 2, 3].map((i) => g.rgba8.data[i * 4])).toEqual([30, 40, 10, 20]);
    // Type 2, 16-bit ARGB1555 with 1 alpha bit, right-to-left, top-left origin.
    const h = decodeTga(new Uint8Array([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1, 0, 16, 0x31, 0x00, 0xfc, 0x1f, 0x00]));
    expect(Array.from(h.rgba8.data)).toEqual([0, 0, 255, 0, 255, 0, 0, 255]);
  });
});

describe('Netpbm', () => {
  it('round trips every format, raw and plain, 8 and 16 bit', () => {
    const rgba = img(11, 5);
    const rgb = new Uint8ClampedArray(55 * 3);
    const gray = new Uint8ClampedArray(55);
    for (let i = 0; i < 55; i++) {
      rgb.set(rgba.data.subarray(i * 4, i * 4 + 3), i * 3);
      gray[i] = rgba.data[i * 4];
    }
    for (const ascii of [false, true]) {
      const ppm = decodeNetpbm(encodeNetpbm({ width: 11, height: 5, data: rgb, channels: 3 }, { ascii }));
      expect([ppm.format, ppm.ascii, ppm.channels]).toEqual(['ppm', ascii, 3]);
      for (let i = 0; i < 55; i++) expect(Array.from(ppm.rgba8.data.subarray(i * 4, i * 4 + 3))).toEqual(Array.from(rgb.subarray(i * 3, i * 3 + 3)));
      const pgm = decodeNetpbm(encodeNetpbm({ width: 11, height: 5, data: gray, channels: 1 }, { ascii }));
      expect(pgm.format).toBe('pgm');
      for (let i = 0; i < 55; i++) expect(pgm.rgba8.data[i * 4]).toBe(gray[i]);
      const pbm = decodeNetpbm(encodeNetpbm({ width: 11, height: 5, data: gray, channels: 1 }, { format: 'pbm', ascii }));
      for (let i = 0; i < 55; i++) expect(pbm.rgba8.data[i * 4]).toBe(gray[i] < 128 ? 0 : 255);
    }
    const pam = decodeNetpbm(encodeNetpbm({ width: 11, height: 5, data: rgba.data, channels: 4 }));
    expect([pam.format, pam.tupleType]).toEqual(['pam', 'RGB_ALPHA']);
    expect(Array.from(pam.rgba8.data)).toEqual(Array.from(rgba.data));
    const deep = testImage(6, 3, 3, 16) as Uint16Array;
    for (const format of ['ppm', 'pam'] as const) {
      const d = decodeNetpbm(encodeNetpbm({ width: 6, height: 3, data: deep, channels: 3 }, { format }));
      expect(d.maxval).toBe(65535);
      for (let i = 0; i < 18; i++) expect(Array.from(d.data16!.subarray(i * 4, i * 4 + 3))).toEqual(Array.from(deep.subarray(i * 3, i * 3 + 3)));
    }
  });

  it('parses comments, odd maxvals and unseparated plain PBM bits', () => {
    const text = (s: string) => new TextEncoder().encode(s);
    const p1 = decodeNetpbm(text('P1\n# comment\n4 2\n0101\n1 1 0 0\n'));
    expect(Array.from({ length: 8 }, (_, i) => p1.rgba8.data[i * 4])).toEqual([255, 0, 255, 0, 0, 0, 255, 255]);
    const p2 = decodeNetpbm(text('P2 2 1 # two pixels\n15\n0 15\n'));
    expect([p2.rgba8.data[0], p2.rgba8.data[4]]).toEqual([0, 255]);
    // Raw P5 with maxval 1000 (two bytes per sample, big-endian).
    const p5 = decodeNetpbm(new Uint8Array([...text('P5\n1 1\n1000\n'), 0x01, 0xf4]));
    expect(p5.data16![0]).toBe(Math.round((500 * 65535) / 1000));
    // P4 with row padding: 10 px wide.
    const p4 = decodeNetpbm(new Uint8Array([...text('P4\n10 1\n'), 0b10000000, 0b01000000]));
    expect(Array.from({ length: 10 }, (_, i) => p4.rgba8.data[i * 4])).toEqual([0, 255, 255, 255, 255, 255, 255, 255, 255, 0]);
    const pam = decodeNetpbm(text('P7\nWIDTH 2\nHEIGHT 1\nDEPTH 1\nMAXVAL 1\nTUPLTYPE BLACKANDWHITE\nENDHDR\n\x00\x01'));
    expect([pam.rgba8.data[0], pam.rgba8.data[4]]).toEqual([0, 255]);
    expect(() => decodeNetpbm(text('P9 1 1'))).toThrow();
  });
});
