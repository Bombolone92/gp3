import { describe, expect, it } from 'vitest';
import { mask8, rgba8 } from '../src/imaging/types';
import {
  boundingBox, contract, edtSquared, expand, feather, grow, intersect, invert, maskToOutline, polygonArea,
  rasterizeEllipse, rasterizePolygon, rasterizeRect, similar, smooth, subtract, union, border,
} from '../src/imaging/segment/mask-ops';
import { rng } from '../src/imaging/segment/filters';

function randomMask(w: number, h: number, density: number, seed: number) {
  const r = rng(seed), m = mask8(w, h);
  for (let i = 0; i < m.data.length; i++) m.data[i] = r() < density ? 255 : 0;
  return m;
}

describe('mask algebra', () => {
  it('union, subtract, intersect and invert follow coverage arithmetic', () => {
    const a = mask8(3, 1), b = mask8(3, 1);
    a.data.set([255, 128, 0]);
    b.data.set([255, 255, 64]);
    expect([...union(a, b).data]).toEqual([255, 255, 64]);
    expect([...subtract(a, b).data]).toEqual([0, 0, 0]);
    expect([...intersect(a, b).data]).toEqual([255, 128, 0]);
    expect([...invert(a).data]).toEqual([0, 127, 255]);
    expect(() => union(a, mask8(2, 1))).toThrow();
  });
  it('bounding box ignores pixels under the threshold', () => {
    const m = mask8(10, 8);
    m.data[2 * 10 + 3] = 255;
    m.data[5 * 10 + 7] = 10;
    expect(boundingBox(m)).toEqual({ x: 3, y: 2, width: 5, height: 4 });
    expect(boundingBox(m, 128)).toEqual({ x: 3, y: 2, width: 1, height: 1 });
    expect(boundingBox(mask8(4, 4))).toBeNull();
  });
});

describe('distance transform morphology', () => {
  it('EDT equals brute force on random masks of odd size', () => {
    const w = 37, h = 23, m = randomMask(w, h, 0.03, 7);
    const feat = new Uint8Array(w * h);
    for (let i = 0; i < feat.length; i++) feat[i] = m.data[i] ? 1 : 0;
    const d = edtSquared(feat, w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let best = Infinity;
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (feat[j * w + i]) best = Math.min(best, (i - x) ** 2 + (j - y) ** 2);
        expect(d[y * w + x]).toBe(best);
      }
  });
  it('expand and contract match brute-force Euclidean disks exactly', () => {
    const w = 41, h = 29, m = randomMask(w, h, 0.4, 3);
    for (const r of [1, 2.5, 4]) {
      const ex = expand(m, r, { antiAlias: false }), co = contract(m, r, { antiAlias: false });
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let nearSel = Infinity, nearUnsel = Infinity;
          for (let j = 0; j < h; j++)
            for (let i = 0; i < w; i++) {
              const d = Math.hypot(i - x, j - y);
              if (m.data[j * w + i]) nearSel = Math.min(nearSel, d);
              else nearUnsel = Math.min(nearUnsel, d);
            }
          expect(ex.data[y * w + x]).toBe(nearSel <= r ? 255 : 0);
          expect(co.data[y * w + x]).toBe(nearUnsel > r ? 255 : 0);
        }
    }
  });
  it('contract is the complement of expanding the complement', () => {
    const m = randomMask(30, 30, 0.5, 11);
    expect([...contract(m, 3).data]).toEqual([...invert(expand(invert(m), 3)).data]);
  });
  it('anti-aliased expand ramps over one pixel and keeps soft input coverage', () => {
    const m = mask8(20, 1);
    m.data[10] = 255;
    m.data[0] = 100;
    const e = expand(m, 2);
    expect(e.data[12]).toBe(255);
    expect(e.data[13]).toBe(0);
    expect(e.data[0]).toBe(100);
    const half = expand(m, 2.5);
    expect(half.data[13]).toBe(128);
  });
});

describe('feather and smoothing', () => {
  it('feather is mirror symmetric and preserves total coverage away from borders', () => {
    const m = rasterizeRect(20, 25, 21, 11, 61, 61, { antiAlias: false });
    const f = feather(m, 6);
    for (let y = 0; y < 61; y++)
      for (let x = 0; x < 61; x++) {
        expect(f.data[y * 61 + x]).toBe(f.data[y * 61 + (60 - x)]);
        expect(f.data[y * 61 + x]).toBe(f.data[(60 - y) * 61 + x]);
      }
    const sum = (a: Uint8Array) => a.reduce((s, v) => s + v, 0);
    expect(Math.abs(sum(f.data) - sum(m.data)) / sum(m.data)).toBeLessThan(0.01);
    expect(f.data[30 * 61 + 30]).toBeGreaterThan(200);
    expect(f.data[30 * 61 + 5]).toBe(0);
  });
  it('smooth removes isolated specks and fills pinholes', () => {
    const m = rasterizeRect(5, 5, 20, 20, 30, 30, { antiAlias: false });
    m.data[12 * 30 + 12] = 0;
    m.data[2 * 30 + 2] = 255;
    const s = smooth(m, 2);
    expect(s.data[12 * 30 + 12]).toBe(255);
    expect(s.data[2 * 30 + 2]).toBe(0);
  });
  it('border selects a band around the edge but not the interior', () => {
    const m = rasterizeRect(10, 10, 30, 30, 50, 50, { antiAlias: false });
    const b = border(m, 6);
    expect(b.data[25 * 50 + 10]).toBeGreaterThan(200);
    expect(b.data[25 * 50 + 25]).toBe(0);
    expect(b.data[25 * 50 + 1]).toBe(0);
  });
});

