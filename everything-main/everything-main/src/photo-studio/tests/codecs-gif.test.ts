import { describe, expect, it } from 'vitest';
import { decodeGif, encodeGif } from '../src/imaging/codecs/gif';
import { lzwDecode, lzwEncode } from '../src/imaging/codecs/lzw';
import { buildPalette, mapToPalette } from '../src/imaging/codecs/quantize';
import { CancelledError, type RGBA8 } from '../src/imaging/types';
import { pseudoRandom, referenceLzwDecode } from './codecs-builders';

function solid(w: number, h: number, rgba: number[], paint?: (x: number, y: number) => number[] | null): RGBA8 {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) data.set(paint?.(x, y) ?? rgba, (y * w + x) * 4);
  return { width: w, height: h, data };
}
function photo(w: number, h: number, seed = 5): RGBA8 {
  const rnd = pseudoRandom(seed);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      data[o] = (x / w) * 255 + rnd() * 20;
      data[o + 1] = (y / h) * 255 + rnd() * 20;
      data[o + 2] = 128 + 100 * Math.sin((x + y) / 37) + rnd() * 20;
      data[o + 3] = 255;
    }
  return { width: w, height: h, data };
}
function meanError(a: RGBA8, b: RGBA8) {
  let e = 0;
  for (let i = 0; i < a.data.length; i += 4) e += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
  return e / (a.data.length / 4) / 3;
}

describe('GIF LZW', () => {
  // Hand-computed: pixels 1,1,1,1,2 with minimum code size 2 ->
  // Clear(4) 1 6 1 [3 bits] then 2 EOI(5) [4 bits after entry 8 is added], LSB-first.
  it('encodes and decodes the hand-computed vector', () => {
    const enc = lzwEncode(new Uint8Array([1, 1, 1, 1, 2]), 'gif', 2);
    expect(Array.from(enc)).toEqual([0x8c, 0x23, 0x05]);
    const out = new Uint8Array(5);
    expect(lzwDecode(new Uint8Array([0x8c, 0x23, 0x05]), out, 'gif', 2)).toBe(5);
    expect(Array.from(out)).toEqual([1, 1, 1, 1, 2]);
  });
  it('matches the reference decoder over table resets at several code sizes', () => {
    const rnd = pseudoRandom(9);
    for (const min of [2, 4, 8]) {
      const data = new Uint8Array(60000);
      for (let i = 0; i < data.length; i++) data[i] = Math.floor(rnd() * (1 << min)) & (i % 300 < 150 ? 1 : 255);
      const enc = lzwEncode(data, 'gif', min);
      expect(Buffer.from(referenceLzwDecode(enc, 'gif', min)).equals(Buffer.from(data))).toBe(true);
      const out = new Uint8Array(data.length);
      expect(lzwDecode(enc, out, 'gif', min)).toBe(data.length);
      expect(Buffer.from(out).equals(Buffer.from(data))).toBe(true);
    }
  });
});

