import { describe, expect, it } from 'vitest';
import { deflate } from 'pako';
import { decodeTiff, encodeTiff, listTiffTags } from '../src/imaging/codecs/tiff';
import { CancelledError } from '../src/imaging/types';
import { lzwDecode, lzwEncode } from '../src/imaging/codecs/lzw';
import { buildTiff, packBits, pseudoRandom, referenceLzwDecode, testImage, type RawTag } from './codecs-builders';

const short = (tag: number, ...values: number[]): RawTag => ({ tag, type: 3, values });
const long = (tag: number, ...values: number[]): RawTag => ({ tag, type: 4, values });

function expectRGBA(page: { rgba8: { data: Uint8ClampedArray } }, src: ArrayLike<number>, channels: number) {
  const d = page.rgba8.data;
  const n = d.length / 4;
  for (let i = 0; i < n; i++) {
    const s = i * channels;
    const exp =
      channels >= 3
        ? [src[s], src[s + 1], src[s + 2], channels === 4 ? src[s + 3] : 255]
        : [src[s], src[s], src[s], channels === 2 ? src[s + 1] : 255];
    for (let c = 0; c < 4; c++) if (d[i * 4 + c] !== exp[c]) throw new Error(`pixel ${i} channel ${c}: ${d[i * 4 + c]} != ${exp[c]}`);
  }
}

describe('TIFF LZW', () => {
  // Hand-computed: ABABABA -> Clear, A, B, <AB>=258, <ABA>=260, EOI, all 9-bit MSB-first.
  const input = new Uint8Array([0x41, 0x42, 0x41, 0x42, 0x41, 0x42, 0x41]);
  const coded = new Uint8Array([0x80, 0x10, 0x48, 0x50, 0x28, 0x24, 0x04]);
  it('encodes the hand-computed vector', () => {
    expect(Array.from(lzwEncode(input, 'tiff'))).toEqual(Array.from(coded));
  });
  it('decodes the hand-computed vector', () => {
    const out = new Uint8Array(7);
    expect(lzwDecode(coded, out, 'tiff')).toBe(7);
    expect(Array.from(out)).toEqual(Array.from(input));
  });
  it('handles the KwKwK case and the empty input', () => {
    // AAAA -> Clear, A, <AA>=258 (code equal to the next free entry), A, EOI.
    const enc = lzwEncode(new Uint8Array([65, 65, 65, 65]), 'tiff');
    expect(referenceLzwDecode(enc, 'tiff')).toEqual([65, 65, 65, 65]);
    const empty = lzwEncode(new Uint8Array(0), 'tiff');
    expect(referenceLzwDecode(empty, 'tiff')).toEqual([]);
    expect(lzwDecode(empty, new Uint8Array(4), 'tiff')).toBe(0);
  });
  it('round trips long inputs across width changes and table resets, matching a reference decoder', () => {
    const rnd = pseudoRandom(3);
    const data = new Uint8Array(150000);
    for (let i = 0; i < data.length; ) {
      const run = 1 + Math.floor(rnd() * 20);
      const v = Math.floor(rnd() * (i < 70000 ? 256 : 6));
      for (let k = 0; k < run && i < data.length; k++) data[i++] = v;
    }
    const enc = lzwEncode(data, 'tiff');
    const ref = referenceLzwDecode(enc, 'tiff');
    expect(ref.length).toBe(data.length);
    expect(Buffer.from(ref).equals(Buffer.from(data))).toBe(true);
    const out = new Uint8Array(data.length);
    expect(lzwDecode(enc, out, 'tiff')).toBe(data.length);
    expect(Buffer.from(out).equals(Buffer.from(data))).toBe(true);
  });
});

