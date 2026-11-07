import { describe, expect, it } from 'vitest';
import { mask8, rgba8 } from '../src/imaging/types';
import { colorRange, magicWand } from '../src/imaging/segment/color-select';
import { GridGraph } from '../src/imaging/segment/maxflow';
import { BG, FG, grabCut, PR_BG, PR_FG } from '../src/imaging/segment/grabcut';
import { removeBackground, selectSky, selectSubject } from '../src/imaging/segment/subject';
import { refineEdge } from '../src/imaging/segment/refine';
import { saliency } from '../src/imaging/segment/saliency';
import { rasterizeRect } from '../src/imaging/segment/mask-ops';
import { disk, diskTruth, iou } from './retouch-fixtures';

function twoColor() {
  // Left half red, right half blue, plus a separate red island inside the blue.
  const img = rgba8(20, 10, [0, 0, 255, 255]);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) img.data.set([255, 0, 0, 255], (y * 20 + x) * 4);
  img.data.set([255, 0, 0, 255], (5 * 20 + 15) * 4);
  return img;
}

describe('magic wand', () => {
  it('is exact on a two-color image, contiguous or global', () => {
    const img = twoColor();
    const c = magicWand(img, 2, 2, 10, { antiAlias: false });
    const g = magicWand(img, 2, 2, 10, { antiAlias: false, contiguous: false });
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 20; x++) {
        const red = x < 10 || (x === 15 && y === 5);
        expect(c.data[y * 20 + x]).toBe(x < 10 ? 255 : 0);
        expect(g.data[y * 20 + x]).toBe(red ? 255 : 0);
      }
  });
  it('tolerance is the largest per-channel difference, inclusive', () => {
    const img = rgba8(3, 1);
    img.data.set([100, 100, 100, 255, 130, 100, 100, 255, 131, 100, 100, 255]);
    const m = magicWand(img, 0, 0, 30, { antiAlias: false, contiguous: false });
    expect([...m.data]).toEqual([255, 255, 0]);
  });
  it('treats all fully transparent pixels as one color', () => {
    const img = rgba8(4, 1);
    img.data.set([10, 20, 30, 0, 200, 0, 0, 0, 1, 2, 3, 255, 0, 0, 0, 0]);
    const m = magicWand(img, 0, 0, 0, { antiAlias: false });
    expect([...m.data]).toEqual([255, 255, 0, 0]);
  });
  it('anti-aliasing softens only the boundary', () => {
    const m = magicWand(twoColor(), 2, 2, 10);
    expect(m.data[5 * 20 + 2]).toBe(255);
    expect(m.data[5 * 20 + 9]).toBeGreaterThan(128);
    expect(m.data[5 * 20 + 9]).toBeLessThan(255);
    expect(m.data[5 * 20 + 10]).toBeGreaterThan(0);
    expect(m.data[5 * 20 + 10]).toBeLessThan(128);
    expect(m.data[5 * 20 + 13]).toBe(0);
  });
  it('handles a 1x1 image and out-of-range clicks', () => {
    expect([...magicWand(rgba8(1, 1, [1, 2, 3, 255]), 0, 0, 0).data]).toEqual([255]);
    expect([...magicWand(rgba8(2, 2), 5, 5, 0).data]).toEqual([0, 0, 0, 0]);
  });
});

describe('color range', () => {
  it('sampled colors are fully selected and coverage falls with distance', () => {
    const img = rgba8(3, 1);
    img.data.set([200, 50, 50, 255, 190, 60, 60, 255, 20, 200, 30, 255]);
    const m = colorRange(img, [[200, 50, 50]], 40);
    expect(m.data[0]).toBe(255);
    expect(m.data[1]).toBeGreaterThan(150);
    expect(m.data[1]).toBeLessThan(255);
    expect(m.data[2]).toBe(0);
    const inv = colorRange(img, [[200, 50, 50]], 40, { invert: true });
    expect(inv.data[0]).toBe(0);
    expect(inv.data[2]).toBe(255);
  });
  it('presets pick hues and tones', () => {
    const img = rgba8(5, 1);
    img.data.set([230, 30, 30, 255, 30, 30, 230, 255, 128, 128, 128, 255, 250, 250, 250, 255, 10, 10, 10, 255]);
    expect(colorRange(img, [], 0, { range: 'reds' }).data[0]).toBe(255);
    expect(colorRange(img, [], 0, { range: 'reds' }).data[1]).toBe(0);
    expect(colorRange(img, [], 0, { range: 'blues' }).data[1]).toBe(255);
    expect(colorRange(img, [], 0, { range: 'reds' }).data[2]).toBe(0);
    const hl = colorRange(img, [], 0, { range: 'highlights' }).data;
    expect([hl[3], hl[4]]).toEqual([255, 0]);
    const sh = colorRange(img, [], 0, { range: 'shadows' }).data;
    expect([sh[3], sh[4]]).toEqual([0, 255]);
    expect(colorRange(img, [], 0, { range: 'midtones' }).data[2]).toBe(255);
    const skin = rgba8(1, 1, [224, 172, 140, 255]);
    expect(colorRange(skin, [], 40, { range: 'skin' }).data[0]).toBeGreaterThan(200);
  });
  it('localized limits the selection to a radius', () => {
    const img = rgba8(40, 1, [100, 150, 200, 255]);
    const m = colorRange(img, [[100, 150, 200]], 10, { localized: { x: 5, y: 0.5, radius: 10 } });
    expect(m.data[5]).toBe(255);
    expect(m.data[30]).toBe(0);
  });
  it('transparent pixels are never selected', () => {
    const img = rgba8(1, 1, [100, 150, 200, 0]);
    expect(colorRange(img, [[100, 150, 200]], 10).data[0]).toBe(0);
    expect(colorRange(img, [[100, 150, 200]], 10, { invert: true }).data[0]).toBe(0);
  });
});

