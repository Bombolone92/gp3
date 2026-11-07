import { describe, expect, it } from 'vitest';
import { rgba8 } from '../src/imaging/types';
import { defaultWarp, type Warp, type WarpStyle } from '../src/imaging/text/model';
import { arcGeometry, isIdentityWarp, warpImage, warpPoint } from '../src/imaging/text/warp';

const styles: WarpStyle[] = ['arc', 'arc-lower', 'arc-upper', 'arch', 'bulge', 'shell-lower', 'shell-upper', 'flag', 'wave', 'fish', 'rise', 'fisheye', 'inflate', 'squeeze', 'twist'];
const rect = { x: 10, y: 20, width: 200, height: 50 };
const w = (style: WarpStyle, bend: number, extra: Partial<Warp> = {}): Warp => ({ ...defaultWarp(), style, bend, ...extra });

describe('warp mapping', () => {
  it("style 'none' and bend 0 are exact identities", () => {
    const pts = [[10, 20], [110, 45], [210, 70], [-30, 5], [400, 300]];
    for (const s of [...styles, 'none' as WarpStyle])
      for (const axis of ['horizontal', 'vertical'] as const)
        for (const [x, y] of pts) {
          expect(warpPoint(w(s, 0, { axis }), rect, x, y)).toEqual([x, y]);
          expect(warpPoint(w('none', 50), rect, x, y)).toEqual([x, y]);
        }
    expect(isIdentityWarp(w('arc', 0))).toBe(true);
    expect(isIdentityWarp(w('arc', 0, { horizontal: 10 }))).toBe(false);
  });
  it('arc maps the center line to a circular arc with the expected sagitta', () => {
    for (const bend of [50, -50, 100, 20]) {
      const { radius, sagitta, theta } = arcGeometry(bend, rect.width);
      const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
      // Center stays put; ends drop (or rise for negative bend) by the sagitta.
      expect(warpPoint(w('arc', bend), rect, cx, cy)).toEqual([cx, cy]);
      const [, ly] = warpPoint(w('arc', bend), rect, rect.x, cy);
      const [, ry] = warpPoint(w('arc', bend), rect, rect.x + rect.width, cy);
      expect(ly - cy).toBeCloseTo(sagitta, 9);
      expect(ry - cy).toBeCloseTo(sagitta, 9);
      expect(Math.sign(sagitta)).toBe(Math.sign(bend));
      // Every point of the center line is on the circle centered (cx, cy + R).
      let len = 0, prev = warpPoint(w('arc', bend), rect, rect.x, cy);
      for (let i = 1; i <= 100; i++) {
        const p = warpPoint(w('arc', bend), rect, rect.x + (i / 100) * rect.width, cy);
        expect(Math.hypot(p[0] - cx, p[1] - (cy + radius))).toBeCloseTo(Math.abs(radius), 9);
        len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        prev = p;
      }
      // Arc length is preserved (chord sum converges to it).
      expect(len).toBeCloseTo(rect.width, 1);
      expect(theta).toBeCloseTo((bend / 100) * Math.PI, 12);
    }
    // 100% bend: a half circle, sagitta equals the radius.
    const g = arcGeometry(100, 200);
    expect(g.sagitta).toBeCloseTo(g.radius, 9);
  });
  it('vertical axis transposes the mapping', () => {
    const r = { x: 0, y: 0, width: 50, height: 200 };
    const { sagitta } = arcGeometry(40, 200);
    const [tx] = warpPoint(w('arc', 40, { axis: 'vertical' }), r, 25, 0);
    expect(tx - 25).toBeCloseTo(sagitta, 9);
  });
  it('is invariant under translation and uniform scale', () => {
    for (const s of styles) {
      const a = warpPoint(w(s, 63, { horizontal: 20, vertical: -30 }), rect, 50, 30);
      const r2 = { x: rect.x * 3 + 7, y: rect.y * 3 - 4, width: rect.width * 3, height: rect.height * 3 };
      const b = warpPoint(w(s, 63, { horizontal: 20, vertical: -30 }), r2, 50 * 3 + 7, 30 * 3 - 4);
      expect(b[0]).toBeCloseTo(a[0] * 3 + 7, 6);
      expect(b[1]).toBeCloseTo(a[1] * 3 - 4, 6);
    }
  });
  it('all styles stay finite and continuous at extreme settings', () => {
    for (const s of styles)
      for (const bend of [-100, 100]) {
        const warp = w(s, bend, { horizontal: 100, vertical: -100 });
        let prev = warpPoint(warp, rect, rect.x, rect.y + 10);
        for (let i = 1; i <= 200; i++) {
          const p = warpPoint(warp, rect, rect.x + i, rect.y + 10);
          expect(Number.isFinite(p[0]) && Number.isFinite(p[1])).toBe(true);
          expect(Math.hypot(p[0] - prev[0], p[1] - prev[1])).toBeLessThan(10);
          prev = p;
        }
      }
  });
});

describe('bitmap warp', () => {
  it('returns the input unchanged for an identity warp', () => {
    const img = rgba8(5, 3, [1, 2, 3, 4]);
    const out = warpImage(img, w('arc', 0), { x: 0, y: 0, width: 5, height: 3 });
    expect(out.image).toBe(img);
    expect([out.x, out.y]).toEqual([0, 0]);
  });
  it('bends a horizontal stripe into an arc of the right sagitta', () => {
    const W = 200, H = 40;
    const img = rgba8(W, H);
    for (let y = 18; y < 22; y++) for (let x = 0; x < W; x++) img.data.set([255, 0, 0, 255], (y * W + x) * 4);
    const r = { x: 0, y: 0, width: W, height: H };
    const bend = 50;
    const { image, x: ox, y: oy } = warpImage(img, w('arc', bend), r);
    const centroid = (col: number) => {
      let s = 0, m = 0;
      for (let y = 0; y < image.height; y++) {
        const a = image.data[(y * image.width + col) * 4 + 3];
        s += a; m += a * (y + 0.5);
      }
      return m / s + oy;
    };
    const midCol = Math.round(W / 2 - ox - 0.5);
    expect(centroid(midCol)).toBeCloseTo(20, 0);
    // A point of the center line at u = -0.8 lands where warpPoint says.
    const [px, py] = warpPoint(w('arc', bend), r, 20, 20);
    expect(centroid(Math.round(px - ox - 0.5))).toBeCloseTo(py, 0);
    expect(py - 20).toBeGreaterThan(5);
  });
  it('never darkens colors at transparent edges (straight alpha)', () => {
    const img = rgba8(30, 30);
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) img.data.set([255, 128, 0, 255], (y * 30 + x) * 4);
    const { image } = warpImage(img, w('twist', 70), { x: 0, y: 0, width: 30, height: 30 });
    let edge = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      const a = image.data[i + 3];
      if (a === 0) continue;
      expect(image.data[i]).toBe(255);
      expect(Math.abs(image.data[i + 1] - 128)).toBeLessThanOrEqual(1);
      if (a < 255) edge++;
    }
    expect(edge).toBeGreaterThan(0);
  });
  it('handles a 1x1 bitmap', () => {
    const { image } = warpImage(rgba8(1, 1, [9, 9, 9, 255]), w('bulge', 80), { x: 0, y: 0, width: 1, height: 1 });
    expect(image.width).toBeGreaterThan(0);
    expect(Math.max(...Array.from(image.data).filter((_, i) => i % 4 === 3))).toBeGreaterThan(0);
  });
});
