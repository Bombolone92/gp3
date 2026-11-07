import { describe, expect, it } from 'vitest';
import { filtersA } from '../src/imaging/filters/index-a';
import { applySelection } from '../src/imaging/filters/common';
import { CancelledError, defaults, mask8, rgba8, type ImageOperation, type OperationContext, type ParamValues, type RGBA8 } from '../src/imaging/types';

const ctx: OperationContext = { foreground: [20, 30, 40], background: [240, 230, 220], seed: 42 };
const op = (id: string) => {
  const o = filtersA.find((f) => f.id === id);
  if (!o) throw new Error(id);
  return o;
};
const run = (o: ImageOperation, src: RGBA8, params: ParamValues = {}, c: OperationContext = ctx) =>
  o.apply(src, { ...defaults(o), ...params }, c) as RGBA8;

function random(w: number, h: number, seed: number, opaque = true): RGBA8 {
  const d = new Uint8ClampedArray(w * h * 4);
  let s = seed >>> 0;
  for (let i = 0; i < d.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    d[i] = s >>> 24;
  }
  if (opaque) for (let j = 3; j < d.length; j += 4) d[j] = 255;
  else for (let j = 3; j < d.length; j += 16) d[j] = 0; // some fully transparent pixels
  return { width: w, height: h, data: d };
}
const px = (img: RGBA8, x: number, y: number) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

describe('filter set A registry', () => {
  it('has unique ids, labels, categories and valid defaults', () => {
    const ids = filtersA.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of filtersA) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(['Blur', 'Blur Gallery', 'Sharpen', 'Noise', 'Stylize', 'Render', 'Video', 'Other']).toContain(f.category);
      if (f.immediate) expect(f.params).toEqual([]);
      for (const p of f.params) if (p.type === 'number') expect(p.default >= p.min && p.default <= p.max).toBe(true);
    }
  });

  for (const f of filtersA) {
    it(`${f.id}: returns a new same-size buffer, leaves the source alone and is deterministic`, async () => {
      const src = random(23, 17, 5, false), before = Array.from(src.data);
      const a = await f.apply(src, defaults(f), ctx), b = await f.apply(src, defaults(f), ctx);
      expect(a).not.toBe(src);
      expect(a.data).not.toBe(src.data);
      expect([a.width, a.height, a.data.length]).toEqual([23, 17, 23 * 17 * 4]);
      expect(Array.from(src.data)).toEqual(before);
      expect(Array.from(a.data)).toEqual(Array.from(b.data));
    });

    it(`${f.id}: unselected pixels are untouched`, async () => {
      const src = random(20, 12, 9, false);
      const sel = mask8(20, 12);
      for (let y = 0; y < 12; y++) for (let x = 10; x < 20; x++) sel.data[y * 20 + x] = 255;
      const out = await f.apply(src, defaults(f), { ...ctx, selection: sel });
      for (let y = 0; y < 12; y++) for (let x = 0; x < 10; x++) expect(px(out, x, y)).toEqual(px(src, x, y));
    });

    it(`${f.id}: survives 1x1, 2x1 and fully transparent images`, async () => {
      for (const src of [rgba8(1, 1, [10, 20, 30, 255]), rgba8(2, 1, [200, 100, 0, 128]), rgba8(7, 5)]) {
        const out = await f.apply(src, defaults(f), ctx);
        expect(out.data.length).toBe(src.data.length);
        expect(out.data.every((v) => Number.isFinite(v))).toBe(true);
      }
    });
  }

  it('processing only the grown selection bounds matches a full-image run', () => {
    const src = random(90, 70, 77, false);
    const sel = mask8(90, 70);
    for (let y = 30; y < 42; y++) for (let x = 40; x < 55; x++) sel.data[y * 90 + x] = y === 30 ? 100 : 255;
    const opaque = random(90, 70, 78);
    for (const [id, params, opaqueOnly] of [
      ['gaussian-blur', { radius: 3 }],
      ['gaussian-blur', { radius: 9 }],
      ['box-blur', { radius: 4 }],
      ['blur-more', {}],
      ['motion-blur', { distance: 12, angle: 20 }],
      ['unsharp-mask', { radius: 2, amount: 150 }],
      ['median', { radius: 3 }],
      ['dust-and-scratches', { radius: 2, threshold: 5 }],
      ['minimum', { radius: 3, preserve: 'round' }],
      ['maximum', { radius: 2 }],
      ['high-pass', { radius: 4 }],
      ['sharpen-more', {}],
      // These fill transparent colors from the whole visible image, so they
      // only match exactly on opaque input.
      ['custom', { k12: 2, k7: -1, scale: 1 }, true],
      ['emboss', {}, true],
      ['find-edges', {}, true],
    ] as const) {
      const o = op(id), img = opaqueOnly ? opaque : src;
      const full = run(o, img, params);
      applySelection(img, full, sel);
      const cropped = run(o, img, params, { ...ctx, selection: sel });
      expect([id, ...cropped.data]).toEqual([id, ...full.data]);
    }
    // An empty selection leaves everything unchanged.
    expect(Array.from(run(op('gaussian-blur'), src, {}, { ...ctx, selection: mask8(90, 70) }).data)).toEqual(Array.from(src.data));
  });

  it('cancellation aborts long filters', () => {
    const src = random(64, 64, 1);
    let calls = 0;
    expect(() => op('gaussian-blur').apply(src, { radius: 20 }, ctx, { cancelled: () => ++calls > 2 })).toThrow(CancelledError);
  });

  it('reports progress ending at 1', () => {
    const seen: number[] = [];
    run(op('median'), random(40, 40, 2), { radius: 2 }) && op('median').apply(random(40, 40, 2), { radius: 2 }, ctx, { report: (f) => seen.push(f) });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toBe(1);
    expect(seen.every((v) => v >= 0 && v <= 1)).toBe(true);
  });
});

