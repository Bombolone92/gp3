import { describe, expect, it } from 'vitest';
import { filtersA } from '../src/imaging/filters/index-a';
import { flameField, frameCoords, growTree } from '../src/imaging/filters/render-procedural';
import { defaults, mask8, rgba8, type OperationContext, type ParamValues, type RGBA8 } from '../src/imaging/types';

const ctx: OperationContext = { foreground: [0, 0, 0], background: [255, 255, 255], seed: 11 };
const op = (id: string) => filtersA.find((f) => f.id === id)!;
const run = (id: string, src: RGBA8, params: ParamValues = {}, c = ctx) => op(id).apply(src, { ...defaults(op(id)), ...params }, c) as RGBA8;
const changed = (a: RGBA8, b: RGBA8) => {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i] || a.data[i + 3] !== b.data[i + 3]) n++;
  return n;
};

describe('procedural render filters', () => {
  for (const [id, params] of [
    ['flame', { length: 40, width: 14 }],
    ['picture-frame', { width: 10 }],
    ['tree', {}],
  ] as const) {
    it(`${id}: draws something, deterministically`, () => {
      const src = rgba8(80, 80, [40, 60, 80, 255]);
      const a = run(id, src, params), b = run(id, src, params);
      expect(changed(a, src)).toBeGreaterThan(50);
      expect(Array.from(a.data)).toEqual(Array.from(b.data));
    });
  }

  it('flame rises above its path and differs with the seed', () => {
    const f = flameField(60, 60, [[{ x: 0.3, y: 0.8 }, { x: 0.7, y: 0.8 }]], { length: 30, width: 10, turbulence: 0.4, jitter: 0.5, seed: 1 });
    let above = 0, below = 0;
    for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) (y < 48 ? (above += f[y * 60 + x]) : (below += f[y * 60 + x]));
    expect(above).toBeGreaterThan(below);
    expect(f[2 * 60 + 30]).toBe(0); // beyond the flame length
    const g = flameField(60, 60, [[{ x: 0.3, y: 0.8 }, { x: 0.7, y: 0.8 }]], { length: 30, width: 10, turbulence: 0.4, jitter: 0.5, seed: 2 });
    expect(Array.from(f)).not.toEqual(Array.from(g));
    const src = rgba8(60, 60);
    expect(run('flame', src, { length: 30, width: 12 }).data.some((v, i) => i % 4 === 3 && v > 0)).toBe(true); // works on transparency
  });

  it('picture frame covers the band only, in every design', () => {
    const src = rgba8(70, 50, [10, 200, 10, 255]);
    for (const style of ['beaded', 'braided', 'vine', 'bevel', 'scalloped']) {
      const out = run('picture-frame', src, { style, width: 8, margin: 2 });
      const px = (x: number, y: number) => Array.from(out.data.slice((y * 70 + x) * 4, (y * 70 + x) * 4 + 4));
      expect(px(0, 0)).toEqual([10, 200, 10, 255]); // margin
      expect(px(35, 25)).toEqual([10, 200, 10, 255]); // picture
      expect(px(35, 3)).not.toEqual([10, 200, 10, 255]); // frame
    }
    expect(frameCoords(5, 20, 100, 100, 0, 10)).toMatchObject({ side: 3, u: 0.5 });
    expect(frameCoords(50, 50, 100, 100, 0, 10)).toBeNull();
  });

  it('tree grows upward from its base with more branches at higher depth', () => {
    const t = (depth: number) => growTree({ baseX: 50, baseY: 95, height: 80, angle: 0.5, depth, thickness: 4, leaves: 0.5, leafSize: 3, bend: 0, seed: 3 });
    const small = t(3), big = t(6);
    expect(big.branches.length).toBeGreaterThan(small.branches.length * 2);
    const ys = big.branches.flat().map((p) => p[1]);
    expect(Math.min(...ys)).toBeLessThan(60);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
    expect(big.leaves.length).toBeGreaterThan(0);
    const grown = (bend: number) => growTree({ baseX: 50, baseY: 95, height: 80, angle: 0.5, depth: 6, thickness: 4, leaves: 0, leafSize: 3, bend, seed: 3 });
    const windy = grown(1);
    const meanX = (s: typeof big) => s.branches.flat().reduce((a, p) => a + p[0], 0) / s.branches.flat().length;
    expect(meanX(windy)).toBeGreaterThan(meanX(grown(0)) + 2);
    expect(meanX(grown(-1))).toBeLessThan(meanX(grown(0)) - 2);
    expect(windy.leaves.length).toBe(0);
  });

  it('respects the selection', () => {
    const src = rgba8(40, 40, [90, 90, 90, 255]);
    const sel = mask8(40, 40);
    for (let i = 0; i < 800; i++) sel.data[i] = 255;
    for (const id of ['flame', 'picture-frame', 'tree']) {
      const out = run(id, src, {}, { ...ctx, selection: sel });
      for (let i = 800 * 4; i < out.data.length; i++) expect(out.data[i]).toBe(src.data[i]);
    }
  });
});
