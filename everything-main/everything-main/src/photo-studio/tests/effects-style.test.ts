import { describe, expect, it } from 'vitest';
import {
  alphaBounds,
  boxSizesForGauss,
  compositeLayerStyle,
  contourLut,
  contourPresets,
  defaultBevel,
  defaultDropShadow,
  defaultInnerShadow,
  defaultStroke,
  findContour,
  gaussianBlur,
  renderLayerStyle,
  signedDistance,
  squaredDistance,
  stylePreset,
  stylePresets,
  styleBoundsExpansion,
  type LayerStyle,
  type LayerStyleResult,
  type ShadowFx,
} from '../src/imaging/effects';
import { findPatternPreset } from '../src/imaging/pattern';
import { rgba8, type RGBA8 } from '../src/imaging/types';

const patterns = (id: string) => findPatternPreset(id);
// Opaque square [x0, x1) x [y0, y1) in a w x h document.
function square(w: number, h: number, x0: number, y0: number, x1: number, y1: number, color: [number, number, number] = [0, 0, 255]): RGBA8 {
  const img = rgba8(w, h);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) img.data.set([...color, 255], (y * w + x) * 4);
  return img;
}
function disc(w: number, h: number, cx: number, cy: number, r: number): RGBA8 {
  const img = rgba8(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let cov = 0;
      for (let s = 0; s < 16; s++) if (Math.hypot(x + ((s & 3) + 0.5) / 4 - cx, y + ((s >> 2) + 0.5) / 4 - cy) < r) cov++;
      img.data.set([200, 40, 40, (cov * 255) / 16], (y * w + x) * 4);
    }
  return img;
}
// Pixel of a result image at document coordinates.
function px(img: RGBA8 | null, r: LayerStyleResult, x: number, y: number): number[] {
  if (!img) return [0, 0, 0, 0];
  const lx = x - r.bounds.x, ly = y - r.bounds.y;
  if (lx < 0 || ly < 0 || lx >= r.bounds.width || ly >= r.bounds.height) return [0, 0, 0, 0];
  const i = (ly * img.width + lx) * 4;
  return [...img.data.slice(i, i + 4)];
}
const hardShadow = (angle: number, distance: number, extra: Partial<ShadowFx> = {}): ShadowFx => ({
  ...defaultDropShadow(), blendMode: 'normal', opacity: 1, size: 0, angle, distance, useGlobalLight: false, knockout: false, ...extra,
});

describe('distance transform and blur primitives', () => {
  it('squaredDistance is exact against brute force, and sites are nearest seeds', () => {
    const w = 23, h = 17;
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const seeds = Array.from({ length: w * h }, () => rnd() < 0.04);
    const site = new Int32Array(w * h);
    const d = squaredDistance(w, h, (i) => seeds[i], undefined, site);
    for (let i = 0; i < w * h; i++) {
      let best = Infinity;
      for (let j = 0; j < w * h; j++)
        if (seeds[j]) best = Math.min(best, ((i % w) - (j % w)) ** 2 + (Math.floor(i / w) - Math.floor(j / w)) ** 2);
      expect(d[i]).toBe(best);
      const s = site[i];
      expect(seeds[s]).toBe(true);
      expect(((i % w) - (s % w)) ** 2 + (Math.floor(i / w) - Math.floor(s / w)) ** 2).toBe(best);
    }
  });
  it('signed distance of a binary shape is the center distance to the edge', () => {
    const w = 30, h = 30, a = new Float32Array(w * h);
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) a[y * w + x] = 1;
    const sd = signedDistance(a, w, h);
    expect(sd[15 * w + 20]).toBeCloseTo(0.5, 6);
    expect(sd[15 * w + 24]).toBeCloseTo(4.5, 6);
    expect(sd[15 * w + 19]).toBeCloseTo(-0.5, 6);
    expect(sd[15 * w + 15]).toBeCloseTo(-4.5, 6);
    expect(sd[24 * w + 24]).toBeCloseTo(Math.hypot(5, 5) - 0.5, 5);
  });
  it('signed distance uses coverage for sub-pixel edges', () => {
    const w = 20, h = 5, a = new Float32Array(w * h);
    // Edge at x = 10.3: pixel 10 is 30% covered.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < 10; x++) a[y * w + x] = 1;
      a[y * w + 10] = 0.3;
    }
    const sd = signedDistance(a, w, h);
    for (const x of [8, 9, 10, 11, 12, 15]) expect(sd[2 * w + x]).toBeCloseTo(x + 0.5 - 10.3, 5);
  });
  it('box sizes approximate the requested sigma and blur preserves constants and mass', () => {
    // Integer boxes are coarse for tiny sigmas; they converge quickly.
    for (const [sigma, tol] of [[1, 0.25], [2.5, 0.12], [6, 0.05], [20, 0.02]]) {
      const sizes = boxSizesForGauss(sigma);
      const variance = sizes.reduce((s, b) => s + (b * b - 1) / 12, 0);
      expect(Math.abs(Math.sqrt(variance) - sigma) / sigma).toBeLessThan(tol);
    }
    const w = 64, h = 64;
    const flat = new Float32Array(w * h).fill(0.7);
    gaussianBlur(flat, w, h, 5, 0.7);
    expect(Math.max(...flat.map((v) => Math.abs(v - 0.7)))).toBeLessThan(1e-5);
    const dot = new Float32Array(w * h);
    dot[32 * w + 32] = 1;
    gaussianBlur(dot, w, h, 4, 0);
    expect(dot.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 5);
    expect(dot[32 * w + 32]).toBeGreaterThan(dot[32 * w + 36]);
    expect(dot[32 * w + 36]).toBeCloseTo(dot[36 * w + 32], 6);
  });
});

