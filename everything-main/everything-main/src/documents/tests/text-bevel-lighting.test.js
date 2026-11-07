import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { bevelLightingNormals } from '../src/engine/text-bevel-lighting.js';
import { create3dShader } from '../src/engine/drawing-3d-lighting.js';
import { bevelScanlineCrossings } from '../src/engine/text-bevel-geometry.js';

const root = 'tests/fixtures/text-3d/';
const reference = JSON.parse(readFileSync(root + 'bevel-smoothing-reference.json'));
const sampleGradient = ({ first, delta }, t) => first.map((v, i) => Math.min(255, Math.max(0, Math.round(v + delta[i] * t))));
describe('native text bevel smoothing', () => {
  it('retains half-open coverage for ordinary, concave and crossing bevel faces', () => {
    const points = coordinates => coordinates.map(([x, y]) => ({ x, y }));
    const rectangle = points([[0, 0], [10, 0], [10, 8], [0, 8]]);
    expect(bevelScanlineCrossings(rectangle, 0)).toEqual([0, 10]);
    expect(bevelScanlineCrossings(rectangle, 8)).toEqual([]);
    expect(bevelScanlineCrossings(points([[0, 0], [10, 0], [7, 8], [3, 8]]), 4)).toEqual([1.5, 8.5]);
    const concave = bevelScanlineCrossings(points([[0, 0], [10, 0], [4, 4], [0, 10]]), 5);
    expect(concave[0]).toBe(0); expect(concave[1]).toBeCloseTo(10 / 3, 12);
    const crossing = points([[0, 0], [10, 10], [0, 10], [10, 0]]);
    expect(bevelScanlineCrossings(crossing, 2)).toEqual([2, 8]);
    expect(bevelScanlineCrossings(crossing, 5)).toEqual([5, 5]);
    expect(bevelScanlineCrossings(points([[0, 0], [2, 4], [4, 0], [6, 4]]), 2)).toEqual([1, 3, 3, 5]);
  });
  it('matches independently drawn reference controls across the angle boundary and edge lengths', () => {
    for (const [file, hash] of [['bevel-smoothing.docx', reference.sourceSha256], ['bevel-smoothing-native.pdf', reference.pdfSha256]])
      expect(createHash('sha256').update(readFileSync(root + file)).digest('hex')).toBe(hash);
    const shader = create3dShader({ material: 'matte' });
    expect(reference.records).toHaveLength(10);
    for (const record of reference.records) {
      const edge = record.contour.findIndex((p, i) => p.x === 400 && record.contour[(i + 1) % record.contour.length].x === 400);
      expect(edge).toBeGreaterThanOrEqual(0);
      const [start, end] = bevelLightingNormals(record.contour, .2)[edge];
      const gradient = shader.gradient([208, 32, 48], start, end, [0, 0, 1]);
      for (const sample of record.samples)
        expect(Math.max(...sampleGradient(gradient, sample.t).map((v, channel) => Math.abs(v - sample.rgb[channel]))), record.name).toBeLessThanOrEqual(1);
    }
  });
  it('keeps sharp corners separate and preserves normals under translation and scale', () => {
    const contour = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const normals = bevelLightingNormals(contour, .2);
    for (const [start, end] of normals) expect(start).toEqual(end);
    expect(normals[0][0]).toEqual([0, -.2, 1]);
    const original = reference.records[0].contour;
    const changed = original.map(p => ({ x: p.x * 3 + 51, y: p.y * 3 - 83 }));
    const actual = bevelLightingNormals(changed, .2).flat(2), expected = bevelLightingNormals(original, .2).flat(2);
    actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 12));
  });
  it('interpolates illumination before clipping for matte and specular materials', () => {
    for (const material of ['matte', 'warmMatte']) {
      const shader = create3dShader({ material });
      const a = [0, -.8, 1], b = [.8, 0, 1], view = [0, 0, 1], color = [239, 171, 185];
      const gradient = shader.gradient(color, a, b, view);
      for (const t of [0, .1, .25, .5, .75, .9, 1]) {
        expect(sampleGradient(gradient, t)).toEqual(shader.interpolate(color, [{ normal: a, view, weight: 1 - t }, { normal: b, view, weight: t }]));
      }
    }
  });
});