describe('grow and similar', () => {
  it('grow follows connected similar colors only; similar reaches disconnected ones', () => {
    const img = rgba8(9, 3, [200, 0, 0, 255]);
    for (let y = 0; y < 3; y++) img.data.set([0, 0, 255, 255], (y * 9 + 4) * 4);
    const seed = mask8(9, 3);
    seed.data[0] = 255;
    const g = grow(img, seed, 10);
    expect(g.data[3]).toBe(255);
    expect(g.data[4]).toBe(0);
    expect(g.data[6]).toBe(0);
    const s = similar(img, seed, 10);
    expect(s.data[6]).toBe(255);
    expect(s.data[4]).toBe(0);
  });
});

describe('outlines', () => {
  it('outline of an anti-aliased disk has the disk area and clockwise winding', () => {
    const m = rasterizeEllipse(50.3, 49.7, 30, 30, 100, 100);
    const polys = maskToOutline(m);
    expect(polys.length).toBe(1);
    const area = polygonArea(polys[0]);
    expect(area).toBeGreaterThan(0);
    expect(Math.abs(area - Math.PI * 900) / (Math.PI * 900)).toBeLessThan(0.005);
    for (const [x, y] of polys[0]) expect(Math.abs(Math.hypot(x - 50.3, y - 49.7) - 30)).toBeLessThan(0.6);
  });
  it('holes wind the opposite way and touching the canvas edge still closes', () => {
    const outer = rasterizeRect(0, 0, 20, 20, 20, 20, { antiAlias: false });
    const hole = rasterizeRect(5, 5, 6, 6, 20, 20, { antiAlias: false });
    const polys = maskToOutline(subtract(outer, hole));
    expect(polys.length).toBe(2);
    const areas = polys.map(polygonArea).sort((a, b) => a - b);
    // Hard corners are chamfered by marching squares: 1/8 px lost per corner.
    expect(areas[0]).toBeCloseTo(-35.5, 5);
    expect(areas[1]).toBeCloseTo(399.5, 5);
  });
  it('a single pixel and an empty mask', () => {
    const m = mask8(1, 1, 255);
    const p = maskToOutline(m);
    expect(p.length).toBe(1);
    expect(polygonArea(p[0])).toBeGreaterThan(0.4);
    expect(maskToOutline(mask8(3, 3))).toEqual([]);
  });
  it('outline then rasterize round-trips a hard shape', () => {
    const m = rasterizePolygon([[3, 4], [40, 8], [30, 35], [8, 28]], 48, 40, false);
    const back = rasterizePolygon(maskToOutline(m), 48, 40, false);
    let diff = 0;
    for (let i = 0; i < m.data.length; i++) if (m.data[i] !== back.data[i]) diff++;
    expect(diff).toBe(0);
  });
});

describe('rasterization', () => {
  it('polygon coverage is exact for an axis-aligned square at fractional offsets', () => {
    const m = rasterizePolygon([[1.5, 1.25], [4.5, 1.25], [4.5, 3.75], [1.5, 3.75]], 6, 5);
    expect(m.data[1 * 6 + 1]).toBe(Math.round(255 * 0.5 * 0.75));
    expect(m.data[2 * 6 + 2]).toBe(255);
    expect(m.data[3 * 6 + 4]).toBe(Math.round(255 * 0.5 * 0.75));
    const total = m.data.reduce((s, v) => s + v, 0) / 255;
    expect(total).toBeCloseTo(3 * 2.5, 1);
  });
  it('clips shapes that extend past every edge without losing coverage inside', () => {
    const m = rasterizePolygon([[-10, -10], [30, -5], [25, 30], [-5, 25]], 10, 10);
    expect([...m.data].every((v) => v === 255)).toBe(true);
    const tri = rasterizePolygon([[-5, 0], [15, 0], [-5, 20]], 10, 10);
    const area = tri.data.reduce((s, v) => s + v, 0) / 255;
    // Inside the canvas the triangle is everything with x + y <= 15: 100 - 12.5.
    expect(area).toBeCloseTo(87.5, 1);
  });
  it('even-odd versus nonzero for a doubly wound contour', () => {
    const sq = (x: number, y: number, s: number): [number, number][] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
    const nz = rasterizePolygon([sq(0, 0, 10), sq(3, 3, 4)], 10, 10, { fillRule: 'nonzero' });
    const eo = rasterizePolygon([sq(0, 0, 10), sq(3, 3, 4)], 10, 10, { fillRule: 'evenodd' });
    expect(nz.data[5 * 10 + 5]).toBe(255);
    expect(eo.data[5 * 10 + 5]).toBe(0);
    expect(eo.data[1 * 10 + 1]).toBe(255);
  });
  it('ellipse area and rect feather', () => {
    const e = rasterizeEllipse(32, 32, 20, 10, 64, 64, { angle: 0.4 });
    expect(e.data.reduce((s, v) => s + v, 0) / 255).toBeCloseTo(Math.PI * 200, -1);
    const hard = rasterizeEllipse(5, 5, 3, 3, 10, 10, { antiAlias: false });
    expect([...hard.data].every((v) => v === 0 || v === 255)).toBe(true);
    const r = rasterizeRect(2.5, 0, 3, 1, 8, 1);
    expect([...r.data]).toEqual([0, 0, 128, 255, 255, 128, 0, 0]);
    const f = rasterizeRect(10, 10, 20, 20, 40, 40, { feather: 4 });
    expect(f.data[20 * 40 + 10]).toBeGreaterThan(90);
    expect(f.data[20 * 40 + 10]).toBeLessThan(165);
  });
});
