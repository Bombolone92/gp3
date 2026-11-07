import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { planWork, pixelEffect, hashPixels, clearPixelCache, onRefine } from '../src/features/pxfx/core.js';
import { invert } from '../src/lib/matrix.js';

/**
 * A tiny 2D canvas: nearest-neighbor drawImage under any affine transform,
 * getImageData / putImageData. Enough to run the pixel pipeline in jsdom.
 */
class FakeCanvas {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
    this.ctx = new FakeCtx(this);
  }
  getContext() {
    return this.ctx;
  }
}

class FakeCtx {
  constructor(canvas) {
    this.canvas = canvas;
    this.t = [1, 0, 0, 1, 0, 0];
    this.imageSmoothingEnabled = true;
  }
  setTransform(a, b, c, d, e, f) {
    this.t = [a, b, c, d, e, f];
  }
  drawImage(src) {
    const inv = invert(this.t);
    const { width: W, height: H, data } = this.canvas;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const sx = Math.floor(inv[0] * (x + 0.5) + inv[2] * (y + 0.5) + inv[4]);
        const sy = Math.floor(inv[1] * (x + 0.5) + inv[3] * (y + 0.5) + inv[5]);
        if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
        const j = (sy * src.width + sx) * 4;
        if (!src.data[j + 3]) continue;
        data.set(src.data.subarray(j, j + 4), (y * W + x) * 4);
      }
    }
  }
  getImageData(x, y, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let j = 0; j < h; j++) out.set(this.canvas.data.subarray(((y + j) * this.canvas.width + x) * 4, ((y + j) * this.canvas.width + x + w) * 4), j * w * 4);
    return { width: w, height: h, data: out };
  }
  putImageData(img, x, y) {
    for (let j = 0; j < img.height; j++) this.canvas.data.set(img.data.subarray(j * img.width * 4, (j + 1) * img.width * 4), ((y + j) * this.canvas.width + x) * 4);
  }
}

const pool = {
  acquire(w, h) {
    const c = new FakeCanvas(w, h);
    return { canvas: c, ctx: c.ctx };
  },
  release() {},
};
const layerOf = (w, h, fill) => {
  const c = new FakeCanvas(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) c.data.set(fill(x, y), (y * w + x) * 4);
  return { canvas: c, ctx: c.ctx };
};
const px = (layer, x, y) => [...layer.canvas.data.subarray((y * layer.canvas.width + x) * 4, (y * layer.canvas.width + x) * 4 + 4)];
const M = (a, e = 0, f = 0) => ({ a, b: 0, c: 0, d: a, e, f });

let saved;
beforeAll(() => {
  saved = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = FakeCanvas;
});
afterAll(() => {
  globalThis.OffscreenCanvas = saved;
});

describe('work grid', () => {
  it('maps a layer to a grid anchored to the document', () => {
    // Device = 2 x document, shifted; the layer sits at device (10, 6).
    const p = planWork(40, 20, [2, 0, 0, 2, 4, 0], 10, 6, null, 1);
    expect(p.rect).toEqual({ x: 3, y: 3, w: 20, h: 10 });
    expect([p.gx0, p.gy0, p.W, p.H, p.k]).toEqual([3, 3, 20, 10, 1]);
    // Same document point, any view: work pixel = document * k - grid origin.
    const q = planWork(80, 40, [4, 0, 0, 4, 0, 0], 12, 12, null, 1);
    expect([q.gx0, q.gy0]).toEqual([3, 3]);
  });

  it('clips to a limit and keeps within the pixel budget', () => {
    const p = planWork(1000, 1000, [1, 0, 0, 1, 0, 0], 0, 0, { x: 100, y: 100, w: 50, h: 40 }, 2);
    expect([p.W, p.H]).toEqual([100, 80]);
    const big = planWork(1000, 1000, [1, 0, 0, 1, 0, 0], 0, 0, null, 4, 1e5);
    expect(big.W * big.H).toBeLessThanOrEqual(1e5 * 1.01);
    expect(big.k).toBeLessThan(4);
    expect(planWork(10, 10, [1, 0, 0, 1, 0, 0], 0, 0, { x: 50, y: 50, w: 5, h: 5 }, 1)).toBeNull();
  });

  it('handles rotated views', () => {
    const c = Math.SQRT1_2;
    const p = planWork(100, 100, [c, c, -c, c, 50, 0], 0, 0, null, 1);
    expect(p.W).toBeGreaterThan(100);
    const back = p.toLayer;
    const fwd = p.toWork;
    // toLayer undoes toWork.
    const x = fwd[0] * 30 + fwd[2] * 40 + fwd[4];
    const y = fwd[1] * 30 + fwd[3] * 40 + fwd[5];
    expect(back[0] * x + back[2] * y + back[4]).toBeCloseTo(30, 6);
    expect(back[1] * x + back[3] * y + back[5]).toBeCloseTo(40, 6);
  });

  it('hashes pixels', () => {
    const a = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 9]);
    expect(hashPixels(a)).toBe(hashPixels(a.slice()));
    expect(hashPixels(a)).not.toBe(hashPixels(b));
  });
});

