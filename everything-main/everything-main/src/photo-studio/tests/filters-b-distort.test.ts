import { describe, expect, it } from 'vitest';
import { defaults, mask8, rgba8, type ImageOperation, type OperationContext, type RGBA8 } from '../src/imaging/types';
import {
  displace,
  displaceOp,
  glass,
  oceanRipple,
  pinch,
  polarCoordinates,
  ripple,
  shear,
  spherize,
  twirl,
  wave,
  zigzag,
} from '../src/imaging/filters/distort';

const ctx: OperationContext = { foreground: [0, 0, 0], background: [255, 255, 255] };
function pattern(w: number, h: number): RGBA8 {
  const img = rgba8(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      img.data[k] = (x * 13 + y * 3) & 255;
      img.data[k + 1] = (y * 11) & 255;
      img.data[k + 2] = ((x ^ y) * 5) & 255;
      img.data[k + 3] = x % 7 === 0 ? 0 : 255;
    }
  return img;
}
function smooth(w: number, h: number): RGBA8 {
  const img = rgba8(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      img.data.set(
        [128 + 100 * Math.sin(x / 9), 128 + 100 * Math.cos(y / 7), 128 + 60 * Math.sin((x + y) / 11), 255],
        (y * w + x) * 4,
      );
  return img;
}
function maxDiff(a: RGBA8, b: RGBA8, rect?: { x: number; y: number; width: number; height: number }) {
  let m = 0;
  const r = rect ?? { x: 0, y: 0, width: a.width, height: a.height };
  for (let y = r.y; y < r.y + r.height; y++)
    for (let x = r.x; x < r.x + r.width; x++)
      for (let c = 0; c < 4; c++) {
        const k = (y * a.width + x) * 4 + c;
        // Color under zero alpha is undefined.
        if (c < 3 && a.data[k - c + 3] === 0 && b.data[k - c + 3] === 0) continue;
        m = Math.max(m, Math.abs(a.data[k] - b.data[k]));
      }
  return m;
}
const run = (op: ImageOperation, src: RGBA8, p: Record<string, unknown> = {}, c: OperationContext = ctx) =>
  op.apply(src, { ...defaults(op), ...(p as object) }, c) as RGBA8;

describe('distort filters', () => {
  const src = pattern(41, 29);
  it('zero amounts are the identity', () => {
    const cases: [ImageOperation, Record<string, unknown>][] = [
      [pinch, { amount: 0 }],
      [spherize, { amount: 0 }],
      [twirl, { angle: 0 }],
      [ripple, { amount: 0 }],
      [zigzag, { amount: 0 }],
      [shear, { p0: 0, p1: 0, p2: 0, p3: 0, p4: 0 }],
      [glass, { distortion: 0 }],
      [oceanRipple, { magnitude: 0 }],
      [displaceOp, { hScale: 0, vScale: 0 }],
      [wave, { scaleH: 0, scaleV: 0 }],
    ];
    for (const [op, p] of cases) expect(maxDiff(run(op, src, p), src), op.id).toBeLessThanOrEqual(1);
  });
  it('nonzero amounts change the image but keep its size', () => {
    const img = smooth(64, 48);
    for (const op of [
      pinch,
      spherize,
      twirl,
      ripple,
      wave,
      zigzag,
      polarCoordinates,
      shear,
      displaceOp,
      glass,
      oceanRipple,
    ]) {
      const out = run(op, img);
      expect([out.width, out.height]).toEqual([64, 48]);
      expect(maxDiff(out, img), op.id).toBeGreaterThan(5);
    }
  });
  it('center-based effects leave pixels outside the inscribed ellipse alone and keep the center', () => {
    const img = smooth(61, 61);
    for (const [op, p] of [
      [twirl, { angle: 300 }],
      [pinch, { amount: 80 }],
      [spherize, { amount: -70 }],
    ] as const) {
      const out = run(op, img, p);
      expect(maxDiff(out, img, { x: 0, y: 0, width: 4, height: 4 })).toBe(0);
      expect(maxDiff(out, img, { x: 30, y: 30, width: 1, height: 1 })).toBeLessThanOrEqual(2);
    }
  });
  it('respects the selection mask and centers on its bounds', () => {
    const img = smooth(50, 40);
    const sel = mask8(50, 40);
    for (let y = 10; y < 30; y++) for (let x = 5; x < 25; x++) sel.data[y * 50 + x] = x < 15 ? 255 : 128;
    const out = run(twirl, img, { angle: 400 }, { ...ctx, selection: sel });
    expect(maxDiff(out, img, { x: 30, y: 0, width: 20, height: 40 })).toBe(0);
    expect(maxDiff(out, img, { x: 5, y: 10, width: 20, height: 20 })).toBeGreaterThan(5);
    const empty = run(twirl, img, { angle: 400 }, { ...ctx, selection: mask8(50, 40) });
    expect(maxDiff(empty, img)).toBe(0);
  });
  it('polar coordinates round trip restores the middle ring', () => {
    const img = smooth(96, 96);
    const polar = run(polarCoordinates, img, { mode: 'rect-to-polar' });
    const back = run(polarCoordinates, polar, { mode: 'polar-to-rect' });
    let sum = 0,
      n = 0;
    for (let y = 30; y < 66; y++)
      for (let x = 10; x < 86; x++)
        for (let c = 0; c < 3; c++) {
          const k = (y * 96 + x) * 4 + c;
          sum += Math.abs(back.data[k] - img.data[k]);
          n++;
        }
    expect(sum / n).toBeLessThan(6);
  });
  it('wave is deterministic for a seed and differs across seeds', () => {
    const img = smooth(40, 40);
    const a = run(wave, img, { seed: 7 }),
      b = run(wave, img, { seed: 7 }),
      c = run(wave, img, { seed: 8 });
    expect(maxDiff(a, b)).toBe(0);
    expect(maxDiff(a, c)).toBeGreaterThan(0);
    expect(maxDiff(run(glass, img, { seed: 3 }), run(glass, img, { seed: 3 }))).toBe(0);
    expect(maxDiff(run(wave, img, { seed: 7 }, { ...ctx, seed: 1 }), a)).toBeGreaterThan(0);
  });
  it('displace shifts by (value - 128) * scale%', () => {
    const img = smooth(60, 10);
    const map = rgba8(4, 4, [138, 128, 0, 255]);
    const out = displace(img, map, 100, 100, 'tile');
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 50; x++) expect(out.data[(y * 60 + x) * 4]).toBe(img.data[(y * 60 + x + 10) * 4]);
    const stretched = displace(img, map, 50, 100, 'stretch');
    expect(stretched.data[0]).toBe(img.data[5 * 4]);
  });
  it('shear with a constant offset wraps rows', () => {
    const img = smooth(40, 8);
    const out = run(shear, img, { p0: 50, p1: 50, p2: 50, p3: 50, p4: 50, undefined: 'wrap' });
    // 50% of half the width = 10 px to the right.
    for (let x = 0; x < 40; x++) expect(out.data[(3 * 40 + ((x + 10) % 40)) * 4]).toBe(img.data[(3 * 40 + x) * 4]);
  });
  it('handles 1x1 and fully transparent images', () => {
    const one = rgba8(1, 1, [9, 8, 7, 255]);
    for (const op of [pinch, twirl, ripple, wave, polarCoordinates, glass]) expect(run(op, one).data[3]).toBe(255);
    const clear = rgba8(12, 12);
    expect(run(twirl, clear, { angle: 90 }).data.every((v) => v === 0)).toBe(true);
  });
});