describe('contours', () => {
  it('linear is the identity; presets stay in range; cone peaks in the middle', () => {
    const lin = contourLut(undefined);
    for (let i = 0; i < lin.length; i += 97) expect(lin[i]).toBeCloseTo(i / (lin.length - 1), 5);
    expect(contourPresets.length).toBeGreaterThanOrEqual(8);
    for (const c of contourPresets) for (const v of contourLut(c)) expect(v >= 0 && v <= 1).toBe(true);
    const cone = contourLut(findContour('Cone'));
    expect(cone[512]).toBeGreaterThan(0.99);
    expect(cone[0]).toBe(0);
    expect(cone[1023]).toBe(0);
    expect(cone[256]).toBeCloseTo(0.5, 2);
  });
  it('monotone data gives a monotone curve without overshoot', () => {
    const lut = contourLut(findContour('Rolling Slope'));
    const cove = contourLut(findContour('Cove'));
    for (let i = 1; i < cove.length; i++) expect(cove[i]).toBeGreaterThanOrEqual(cove[i - 1] - 1e-6);
    expect(Math.max(...lut)).toBeLessThanOrEqual(1);
  });
  it('anti-aliasing softens corners', () => {
    const saw = findContour('Saw Teeth')!;
    const hard = contourLut(saw, false), soft = contourLut(saw, true);
    // The sharp peaks get rounded off.
    const peak = (l: Float32Array) => Math.max(...l.slice(250, 400));
    expect(peak(soft)).toBeLessThan(peak(hard) - 0.03);
    expect(soft[Math.round(0.33 * 1023)]).toBeLessThan(hard[Math.round(0.32 * 1023)]);
  });
});