describe('GIF encode/decode', () => {
  it('round trips images with up to 256 colors exactly, with transparency', () => {
    const img = solid(17, 9, [0, 0, 0, 255], (x, y) => (x === 3 ? [0, 0, 0, 0] : [(x * 15) & 255, (y * 28) & 255, 77, 255]));
    for (const interlace of [false, true]) {
      const gif = encodeGif(img, { interlace });
      const res = decodeGif(gif);
      expect(res.frames.length).toBe(1);
      expect(res.frames[0].interlaced).toBe(interlace);
      const out = res.frames[0].rgba.data;
      for (let i = 0; i < out.length; i += 4) {
        if (img.data[i + 3] === 0) expect(out[i + 3]).toBe(0);
        else expect(Array.from(out.subarray(i, i + 4))).toEqual(Array.from(img.data.subarray(i, i + 4)));
      }
    }
  });

  it('handles a 1x1 image and the alpha threshold', () => {
    const one = decodeGif(encodeGif(solid(1, 1, [9, 8, 7, 255])));
    expect(Array.from(one.frames[0].rgba.data)).toEqual([9, 8, 7, 255]);
    const faint = solid(2, 1, [200, 0, 0, 100]);
    expect(decodeGif(encodeGif(faint)).frames[0].rgba.data[3]).toBe(0);
    expect(decodeGif(encodeGif(faint, { alphaThreshold: 50 })).frames[0].rgba.data[3]).toBe(255);
  });

  it('encodes animations with delays and loop count that composite back to the source frames', () => {
    const frames = [0, 1, 2].map((k) => ({
      rgba: solid(12, 8, [20, 40, 60, 255], (x, y) => (x >= k * 3 && x < k * 3 + 4 && y > 2 ? [250, 10 * k, 0, 255] : null)),
      delayMs: 50 + k * 10,
    }));
    for (const palette of ['global', 'local'] as const) {
      const res = decodeGif(encodeGif(frames, { palette, loop: 3 }));
      expect(res.loopCount).toBe(3);
      expect(res.frames.map((f) => f.delayMs)).toEqual([50, 60, 70]);
      // Opaque animation: later frames are cropped to the changed area.
      expect(res.frames[1].rect.width).toBeLessThan(12);
      res.frames.forEach((f, i) => expect(Array.from(f.rgba.data)).toEqual(Array.from(frames[i].rgba.data)));
    }
  });

  it('clears transparent animation frames (disposal 2) so earlier frames do not show through', () => {
    const frames = [0, 1].map((k) => ({ rgba: solid(6, 6, [0, 0, 0, 0], (x, y) => (x === k * 3 && y === k * 3 ? [255, 255, 255, 255] : null)) }));
    const res = decodeGif(encodeGif(frames));
    expect(res.frames[1].disposal).toBe(2);
    expect(res.frames[0].disposal).toBe(2);
    res.frames.forEach((f, i) => expect(Array.from(f.rgba.data)).toEqual(Array.from(frames[i].rgba.data)));
  });

  it('honours disposal 3 (restore previous) and local palettes in a hand-built file', () => {
    // 4x1 canvas. Frame 1 paints all red (keep). Frame 2 paints pixel 1 green
    // with disposal 3. Frame 3 paints pixel 3 blue from a local palette: pixel 1
    // must be red again.
    const bytes: number[] = [...'GIF89a'].map((c) => c.charCodeAt(0));
    bytes.push(4, 0, 1, 0, 0x80, 0, 0); // 2-color global table
    bytes.push(255, 0, 0, 0, 255, 0);
    const image = (x: number, w: number, indices: number[], disposal: number, localTable?: number[]) => {
      bytes.push(0x21, 0xf9, 4, disposal << 2, 5, 0, 0, 0);
      bytes.push(0x2c, x, 0, 0, 0, w, 0, 1, 0, localTable ? 0x80 : 0);
      if (localTable) bytes.push(...localTable);
      const data = lzwEncode(new Uint8Array(indices), 'gif', 2);
      bytes.push(2, data.length, ...data, 0);
    };
    image(0, 4, [0, 0, 0, 0], 1);
    image(1, 1, [1], 3);
    image(3, 1, [1], 1, [0, 0, 0, 0, 0, 255]);
    bytes.push(0x3b);
    const res = decodeGif(new Uint8Array(bytes));
    const px = (f: number, x: number) => Array.from(res.frames[f].rgba.data.subarray(x * 4, x * 4 + 4));
    expect(px(1, 1)).toEqual([0, 255, 0, 255]);
    expect(px(2, 1)).toEqual([255, 0, 0, 255]);
    expect(px(2, 3)).toEqual([0, 0, 255, 255]);
    expect(res.frames[2].localPalette).toBe(true);
    expect(res.frames[0].delayMs).toBe(50);
    expect(res.loopCount).toBeUndefined();
  });

  it('can be cancelled between frames', () => {
    const frames = [0, 1, 2].map(() => ({ rgba: solid(4, 4, [1, 2, 3, 255]) }));
    let n = 0;
    const seen: number[] = [];
    expect(() => encodeGif(frames, { progress: { cancelled: () => ++n > 2, report: (f) => seen.push(f) } })).toThrow(CancelledError);
    expect(seen.length).toBe(2);
  });

  it('quantizes photographs with every method to a small error', () => {
    const img = photo(96, 64);
    for (const method of ['mediancut', 'octree', 'neuquant'] as const) {
      const pal = buildPalette([img], { method, maxColors: 64 });
      expect(pal.length / 3).toBeLessThanOrEqual(64);
      expect(pal.length / 3).toBeGreaterThan(32);
      for (const dither of [false, true]) {
        const idx = mapToPalette(img, pal, { dither });
        const back = new Uint8ClampedArray(img.data.length);
        for (let i = 0; i < idx.length; i++) back.set([pal[idx[i] * 3], pal[idx[i] * 3 + 1], pal[idx[i] * 3 + 2], 255], i * 4);
        const err = meanError(img, { ...img, data: back });
        expect(err).toBeLessThan(dither ? 14 : 10);
      }
    }
    // Deterministic.
    expect(Array.from(buildPalette([img], { method: 'neuquant', maxColors: 16 }))).toEqual(Array.from(buildPalette([img], { method: 'neuquant', maxColors: 16 })));
  });

  it('octree keeps the average color when the palette collapses to the root', () => {
    // Red, green and blue sit in three top-level octants, so two colors
    // force the whole tree into its root.
    const img: RGBA8 = { width: 3, height: 1, data: new Uint8ClampedArray([200, 10, 10, 255, 10, 200, 10, 255, 10, 10, 200, 255]) };
    expect(Array.from(buildPalette([img], { method: 'octree', maxColors: 2 }))).toEqual([73, 73, 73]);
  });

  it('dithering preserves average color better than plain mapping on a smooth ramp', () => {
    const ramp = solid(256, 4, [0, 0, 0, 255], (x) => [x, x, x, 255]);
    const pal = new Uint8Array([0, 0, 0, 255, 255, 255]);
    const avg = (idx: Uint8Array, x0: number) => {
      let s = 0;
      for (let y = 0; y < 4; y++) for (let x = x0; x < x0 + 32; x++) s += idx[y * 256 + x] * 255;
      return s / 128;
    };
    const plain = mapToPalette(ramp, pal);
    const dith = mapToPalette(ramp, pal, { dither: true });
    // Region around x = 64..95 has mean ~80.
    expect(avg(plain, 64)).toBe(0);
    expect(Math.abs(avg(dith, 64) - 79.5)).toBeLessThan(12);
  });

  // Timing budgets are opt-in: shared CI and loaded machines make them flaky.
  it.skipIf(!process.env.CODECS_PERF)('meets the 1000x1000 quantize + encode budget', () => {
    const img = photo(1000, 1000);
    for (const quantizer of ['mediancut', 'octree'] as const) {
      const t = performance.now();
      const gif = encodeGif(img, { quantizer, dither: true });
      const ms = performance.now() - t;
      console.log(`GIF 1000x1000 ${quantizer}+dither: ${ms.toFixed(0)} ms, ${(gif.length / 1e3).toFixed(0)} KB`);
      expect(ms).toBeLessThan(2500);
      const back = decodeGif(gif).frames[0].rgba;
      expect(meanError(img, back)).toBeLessThan(16);
    }
    const t = performance.now();
    encodeGif(img, { quantizer: 'neuquant', dither: true });
    console.log(`GIF 1000x1000 neuquant+dither: ${(performance.now() - t).toFixed(0)} ms`);
  }, 30000);
});
