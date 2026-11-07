import { describe, expect, it } from 'vitest';
import { mask8, rgba8, type Mask8, type RGBA8 } from '../src/imaging/types';
import {
  anchorSpacing,
  binarize,
  clampRect,
  colorAdaptationFor,
  colorRangeMulti,
  cropMask,
  decontaminateLayer,
  defringe,
  downscaleImage,
  edgeStrength,
  expandRect,
  fitSize,
  limitToCoverage,
  mixImages,
  outlinePath,
  paintOver,
  pasteMask,
  patchSizeFor,
  placeOver,
  refineComposite,
  removeMatte,
  resizeMask,
  shiftMask,
  strokeBounds,
  strokeMask,
} from '../src/features/retouch/logic';
import { expandMask } from '../src/features/retouch/ai';

const px = (img: RGBA8, x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

describe('rect helpers', () => {
  it('clamps and expands within the canvas', () => {
    expect(clampRect({ x: -5, y: 2.5, width: 10, height: 4 }, 8, 8)).toEqual({ x: 0, y: 2, width: 5, height: 5 });
    expect(clampRect({ x: 20, y: 0, width: 3, height: 3 }, 8, 8)).toBeNull();
    expect(expandRect({ x: 2, y: 2, width: 2, height: 2 }, 3, 6, 6)).toEqual({ x: 0, y: 0, width: 6, height: 6 });
  });
  it('stroke bounds include the brush radius', () => {
    const b = strokeBounds([[10, 10], [20, 12]], 5);
    expect(b.x).toBeLessThanOrEqual(5);
    expect(b.y).toBeLessThanOrEqual(5);
    expect(b.x + b.width).toBeGreaterThanOrEqual(25);
    expect(b.y + b.height).toBeGreaterThanOrEqual(17);
  });
  it('fits sizes without upscaling', () => {
    expect(fitSize(4000, 2000, 1000)).toEqual([1000, 500]);
    expect(fitSize(300, 200, 1000)).toEqual([300, 200]);
  });
});

describe('stroke masks', () => {
  it('a hard dab covers its disk and nothing beyond', () => {
    const R = { x: 0, y: 0, width: 40, height: 40 };
    const m = strokeMask([[20, 20]], 20, 1, R);
    expect(m.data[20 * 40 + 20]).toBe(255);
    expect(m.data[20 * 40 + 28]).toBe(255);
    expect(m.data[20 * 40 + 32]).toBe(0);
    expect(m.data[0]).toBe(0);
  });
  it('a soft dab falls off toward the rim and segments are continuous', () => {
    const R = { x: 0, y: 0, width: 100, height: 40 };
    const m = strokeMask([[10, 20], [90, 20]], 16, 0, R);
    expect(m.data[20 * 100 + 10]).toBeGreaterThan(245);
    for (let x = 10; x <= 90; x++) expect(m.data[20 * 100 + x]).toBeGreaterThan(200);
    expect(m.data[26 * 100 + 50]).toBeLessThan(m.data[22 * 100 + 50]);
  });
  it('respects the rectangle offset', () => {
    const m = strokeMask([[105, 55]], 4, 1, { x: 100, y: 50, width: 10, height: 10 });
    expect(m.data[5 * 10 + 5]).toBe(255);
  });
  it('an empty stroke is empty', () => {
    expect(strokeMask([], 10, 1, { x: 0, y: 0, width: 3, height: 3 }).data.every((v) => v === 0)).toBe(true);
  });
});

describe('mask placement', () => {
  it('paste clips to the destination and shift moves content', () => {
    const src: Mask8 = { width: 2, height: 2, data: new Uint8Array([1, 2, 3, 4]) };
    const dst = pasteMask(mask8(3, 3), src, 2, -1);
    expect([...dst.data]).toEqual([0, 0, 3, 0, 0, 0, 0, 0, 0]);
    const m = mask8(4, 1);
    m.data[0] = 255;
    expect([...shiftMask(m, 2, 0).data]).toEqual([0, 0, 255, 0]);
    expect([...shiftMask(m, -1, 0).data]).toEqual([0, 0, 0, 0]);
  });
  it('crop and binarize', () => {
    const m: Mask8 = { width: 3, height: 2, data: new Uint8Array([0, 10, 20, 30, 0, 50]) };
    expect([...cropMask(m, { x: 1, y: 0, width: 2, height: 2 }).data]).toEqual([10, 20, 0, 50]);
    expect([...binarize(m).data]).toEqual([0, 255, 255, 255, 0, 255]);
  });
});

describe('write-back blending', () => {
  it('limits a change to the selection coverage', () => {
    const before = rgba8(2, 1, [0, 0, 0, 255]),
      after = rgba8(2, 1, [200, 100, 50, 255]);
    const cover: Mask8 = { width: 2, height: 1, data: new Uint8Array([255, 128]) };
    const out = limitToCoverage(before, after, cover);
    expect(px(out, 0, 0)).toEqual([200, 100, 50, 255]);
    expect(px(out, 1, 0)[0]).toBeCloseTo(100, -1);
  });
  it('paints merged-source results over an empty layer only where weighted', () => {
    const base = rgba8(2, 1),
      top = rgba8(2, 1, [10, 20, 30, 255]);
    const out = paintOver(base, top, { width: 2, height: 1, data: new Uint8Array([255, 0]) });
    expect(px(out, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(px(out, 1, 0)).toEqual([0, 0, 0, 0]);
  });
  it('places a patch over a base with its coverage and offset', () => {
    const base = rgba8(4, 4, [0, 0, 255, 255]);
    const patch = rgba8(2, 2, [255, 0, 0, 255]);
    const m: Mask8 = { width: 2, height: 2, data: new Uint8Array([255, 255, 0, 128]) };
    const out = placeOver(base, patch, m, 2, 2);
    expect(px(out, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(px(out, 2, 3)).toEqual([0, 0, 255, 255]);
    expect(px(out, 3, 3)[0]).toBeGreaterThan(120);
    expect(px(out, 0, 0)).toEqual([0, 0, 255, 255]);
    // Off-canvas placement is clipped, not wrapped.
    expect(() => placeOver(base, patch, m, 3, 3)).not.toThrow();
  });
  it('mixes images linearly', () => {
    const a = rgba8(1, 1, [0, 0, 0, 0]),
      b = rgba8(1, 1, [100, 200, 50, 255]);
    expect(px(mixImages(a, b, 0.5), 0, 0)).toEqual([50, 100, 25, 128]);
  });
});

describe('previews', () => {
  it('outlines a square at its 50% edge in document units', () => {
    const m = mask8(20, 20);
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) m.data[y * 20 + x] = 255;
    const d = outlinePath(m);
    expect(d.startsWith('M')).toBe(true);
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(4.5);
    expect(Math.max(...nums)).toBeLessThanOrEqual(15.5);
    expect(outlinePath(mask8(5, 5))).toBe('');
  });
  it('coarse outlines of large masks stay in document units', () => {
    const m = mask8(2000, 1000);
    for (let y = 100; y < 900; y++) m.data.fill(255, y * 2000 + 200, y * 2000 + 1800);
    const nums = outlinePath(m, 10_000).match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.max(...nums)).toBeGreaterThan(1700);
    expect(Math.max(...nums)).toBeLessThan(1900);
  });
  it('resizes masks and images', () => {
    const m: Mask8 = { width: 2, height: 1, data: new Uint8Array([0, 255]) };
    const big = resizeMask(m, 4, 1);
    expect(big.data[0]).toBe(0);
    expect(big.data[3]).toBe(255);
    const img = rgba8(4, 4, [0, 0, 0, 0]);
    for (let i = 0; i < 4; i++) img.data.set([255, 0, 0, 255], i * 4);
    const small = downscaleImage(img, 2, 2);
    // Transparent pixels do not darken the average color.
    expect(px(small, 0, 0)).toEqual([255, 0, 0, 128]);
  });
});

describe('magnetic lasso helpers', () => {
  it('anchor spacing shrinks as frequency rises', () => {
    expect(anchorSpacing(100)).toBeLessThan(anchorSpacing(57));
    expect(anchorSpacing(57)).toBeLessThan(anchorSpacing(0));
    expect(anchorSpacing(-10)).toBe(anchorSpacing(0));
  });
  it('edge strength is high on an edge and zero on flat color', () => {
    const img = rgba8(10, 10, [0, 0, 0, 255]);
    for (let y = 0; y < 10; y++) for (let x = 5; x < 10; x++) img.data.set([255, 255, 255, 255], (y * 10 + x) * 4);
    expect(edgeStrength(img, 5, 5)).toBeGreaterThan(0.9);
    expect(edgeStrength(img, 2, 5)).toBe(0);
    expect(edgeStrength(rgba8(1, 1), 0, 0)).toBe(0);
  });
});

describe('patch settings', () => {
  it('maps structure to odd patch sizes and color to adaptation', () => {
    for (let s = 1; s <= 7; s++) expect(patchSizeFor(s) % 2).toBe(1);
    expect(patchSizeFor(1)).toBeLessThan(patchSizeFor(7));
    expect(colorAdaptationFor(0)).toBe('none');
    expect(colorAdaptationFor(3)).toBe('default');
    expect(colorAdaptationFor(10)).toBe('high');
  });
});

describe('matting', () => {
  it('removes a black matte', () => {
    // Red at 50% alpha that was premultiplied against black.
    const img = rgba8(1, 1, [100, 0, 0, 128]);
    expect(px(removeMatte(img, 'black'), 0, 0)[0]).toBeGreaterThan(195);
  });
  it('removes a white matte', () => {
    // Pure blue at 50% over white reads (128, 128, 255).
    const img = rgba8(1, 1, [128, 128, 255, 128]);
    const out = px(removeMatte(img, 'white'), 0, 0);
    expect(out[0]).toBeLessThan(5);
    expect(out[2]).toBe(255);
    expect(out[3]).toBe(128);
  });
  it('leaves opaque and transparent pixels alone', () => {
    const img = rgba8(2, 1, [10, 20, 30, 255]);
    img.data.set([1, 2, 3, 0], 4);
    expect([...removeMatte(img, 'black').data]).toEqual([...img.data]);
  });
  it('defringe replaces halo colors at the edge with interior colors', () => {
    const img = rgba8(6, 1);
    for (let x = 0; x < 3; x++) img.data.set([0, 200, 0, 255], x * 4);
    img.data.set([255, 255, 255, 120], 12); // white halo pixel
    const out = defringe(img, 1);
    expect(px(out, 3, 0)).toEqual([0, 200, 0, 120]);
    expect(px(out, 4, 0)).toEqual([0, 0, 0, 0]);
  });
  it('color decontaminate keeps alpha and pulls edge colors toward the foreground', () => {
    const img = rgba8(30, 1);
    for (let x = 0; x < 15; x++) img.data.set([0, 0, 200, 255], x * 4);
    img.data.set([200, 200, 200, 128], 15 * 4);
    const out = decontaminateLayer(img, 1);
    expect(px(out, 15, 0)[3]).toBe(128);
    expect(px(out, 15, 0)[2]).toBeGreaterThan(px(out, 15, 0)[0]);
  });
});

describe('select and mask compositing', () => {
  const disk = () => {
    const img = rgba8(80, 80, [40, 60, 160, 255]);
    const m = mask8(80, 80);
    for (let y = 0; y < 80; y++)
      for (let x = 0; x < 80; x++)
        if ((x - 40) ** 2 + (y - 40) ** 2 < 400) {
          img.data.set([230, 200, 60, 255], (y * 80 + x) * 4);
          m.data[y * 80 + x] = 255;
        }
    return { img, m };
  };
  const base = { radius: 0, adaptiveRadius: false, smooth: 0, feather: 0, contrast: 0, shiftEdge: 0, decontaminate: 0 };
  it('without settings returns the selection unchanged', () => {
    const { img, m } = disk();
    expect([...refineComposite(img, m, base).mask.data]).toEqual([...m.data]);
  });
  it('feather softens the edge and decontaminate returns an image', () => {
    const { img, m } = disk();
    const r = refineComposite(img, m, { ...base, feather: 4, decontaminate: 1 });
    expect(r.mask.data[40 * 80 + 60]).toBeGreaterThan(0);
    expect(r.mask.data[40 * 80 + 60]).toBeLessThan(255);
    expect(r.image).toBeDefined();
  });
  it('the refine brush only changes brushed pixels', () => {
    const { img } = disk();
    // A sloppy selection: a square around the disk.
    const sq = mask8(80, 80);
    for (let y = 15; y < 65; y++) sq.data.fill(255, y * 80 + 15, y * 80 + 65);
    const brushed = mask8(80, 80);
    for (let y = 0; y < 40; y++) brushed.data.fill(255, y * 80, y * 80 + 80);
    const r = refineComposite(img, sq, { ...base, radius: 2 }, brushed, 14);
    // The brushed top corner (background color) drops out; the unbrushed bottom corner stays.
    expect(r.mask.data[17 * 80 + 17]).toBeLessThan(80);
    expect(r.mask.data[62 * 80 + 17]).toBe(255);
  });
});

describe('color range with several samples', () => {
  const img = rgba8(30, 10, [200, 30, 30, 255]);
  for (let y = 0; y < 10; y++) for (let x = 10; x < 20; x++) img.data.set([30, 30, 200, 255], (y * 30 + x) * 4);
  for (let y = 0; y < 10; y++) for (let x = 20; x < 30; x++) img.data.set([30, 200, 30, 255], (y * 30 + x) * 4);
  const s = { range: 'sampled' as const, add: [], subtract: [], addColors: [], subtractColors: [], fuzziness: 40, localized: false, rangePct: 25, invert: false };
  it('adds and subtracts sampled colors', () => {
    const m = colorRangeMulti(img, { ...s, addColors: [[200, 30, 30], [30, 30, 200]] });
    expect(m.data[5]).toBe(255);
    expect(m.data[15]).toBe(255);
    expect(m.data[25]).toBe(0);
    const sub = colorRangeMulti(img, { ...s, addColors: [[200, 30, 30], [30, 30, 200]], subtractColors: [[30, 30, 200]] });
    expect(sub.data[5]).toBe(255);
    expect(sub.data[15]).toBe(0);
  });
  it('localized clusters limit each sample to its neighborhood', () => {
    const two = rgba8(100, 10, [200, 30, 30, 255]);
    const m = colorRangeMulti(two, { ...s, addColors: [[200, 30, 30]], add: [[5, 5]], localized: true, rangePct: 20 });
    expect(m.data[5 * 100 + 5]).toBe(255);
    expect(m.data[5 * 100 + 95]).toBe(0);
  });
  it('presets ignore samples and invert flips opaque pixels', () => {
    const m = colorRangeMulti(img, { ...s, range: 'greens', invert: true });
    expect(m.data[25]).toBeLessThan(10);
    expect(m.data[5]).toBe(255);
  });
});

describe('AI Expand mask', () => {
  it('covers the new border and fades into the old edge only on extended sides', () => {
    const m = expandMask(20, 10, 5, 0, 10, 10, 3);
    expect(m.data[0]).toBe(255);
    expect(m.data[19]).toBe(255);
    expect(m.data[5 * 20 + 5]).toBeGreaterThan(0);
    expect(m.data[5 * 20 + 5]).toBeLessThan(255);
    expect(m.data[5 * 20 + 10]).toBe(0);
    // Top was not extended, so no ramp there.
    expect(m.data[0 * 20 + 10]).toBe(0);
  });
});

describe('Context Fill hole prefill', () => {
  it('keeps high color adaptation from picking up the removed object color', async () => {
    const { contextFill } = await import('../src/imaging/retouch');
    const { prefillHole } = await import('../src/features/retouch/logic');
    const W = 200, H = 150, img = rgba8(W, H, [140, 122, 98, 255]);
    for (let y = 0; y < H; y++) if (Math.floor(y / 10) % 2) for (let x = 0; x < W; x++) img.data.set([133, 114, 89, 255], (y * W + x) * 4);
    for (let y = 60; y < 90; y++) for (let x = 80; x < 115; x++) img.data.set([200, 40, 40, 255], (y * W + x) * 4);
    const hole = mask8(W, H);
    for (let y = 56; y < 94; y++) hole.data.fill(255, y * W + 76, y * W + 119);
    const out = contextFill(prefillHole(img, hole), hole, { colorAdaptation: 'high' });
    let r = 0, g = 0, n = 0;
    for (let y = 60; y < 90; y++)
      for (let x = 80; x < 115; x++) {
        r += out.data[(y * W + x) * 4];
        g += out.data[(y * W + x) * 4 + 1];
        n++;
      }
    expect(Math.abs(r / n - 137)).toBeLessThan(12);
    expect(Math.abs(g / n - 118)).toBeLessThan(12);
  }, 60000);
  it('leaves soft-edge and outside pixels alone', async () => {
    const { prefillHole } = await import('../src/features/retouch/logic');
    const img = rgba8(5, 1, [10, 20, 30, 255]);
    img.data.set([250, 0, 0, 255], 8);
    const hole: Mask8 = { width: 5, height: 1, data: new Uint8Array([0, 128, 255, 0, 0]) };
    const out = prefillHole(img, hole);
    expect(px(out, 1, 0)).toEqual([10, 20, 30, 255]);
    expect(px(out, 2, 0)).toEqual([10, 20, 30, 255]);
    expect(px(out, 0, 0)).toEqual([10, 20, 30, 255]);
  });
});

describe('AI Expand canvas growth', () => {
  it('grows the canvas and moves layers and document-space masks by the added margin', async () => {
    const { enlargeCanvas } = await import('../src/features/retouch/ai');
    const { newDocument, layer } = await import('../src/model/document');
    const doc = newDocument();
    const l = layer('solid', 'Fill', doc.width, doc.height);
    l.maskGrid = { channels: 1, x: 0, y: 0, tiles: {}, bounds: null, fill: 255 };
    doc.layers = [l];
    const w = doc.width, h = doc.height;
    enlargeCanvas(doc, 10, 20, w + 30, h + 40);
    expect([doc.width, doc.height]).toEqual([w + 30, h + 40]);
    expect([l.transform.x, l.transform.y]).toEqual([10, 20]);
    expect([l.maskGrid!.x, l.maskGrid!.y]).toEqual([10, 20]);
    expect(doc.selection).toBeNull();
  });
});