describe('TIFF encode/decode round trips', () => {
  const sizes: [number, number][] = [
    [1, 1],
    [37, 23],
  ];
  for (const channels of [1, 2, 3, 4] as const)
    for (const compression of ['none', 'lzw', 'deflate'] as const)
      for (const predictor of [false, true])
        it(`8-bit ${channels}ch ${compression}${predictor ? '+predictor' : ''}`, () => {
          for (const [w, h] of sizes) {
            const data = testImage(w, h, channels) as Uint8ClampedArray;
            const tiff = encodeTiff({ width: w, height: h, data, channels }, { compression, predictor, rowsPerStrip: 5 });
            const { pages } = decodeTiff(tiff);
            expect(pages.length).toBe(1);
            const p = pages[0];
            expect([p.width, p.height, p.channels, p.bitsPerSample]).toEqual([w, h, channels, 8]);
            expect(p.alpha).toBe(channels % 2 === 0 ? 'unassociated' : undefined);
            expectRGBA(p, data, channels);
          }
        });

  for (const channels of [1, 2, 3, 4] as const)
    for (const compression of ['none', 'lzw', 'deflate'] as const)
      it(`16-bit ${channels}ch ${compression}+predictor is bit exact`, () => {
        const w = 29;
        const h = 17;
        const data = testImage(w, h, channels, 16) as Uint16Array;
        const tiff = encodeTiff({ width: w, height: h, data, channels }, { compression, predictor: true });
        const p = decodeTiff(tiff).pages[0];
        expect(p.bitsPerSample).toBe(16);
        const d16 = p.data16!;
        for (let i = 0; i < w * h; i++) {
          const s = i * channels;
          const exp = channels >= 3 ? [data[s], data[s + 1], data[s + 2], channels === 4 ? data[s + 3] : 65535] : [data[s], data[s], data[s], channels === 2 ? data[s + 1] : 65535];
          expect([d16[i * 4], d16[i * 4 + 1], d16[i * 4 + 2], d16[i * 4 + 3]]).toEqual(exp);
        }
        // 8-bit view is the rounded 16-bit value.
        expect(p.rgba8.data[0]).toBe(Math.round(d16[0] / 257));
      });

  it('32-bit float with the floating-point predictor is bit exact', () => {
    const w = 13;
    const h = 7;
    const data = new Float32Array(w * h * 3);
    const rnd = pseudoRandom(11);
    for (let i = 0; i < data.length; i++) data[i] = i % 5 === 0 ? -0.25 : rnd() * 4;
    for (const compression of ['lzw', 'deflate', 'none'] as const) {
      const p = decodeTiff(encodeTiff({ width: w, height: h, data, channels: 3 }, { compression, predictor: true })).pages[0];
      expect(p.sampleFormat).toBe('float');
      expect(p.predictor).toBe(compression === 'none' ? 1 : 3);
      for (let i = 0; i < w * h; i++) {
        expect(p.dataF32![i * 4]).toBe(data[i * 3]);
        expect(p.dataF32![i * 4 + 2]).toBe(data[i * 3 + 2]);
        expect(p.dataF32![i * 4 + 3]).toBe(1);
      }
      expect(p.rgba8.data[0]).toBe(0); // -0.25 clamps to 0
    }
  });

  it('writes and reads ICC profile, resolution and unassociated alpha', () => {
    const icc = new Uint8Array(301).map((_, i) => (i * 7) & 255);
    const data = testImage(5, 4, 4) as Uint8ClampedArray;
    const tiff = encodeTiff({ width: 5, height: 4, data, channels: 4 }, { compression: 'lzw', predictor: true, icc, dpi: 300 });
    const p = decodeTiff(tiff).pages[0];
    expect(Array.from(p.icc!)).toEqual(Array.from(icc));
    expect(p.resolution).toEqual({ x: 300, y: 300, unit: 'inch' });
    const tags = listTiffTags(tiff)[0];
    expect(tags[338]).toEqual([2]);
    expect(tags[317]).toEqual([2]);
    expect(tags[259]).toEqual([5]);
  });

  it('reports progress per strip and can be cancelled', () => {
    const data = testImage(64, 64, 4) as Uint8ClampedArray;
    const enc: number[] = [];
    const tiff = encodeTiff({ width: 64, height: 64, data, channels: 4 }, { compression: 'lzw', rowsPerStrip: 8, progress: { report: (f) => enc.push(f) } });
    expect(enc).toEqual([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]);
    const dec: number[] = [];
    decodeTiff(tiff, { progress: { report: (f) => dec.push(f) } });
    expect(dec.length).toBe(8);
    let n = 0;
    expect(() => decodeTiff(tiff, { progress: { cancelled: () => ++n > 3 } })).toThrow(CancelledError);
    expect(() => encodeTiff({ width: 64, height: 64, data, channels: 4 }, { compression: 'none', progress: { cancelled: () => true } })).toThrow(CancelledError);
  });

  // Timing budgets are opt-in: shared CI and loaded machines make them flaky.
  it.skipIf(!process.env.CODECS_PERF)('meets the 12-megapixel LZW budget', () => {
    const w = 4000;
    const h = 3000;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i] = x & 255;
        data[i + 1] = y & 255;
        data[i + 2] = (x ^ y) & 255;
        data[i + 3] = 255 - ((x * y) & 63);
      }
    let t = performance.now();
    const tiff = encodeTiff({ width: w, height: h, data, channels: 4 }, { compression: 'lzw', predictor: true });
    const encMs = performance.now() - t;
    t = performance.now();
    const p = decodeTiff(tiff).pages[0];
    const decMs = performance.now() - t;
    console.log(`TIFF LZW 4000x3000 RGBA: encode ${encMs.toFixed(0)} ms, decode ${decMs.toFixed(0)} ms, ${(tiff.length / 1e6).toFixed(1)} MB`);
    expect(Buffer.from(p.rgba8.data.buffer).equals(Buffer.from(data.buffer))).toBe(true);
    expect(encMs).toBeLessThan(3000);
    expect(decMs).toBeLessThan(3000);
  }, 30000);
});