describe('drop shadow geometry', () => {
  const layer = square(100, 100, 40, 40, 60, 60);
  const shadowAt = (fx: ShadowFx) => renderLayerStyle(layer, { enabled: true, dropShadow: [fx] }, { fillOpacity: 1, patterns });
  it('angle is the light direction: offset = distance * (-cos a, +sin a) on screen', () => {
    const cases: [number, number, number][] = [[90, 0, 10], [0, -10, 0], [180, 10, 0], [270, 0, -10], [120, 5, 9]];
    for (const [angle, dx, dy] of cases) {
      const r = shadowAt(hardShadow(angle, 10));
      expect(px(r.below, r, 40 + dx, 40 + dy)[3], `angle ${angle}`).toBe(255);
      expect(px(r.below, r, 59 + dx, 59 + dy)[3], `angle ${angle}`).toBe(255);
      expect(px(r.below, r, 39 + dx, 50 + dy)[3], `angle ${angle}`).toBe(0);
      expect(px(r.below, r, 60 + dx, 50 + dy)[3], `angle ${angle}`).toBe(0);
    }
  });
  it('global light overrides the effect angle', () => {
    const r = renderLayerStyle(layer, { enabled: true, globalAngle: 90, dropShadow: [hardShadow(0, 10, { useGlobalLight: true })] }, { fillOpacity: 1, patterns });
    expect(px(r.below, r, 50, 65)[3]).toBe(255);
    expect(px(r.below, r, 35, 50)[3]).toBe(0);
  });
  it('the layer knocks out the shadow under it when enabled', () => {
    const r = shadowAt(hardShadow(90, 10, { knockout: true }));
    expect(px(r.below, r, 50, 55)[3]).toBe(0);
    expect(px(r.below, r, 50, 65)[3]).toBe(255);
  });
  it('size blurs, spread hardens, and the bounds cover the reach', () => {
    const soft = shadowAt(hardShadow(90, 0, { size: 10 }));
    const edge = px(soft.below, soft, 50, 60)[3];
    expect(Math.abs(edge - 128)).toBeLessThanOrEqual(20); // half way at the edge
    expect(px(soft.below, soft, 50, 66)[3]).toBeGreaterThan(0);
    expect(px(soft.below, soft, 50, 72)[3]).toBe(0);
    // Spread 0.8 grows the matte 8 px and blurs over the remaining 2 px, so
    // the shadow is solid for about 6 px.
    const spread = shadowAt(hardShadow(90, 0, { size: 10, spread: 0.8 }));
    expect(px(spread.below, spread, 50, 65)[3]).toBe(255);
    expect(px(spread.below, spread, 50, 68)[3]).toBeLessThan(255);
    expect(px(spread.below, spread, 50, 68)[3]).toBeGreaterThan(px(soft.below, soft, 50, 68)[3]);
    expect(soft.bounds.y + soft.bounds.height).toBeGreaterThanOrEqual(72);
    const e = styleBoundsExpansion({ enabled: true, dropShadow: [hardShadow(90, 10, { size: 5 })] });
    expect(e).toEqual({ left: 7, top: 0, right: 7, bottom: 17 });
  });
  it('noise is deterministic', () => {
    const fx = hardShadow(90, 4, { size: 8, noise: 0.5 });
    expect(shadowAt(fx).below!.data).toEqual(shadowAt(fx).below!.data);
  });
});