describe('blur filters', () => {
  it('constant images stay constant', () => {
    const src = rgba8(31, 19, [70, 140, 210, 255]);
    for (const [id, params] of [
      ['gaussian-blur', { radius: 7 }],
      ['box-blur', { radius: 4 }],
      ['blur', {}],
      ['blur-more', {}],
      ['motion-blur', { angle: 33, distance: 25 }],
      ['radial-blur', { method: 'zoom', amount: 40 }],
      ['radial-blur', { method: 'spin', amount: 40 }],
      ['surface-blur', { radius: 6 }],
      ['edge-preserving-blur', {}],
      ['lens-blur', { radius: 6 }],
      ['tilt-shift', {}],
      ['iris-blur', {}],
    ] as const) {
      const out = run(op(id), src, params);
      for (let j = 0; j < out.data.length; j += 4) expect(Array.from(out.data.slice(j, j + 4))).toEqual([70, 140, 210, 255]);
    }
  });

  it('box blur matches a brute-force clamped box', () => {
    const src = random(15, 11, 3), r = 2;
    const out = run(op('box-blur'), src, { radius: r });
    const cl = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
    for (let y = 0; y < 11; y++)
      for (let x = 0; x < 15; x++)
        for (let c = 0; c < 3; c++) {
          let s = 0;
          for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) s += src.data[(cl(y + dy, 11) * 15 + cl(x + dx, 15)) * 4 + c];
          expect(Math.abs(out.data[(y * 15 + x) * 4 + c] - s / 25)).toBeLessThanOrEqual(0.51);
        }
  });

  it('horizontal motion blur leaves horizontal stripes alone', () => {
    const src = rgba8(30, 10);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 30; x++) src.data.set([y * 20, 255 - y * 20, 7, 255], (y * 30 + x) * 4);
    const out = run(op('motion-blur'), src, { angle: 0, distance: 40 });
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
  });

  it('red next to transparent stays red for the alpha-weighted blurs', () => {
    const src = rgba8(24, 24);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 12; x++) src.data.set([255, 0, 0, 255], (y * 24 + x) * 4);
    for (const [id, params] of [
      ['gaussian-blur', { radius: 4 }],
      ['box-blur', { radius: 3 }],
      ['motion-blur', { distance: 15 }],
      ['radial-blur', { method: 'spin', amount: 30 }],
      ['lens-blur', { radius: 5 }],
      ['surface-blur', { radius: 5, threshold: 50 }],
      ['iris-blur', { radius: 5, blur: 6 }],
      ['median', { radius: 3 }],
    ] as const) {
      const out = run(op(id), src, params);
      for (let j = 0; j < out.data.length; j += 4) {
        if (out.data[j + 3] < 3) continue;
        expect([id, out.data[j], out.data[j + 1], out.data[j + 2]]).toEqual([id, 255, 0, 0]);
      }
    }
  });

  it('preview scale multiplies radii', () => {
    const src = random(40, 30, 8);
    const a = run(op('gaussian-blur'), src, { radius: 4 }, { ...ctx, scale: 0.5 });
    const b = run(op('gaussian-blur'), src, { radius: 2 });
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it('tilt-shift and iris keep the focus area sharp and blur outside it', () => {
    const src = random(40, 40, 4);
    const t = run(op('tilt-shift'), src, { focus: 20, transition: 10, blur: 6 });
    for (let x = 0; x < 40; x++) expect(px(t, x, 20)).toEqual(px(src, x, 20));
    expect(px(t, 5, 0)).not.toEqual(px(src, 5, 0));
    const i = run(op('iris-blur'), src, { radius: 20, feather: 10, blur: 6 });
    expect(px(i, 20, 20)).toEqual(px(src, 20, 20));
    expect(px(i, 0, 0)).not.toEqual(px(src, 0, 0));
  });

  it('average fills the selection with its mean color', () => {
    const src = rgba8(4, 1);
    src.data.set([0, 0, 0, 255, 100, 50, 0, 255, 200, 100, 0, 255, 9, 9, 9, 255]);
    const sel = mask8(4, 1);
    sel.data.set([0, 255, 255, 0]);
    const out = run(op('average'), src, {}, { ...ctx, selection: sel });
    expect(Array.from(out.data)).toEqual([0, 0, 0, 255, 150, 75, 0, 255, 150, 75, 0, 255, 9, 9, 9, 255]);
  });

  it('lens blur highlight boost brightens around a bright spot', () => {
    const src = rgba8(21, 21, [40, 40, 40, 255]);
    src.data.set([255, 255, 255, 255], (10 * 21 + 10) * 4);
    const plain = run(op('lens-blur'), src, { radius: 4, brightness: 0 });
    const boosted = run(op('lens-blur'), src, { radius: 4, brightness: 100, threshold: 200 });
    expect(boosted.data[(10 * 21 + 12) * 4]).toBeGreaterThan(plain.data[(10 * 21 + 12) * 4] + 10);
  });
});

