import { describe, expect, it } from 'vitest';
import { defaults, mask8, rgba8, type ImageOperation, type OperationContext, type RGBA8 } from '../src/imaging/types';
import {
  colorHalftone,
  crystallize,
  facet,
  fragment,
  mezzotint,
  mosaic,
  pointillize,
} from '../src/imaging/filters/pixelate';

const ctx: OperationContext = { foreground: [0, 0, 0], background: [255, 255, 255] };
const run = (op: ImageOperation, src: RGBA8, p: Record<string, unknown> = {}, c: OperationContext = ctx) =>
  op.apply(src, { ...defaults(op), ...(p as object) }, c) as RGBA8;
function noisy(w: number, h: number, seed = 1): RGBA8 {
  const img = rgba8(w, h);
  let s = seed;
  for (let i = 0; i < img.data.length; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    img.data[i] = (i & 3) === 3 ? 255 : s >>> 24;
  }
  return img;
}
const px = (img: RGBA8, x: number, y: number) =>
  Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

describe('pixelate filters', () => {
  it('constant images stay constant', () => {
    const c = rgba8(33, 21, [90, 140, 200, 255]);
    for (const op of [mosaic, crystallize, fragment, facet]) {
      const out = run(op, c);
      for (let i = 0; i < out.data.length; i += 4)
        expect([out.data[i], out.data[i + 1], out.data[i + 2], out.data[i + 3]], op.id).toEqual([90, 140, 200, 255]);
    }
  });
  it('mosaic averages each cell with alpha weights', () => {
    const img = rgba8(4, 4);
    // Left half opaque red, right half transparent black: the cell is red at half alpha.
    for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) img.data.set([255, 0, 0, 255], (y * 4 + x) * 4);
    const out = run(mosaic, img, { cellSize: 4 });
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) expect(px(out, x, y)).toEqual([255, 0, 0, 128]);
    const grid = run(mosaic, noisy(10, 10), { cellSize: 5 });
    expect(px(grid, 0, 0)).toEqual(px(grid, 4, 4));
    expect(px(grid, 5, 5)).toEqual(px(grid, 9, 9));
  });
  it('mosaic cells are anchored to the image so a selection crop matches', () => {
    const img = noisy(20, 20);
    const sel = mask8(20, 20);
    for (let y = 7; y < 20; y++) for (let x = 7; x < 20; x++) sel.data[y * 20 + x] = 255;
    const full = run(mosaic, img, { cellSize: 5 }),
      part = run(mosaic, img, { cellSize: 5 }, { ...ctx, selection: sel });
    expect(px(part, 12, 12)).toEqual(px(full, 12, 12));
    expect(px(part, 2, 2)).toEqual(px(img, 2, 2));
  });
  it('crystallize is piecewise constant and deterministic', () => {
    const img = noisy(60, 40);
    const a = run(crystallize, img, { cellSize: 10, seed: 4 }),
      b = run(crystallize, img, { cellSize: 10, seed: 4 }),
      c = run(crystallize, img, { cellSize: 10, seed: 5 });
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(Array.from(a.data)).not.toEqual(Array.from(c.data));
    const colors = new Set<string>();
    for (let i = 0; i < a.data.length; i += 4) colors.add(a.data.slice(i, i + 4).join());
    expect(colors.size).toBeLessThanOrEqual(8 * 6);
    expect(colors.size).toBeGreaterThan(10);
  });
  it('pointillize paints dots of the source color over the background', () => {
    const img = rgba8(40, 40, [0, 0, 255, 255]);
    const out = run(pointillize, img, { cellSize: 8 }, { ...ctx, background: [255, 255, 0] });
    let dots = 0,
      bg = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      // Every pixel is a mix of blue and the yellow background.
      expect(out.data[i]).toBe(out.data[i + 1]);
      expect(out.data[i] + out.data[i + 2]).toBeGreaterThanOrEqual(254);
      if (out.data[i + 2] === 255) dots++;
      if (out.data[i] === 255) bg++;
    }
    expect(dots).toBeGreaterThan(300);
    expect(bg).toBeGreaterThan(50);
  });
  it('color halftone maps white to white and black to black, midtones to dots', () => {
    expect(run(colorHalftone, rgba8(30, 30, [255, 255, 255, 255])).data.every((v) => v === 255)).toBe(true);
    const black = run(colorHalftone, rgba8(30, 30, [0, 0, 0, 255]));
    for (let i = 0; i < black.data.length; i += 4)
      expect(black.data[i] + black.data[i + 1] + black.data[i + 2]).toBe(0);
    const mid = run(colorHalftone, rgba8(64, 64, [128, 128, 128, 255]), { maxRadius: 6 });
    let on = 0;
    for (let i = 0; i < mid.data.length; i += 4) if (mid.data[i] > 127) on++;
    expect(on / (64 * 64)).toBeGreaterThan(0.3);
    expect(on / (64 * 64)).toBeLessThan(0.8);
  });
  it('facet keeps a hard edge sharp while flattening noise', () => {
    const img = rgba8(20, 10);
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 20; x++) img.data.set(x < 10 ? [20, 20, 20, 255] : [230, 230, 230, 255], (y * 20 + x) * 4);
    const out = run(facet, img);
    expect(px(out, 9, 5)).toEqual([20, 20, 20, 255]);
    expect(px(out, 10, 5)).toEqual([230, 230, 230, 255]);
    const n = noisy(30, 30),
      f = run(facet, n);
    let dn = 0,
      df = 0;
    for (let i = 4; i < n.data.length; i += 4) {
      dn += Math.abs(n.data[i] - n.data[i - 4]);
      df += Math.abs(f.data[i] - f.data[i - 4]);
    }
    expect(df).toBeLessThan(dn * 0.8);
  });
  it('fragment averages four offset copies', () => {
    const img = rgba8(20, 20);
    img.data.set([255, 255, 255, 255], (10 * 20 + 10) * 4);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    const out = run(fragment, img);
    expect(px(out, 6, 6)[0]).toBe(64);
    expect(px(out, 14, 6)[0]).toBe(64);
    expect(px(out, 10, 10)[0]).toBe(0);
  });
  it('mezzotint outputs pure channel values whose density follows the input', () => {
    for (const type of ['fine-dots', 'coarse-dots', 'grainy-dots', 'long-lines', 'medium-strokes']) {
      const out = run(mezzotint, rgba8(100, 100, [64, 192, 128, 255]), { type, seed: 2 });
      const on = [0, 0, 0];
      let impure = 0;
      for (let i = 0; i < out.data.length; i += 4)
        for (let c = 0; c < 3; c++) {
          if (out.data[i + c] !== 0 && out.data[i + c] !== 255) impure++;
          if (out.data[i + c]) on[c]++;
        }
      expect(impure, type).toBe(0);
      expect(Math.abs(on[0] / 1e4 - 0.25), type).toBeLessThan(0.08);
      expect(Math.abs(on[1] / 1e4 - 0.75), type).toBeLessThan(0.08);
    }
    const a = run(mezzotint, noisy(30, 30), { seed: 9 }),
      b = run(mezzotint, noisy(30, 30), { seed: 9 });
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});