describe('strokes', () => {
  const layer = square(100, 100, 40, 40, 60, 60);
  const stroke = (position: 'outside' | 'inside' | 'center', size = 5) =>
    renderLayerStyle(layer, { enabled: true, stroke: [{ ...defaultStroke(), size, position, fill: { type: 'color', color: [255, 0, 0] } }] }, { fillOpacity: 1, patterns });
  it('outside stroke covers exactly `size` pixels beyond the edge', () => {
    const r = stroke('outside', 5);
    for (let x = 60; x < 65; x++) expect(px(r.above, r, x, 50)).toEqual([255, 0, 0, 255]);
    expect(px(r.above, r, 65, 50)[3]).toBe(0);
    for (let x = 35; x < 40; x++) expect(px(r.above, r, x, 50)[3]).toBe(255);
    expect(px(r.above, r, 34, 50)[3]).toBe(0);
    expect(px(r.above, r, 50, 50)[3]).toBe(0);
    expect(px(r.layer, r, 50, 50)).toEqual([0, 0, 255, 255]);
    // Corners are rounded: inside the diagonal reach, outside the square's corner box.
    expect(px(r.above, r, 62, 62)[3]).toBe(255);
    expect(px(r.above, r, 64, 64)[3]).toBe(0);
  });
  it('fractional sizes give fractional coverage on the last pixel', () => {
    const r = stroke('outside', 2.25);
    expect(px(r.above, r, 61, 50)[3]).toBe(255);
    expect(Math.abs(px(r.above, r, 62, 50)[3] - 64)).toBeLessThanOrEqual(1);
  });
  it('inside stroke recolors the inner band of the layer and nothing outside', () => {
    const r = stroke('inside', 4);
    expect(r.above).toBeNull();
    expect(px(r.layer, r, 40, 50)).toEqual([255, 0, 0, 255]);
    expect(px(r.layer, r, 43, 50)).toEqual([255, 0, 0, 255]);
    expect(px(r.layer, r, 44, 50)).toEqual([0, 0, 255, 255]);
    expect(px(r.layer, r, 39, 50)[3]).toBe(0);
  });
  it('center stroke splits the size across the edge', () => {
    const r = stroke('center', 6);
    expect(px(r.above, r, 62, 50)[3]).toBe(255);
    expect(px(r.above, r, 63, 50)[3]).toBe(0);
    expect(px(r.layer, r, 57, 50)).toEqual([255, 0, 0, 255]);
    expect(px(r.layer, r, 56, 50)).toEqual([0, 0, 255, 255]);
  });
  it('an outside stroke leaves no seam at an anti-aliased edge', () => {
    const d = disc(80, 80, 40, 40, 20);
    const back = rgba8(80, 80, [255, 255, 255, 255]);
    const style: LayerStyle = { enabled: true, stroke: [{ ...defaultStroke(), size: 3, fill: { type: 'color', color: [0, 0, 0] } }] };
    compositeLayerStyle(back, d, style, { fillOpacity: 1, patterns });
    // Along the ring between shape and stroke no pixel may let white through.
    for (let t = 0; t < 360; t += 3) {
      const a = (t * Math.PI) / 180;
      for (const rr of [19.6, 20, 20.4]) {
        const x = Math.floor(40 + Math.cos(a) * rr), y = Math.floor(40 + Math.sin(a) * rr);
        const i = (y * 80 + x) * 4;
        expect(Math.min(back.data[i], back.data[i + 1], back.data[i + 2]), `${x},${y}`).toBeLessThan(215);
      }
    }
  });
  it('gradient and pattern fills, including shape burst', () => {
    const grad = { kind: 'solid' as const, colorStops: [{ location: 0, color: [0, 0, 0] as [number, number, number] }, { location: 1, color: [255, 255, 255] as [number, number, number] }], opacityStops: [{ location: 0, opacity: 1 }, { location: 1, opacity: 1 }] };
    const r = renderLayerStyle(layer, { enabled: true, stroke: [{ ...defaultStroke(), size: 10, fill: { type: 'gradient', gradient: grad, style: 'shape-burst', angle: 0, scale: 1, method: 'classic' } }] }, { fillOpacity: 1, patterns });
    const inner = px(r.above, r, 60, 50)[0], outer = px(r.above, r, 69, 50)[0];
    expect(inner).toBeLessThan(40);
    expect(outer).toBeGreaterThan(215);
    const p = renderLayerStyle(layer, { enabled: true, stroke: [{ ...defaultStroke(), size: 4, fill: { type: 'pattern', patternId: 'checker', scale: 1 } }] }, { fillOpacity: 1, patterns });
    const tile = findPatternPreset('checker')!.tile;
    expect(px(p.above, p, 62, 50).slice(0, 3)).toEqual([...tile.data.slice((18 * 32 + 30) * 4, (18 * 32 + 30) * 4 + 3)]);
  });
});