describe('sharpen filters', () => {
  it('unsharp mask with amount 0 or a high threshold is identity', () => {
    const src = random(20, 14, 6, false);
    expect(Array.from(run(op('unsharp-mask'), src, { amount: 0, radius: 3 }).data)).toEqual(Array.from(src.data));
    const smooth = rgba8(20, 14, [100, 100, 100, 255]);
    for (let i = 0; i < 20 * 14; i++) smooth.data[i * 4] = 100 + (i % 3);
    expect(Array.from(run(op('unsharp-mask'), smooth, { amount: 300, radius: 2, threshold: 10 }).data)).toEqual(Array.from(smooth.data));
    expect(Array.from(run(op('advanced-sharpen'), src, { amount: 0 }).data)).toEqual(Array.from(src.data));
  });

  it('unsharp mask increases contrast across an edge and keeps alpha', () => {
    const src = rgba8(20, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 20; x++) src.data.set(x < 10 ? [80, 80, 80, 200] : [160, 160, 160, 200], (y * 20 + x) * 4);
    const out = run(op('unsharp-mask'), src, { amount: 150, radius: 2 });
    expect(out.data[(1 * 20 + 9) * 4]).toBeLessThan(80);
    expect(out.data[(1 * 20 + 10) * 4]).toBeGreaterThan(160);
    for (let j = 3; j < out.data.length; j += 4) expect(out.data[j]).toBe(200);
  });

  it('sharpening does not create dark halos from transparent black', () => {
    const src = rgba8(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) src.data.set([200, 200, 200, 255], (y * 16 + x) * 4);
    for (const id of ['sharpen', 'sharpen-more', 'unsharp-mask', 'advanced-sharpen', 'sharpen-edges'])
      for (let y = 0; y < 16; y++) expect([id, ...px(run(op(id), src), 7, y)]).toEqual([id, 200, 200, 200, 255]);
  });
});

