import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { shade3d, create3dShader } from '../src/engine/drawing-3d-lighting.js';
import { projection3d, intersectExtrusion } from '../src/engine/drawing-3d-geometry.js';

const reference = JSON.parse(readFileSync('tests/fixtures/picture-3d/reference.json', 'utf8'));
it('uses colors from the exact independently captured reference fixture', () => {
  expect(createHash('sha256').update(readFileSync('public/fixtures/picture-3d.docx')).digest('hex')).toBe(reference.sourceSha256);
});
for (const c of reference.cases) {
  it(`matches the native reference ${c.name} lighting on the photograph and exposed sides`, () => {
    const camera = projection3d({ turn: c.camera === 'perspectiveRight' ? 20 : c.camera === 'perspectiveLeft' ? -20 : 0, perspective: c.camera !== 'orthographicFront' });
    for (const [surface, samples] of [['front', c.samples], ['side', c.sideSamples]]) for (const sample of samples) {
      const ray = camera.ray(sample.x - 100 - c.widthPt / 2, sample.y - 140 - c.heightPt / 2);
      const hit = intersectExtrusion(ray, { width: c.widthPt, height: c.heightPt, depth: c.extrusionPt, geometry: c.geometry });
      expect(hit?.surface).toBe(surface);
      // The independent source PNG has four constant-color quadrants. On a
      // wall, default extrusion color follows the adjoining front-face color.
      const [x, y] = hit.point;
      const color = y < 0 ? (x < 0 ? [240, 40, 30] : [30, 80, 210]) : (x < 0 ? [40, 170, 70] : [240, 180, 20]);
      const actual = shade3d(color, hit.normal, ray.direction.map(value => -value));
      // The reference PDF embeds rasterized, quantized 3D images. This is a measured
      // per-channel tolerance, not a claim of identical rendering.
      actual.forEach((value, i) => expect(Math.abs(value - sample.rgb[i]), `${surface} (${sample.x},${sample.y}) channel ${i}`).toBeLessThanOrEqual(3));
    }
  });
}
it('normalizes normals and view directions without changing illumination', () => {
  expect(shade3d([120, 60, 30], [0, 0, 1e-8], [0, 0, 1e8])).toEqual(shade3d([120, 60, 30], [0, 0, 1], [0, 0, 1]));
});
it('matches native text front and horizontal bevel surfaces for matte and warmMatte', () => {
  const refs = JSON.parse(readFileSync('tests/fixtures/text-3d/reference.json', 'utf8'));
  const grid = JSON.parse(readFileSync('tests/fixtures/text-3d/native-surface-grid.json', 'utf8'));
  expect(createHash('sha256').update(readFileSync('tests/fixtures/text-3d/control.docx')).digest('hex')).toBe(refs.sourceSha256);
  expect(createHash('sha256').update(readFileSync('tests/fixtures/text-3d/native.pdf')).digest('hex')).toBe(refs.pdfSha256);
  for (const [material, name] of [['matte', 'bevel-extrusion-matte'], ['warmMatte', 'bevel-extrusion-default']]) {
    const record = grid.find(r => r.name === name);
    // These points lie on the flat face and the straight top bevel of A.
    // The independently authored effect specifies a 5pt width and 1pt height.
    for (const [x, y, normal] of [[118, 137, [0, 0, 1]], [118, 131, [0, -.2, 1]]]) {
      const sample = record.samples.find(s => s[0] === x && s[1] === y);
      expect(sample).toBeTruthy();
      const actual = shade3d([208, 32, 48], normal, [0, 0, 1], { material });
      actual.forEach((c, i) => expect(Math.abs(c - sample[i+2]), `${material} (${x},${y}) channel ${i}`).toBeLessThanOrEqual(3));
    }
  }
});
it('matte has no view-dependent specular highlight, including interpolated surfaces', () => {
  const shader = create3dShader({ material: 'matte' });
  const normal = [0, -.2, 1];
  expect(shader([0, 0, 0], normal, [0, 0, 1])).toEqual([0, 0, 0]);
  expect(shader([208, 32, 48], normal, [0, 0, 1])).toEqual(shader([208, 32, 48], normal, [1, 1, 1]));
  expect(shader.interpolate([208, 32, 48], [
    { normal, view: [0, 0, 1], weight: .5 },
    { normal, view: [-1, -1, 1], weight: .5 },
  ])).toEqual(shader([208, 32, 48], normal, [0, 0, 1]));
});
it('retains the native material distinction in both supported explicit text lighting rigs', () => {
  const ref = JSON.parse(readFileSync('tests/fixtures/text-3d/scene-reference.json', 'utf8'));
  expect(createHash('sha256').update(readFileSync('tests/fixtures/text-3d/scene-control.docx')).digest('hex')).toBe(ref.sourceSha256);
  expect(createHash('sha256').update(readFileSync('tests/fixtures/text-3d/scene-native.pdf')).digest('hex')).toBe(ref.pdfSha256);
  const normals = [[0, 0, 1], [0, -.2, 1]];
  for (const record of ref.records.filter(r => r.rig === 'threePt' || r.rig === 'twoPt')) {
    record.planeSamples.forEach((sample, i) => {
      const rgb = shade3d([208, 32, 48], normals[i], [0, 0, 1], { rig: record.rig, material: record.material });
      rgb.forEach((c, channel) => expect(Math.abs(c - sample.rgb[channel]), `${record.name} channel ${channel}`).toBeLessThanOrEqual(3));
    });
  }
});
it('records contours as the unlit contour color independently of the face lighting', () => {
  const contours = reference.cases.flatMap(c => c.contourSamples);
  expect(contours).toHaveLength(20);
  for (const sample of contours) expect(sample.rgb).toEqual([32, 32, 96]);
  expect(shade3d([32, 32, 96], [0, 0, 1], [0, 0, 1])).not.toEqual([32, 32, 96]);
});
it('rejects invalid vectors, colors and unsupported material/rig/direction', () => {
  for (const vector of [[0, 0, 0], [0, NaN, 1], [0, 1]]) {
    expect(() => shade3d([0, 0, 0], vector, [0, 0, 1])).toThrow();
    expect(() => shade3d([0, 0, 0], [0, 0, 1], vector)).toThrow();
  }
  for (const color of [[-1, 0, 0], [256, 0, 0], [0, Infinity, 0], [0, 0]]) expect(() => shade3d(color, [0, 0, 1], [0, 0, 1])).toThrow();
  for (const preset of [{ rig: 'balanced' }, { material: 'metal' }, { direction: 'b' }]) expect(() => shade3d([0, 0, 0], [0, 0, 1], [0, 0, 1], preset)).toThrow(/Unsupported/);
});