describe('interior effects', () => {
  const layer = square(100, 100, 30, 30, 70, 70, [200, 200, 200]);
  it('inner shadow stays inside the alpha and falls on the lit side of the inner edge', () => {
    const style: LayerStyle = { enabled: true, innerShadow: [{ ...defaultInnerShadow(), blendMode: 'normal', opacity: 1, angle: 90, useGlobalLight: false, distance: 6, size: 0 }] };
    const r = renderLayerStyle(layer, style, { fillOpacity: 1, patterns });
    expect(r.below).toBeNull();
    expect(r.above).toBeNull();
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 100; x++) expect(px(r.layer, r, x, y)[3]).toBe(px(layer as never, { bounds: { x: 0, y: 0, width: 100, height: 100 } } as never, x, y)[3]);
    expect(px(r.layer, r, 50, 31).slice(0, 3)).toEqual([0, 0, 0]); // top band, light from above
    expect(px(r.layer, r, 50, 35).slice(0, 3)).toEqual([0, 0, 0]);
    expect(px(r.layer, r, 50, 36).slice(0, 3)).toEqual([200, 200, 200]);
    expect(px(r.layer, r, 50, 68).slice(0, 3)).toEqual([200, 200, 200]); // bottom edge untouched
  });
  it('fill opacity 0 removes the fill but keeps effects at full strength', () => {
    const style: LayerStyle = {
      enabled: true,
      dropShadow: [hardShadow(90, 5)],
      stroke: [{ ...defaultStroke(), size: 3, fill: { type: 'color', color: [0, 255, 0] } }],
    };
    const r = renderLayerStyle(layer, style, { fillOpacity: 0, patterns });
    expect(px(r.layer, r, 50, 50)[3]).toBe(0);
    expect(px(r.below, r, 50, 72)[3]).toBe(255);
    expect(px(r.below, r, 50, 50)[3]).toBe(255); // no knockout requested
    expect(px(r.above, r, 71, 50)).toEqual([0, 255, 0, 255]);
    const overlay = renderLayerStyle(layer, { enabled: true, colorOverlay: [{ enabled: true, blendMode: 'normal', opacity: 1, color: [9, 8, 7] }] }, { fillOpacity: 0, patterns });
    expect(px(overlay.layer, overlay, 50, 50)).toEqual([9, 8, 7, 255]);
    const half = renderLayerStyle(layer, {}as LayerStyle, { fillOpacity: 0.5, patterns });
    expect(px(half.layer, half, 50, 50)[3]).toBe(128);
  });
  it('color overlay keeps the soft edge of the layer and honors blend modes', () => {
    const d = disc(60, 60, 30, 30, 15);
    const r = renderLayerStyle(d, { enabled: true, colorOverlay: [{ enabled: true, blendMode: 'normal', opacity: 1, color: [0, 255, 0] }] }, { fillOpacity: 1, patterns });
    for (let i = 0; i < d.data.length; i += 4) {
      const x = (i / 4) % 60, y = Math.floor(i / 240);
      expect(px(r.layer, r, x, y)[3]).toBe(d.data[i + 3]);
    }
    const m = renderLayerStyle(layer, { enabled: true, colorOverlay: [{ enabled: true, blendMode: 'multiply', opacity: 1, color: [128, 255, 0] }] }, { fillOpacity: 1, patterns });
    expect(px(m.layer, m, 50, 50)).toEqual([100, 200, 0, 255]);
  });
  it('gradient overlay spans the layer bounds along the angle', () => {
    const g = { kind: 'solid' as const, colorStops: [{ location: 0, color: [0, 0, 0] as [number, number, number] }, { location: 1, color: [255, 255, 255] as [number, number, number] }], opacityStops: [{ location: 0, opacity: 1 }, { location: 1, opacity: 1 }] };
    const r = renderLayerStyle(layer, { enabled: true, gradientOverlay: [{ enabled: true, blendMode: 'normal', opacity: 1, gradient: g, style: 'linear', angle: 0, scale: 1, alignWithLayer: true, method: 'classic' }] }, { fillOpacity: 1, patterns });
    expect(px(r.layer, r, 30, 50)[0]).toBeLessThan(8);
    expect(px(r.layer, r, 69, 50)[0]).toBeGreaterThan(247);
    expect(Math.abs(px(r.layer, r, 50, 50)[0] - 134)).toBeLessThanOrEqual(4);
    const up = renderLayerStyle(layer, { enabled: true, gradientOverlay: [{ enabled: true, blendMode: 'normal', opacity: 1, gradient: g, style: 'linear', angle: 90, scale: 1, alignWithLayer: true, method: 'classic' }] }, { fillOpacity: 1, patterns });
    expect(px(up.layer, up, 50, 69)[0]).toBeLessThan(8); // angle 90 starts at the bottom
  });
  it('pattern overlay links to the layer origin', () => {
    const r = renderLayerStyle(layer, { enabled: true, patternOverlay: { enabled: true, blendMode: 'normal', opacity: 1, patternId: 'bricks', scale: 1, linkWithLayer: true } }, { fillOpacity: 1, patterns });
    const tile = findPatternPreset('bricks')!.tile;
    expect(px(r.layer, r, 30, 30)).toEqual([...tile.data.slice(0, 4)]);
    expect(px(r.layer, r, 35, 32)).toEqual([...tile.data.slice((2 * tile.width + 5) * 4, (2 * tile.width + 5) * 4 + 4)]);
    const missing = renderLayerStyle(layer, { enabled: true, patternOverlay: { enabled: true, blendMode: 'normal', opacity: 1, patternId: 'nope', scale: 1 } }, { fillOpacity: 1, patterns });
    expect(px(missing.layer, missing, 50, 50)).toEqual([200, 200, 200, 255]);
  });
  it('inner glow from the edge brightens the rim; from the center brightens the middle', () => {
    const glow = (source: 'edge' | 'center') => renderLayerStyle(layer, {
      enabled: true,
      innerGlow: { enabled: true, blendMode: 'normal', opacity: 1, fill: { type: 'color', color: [255, 255, 0] }, technique: 'precise', spread: 0, size: 10, range: 0.5, jitter: 0, source },
    }, { fillOpacity: 1, patterns });
    const e = glow('edge'), c = glow('center');
    expect(px(e.layer, e, 30, 50)[2]).toBeLessThan(30);
    expect(px(e.layer, e, 50, 50)).toEqual([200, 200, 200, 255]);
    expect(px(c.layer, c, 50, 50)).toEqual([255, 255, 0, 255]);
    expect(px(c.layer, c, 30, 50)[2]).toBeGreaterThan(170);
  });
  it('satin darkens only inside, symmetric about its axis', () => {
    const r = renderLayerStyle(layer, { enabled: true, satin: { enabled: true, blendMode: 'normal', opacity: 1, color: [0, 0, 0], angle: 0, distance: 8, size: 6, invert: false } }, { fillOpacity: 1, patterns });
    expect(px(r.layer, r, 50, 50)[0]).toBe(200); // the two copies cancel in the middle
    expect(px(r.layer, r, 33, 50)[0]).toBeLessThan(150);
    expect(Math.abs(px(r.layer, r, 33, 50)[0] - px(r.layer, r, 66, 50)[0])).toBeLessThanOrEqual(2);
    expect(r.above).toBeNull();
    expect(r.below).toBeNull();
  });
});