describe('noise filters', () => {
  it('add noise is seeded, zero-mean and leaves alpha', () => {
    const src = rgba8(64, 64, [128, 128, 128, 77]);
    const a = run(op('add-noise'), src, { amount: 20 });
    const b = run(op('add-noise'), src, { amount: 20 }, { ...ctx, seed: 43 });
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data));
    let sum = 0;
    for (let j = 0; j < a.data.length; j += 4) { sum += a.data[j] - 128; expect(a.data[j + 3]).toBe(77); }
    expect(Math.abs(sum / 4096)).toBeLessThan(1.5);
    const mono = run(op('add-noise'), src, { amount: 20, mono: true, distribution: 'uniform' });
    for (let j = 0; j < mono.data.length; j += 4) expect(mono.data[j]).toBe(mono.data[j + 1]);
  });

  it('dust & scratches and median remove an isolated speck', () => {
    const src = rgba8(9, 9, [50, 60, 70, 255]);
    src.data.set([255, 255, 255, 255], 40 * 4);
    expect(px(run(op('dust-and-scratches'), src, { radius: 1, threshold: 20 }), 4, 4)).toEqual([50, 60, 70, 255]);
    expect(px(run(op('median'), src, { radius: 1 }), 4, 4)).toEqual([50, 60, 70, 255]);
    // A threshold above the speck's contrast keeps it.
    expect(px(run(op('dust-and-scratches'), src, { radius: 1, threshold: 250 }), 4, 4)).toEqual([255, 255, 255, 255]);
  });

  it('reduce noise lowers variance on a noisy flat patch', () => {
    const src = rgba8(48, 48, [120, 120, 120, 255]);
    for (let i = 0; i < 48 * 48; i++) {
      const n = ((Math.imul(i + 7, 2654435761) >>> 24) % 21) - 10;
      src.data[i * 4] += n; src.data[i * 4 + 1] += n; src.data[i * 4 + 2] -= n;
    }
    const out = run(op('reduce-noise'), src, { strength: 8, preserve: 20, color: 80 });
    const variance = (img: RGBA8) => {
      let s = 0;
      for (let j = 0; j < img.data.length; j += 4) s += (img.data[j] - 120) ** 2 + (img.data[j + 2] - 120) ** 2;
      return s / (48 * 48);
    };
    expect(variance(out)).toBeLessThan(variance(src) * 0.35);
  });

  it('despeckle smooths flat noise but keeps a strong edge', () => {
    const src = rgba8(20, 10);
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 20; x++) src.data.set(x < 10 ? [40 + ((x + y) % 2) * 6, 40, 40, 255] : [220, 220, 220, 255], (y * 20 + x) * 4);
    const out = run(op('despeckle'), src);
    expect(Math.abs(out.data[(5 * 20 + 4) * 4] - 43)).toBeLessThanOrEqual(2);
    expect(px(out, 10, 5)).toEqual([220, 220, 220, 255]);
  });
});