describe('grid max-flow', () => {
  it('finds the minimum cut of a 1D chain at its weakest link', () => {
    const g = new GridGraph(6, 1, 4);
    const caps = [9, 7, 2, 8, 9];
    caps.forEach((c, i) => g.setEdge(i, 0, c));
    g.tr[0] = 100;
    g.tr[5] = -100;
    expect(g.maxflow()).toBe(2);
    expect([0, 1, 2, 3, 4, 5].map((i) => g.isSource(i))).toEqual([true, true, true, false, false, false]);
  });
  it('matches brute-force min cut on small random 3x3 grids', () => {
    let seed = 3;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let trial = 0; trial < 30; trial++) {
      const w = 3, h = 3, n = 9, g = new GridGraph(w, h, 4);
      const edges: [number, number, number][] = [];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (x < w - 1) { const c = Math.floor(rand() * 10); g.setEdge(i, 0, c); edges.push([i, i + 1, c]); }
          if (y < h - 1) { const c = Math.floor(rand() * 10); g.setEdge(i, 2, c); edges.push([i, i + w, c]); }
        }
      const tr = Array.from({ length: n }, () => Math.floor(rand() * 21) - 10);
      tr.forEach((v, i) => (g.tr[i] = v));
      const flow = g.maxflow();
      let best = Infinity;
      for (let s = 0; s < 1 << n; s++) {
        let c = 0;
        for (let i = 0; i < n; i++) {
          const src = (s >> i) & 1;
          if (src && tr[i] < 0) c += -tr[i];
          if (!src && tr[i] > 0) c += tr[i];
        }
        for (const [a, b, cap] of edges) if (((s >> a) & 1) !== ((s >> b) & 1)) c += cap;
        best = Math.min(best, c);
      }
      // Flow from the net terminal links equals the min cut minus the cancelled constant.
      let cut = 0;
      for (let i = 0; i < n; i++) {
        const src = g.isSource(i);
        if (src && tr[i] < 0) cut += -tr[i];
        if (!src && tr[i] > 0) cut += tr[i];
      }
      for (const [a, b, cap] of edges) if (g.isSource(a) !== g.isSource(b)) cut += cap;
      expect(cut).toBe(best);
      expect(flow).toBe(best);
    }
  });
});

