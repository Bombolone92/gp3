import { describe, it, expect } from 'vitest';
import { FILTERS, FILTER, CATEGORIES, runStack, newLayer, cleanLayer, stackGrow, stackReach, stackLabel } from '../src/features/pxfx/catalog.js';
import { cleanParams } from '../src/features/pxfx/params.js';
import { createImg, fromRGBA, toRGBA, gauss, kuwahara, cells, hash2 } from '../src/features/pxfx/img.js';
import { sampleImage } from '../src/features/pxfx/sample.js';
import { MENUS } from '../src/ui/menus.js';
import '../src/features/pxfx/effect-types.js';
import { normalizeEffect, createEffect, effectLabel } from '../src/features/paint/effects-model.js';

/** A colorful test picture with a transparent margin. */
function picture(w = 64, h = 48, margin = 6) {
  const img = sampleImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < margin || y < margin || x >= w - margin || y >= h - margin) img.a[y * w + x] = 0;
  return img;
}

const ctxFor = (img, extra = {}) => ({ k: 1, ox: 0, oy: 0, seed: 42, bounds: { x: 0, y: 0, w: img.w, h: img.h }, ...extra });
const same = (a, b) => ['r', 'g', 'b', 'a'].every((c) => a[c].length === b[c].length && a[c].every((v, i) => v === b[c][i]));
const window_ = (img, x0, y0, w, h) => {
  const out = createImg(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (const c of ['r', 'g', 'b', 'a']) out[c][y * w + x] = img[c][(y + y0) * img.w + x + x0];
  return out;
};

describe('pixel filter catalog', () => {
  it('has a filter for every planned Effect menu entry, each in a known category', () => {
    const effect = MENUS.find((m) => m.label === 'Effect');
    const ids = JSON.stringify(effect).match(/effect\.px\.\w+/g);
    expect(ids.length).toBe(38);
    for (const id of ids) expect(FILTER.has(id.slice('effect.px.'.length)), id).toBe(true);
    expect(FILTERS).toHaveLength(ids.length);
    const cats = new Set(CATEGORIES.map((c) => c.id));
    for (const f of FILTERS) {
      expect(cats.has(f.category), f.id).toBe(true);
      expect(f.params.every((p) => p.key && p.label), f.id).toBe(true);
    }
  });

  it('cleans parameters: defaults, clamping, rounding, unknown choices', () => {
    const f = FILTER.get('paintDaubs');
    expect(cleanParams(f, {})).toEqual({ size: 8, sharpness: 7, brush: 'simple' });
    expect(cleanParams(f, { size: 999, sharpness: -4, brush: 'nope', extra: 1 })).toEqual({ size: 50, sharpness: 0, brush: 'simple' });
    expect(cleanParams(f, { size: 3.6 }).size).toBe(4);
    expect(cleanParams(FILTER.get('smartBlur'), { radius: 2.55 }).radius).toBe(2.55);
    expect(cleanParams(FILTER.get('neonGlow'), { color: '#ABCDEF' }).color).toBe('#abcdef');
    expect(cleanParams(FILTER.get('neonGlow'), { color: 'red' }).color).toBe('#3d8cff');
    expect(cleanLayer({ filter: 'nope' })).toBeNull();
    expect(cleanLayer({ filter: 'grain', hidden: true, intensity: 10 })).toEqual({ filter: 'grain', hidden: true, intensity: 10, contrast: 50, type: 'regular' });
  });
});

describe('pixel filters', () => {
  const img = picture();

  it.each(FILTERS.map((f) => [f.id]))('%s is deterministic and keeps size and value ranges', (id) => {
    const a = runStack(img, [newLayer(id)], ctxFor(img));
    const b = runStack(img, [newLayer(id)], ctxFor(img));
    expect(a.w).toBe(img.w);
    expect(a.h).toBe(img.h);
    expect(same(a, b)).toBe(true);
    for (const c of ['r', 'g', 'b', 'a']) for (const v of a[c]) expect(v >= 0 && v <= 1 && Number.isFinite(v)).toBe(true);
    // It changes the picture (with default settings, on a picture with detail).
    expect(same(a, img)).toBe(false);
  });

  it.each(FILTERS.map((f) => [f.id]))('%s handles tiny and empty images', (id) => {
    for (const [w, h] of [[1, 1], [3, 2], [2, 7]]) {
      const tiny = picture(w, h, 0);
      const out = runStack(tiny, [newLayer(id)], ctxFor(tiny));
      expect([out.w, out.h]).toEqual([w, h]);
      for (const c of ['r', 'g', 'b', 'a']) for (const v of out[c]) expect(Number.isFinite(v)).toBe(true);
    }
    const clear = createImg(8, 8);
    const out = runStack(clear, [newLayer(id)], ctxFor(clear));
    for (const c of ['r', 'g', 'b', 'a']) for (const v of out[c]) expect(Number.isFinite(v)).toBe(true);
  });

  it('patterns are anchored to the document, not to the visible part', () => {
    // A window of a bigger picture, placed with ox/oy, gets the same pixels as
    // the bigger picture away from the window's edges.
    const big = picture(96, 72, 0);
    for (const id of ['crystallize', 'grain', 'mosaicTiles', 'texturizer', 'filmGrain', 'mezzotint', 'colorHalftone', 'stainedGlass']) {
      const full = runStack(big, [newLayer(id)], ctxFor(big, { bounds: null }));
      const part = window_(big, 20, 16, 56, 40);
      const got = runStack(part, [newLayer(id)], ctxFor(part, { ox: 20, oy: 16, bounds: null }));
      const reach = Math.ceil(stackReach([newLayer(id)])) + 1;
      let diff = 0;
      for (let y = reach; y < 40 - reach; y++) {
        for (let x = reach; x < 56 - reach; x++) {
          const i = y * 56 + x;
          const j = (y + 16) * 96 + x + 20;
          diff = Math.max(diff, Math.abs(got.r[i] - full.r[j]), Math.abs(got.a[i] - full.a[j]));
        }
      }
      expect(diff, id).toBeLessThan(0.02);
    }
  });

  it('keeps sizes in document units at any resolution', () => {
    // Crystallize cells of 10 pt are 10 px at 1 px/pt and 20 px at 2 px/pt.
    const c1 = cells(createImg(40, 40), { k: 1, ox: 0, oy: 0 }, 10);
    const c2 = cells(createImg(80, 80), { k: 2, ox: 0, oy: 0 }, 10);
    expect(c1.size).toBe(10);
    expect(c2.size).toBe(20);
    expect(c2.sx[5] / 2).toBeCloseTo(c1.sx[5], 6);
  });

  it('uses the seed for its randomness', () => {
    const a = runStack(img, [newLayer('filmGrain', { grain: 15 })], ctxFor(img, { seed: 1 }));
    const b = runStack(img, [newLayer('filmGrain', { grain: 15 })], ctxFor(img, { seed: 2 }));
    expect(same(a, b)).toBe(false);
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
    expect(hash2(3, 4, 5)).not.toBe(hash2(4, 3, 5));
  });

  it('keeps transparency where a filter does not move pixels', () => {
    const out = runStack(img, [newLayer('posterEdges')], ctxFor(img));
    expect(out.a).toEqual(img.a);
    // Spatter moves pixels (and their alpha).
    const sp = runStack(img, [newLayer('spatter', { radius: 8 })], ctxFor(img));
    expect(sp.a).not.toEqual(img.a);
  });
});

describe('filter stacks', () => {
  const img = picture();

  it('apply in order, skip hidden layers and seed each filter on its own', () => {
    const a = newLayer('crystallize', { size: 6 });
    const b = newLayer('glowingEdges');
    const ab = runStack(img, [a, b], ctxFor(img));
    const ba = runStack(img, [b, a], ctxFor(img));
    expect(same(ab, ba)).toBe(false);
    const hidden = runStack(img, [a, { ...b, hidden: true }], ctxFor(img));
    expect(same(hidden, runStack(img, [a], ctxFor(img)))).toBe(true);
    // Moving a filter in the stack keeps its own randomness.
    const g = newLayer('grain');
    const one = runStack(img, [g], ctxFor(img));
    const two = runStack(img, [{ ...newLayer('cutout'), hidden: true }, g], ctxFor(img));
    expect(same(one, two)).toBe(true);
    expect(runStack(img, [], ctxFor(img))).toBe(img);
  });

  it('report how far they paint and read past the object', () => {
    expect(stackGrow([newLayer('grain')])).toBe(0);
    expect(stackGrow([newLayer('spatter', { radius: 10 })])).toBe(5);
    expect(stackGrow([newLayer('spatter', { radius: 10 }), newLayer('oceanRipple', { magnitude: 10 })])).toBeCloseTo(8.5, 6);
    expect(stackGrow([{ ...newLayer('spatter', { radius: 10 }), hidden: true }])).toBe(0);
    const b = { x: 0, y: 0, w: 100, h: 60 };
    expect(stackGrow([newLayer('radialBlur', { method: 'zoom', amount: 50 })], b)).toBeGreaterThan(10);
    // Reach covers what a filter reads (1.5 cells) and where it paints (1 cell).
    expect(stackReach([newLayer('crystallize', { size: 20 })])).toBe(50);
    expect(stackLabel([newLayer('grain')])).toBe('Grain');
    expect(stackLabel([newLayer('grain'), newLayer('cutout')])).toBe('Effect Gallery');
  });

  it('are stored as clean gallery records', () => {
    const e = createEffect('gallery', { stack: [{ filter: 'grain', intensity: 500 }, { filter: 'bogus' }, null] });
    expect(e.type).toBe('gallery');
    expect(e.seed).toBeGreaterThan(0);
    expect(e.stack).toEqual([{ filter: 'grain', intensity: 100, contrast: 50, type: 'regular' }]);
    expect(normalizeEffect({ type: 'gallery', stack: 'x', seed: 3.4 })).toEqual({ type: 'gallery', stack: [], seed: 3 });
    expect(effectLabel(e)).toBe('Grain');
    expect(effectLabel(normalizeEffect({ type: 'svgFilter', name: 'Soft Shadow', markup: '<filter/>' }))).toBe('SVG Filter: Soft Shadow');
  });
});

describe('image helpers', () => {
  it('round-trips RGBA bytes and fills transparent colors from their neighbors', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      const opaque = i % 4 < 2;
      data.set(opaque ? [200, 40, 10, 255] : [0, 0, 0, 0], i * 4);
    }
    const img = fromRGBA(data, 4, 4);
    // Transparent pixels take the nearby red instead of black.
    expect(img.r[3]).toBeGreaterThan(0.5);
    expect(img.a[3]).toBe(0);
    const back = toRGBA(img);
    expect([...back.slice(0, 4)]).toEqual([200, 40, 10, 255]);
  });

  it('blurs symmetrically and keeps the total', () => {
    const p = new Float32Array(31 * 31);
    p[15 * 31 + 15] = 1;
    const b = gauss(p, 31, 31, 3);
    expect(b[15 * 31 + 12]).toBeCloseTo(b[15 * 31 + 18], 6);
    expect(b[12 * 31 + 15]).toBeCloseTo(b[18 * 31 + 15], 6);
    expect(b.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 4);
    const onlyX = gauss(p, 31, 31, 3, 0);
    expect(onlyX[14 * 31 + 15]).toBe(0);
  });

  it('kuwahara flattens noise but keeps a hard edge', () => {
    const img = createImg(20, 10);
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 20; x++) {
        const v = (x < 10 ? 0.2 : 0.8) + (hash2(x, y) - 0.5) * 0.1;
        const i = y * 20 + x;
        img.r[i] = img.g[i] = img.b[i] = v;
        img.a[i] = 1;
      }
    }
    const out = kuwahara(img, 2);
    expect(out.r[5 * 20 + 8]).toBeLessThan(0.3);
    expect(out.r[5 * 20 + 11]).toBeGreaterThan(0.7);
  });
});
