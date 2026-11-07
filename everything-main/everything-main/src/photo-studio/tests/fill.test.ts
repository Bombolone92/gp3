import { describe, expect, it } from 'vitest';
import { fillFloat } from '../src/engine/fill';

describe('floating-point connected selection', () => {
  it('distinguishes HDR samples, tiny differences and transparency without display clipping', () => {
    const data = new Float32Array([
      2, -1, 0.25, 1, 2, -1, 0.25, 1, 4, -2, 0.25, 1, 2, -1, 0.25, 0.999, 2.000001, -1,
      0.25, 1, 2, -1, 0.25, 1,
    ]);
    expect(
      Array.from(fillFloat(data, 3, 2, 0, 0, 0)).filter((_, i) => i % 4 === 3),
    ).toEqual([255, 255, 0, 0, 0, 0]);
    expect(
      Array.from(fillFloat(data, 3, 2, 0, 0, 1)).filter((_, i) => i % 4 === 3),
    ).toEqual([255, 255, 0, 255, 255, 255]);
  });
  it('matches independent four-neighbor traversal across dimensions, seeds and tolerance', () => {
    for (const [w, h] of [
      [1, 1],
      [1, 17],
      [19, 1],
      [7, 9],
    ]) {
      const data = new Float32Array(w * h * 4);
      for (let i = 0; i < data.length; i++)
        data[i] = ((i * 17 + Math.floor(i / 7)) % 13) / 255;
      for (const seed of [0, Math.floor((w * h) / 2), w * h - 1])
        for (const tolerance of [0, 4, 255]) {
          const accepted = new Set<number>(),
            pending = [seed],
            tested = new Set<number>();
          while (pending.length) {
            const pixel = pending.shift()!;
            if (tested.has(pixel)) continue;
            tested.add(pixel);
            if (
              [0, 1, 2, 3].some(
                (c) =>
                  Math.abs(data[pixel * 4 + c] - data[seed * 4 + c]) > tolerance / 255,
              )
            )
              continue;
            accepted.add(pixel);
            for (let other = 0; other < w * h; other++)
              if (
                Math.abs((other % w) - (pixel % w)) +
                  Math.abs(Math.floor(other / w) - Math.floor(pixel / w)) ===
                1
              )
                pending.push(other);
          }
          const mask = fillFloat(data, w, h, seed % w, Math.floor(seed / w), tolerance);
          for (let i = 0; i < mask.length; i++)
            expect(mask[i]).toBe(accepted.has(Math.floor(i / 4)) ? 255 : 0);
        }
    }
  });
  it('rejects invalid buffers and parameters and handles seeds outside the document', () => {
    const pixels = new Float32Array(4);
    for (const [x, y] of [
      [-1, 0],
      [1, 0],
      [0, 1],
      [0.5, 0],
    ])
      expect(fillFloat(pixels, 1, 1, x, y, 0)).toEqual(new Uint8Array(4));
    for (const tolerance of [-1, 256, NaN])
      expect(() => fillFloat(pixels, 1, 1, 0, 0, tolerance)).toThrow();
    expect(() => fillFloat(new Float32Array(3), 1, 1, 0, 0, 0)).toThrow();
    expect(() => fillFloat(new Float32Array([NaN, 0, 0, 1]), 1, 1, 0, 0, 0)).toThrow();
    expect(() => fillFloat(pixels, 0, 1, 0, 0, 0)).toThrow();
  });
});
