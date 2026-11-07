import { describe, expect, it } from 'vitest';
import { rgba8 } from '../src/imaging/types';
import {
  bilinearSampler,
  cloneMatrix,
  destinationOf,
  identityCloneTransform,
  isTranslation,
  mappedSampler,
  renderMapped,
  sourceMapping,
} from '../src/imaging/retouch/clone-transform';
import { layersBelow, withoutAdjustments } from '../src/features/clone-source/state';
import { layer, type Layer } from '../src/model/document';

const close = (a: number[], b: number[], eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);

describe('clone source mapping', () => {
  it('is a translation by the anchor offset without a transform', () => {
    const map = sourceMapping([10, 20], [50, 60], identityCloneTransform());
    expect(map(50, 60)).toEqual([10, 20]);
    expect(map(53, 58)).toEqual([13, 18]);
    expect(isTranslation(identityCloneTransform())).toBe(true);
  });
  it('scales about the source point', () => {
    const t = { ...identityCloneTransform(), scaleW: 200, scaleH: 50 };
    const map = sourceMapping([10, 10], [100, 100], t);
    // Twice as large in the destination: ten pixels there are five in the source.
    expect(close(map(110, 100), [15, 10])).toBe(true);
    expect(close(map(100, 105), [10, 20])).toBe(true);
    expect(isTranslation(t)).toBe(false);
  });
  it('rotates and flips, and destinationOf inverts the mapping', () => {
    const t = { ...identityCloneTransform(), rotation: 90, flipH: true, scaleW: 150 };
    const S: [number, number] = [30, 40],
      D: [number, number] = [200, 120];
    const map = sourceMapping(S, D, t);
    for (const p of [[205, 118], [190, 150], [200, 120]] as [number, number][]) {
      const s = map(p[0], p[1]);
      expect(close(destinationOf(S, D, t, s), p, 1e-6)).toBe(true);
    }
    // A 90° rotation turns the source's +x axis into the destination's +y axis.
    const [a, b] = cloneMatrix({ ...identityCloneTransform(), rotation: 90 });
    expect(close([a, b], [0, 1])).toBe(true);
  });
});

describe('clone samplers', () => {
  it('bilinear sampling hits pixel centers exactly and blends premultiplied', () => {
    const img = rgba8(2, 1);
    img.data.set([255, 0, 0, 255, 0, 0, 255, 0]);
    const s = bilinearSampler(img);
    const out = new Uint8ClampedArray(4);
    expect(s(0.5, 0.5, out)).toBe(true);
    expect([...out]).toEqual([255, 0, 0, 255]);
    // Halfway towards a transparent pixel: the color stays red, alpha halves.
    s(1, 0.5, out);
    expect(out[0]).toBe(255);
    expect(out[2]).toBe(0);
    expect(out[3]).toBeCloseTo(128, -1);
    expect(s(-5, -5, out)).toBe(false);
  });
  it('renders a mapped rectangle and keeps translations crisp', () => {
    const img = rgba8(4, 4);
    for (let i = 0; i < 16; i++) img.data.set([i * 10, 0, 0, 255], i * 4);
    const nearest = (x: number, y: number, out: Uint8ClampedArray) => {
      const i = (Math.floor(y) * 4 + Math.floor(x)) * 4;
      out.set(img.data.subarray(i, i + 4));
      return true;
    };
    const map = sourceMapping([1, 1], [11, 11], identityCloneTransform());
    const sampler = mappedSampler(bilinearSampler(img), nearest, map, true);
    const out = new Uint8ClampedArray(4);
    sampler(12, 13, out);
    expect(out[0]).toBe((3 * 4 + 2) * 10);
    const r = renderMapped(nearest, (x, y) => map(x, y), { x: 10, y: 10, width: 2, height: 2 });
    expect(r.data[0]).toBe(0);
    expect(r.data[(1 * 2 + 1) * 4]).toBe(50);
  });
});

describe('sampling Current & Below', () => {
  const named = (id: string, kind: Layer['kind'] = 'pixel', children: Layer[] = []) => ({ ...layer(kind, id, 10, 10), id, children });
  it('drops layers above the current one, including outside its group', () => {
    const doc = [named('a'), named('g', 'group', [named('b'), named('c'), named('d')]), named('e')];
    const below = layersBelow(doc, 'c')!;
    expect(below.map((l) => l.id)).toEqual(['a', 'g']);
    expect(below[1].children.map((l) => l.id)).toEqual(['b', 'c']);
    expect(layersBelow(doc, 'missing')).toBeUndefined();
  });
  it('can hide adjustment layers', () => {
    const doc = [named('a'), named('adj', 'adjustment'), named('b')];
    expect(layersBelow(doc, 'b', true)!.find((l) => l.id === 'adj')!.visible).toBe(false);
    expect(withoutAdjustments(doc)[0].visible).toBe(true);
  });
});
