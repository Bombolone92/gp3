import { describe, expect, it } from 'vitest';
import { layer, newDocument } from '../src/model/document';
import { Assets } from '../src/model/assets';
import type { PinFrame } from '../src/model/pin-warp';
import { rgba8 } from '../src/imaging/types';
import { renderPinFrame } from '../src/features/warp/pin-render';
import { setFrame } from '../src/features/embedded/frame';
import { effectiveFrame } from '../src/features/embedded/frame-math';
import { rectQuad, rotateM, about, mapQuad } from '../src/features/transform/math';
import { addPlane, emptyPlanes, perspectiveForward, perspectiveMap, planeMaps } from '../src/imaging/warp/perspective';

function bar() {
  // A 40 x 20 opaque bar, red left half, blue right half.
  const img = rgba8(40, 20);
  for (let i = 0; i < 800; i++) img.data.set(i % 40 < 20 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
  return img;
}
const pins = (moved: boolean): PinFrame => ({
  mode: 'rigid',
  density: 'normal',
  expansion: 0,
  width: 40,
  height: 20,
  pins: [
    { x: 5, y: 10, tx: 5, ty: 10, depth: 0 },
    { x: 35, y: 10, tx: 35, ty: moved ? 30 : 10, depth: 0 },
  ],
});

describe('pin frames of embedded objects', () => {
  it('render the content through the pins and the placement quad', () => {
    const doc = { width: 200, height: 200 };
    const quad = rectQuad({ x: 50, y: 60, width: 40, height: 20 });
    const still = renderPinFrame(bar(), quad, pins(false), doc, 'nearest')!;
    const px = (r: typeof still, x: number, y: number) => Array.from(r.image.data.slice(((y - r.rect.y) * r.image.width + (x - r.rect.x)) * 4, ((y - r.rect.y) * r.image.width + (x - r.rect.x)) * 4 + 4));
    // The mesh reaches a little past the content (transparent there).
    expect(still.rect.x).toBeLessThanOrEqual(50);
    expect(still.rect.x + still.rect.width).toBeGreaterThanOrEqual(90);
    expect(px(still, still.rect.x, still.rect.y)[3]).toBe(0);
    expect(px(still, 55, 70)).toEqual([255, 0, 0, 255]);
    expect(px(still, 85, 70)).toEqual([0, 0, 255, 255]);
    // Moving the right pin down swings the blue end below the original bar.
    const bent = renderPinFrame(bar(), quad, pins(true), doc, 'nearest')!;
    expect(bent.rect.y + bent.rect.height).toBeGreaterThan(85);
    expect(px(bent, 84, 88)).toEqual([0, 0, 255, 255]);
    // A content of another size keeps the pins at the same relative places.
    const big = rgba8(80, 40);
    for (let i = 0; i < 3200; i++) big.data.set(i % 80 < 40 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
    const scaled = renderPinFrame(big, quad, pins(true), doc, 'nearest')!;
    expect(Math.abs(scaled.rect.y + scaled.rect.height - (bent.rect.y + bent.rect.height))).toBeLessThanOrEqual(2);
  });

  it('keep their pins through turns of the placement, but not a new warp mesh', () => {
    const doc = newDocument(200, 200);
    const assets = new Assets();
    const l = layer('image', 'Bar', 40, 20);
    l.asset = 'cache';
    doc.embeds = { c: { id: 'c', name: 'Bar', width: 40, height: 20, composite: 'content', colorSpace: 'document' } };
    const quad = rectQuad({ x: 50, y: 60, width: 40, height: 20 });
    l.embed = { contents: 'c', frame: { quad: quad.map((p) => [p.x, p.y]) as [number, number][], rect: { x: 50, y: 60, width: 40, height: 50 }, source: 'content', pins: pins(true) } };
    l.transform = { x: 50, y: 60, width: 40, height: 50, rotation: 0 };
    doc.layers.push(l);
    // A quarter turn is still a rotated rectangle, but the pins need a frame.
    const turned = mapQuad(about(rotateM(90), 70, 70), quad);
    setFrame(doc, l, turned, undefined, assets);
    expect(l.embed.frame?.pins?.pins).toHaveLength(2);
    expect(l.embed.frame?.source).toBe('');
    expect(effectiveFrame(l)!.quad[0].x).toBeCloseTo(turned[0].x, 6);
    setFrame(doc, l, turned, { cols: 2, rows: 2, points: Float64Array.from(turned.flatMap((p) => [p.x, p.y])) }, assets);
    expect(l.embed.frame?.pins).toBeUndefined();
  });
});

describe('perspective forward map', () => {
  it('inverts the destination map inside and near the planes', () => {
    const set = addPlane(addPlane(emptyPlanes(), rectQuad({ x: 0, y: 0, width: 100, height: 100 }), 5), rectQuad({ x: 100, y: 0, width: 100, height: 100 }), 5);
    const warped = set.points.map((p) => ({ ...p }));
    const [, tr, br] = set.planes[1];
    warped[tr] = { x: 180, y: 20 };
    warped[br] = { x: 180, y: 80 };
    const maps = planeMaps(set.points, warped, set.planes);
    const forward = perspectiveForward(maps),
      inverse = perspectiveMap(maps);
    for (const [x, y] of [[50, 50], [150, 30], [190, 90]]) {
      const q = forward(x, y)!;
      const t = new Float64Array([q.x, q.y]);
      inverse(q.x, q.y, t);
      expect(t[0]).toBeCloseTo(x, 6);
      expect(t[1]).toBeCloseTo(y, 6);
    }
    // Outside the planes it stays continuous with them.
    const a = forward(200.001, 50)!,
      b = forward(199.999, 50)!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.05);
  });
});