describe('outer glow', () => {
  const layer = square(120, 120, 40, 40, 80, 80);
  it('precise technique falls off linearly with distance', () => {
    const r = renderLayerStyle(layer, {
      enabled: true,
      outerGlow: { enabled: true, blendMode: 'normal', opacity: 1, fill: { type: 'color', color: [255, 255, 0] }, technique: 'precise', spread: 0, size: 10, range: 0.5, jitter: 0 },
    }, { fillOpacity: 1, patterns });
    for (const d of [0, 2, 5, 8]) expect(Math.abs(px(r.below, r, 80 + d, 60)[3] - (1 - (d + 0.5) / 10) * 255)).toBeLessThanOrEqual(1);
    expect(px(r.below, r, 91, 60)[3]).toBe(0);
    expect(px(r.below, r, 60, 60)[3]).toBe(0); // outer glow stays outside the shape
  });
  it('gradient fill colors the falloff', () => {
    const g = { kind: 'solid' as const, colorStops: [{ location: 0, color: [255, 0, 0] as [number, number, number] }, { location: 1, color: [0, 0, 255] as [number, number, number] }], opacityStops: [{ location: 0, opacity: 1 }, { location: 1, opacity: 1 }] };
    const r = renderLayerStyle(layer, {
      enabled: true,
      outerGlow: { enabled: true, blendMode: 'normal', opacity: 1, fill: { type: 'gradient', gradient: g }, technique: 'precise', spread: 0, size: 10, range: 0.5, jitter: 0 },
    }, { fillOpacity: 1, patterns });
    const near = px(r.below, r, 80, 60), far = px(r.below, r, 88, 60);
    expect(near[0]).toBeGreaterThan(near[2]);
    expect(far[2]).toBeGreaterThan(far[0]);
  });
});

