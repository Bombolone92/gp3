import { describe, expect, it } from 'vitest';
import { mask8, rgba8, type RGBA8 } from '../src/imaging/types';
import { LiquifyField, type LiquifyTool } from '../src/imaging/filters/liquify';

function img(w: number, h: number): RGBA8 {
  const out = rgba8(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      out.data.set([(x * 7) & 255, (y * 5) & 255, ((x * y) >> 2) & 255, 255], (y * w + x) * 4);
  return out;
}
const same = (a: RGBA8, b: RGBA8) => {
  let m = 0;
  for (let i = 0; i < a.data.length; i++) m = Math.max(m, Math.abs(a.data[i] - b.data[i]));
  return m;
};
const tools: LiquifyTool[] = [
  'forward-warp',
  'twirl-cw',
  'twirl-ccw',
  'pucker',
  'bloat',
  'push-left',
  'smooth',
  'reconstruct',
];

describe('liquify field', () => {
  it('a fresh field renders the source exactly', () => {
    const src = img(50, 37);
    const f = new LiquifyField(50, 37, 4);
    expect(f.isIdentity()).toBe(true);
    expect(same(f.render(src), src)).toBe(0);
    const part = f.render(src, { x: 10, y: 5, width: 20, height: 9 });
    expect(Array.from(part.data.slice(0, 4))).toEqual(
      Array.from(src.data.slice((5 * 50 + 10) * 4, (5 * 50 + 10) * 4 + 4)),
    );
  });
  it('every deforming tool changes the image and reconstruct(1) restores it', () => {
    const src = img(64, 64);
    for (const tool of tools.slice(0, 6)) {
      const f = new LiquifyField(64, 64, 2);
      for (let k = 0; k < 10; k++) f.applyBrush(tool, 32 + k, 32, 1, 0.5, 30, 1, 50, 80);
      expect(same(f.render(src), src), tool).toBeGreaterThan(10);
      f.reconstruct(1);
      expect(f.isIdentity()).toBe(true);
      expect(same(f.render(src), src)).toBe(0);
    }
  });
  it('forward warp moves content along the drag', () => {
    const src = rgba8(60, 20, [0, 0, 0, 255]);
    for (let y = 0; y < 20; y++) src.data.set([255, 255, 255, 255], (y * 60 + 30) * 4);
    const f = new LiquifyField(60, 20, 2);
    for (let k = 0; k < 5; k++) f.applyBrush('forward-warp', 30 + k, 10, 1, 0, 30, 1, 100, 80);
    const out = f.render(src);
    let best = 0,
      bx = 0;
    for (let x = 0; x < 60; x++) {
      const v = out.data[(10 * 60 + x) * 4];
      if (v > best) ((best = v), (bx = x));
    }
    expect(bx).toBeGreaterThan(32);
  });
  it('reconstruct brush and partial reconstruct shrink displacement', () => {
    const f = new LiquifyField(40, 40, 4);
    f.applyBrush('bloat', 20, 20, 0, 0, 30, 1, 50, 100);
    const before = f.displacementAt(14, 20)[0];
    expect(Math.abs(before)).toBeGreaterThan(0.01);
    const g = f.clone();
    g.reconstruct(0.5);
    expect(g.displacementAt(14, 20)[0]).toBeCloseTo(before * 0.5, 5);
    f.applyBrush('reconstruct', 20, 20, 0, 0, 40, 1, 100, 100);
    expect(Math.abs(f.displacementAt(14, 20)[0])).toBeLessThan(Math.abs(before));
    // Region limited reconstruct leaves the outside alone.
    const h = g.clone();
    h.reconstruct(1, { x: 0, y: 0, width: 10, height: 40 });
    expect(h.displacementAt(14, 20)[0]).toBeCloseTo(g.displacementAt(14, 20)[0], 6);
  });
  it('frozen areas do not move', () => {
    const freeze = mask8(40, 40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 20; x++) freeze.data[y * 40 + x] = 255;
    const f = new LiquifyField(40, 40, 2);
    f.applyBrush('twirl-cw', 20, 20, 0, 0, 30, 1, 50, 100, freeze);
    expect(f.displacementAt(10, 20)[0]).toBe(0);
    expect(f.displacementAt(10, 20)[1]).toBe(0);
    expect(Math.hypot(...f.displacementAt(28, 20))).toBeGreaterThan(0);
  });
  it('serializes losslessly and is deterministic', () => {
    const a = new LiquifyField(33, 21, 3),
      b = new LiquifyField(33, 21, 3);
    for (const f of [a, b]) {
      f.applyBrush('forward-warp', 10, 10, 3, 1, 12);
      f.applyBrush('pucker', 20, 12, 0, 0, 16);
    }
    expect(Array.from(a.dx)).toEqual(Array.from(b.dx));
    const c = LiquifyField.deserialize(a.serialize());
    expect([c.width, c.height, c.cellSize]).toEqual([33, 21, 3]);
    expect(Array.from(c.dx)).toEqual(Array.from(a.dx));
    expect(Array.from(c.dy)).toEqual(Array.from(a.dy));
    expect(() => LiquifyField.deserialize(new Uint8Array(32))).toThrow();
  });
  it('returns the dirty rectangle of a dab', () => {
    const f = new LiquifyField(100, 100, 4);
    const r = f.applyBrush('bloat', 50, 50, 0, 0, 20)!;
    expect(r.x).toBeLessThanOrEqual(40);
    expect(r.x + r.width).toBeGreaterThanOrEqual(60);
    expect(f.applyBrush('forward-warp', 50, 50, 0, 0, 20)).toBeNull();
  });
  it('works on 1x1 images', () => {
    const f = new LiquifyField(1, 1);
    f.applyBrush('bloat', 0.5, 0.5, 0, 0, 4);
    expect(Array.from(f.render(rgba8(1, 1, [1, 2, 3, 255])).data)).toEqual([1, 2, 3, 255]);
  });
});