describe('stylize filters', () => {
  it('known values on flat images', () => {
    const flat = rgba8(10, 8, [60, 200, 128, 255]);
    expect(px(run(op('solarize'), flat), 3, 3)).toEqual([60, 55, 127, 255]);
    expect(px(run(op('find-edges'), flat), 3, 3)).toEqual([255, 255, 255, 255]);
    expect(px(run(op('emboss'), flat), 3, 3)).toEqual([128, 128, 128, 255]);
    expect(px(run(op('trace-contour'), flat), 3, 3)).toEqual([255, 255, 255, 255]);
    expect(px(run(op('glowing-edges'), flat), 3, 3)).toEqual([0, 0, 0, 255]);
  });

  it('trace contour marks the lower side of a level crossing', () => {
    const src = rgba8(10, 3);
    for (let x = 0; x < 10; x++) for (let y = 0; y < 3; y++) src.data.set(x < 5 ? [50, 50, 50, 255] : [200, 200, 200, 255], (y * 10 + x) * 4);
    const out = run(op('trace-contour'), src, { level: 128, edge: 'lower' });
    expect(px(out, 4, 1)).toEqual([0, 0, 0, 255]);
    expect(px(out, 5, 1)).toEqual([255, 255, 255, 255]);
    expect(px(out, 2, 1)).toEqual([255, 255, 255, 255]);
  });

  it('diffuse only moves existing pixels around', () => {
    const src = random(16, 16, 11);
    const colors = new Set<string>();
    for (let j = 0; j < src.data.length; j += 4) colors.add(src.data.slice(j, j + 4).join());
    for (const mode of ['normal', 'darken', 'lighten', 'anisotropic']) {
      const out = run(op('diffuse'), src, { mode });
      for (let j = 0; j < out.data.length; j += 4) expect(colors.has(out.data.slice(j, j + 4).join())).toBe(true);
    }
  });

  it('tiles with unaltered fill and one tile per image keeps the content', () => {
    const src = random(12, 12, 13);
    const out = run(op('tiles'), src, { count: 1, offset: 1, fill: 'unaltered' });
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
  });

  it('oil paint flattens texture into patches', () => {
    const src = random(30, 30, 17);
    const out = run(op('oil-paint'), src, { bristle: 0, cleanliness: 0, stylization: 2 });
    let dSrc = 0, dOut = 0;
    for (let i = 0; i < 29 * 30; i++) {
      dSrc += Math.abs(src.data[i * 4] - src.data[i * 4 + 4]);
      dOut += Math.abs(out.data[i * 4] - out.data[i * 4 + 4]);
    }
    expect(dOut).toBeLessThan(dSrc * 0.5);
  });

  it('wind streaks a bright pixel in the wind direction only', () => {
    const src = rgba8(40, 1, [0, 0, 0, 255]);
    src.data.set([255, 255, 255, 255], 20 * 4);
    // Find a seed where the streak starts (starts are random).
    for (let seed = 0; seed < 20; seed++) {
      const out = run(op('wind'), src, { method: 'blast', direction: 'right' }, { ...ctx, seed });
      if (out.data[19 * 4] === 0) continue;
      expect(out.data[21 * 4]).toBe(0);
      expect(out.data[19 * 4]).toBeGreaterThan(100);
      return;
    }
    throw new Error('no streak');
  });

  it('extrude blocks with solid fronts produce block colors', () => {
    const src = rgba8(40, 40, [90, 90, 90, 255]);
    const out = run(op('extrude'), src, { size: 10, depth: 20, solid: true });
    const shades = new Set<number>();
    for (let j = 0; j < out.data.length; j += 4) shades.add(out.data[j]);
    expect(shades.has(90)).toBe(true);
    expect([...shades].every((v) => v <= 90)).toBe(true);
  });
});