describe('bevel and emboss', () => {
  const layer = square(100, 100, 30, 30, 70, 70, [128, 128, 128]);
  const bevel = (over: Partial<ReturnType<typeof defaultBevel>>) =>
    renderLayerStyle(layer, { enabled: true, bevel: { ...defaultBevel(), angle: 135, useGlobalLight: false, size: 8, ...over } }, { fillOpacity: 1, patterns });
  it('inner bevel lights the edges facing the light and shades the others, flat center untouched', () => {
    for (const technique of ['smooth', 'chisel-hard', 'chisel-soft'] as const) {
      const r = bevel({ technique });
      expect(r.above, technique).toBeNull();
      expect(px(r.layer, r, 50, 32)[0], technique).toBeGreaterThan(150); // top edge
      expect(px(r.layer, r, 32, 50)[0], technique).toBeGreaterThan(150); // left edge
      expect(px(r.layer, r, 50, 67)[0], technique).toBeLessThan(100); // bottom edge
      expect(px(r.layer, r, 67, 50)[0], technique).toBeLessThan(100); // right edge
      expect(px(r.layer, r, 50, 50), technique).toEqual([128, 128, 128, 255]);
      expect(px(r.layer, r, 28, 50)[3], technique).toBe(0);
    }
  });
  it('direction down swaps highlight and shadow', () => {
    const r = bevel({ direction: 'down' });
    expect(px(r.layer, r, 50, 32)[0]).toBeLessThan(100);
    expect(px(r.layer, r, 50, 67)[0]).toBeGreaterThan(150);
  });
  it('outer bevel and emboss draw outside the shape; inner parts only for emboss', () => {
    const outer = bevel({ style: 'outer-bevel' });
    expect(outer.above).not.toBeNull();
    expect(px(outer.above, outer, 50, 27)[3]).toBeGreaterThan(0);
    expect(px(outer.layer, outer, 50, 32)).toEqual([128, 128, 128, 255]);
    const emb = bevel({ style: 'emboss' });
    expect(px(emb.above, emb, 50, 27)[3]).toBeGreaterThan(0);
    expect(px(emb.layer, emb, 50, 32)[0]).not.toBe(128);
    const pillow = bevel({ style: 'pillow-emboss' });
    // Pillow: inside top edge lit, outside top edge shaded (a groove at the edge).
    expect(px(pillow.layer, pillow, 50, 32)[0]).toBeGreaterThan(128);
    const outsideTop = px(pillow.above, pillow, 50, 27);
    expect(outsideTop[3]).toBeGreaterThan(0);
    expect(outsideTop[0]).toBeLessThan(80);
  });
  it('stroke emboss needs a stroke and shades it', () => {
    const none = bevel({ style: 'stroke-emboss' });
    expect(none.above).toBeNull();
    const r = renderLayerStyle(layer, {
      enabled: true,
      bevel: { ...defaultBevel(), style: 'stroke-emboss', angle: 135, useGlobalLight: false, size: 4 },
      stroke: [{ ...defaultStroke(), size: 6, fill: { type: 'color', color: [128, 128, 128] } }],
    }, { fillOpacity: 1, patterns });
    expect(px(r.above, r, 50, 25)[0]).not.toBe(128);
  });
  it('texture adds bumps inside the shape', () => {
    const flat = bevel({});
    const tex = bevel({ texture: { patternId: 'bubbles', scale: 1, depth: 2 } });
    let changed = 0;
    for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) if (px(tex.layer, tex, x, y)[0] !== px(flat.layer, flat, x, y)[0]) changed++;
    expect(changed).toBeGreaterThan(20);
  });
});

describe('render plumbing', () => {
  const layer = square(64, 64, 20, 20, 40, 40);
  it('empty layers, disabled styles and 1x1 layers', () => {
    const empty = renderLayerStyle(rgba8(10, 10), { enabled: true, dropShadow: [defaultDropShadow()] }, { fillOpacity: 1, patterns });
    expect(empty.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    const off = renderLayerStyle(layer, { enabled: false, dropShadow: [defaultDropShadow()] }, { fillOpacity: 0.5, patterns });
    expect(off.below).toBeNull();
    expect(off.bounds).toEqual({ x: 20, y: 20, width: 20, height: 20 });
    expect(px(off.layer, off, 25, 25)[3]).toBe(128);
    const one = rgba8(1, 1, [10, 20, 30, 255]);
    const r = renderLayerStyle(one, { enabled: true, stroke: [defaultStroke()], dropShadow: [defaultDropShadow()], bevel: defaultBevel() }, { fillOpacity: 1, patterns });
    expect(r.bounds).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(r.layer.data.every((v) => Number.isFinite(v))).toBe(true);
  });
  it('bounds clip to the document while effects near the edge still render', () => {
    const edge = square(50, 50, 0, 0, 20, 20);
    const r = renderLayerStyle(edge, { enabled: true, stroke: [{ ...defaultStroke(), size: 4 }] }, { fillOpacity: 1, patterns });
    // 20 px of content + 4 px stroke + 2 px safety margin + 1 px padding.
    expect(r.bounds).toEqual({ x: 0, y: 0, width: 27, height: 27 });
    expect(px(r.above, r, 22, 5)[3]).toBe(255);
  });
  it('alphaBounds finds the content rectangle', () => {
    expect(alphaBounds(layer)).toEqual({ x: 20, y: 20, width: 20, height: 20 });
  });
  it('separate passes carry blend modes and compositeLayerStyle applies them with layer opacity', () => {
    const style: LayerStyle = { enabled: true, dropShadow: [hardShadow(90, 4, { blendMode: 'multiply', color: [255, 0, 0] })], stroke: [{ ...defaultStroke(), size: 2 }] };
    const r = renderLayerStyle(layer, style, { fillOpacity: 1, patterns, separatePasses: true });
    expect(r.passes!.map((p) => [p.stage, p.effect, p.mode])).toEqual([['below', 'drop-shadow', 'multiply'], ['above', 'stroke', 'normal']]);
    const back = rgba8(64, 64, [0, 255, 255, 255]);
    compositeLayerStyle(back, layer, style, { fillOpacity: 1, patterns });
    const at = (x: number, y: number) => [...back.data.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)];
    expect(at(30, 43)).toEqual([0, 0, 0, 255]); // red multiplied onto cyan
    expect(at(30, 30)).toEqual([0, 0, 255, 255]);
    const faded = rgba8(64, 64, [255, 255, 255, 255]);
    compositeLayerStyle(faded, layer, style, { fillOpacity: 1, patterns, layerOpacity: 0.5 });
    expect([...faded.data.slice((30 * 64 + 30) * 4, (30 * 64 + 30) * 4 + 4)]).toEqual([128, 128, 255, 255]);
  });
  it('cancellation is honored', () => {
    expect(() => renderLayerStyle(layer, { enabled: true, dropShadow: [defaultDropShadow()] }, { fillOpacity: 1, patterns, progress: { cancelled: () => true } })).toThrow('cancelled');
  });
});