describe('document-space pixel effects', () => {
  const doc = { root: { rasterResolution: 72 }, tx: null };
  const invertFx = (calls) =>
    pixelEffect({
      key: (e) => `inv${e.n}`,
      process: (img, e, ctx) => {
        calls.push(ctx);
        const out = { ...img, r: img.r.map((v) => 1 - v), g: img.g.slice(), b: img.b.slice(), a: img.a.slice() };
        return out;
      },
    });

  it('processes at the document resolution and draws the result back', () => {
    clearPixelCache();
    const calls = [];
    const fx = invertFx(calls);
    // A 2x zoomed layer: 20 x 20 device pixels for 10 x 10 points.
    const layer = layerOf(20, 20, (x) => (x < 10 ? [0, 0, 255, 255] : [255, 0, 0, 255]));
    const out = fx(layer, { n: 1 }, 2, pool, { transform: M(2), x: 0, y: 0, doc });
    expect(calls).toHaveLength(1);
    expect(calls[0].k).toBe(1);
    expect([calls[0].ox, calls[0].oy]).toEqual([0, 0]);
    expect(px(out, 2, 2)).toEqual([255, 0, 255, 255]);
    expect(px(out, 15, 2)).toEqual([0, 0, 0, 255]);
    // Same input and settings: served from the cache.
    fx(layer, { n: 1 }, 2, pool, { transform: M(2), x: 0, y: 0, doc });
    expect(calls).toHaveLength(1);
    fx(layer, { n: 2 }, 2, pool, { transform: M(2), x: 0, y: 0, doc });
    expect(calls).toHaveLength(2);
  });

  it('follows the document raster resolution and the view position', () => {
    clearPixelCache();
    const calls = [];
    const fx = invertFx(calls);
    const layer = layerOf(30, 30, () => [10, 20, 30, 255]);
    fx(layer, { n: 1 }, 1, pool, { transform: M(1, -7, -3), x: 0, y: 0, doc: { root: { rasterResolution: 144 }, tx: null } });
    expect(calls[0].k).toBe(2);
    expect([calls[0].ox, calls[0].oy]).toEqual([14, 6]);
  });

  it('leaves content alone when it cannot read pixels', () => {
    const fx = invertFx([]);
    const broken = { canvas: { width: 4, height: 4 } };
    const stub = { acquire: () => ({ canvas: { width: 4, height: 4, getContext: () => ({ setTransform() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }) }) } }), release() {} };
    const prev = globalThis.OffscreenCanvas;
    globalThis.OffscreenCanvas = class {
      constructor(w, h) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return { setTransform() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }) };
      }
    };
    expect(fx(broken, { n: 1 }, 1, stub, { transform: M(1), x: 0, y: 0, doc })).toBeNull();
    globalThis.OffscreenCanvas = prev;
  });

  it('drafts slow effects while a transaction is open, then asks for a sharp redraw', async () => {
    clearPixelCache();
    const calls = [];
    const fx = pixelEffect({
      key: () => 'slow',
      process: (img, e, ctx) => {
        calls.push(ctx);
        const until = Date.now() + 60;
        while (Date.now() < until);
        return img;
      },
    });
    let refined = 0;
    const off = onRefine(() => refined++);
    const live = { root: { rasterResolution: 72 }, tx: {} };
    fx(layerOf(40, 40, () => [1, 2, 3, 255]), {}, 1, pool, { transform: M(1), x: 0, y: 0, doc: live });
    expect(calls[0].draft).toBe(false);
    fx(layerOf(40, 40, () => [4, 5, 6, 255]), {}, 1, pool, { transform: M(1), x: 0, y: 0, doc: live });
    expect(calls[1].draft).toBe(true);
    expect(calls[1].k).toBeLessThan(1);
    await new Promise((r) => setTimeout(r, 400));
    expect(refined).toBe(1);
    // Right after the refinement request, results are computed sharp again.
    fx(layerOf(40, 40, () => [7, 8, 9, 255]), {}, 1, pool, { transform: M(1), x: 0, y: 0, doc: live });
    expect(calls[2].draft).toBe(false);
    off();
  });
});