describe('render filters', () => {
  it('clouds use only colors between foreground and background and depend on the seed', () => {
    const src = rgba8(32, 32);
    const a = run(op('clouds'), src);
    for (let j = 0; j < a.data.length; j += 4) {
      const t = (a.data[j] - 20) / 220;
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
      expect(Math.abs(a.data[j + 1] - (30 + 200 * t))).toBeLessThanOrEqual(1.5);
      expect(a.data[j + 3]).toBe(255);
    }
    expect(Array.from(run(op('clouds'), src, {}, { ...ctx, seed: 1 }).data)).not.toEqual(Array.from(a.data));
    const diff = run(op('difference-clouds'), rgba8(32, 32, [20, 30, 40, 255]));
    for (let j = 0; j < diff.data.length; j += 4) expect(Math.abs(diff.data[j] - (a.data[j] - 20))).toBeLessThanOrEqual(1);
  });

  it('lens flare only brightens and peaks at its center', () => {
    const src = random(40, 30, 21);
    const out = run(op('lens-flare'), src, { center: { x: 0.5, y: 0.5 } });
    for (let j = 0; j < out.data.length; j++) if ((j & 3) !== 3) expect(out.data[j]).toBeGreaterThanOrEqual(src.data[j]);
    for (const v of px(out, 20, 15)) expect(v).toBeGreaterThanOrEqual(250);
  });

  it('lighting with full ambience and no light is identity; light brightens near the source', () => {
    const src = random(20, 20, 23);
    const same = run(op('lighting-effects'), src, { intensity: 0, ambient: 100 });
    expect(Array.from(same.data)).toEqual(Array.from(src.data));
    const gray = rgba8(40, 40, [100, 100, 100, 255]);
    const lit = run(op('lighting-effects'), gray, { type: 'point', position: { x: 0.25, y: 0.25 }, ambient: 0, gloss: 0 });
    expect(px(lit, 10, 10)[0]).toBeGreaterThan(px(lit, 39, 39)[0]);
  });

  it('fibers are seeded and vertical', () => {
    const src = rgba8(30, 60);
    const a = run(op('fibers'), src, { seed: 3 });
    expect(Array.from(run(op('fibers'), src, { seed: 4 }).data)).not.toEqual(Array.from(a.data));
    let dx = 0, dy = 0;
    for (let y = 0; y < 59; y++)
      for (let x = 0; x < 29; x++) {
        dx += Math.abs(a.data[(y * 30 + x) * 4] - a.data[(y * 30 + x + 1) * 4]);
        dy += Math.abs(a.data[(y * 30 + x) * 4] - a.data[((y + 1) * 30 + x) * 4]);
      }
    expect(dx).toBeGreaterThan(dy * 2);
  });
});

describe('other filters', () => {
  it('offset wraps around and round-trips', () => {
    const src = random(13, 9, 29, false);
    const there = run(op('offset'), src, { horizontal: 5, vertical: -3, undefined: 'wrap' });
    expect(px(there, 5, 6)).toEqual(px(src, 0, 0));
    const back = run(op('offset'), there, { horizontal: -5, vertical: 3, undefined: 'wrap' });
    expect(Array.from(back.data)).toEqual(Array.from(src.data));
    const transparent = run(op('offset'), src, { horizontal: 2, vertical: 0, undefined: 'transparent' });
    expect(px(transparent, 1, 4)[3]).toBe(0);
    const repeat = run(op('offset'), src, { horizontal: 2, vertical: 0, undefined: 'repeat' });
    expect(px(repeat, 0, 4)).toEqual(px(src, 0, 4));
    const bg = run(op('offset'), src, { horizontal: 0, vertical: 2, undefined: 'background' });
    expect(px(bg, 3, 0)).toEqual([240, 230, 220, 255]);
  });

  it('high pass of a flat image is mid gray', () => {
    expect(px(run(op('high-pass'), rgba8(9, 9, [10, 250, 99, 255])), 4, 4)).toEqual([128, 128, 128, 255]);
  });

  it('minimum and maximum spread dark and light', () => {
    const src = rgba8(9, 9, [100, 100, 100, 255]);
    src.data.set([0, 0, 0, 255], 40 * 4);
    const min = run(op('minimum'), src, { radius: 2, preserve: 'round' });
    expect(px(min, 4, 2)).toEqual([0, 0, 0, 255]);
    expect(px(min, 2, 2)).toEqual([100, 100, 100, 255]);
    const sq = run(op('minimum'), src, { radius: 2, preserve: 'square' });
    expect(px(sq, 2, 2)).toEqual([0, 0, 0, 255]);
    expect(px(run(op('maximum'), src, { radius: 1 }), 4, 4)).toEqual([100, 100, 100, 255]);
  });

  it('custom kernel: identity, shift, scale and offset', () => {
    const src = random(11, 7, 31);
    expect(Array.from(run(op('custom'), src).data)).toEqual(Array.from(src.data));
    // k13 is row 3, column 4: each pixel takes its right neighbor.
    const shifted = run(op('custom'), src, { k12: 0, k13: 2, scale: 2, offset: 0 });
    expect(px(shifted, 3, 3)).toEqual(px(src, 4, 3));
    const off = run(op('custom'), rgba8(4, 4, [10, 10, 10, 255]), { offset: 5 });
    expect(px(off, 1, 1)).toEqual([15, 15, 15, 255]);
  });
});