describe('style presets', () => {
  it('ships about ten original presets that all render cleanly', () => {
    expect(stylePresets.length).toBeGreaterThanOrEqual(10);
    expect(new Set(stylePresets.map((p) => p.name)).size).toBe(stylePresets.length);
    const shape = disc(120, 120, 60, 60, 30);
    for (const p of stylePresets) {
      const r = renderLayerStyle(shape, stylePreset(p.id)!, { fillOpacity: 1, patterns });
      expect(r.below || r.above || r.layer, p.id).toBeTruthy();
      for (const img of [r.below, r.layer, r.above]) if (img) expect(img.data.length).toBe(r.bounds.width * r.bounds.height * 4);
      const changed = r.layer.data.some((v, i) => v !== shape.data[((r.bounds.y + Math.floor(i / 4 / r.bounds.width)) * 120 + r.bounds.x + ((i / 4) % r.bounds.width)) * 4 + (i % 4)]);
      expect(changed || !!r.below || !!r.above, p.id).toBe(true);
    }
    const a = stylePreset('outline')!, b = stylePreset('outline')!;
    a.stroke![0].size = 99;
    expect(b.stroke![0].size).toBe(3);
  });
});

describe('performance', () => {
  // Timed by process CPU time, which shared-machine load inflates far less
  // than wall time; the target is ~400 ms on an idle machine.
  it('shadow + glow + bevel + stroke on a 2000x2000 layer', () => {
    const W = 2000, layer = rgba8(W, W);
    // Centered rounded square, anti-aliased by its distance to the edge.
    for (let y = 400; y < 1600; y++)
      for (let x = 400; x < 1600; x++) {
        const dx = Math.max(Math.abs(x + 0.5 - W / 2) - 500, 0), dy = Math.max(Math.abs(y + 0.5 - W / 2) - 500, 0);
        const cov = Math.min(1, Math.max(0, 100.5 - Math.hypot(dx, dy)));
        if (cov > 0) layer.data.set([60, 120, 220, cov * 255], (y * W + x) * 4);
      }
    const style: LayerStyle = {
      enabled: true,
      dropShadow: [{ ...defaultDropShadow(), distance: 20, size: 40 }],
      outerGlow: { enabled: true, blendMode: 'screen', opacity: 0.6, fill: { type: 'color', color: [255, 255, 200] }, technique: 'softer', spread: 0, size: 30, range: 0.5, jitter: 0 },
      bevel: { ...defaultBevel(), size: 20, soften: 2 },
      stroke: [{ ...defaultStroke(), size: 6 }],
    };
    let best = Infinity, r: LayerStyleResult | undefined;
    for (let i = 0; i < 3; i++) {
      const c0 = process.cpuUsage(), t0 = performance.now();
      r = renderLayerStyle(layer, style, { fillOpacity: 1, patterns });
      const c = process.cpuUsage(c0);
      best = Math.min(best, (c.user + c.system) / 1000);
      console.log(`full style on 2000x2000: ${(performance.now() - t0).toFixed(0)} ms wall, ${((c.user + c.system) / 1000).toFixed(0)} ms cpu, bounds ${r.bounds.width}x${r.bounds.height}`);
    }
    expect(r!.below && r!.above).toBeTruthy();
    expect(best).toBeLessThan(2500);
  }, 120_000);
});