describe('TIFF decoder variants', () => {
  const rgbTags = (w: number, h: number, extra: RawTag[] = []): RawTag[] => [
    long(256, w),
    long(257, h),
    short(258, 8, 8, 8),
    short(262, 2),
    short(277, 3),
    long(278, h),
    ...extra,
  ];

  it('reads big-endian 16-bit RGB with LZW and horizontal predictor', () => {
    const w = 6;
    const h = 3;
    const vals = testImage(w, h, 3, 16) as Uint16Array;
    const raw = new Uint8Array(w * h * 6);
    for (let y = 0; y < h; y++)
      for (let i = 0; i < w * 3; i++) {
        const k = y * w * 3 + i;
        const v = i >= 3 ? (vals[k] - vals[k - 3]) & 0xffff : vals[k];
        raw[k * 2] = v >> 8;
        raw[k * 2 + 1] = v & 255;
      }
    const tiff = buildTiff(
      [{ tags: [long(256, w), long(257, h), short(258, 16, 16, 16), short(259, 5), short(262, 2), short(277, 3), long(278, h), short(317, 2)], chunks: [lzwEncode(raw, 'tiff')] }],
      { le: false },
    );
    expect(tiff[0]).toBe(0x4d);
    const { pages, littleEndian } = decodeTiff(tiff);
    expect(littleEndian).toBe(false);
    for (let i = 0; i < w * h; i++) expect(Array.from(pages[0].data16!.subarray(i * 4, i * 4 + 3))).toEqual(Array.from(vals.subarray(i * 3, i * 3 + 3)));
  });

  it('reads PackBits tiles with partial edge tiles', () => {
    const w = 20;
    const h = 19;
    const img = testImage(w, h, 3) as Uint8ClampedArray;
    const chunks: Uint8Array[] = [];
    for (let ty = 0; ty < 2; ty++)
      for (let tx = 0; tx < 2; tx++) {
        const tile = new Uint8Array(16 * 16 * 3).fill(99);
        for (let y = 0; y < 16; y++)
          for (let x = 0; x < 16; x++) {
            const sx = tx * 16 + x;
            const sy = ty * 16 + y;
            if (sx < w && sy < h) tile.set(img.subarray((sy * w + sx) * 3, (sy * w + sx) * 3 + 3), (y * 16 + x) * 3);
          }
        chunks.push(packBits(tile));
      }
    const tags = [long(256, w), long(257, h), short(258, 8, 8, 8), short(259, 32773), short(262, 2), short(277, 3), long(322, 16), long(323, 16)];
    const p = decodeTiff(buildTiff([{ tags, chunks, tiled: true }], { le: true })).pages[0];
    expect(p.tiled).toBe(true);
    expectRGBA(p, img, 3);
  });

  it('reads planar RGB strips with Deflate', () => {
    const w = 7;
    const h = 5;
    const img = testImage(w, h, 3) as Uint8ClampedArray;
    const chunks: Uint8Array[] = [];
    for (let c = 0; c < 3; c++)
      for (let y0 = 0; y0 < h; y0 += 2) {
        const rows = Math.min(2, h - y0);
        const plane = new Uint8Array(rows * w);
        for (let i = 0; i < rows * w; i++) plane[i] = img[(y0 * w + i) * 3 + c];
        chunks.push(deflate(plane));
      }
    const tags = [long(256, w), long(257, h), short(258, 8, 8, 8), short(259, 8), short(262, 2), short(277, 3), long(278, 2), short(284, 2)];
    const p = decodeTiff(buildTiff([{ tags, chunks }], { le: true })).pages[0];
    expect(p.planar).toBe(true);
    expectRGBA(p, img, 3);
  });

  it('reads 4-bit palette, WhiteIsZero bilevel and associated alpha', () => {
    // 4-bit palette, 3x2: indices 0..5.
    const map = new Array(48).fill(0);
    for (let i = 0; i < 16; i++) {
      map[i] = i * 4096;
      map[16 + i] = 65535 - i * 4096;
      map[32 + i] = 32896;
    }
    const pal = buildTiff(
      [{ tags: [long(256, 3), long(257, 2), short(258, 4), short(262, 3), short(277, 1), long(278, 2), short(320, ...map)], chunks: [new Uint8Array([0x01, 0x20, 0x34, 0x50])] }],
      { le: true },
    );
    const pp = decodeTiff(pal).pages[0];
    expect(pp.colorModel).toBe('palette');
    const idx = [0, 1, 2, 3, 4, 5];
    for (let i = 0; i < 6; i++) expect(Array.from(pp.rgba8.data.subarray(i * 4, i * 4 + 4))).toEqual([Math.round((idx[i] * 4096) / 257), Math.round((65535 - idx[i] * 4096) / 257), 128, 255]);

    // 1-bit WhiteIsZero, 10x2: row padding to bytes.
    const bil = buildTiff(
      [{ tags: [long(256, 10), long(257, 2), short(258, 1), short(262, 0), short(277, 1), long(278, 2)], chunks: [new Uint8Array([0b10100000, 0b01000000, 0xff, 0xc0])] }],
      { le: true },
    );
    const bp = decodeTiff(bil).pages[0];
    expect(bp.colorModel).toBe('bilevel');
    const greys = Array.from({ length: 20 }, (_, i) => bp.rgba8.data[i * 4]);
    expect(greys).toEqual([0, 255, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    // Premultiplied RGBA: (100, 50, 0, 128) premultiplied -> straight (199, 100, 0, 128).
    const assoc = buildTiff(
      [{ tags: [long(256, 2), long(257, 1), short(258, 8, 8, 8, 8), short(262, 2), short(277, 4), long(278, 1), short(338, 1)], chunks: [new Uint8Array([100, 50, 0, 128, 0, 0, 0, 0])] }],
      { le: true },
    );
    const ap = decodeTiff(assoc).pages[0];
    expect(ap.alpha).toBe('associated');
    expect(Array.from(ap.rgba8.data)).toEqual([199, 100, 0, 128, 0, 0, 0, 0]);
  });

  it('reads CMYK with raw planes and a naive RGB conversion', () => {
    const tiff = buildTiff(
      [{ tags: [long(256, 2), long(257, 1), short(258, 8, 8, 8, 8), short(262, 5), short(277, 4), long(278, 1)], chunks: [new Uint8Array([255, 0, 0, 0, 0, 0, 0, 128])] }],
      { le: true },
    );
    const p = decodeTiff(tiff).pages[0];
    expect(p.colorModel).toBe('cmyk');
    expect(Array.from(p.cmyk!)).toEqual([255, 0, 0, 0, 0, 0, 0, 128]);
    expect(Array.from(p.rgba8.data)).toEqual([0, 255, 255, 255, 127, 127, 127, 255]);
  });

  it('reads all pages, orientation, embedded layer data presence and BigTIFF', () => {
    const page = (v: number, extra: RawTag[] = []) => ({ tags: rgbTags(1, 1, extra), chunks: [new Uint8Array([v, v, v])] });
    const layerBlob: RawTag = { tag: 37724, type: 7, values: new Uint8Array(20) };
    for (const big of [false, true]) {
      const tiff = buildTiff([page(10, [short(274, 6), layerBlob]), page(20), page(30)], { le: !big, big });
      const res = decodeTiff(tiff);
      expect(res.bigTiff).toBe(big);
      expect(res.pages.map((p) => p.rgba8.data[0])).toEqual([10, 20, 30]);
      expect(res.pages[0].orientation).toBe(6);
      expect(res.pages[0].hasImageSourceData).toBe(true);
      expect(res.pages[1].hasImageSourceData).toBe(false);
      expect(decodeTiff(tiff, { firstPageOnly: true }).pages.length).toBe(1);
    }
  });

  it('skips undecodable later pages with a warning and rejects a bad first page', () => {
    const good = { tags: rgbTags(1, 1), chunks: [new Uint8Array([1, 2, 3])] };
    const jpeg = { tags: rgbTags(1, 1, [short(259, 7)]), chunks: [new Uint8Array([1, 2, 3])] };
    const res = decodeTiff(buildTiff([good, jpeg], { le: true }));
    expect(res.pages.length).toBe(1);
    expect(res.warnings[0]).toMatch(/JPEG/);
    expect(() => decodeTiff(buildTiff([jpeg], { le: true }))).toThrow(/JPEG/);
    expect(() => decodeTiff(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow();
  });

  it('reads big-endian float32 with predictor 3 and 16-bit half floats', () => {
    const vals = [0.5, -2, 1e-3, 3.25];
    // Predictor 3 encoding by hand: byte planes MSB first, then difference with stride 1.
    const be = new Uint8Array(16);
    const dv = new DataView(be.buffer);
    vals.forEach((v, i) => dv.setFloat32(i * 4, v));
    const planes = new Uint8Array(16);
    for (let i = 0; i < 4; i++) for (let b = 0; b < 4; b++) planes[b * 4 + i] = be[i * 4 + b];
    for (let i = 15; i >= 1; i--) planes[i] = (planes[i] - planes[i - 1]) & 255;
    const tiff = buildTiff(
      [{ tags: [long(256, 4), long(257, 1), short(258, 32), short(259, 8), short(262, 1), short(277, 1), long(278, 1), short(317, 3), short(339, 3)], chunks: [deflate(planes)] }],
      { le: false },
    );
    const p = decodeTiff(tiff).pages[0];
    expect([0, 1, 2, 3].map((i) => p.dataF32![i * 4])).toEqual(vals.map((v) => Math.fround(v)));
    // Half floats 1.0 (0x3c00) and -0.5 (0xb800), little endian.
    const h = buildTiff(
      [{ tags: [long(256, 2), long(257, 1), short(258, 16), short(262, 1), short(277, 1), long(278, 1), short(339, 3)], chunks: [new Uint8Array([0x00, 0x3c, 0x00, 0xb8])] }],
      { le: true },
    );
    const hp = decodeTiff(h).pages[0];
    expect([hp.dataF32![0], hp.dataF32![4]]).toEqual([1, -0.5]);
    expect([hp.rgba8.data[0], hp.rgba8.data[4]]).toEqual([255, 0]);
  });
});