describe('GrabCut and subject selection', () => {
  it('GrabCut separates a centered disk from a different background (IoU > 0.9)', () => {
    const w = 120, h = 90, img = disk(w, h, 60, 45, 25, [200, 60, 50], [40, 120, 70], 20);
    const tri = new Uint8Array(w * h).fill(BG);
    for (let y = 10; y < 80; y++) for (let x = 25; x < 95; x++) tri[y * w + x] = PR_FG;
    const lab = grabCut(img, tri);
    expect(iou(lab, diskTruth(w, h, 60, 45, 25))).toBeGreaterThan(0.9);
  });
  it('GrabCut respects hard labels', () => {
    const w = 40, h = 30, img = disk(w, h, 20, 15, 8, [255, 255, 255], [0, 0, 0]);
    const tri = new Uint8Array(w * h).fill(PR_BG);
    tri[0] = FG;
    for (let y = 10; y < 20; y++) for (let x = 15; x < 25; x++) tri[y * w + x] = PR_FG;
    tri[15 * w + 20] = BG;
    const lab = grabCut(img, tri);
    expect(lab[0]).toBe(1);
    expect(lab[15 * w + 20]).toBe(0);
  });
  it('saliency is higher on a distinct centered object than on the border', () => {
    const img = disk(100, 80, 50, 40, 18, [230, 200, 40], [60, 70, 120], 10);
    const s = saliency(img);
    expect(s[40 * 100 + 50]).toBeGreaterThan(0.8);
    expect(s[5 * 100 + 5]).toBeLessThan(0.4);
  });
  it('selectSubject finds a centered disk in a noisy photo-sized image', () => {
    const w = 640, h = 480, img = disk(w, h, 330, 230, 120, [210, 80, 60], [50, 110, 150], 25);
    const m = selectSubject(img);
    expect(iou(m, diskTruth(w, h, 330, 230, 120))).toBeGreaterThan(0.95);
  }, 60000);
  it('removeBackground cuts out the subject and keeps a layer mask', () => {
    const w = 200, h = 150, img = disk(w, h, 100, 75, 40, [240, 220, 30], [30, 60, 160], 10);
    const { mask, image } = removeBackground(img);
    expect(mask.data[75 * w + 100]).toBe(255);
    expect(image.data[(75 * w + 100) * 4 + 3]).toBe(255);
    expect(image.data[(5 * w + 5) * 4 + 3]).toBe(0);
  }, 60000);
  it('selectSky selects a blue top region above a textured ground', () => {
    const w = 160, h = 120, img = rgba8(w, h);
    let s = 7;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const horizon = 50 + 8 * Math.sin(x / 15);
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const n = (s % 60) - 30;
        img.data.set(y < horizon ? [110 + y / 2, 160 + y / 3, 235, 255] : [90 + n, 80 + n, 40 + n, 255], (y * w + x) * 4);
      }
    const m = selectSky(img);
    const truth = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) truth[y * w + x] = y < 50 + 8 * Math.sin(x / 15) ? 1 : 0;
    expect(iou(m, truth)).toBeGreaterThan(0.93);
    // Nothing sky-like: empty.
    expect(selectSky(rgba8(64, 48, [90, 60, 30, 255])).data.every((v) => v === 0)).toBe(true);
  }, 60000);
});

describe('refine edge', () => {
  it('snaps a misplaced hard edge to the image edge within the radius', () => {
    const w = 60, h = 20, img = rgba8(w, h, [20, 20, 20, 255]);
    for (let y = 0; y < h; y++) for (let x = 30; x < w; x++) img.data.set([230, 230, 230, 255], (y * w + x) * 4);
    const rough = rasterizeRect(26, 0, 34, 20, w, h, { antiAlias: false });
    const { mask } = refineEdge(img, rough, { radius: 6 });
    expect(mask.data[10 * w + 27]).toBeLessThan(60);
    expect(mask.data[10 * w + 33]).toBeGreaterThan(200);
    expect(mask.data[10 * w + 5]).toBe(0);
    expect(mask.data[10 * w + 55]).toBe(255);
  });
  it('contrast hardens, shift moves and feather softens', () => {
    const m = mask8(5, 1);
    m.data.set([0, 64, 128, 192, 255]);
    const img = rgba8(5, 1, [0, 0, 0, 255]);
    expect([...refineEdge(img, m, { contrast: 50 }).mask.data]).toEqual([0, 1, 129, 255, 255]);
    const out = refineEdge(img, m, { shiftEdge: 50 }).mask.data;
    expect(out[1]).toBeGreaterThan(64);
    const f = refineEdge(rgba8(30, 1, [0, 0, 0, 255]), rasterizeRect(10, 0, 10, 1, 30, 1, { antiAlias: false }), { feather: 4 }).mask.data;
    expect(f[9]).toBeGreaterThan(0);
    expect(f[9]).toBeLessThan(255);
  });
  it('decontamination removes background color from soft edge pixels', () => {
    const w = 40, h = 4, img = rgba8(w, h), m = mask8(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        // Foreground pure white, background pure green, a soft 50% column at x = 20.
        const a = x < 20 ? 1 : x === 20 ? 0.5 : 0;
        img.data.set([255 * a, 255 * a + 255 * (1 - a), 255 * a, 255], (y * w + x) * 4);
        m.data[y * w + x] = Math.round(a * 255);
      }
    const { image } = refineEdge(img, m, { decontaminate: true });
    const o = (1 * w + 20) * 4;
    expect(image!.data[o]).toBeGreaterThan(240);
    expect(image!.data[o + 2]).toBeGreaterThan(240);
    expect(image!.data[(1 * w + 5) * 4]).toBe(255);
  });
});
