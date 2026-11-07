import { describe, expect, it } from 'vitest';
import { CATEGORIES, defaultSpec, documentBytes, fromPixels, PRESETS, presetPpi, specFromPreset, specPixels, toPixels, validSpec } from '../src/model/document-presets';
import { documentPaths, pathsSvg } from '../src/features/files/paths-export';
import { packageReport } from '../src/features/files/package';
import { newDocument } from '../src/model/document';

const prefs = { printPpi: 300, screenDocPpi: 72 };
const cols = { columnWidth: 180, columnGutter: 12, columnUnit: 'pt' };

describe('new document presets', () => {
  it('belong to listed categories, have unique IDs and fit the size limits', () => {
    const cats = new Set(CATEGORIES.map(([c]) => c));
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(cats.has(p.category)).toBe(true);
      const size = specPixels(specFromPreset(p, prefs, defaultSpec()));
      expect(size.error, p.id).toBeUndefined();
    }
    for (const c of ['photo', 'print', 'art', 'web', 'mobile', 'film']) expect(PRESETS.some((p) => p.category === c)).toBe(true);
  });
  it('use the preference resolutions for print and screen presets', () => {
    const a4 = PRESETS.find((p) => p.id === 'print-a4')!;
    expect(presetPpi(a4, prefs)).toBe(300);
    const spec = specFromPreset(a4, prefs, defaultSpec());
    expect(specPixels(spec)).toMatchObject({ width: 2480, height: 3508 });
    expect(specPixels(specFromPreset(a4, { printPpi: 150, screenDocPpi: 72 }, defaultSpec()))).toMatchObject({ width: 1240, height: 1754 });
    const ntsc = specFromPreset(PRESETS.find((p) => p.id === 'film-ntsc')!, prefs, defaultSpec());
    expect(ntsc.pixelAspect).toBeCloseTo(10 / 11);
  });
});

describe('new document units', () => {
  it('converts lengths to pixels and back', () => {
    expect(toPixels(8.5, 'in', 300)).toBe(2550);
    expect(toPixels(210, 'mm', 300)).toBe(2480);
    expect(toPixels(72, 'pt', 144)).toBe(144);
    expect(toPixels(1, 'pica', 72)).toBe(12);
    expect(fromPixels(2550, 'in', 300)).toBe(8.5);
    expect(toPixels(fromPixels(2480, 'mm', 300), 'mm', 300)).toBe(2480);
  });
  it('measures columns with gutters between them', () => {
    // Two 180 pt columns and one 12 pt gutter at 72 ppi.
    expect(toPixels(2, 'col', 72, cols)).toBe(372);
    expect(toPixels(0.5, 'col', 72, cols)).toBe(90);
    expect(fromPixels(372, 'col', 72, cols)).toBe(2);
    expect(fromPixels(90, 'col', 72, cols)).toBe(0.5);
    expect(toPixels(fromPixels(2480, 'col', 300, cols), 'col', 300, cols)).toBe(2480);
  });
  it('reports sizes beyond the limits', () => {
    expect(specPixels({ ...defaultSpec(), width: 9000, height: 10 }).error).toMatch(/8192/);
    expect(specPixels({ ...defaultSpec(), width: 6000, height: 4001 }).error).toMatch(/24 megapixels/);
    expect(specPixels({ ...defaultSpec(), width: 0, height: 10 }).error).toMatch(/greater than zero/);
    expect(specPixels({ ...defaultSpec(), width: 1, height: 1, unit: 'in', ppi: 0.5 }).error).toMatch(/resolution/);
    expect(specPixels({ ...defaultSpec(), width: 10, height: 10, unit: 'cm', ppi: 100, ppiUnit: 'ppcm' })).toMatchObject({ width: 1000, height: 1000 });
  });
  it('estimates memory by mode', () => {
    expect(documentBytes(10, 10, 'rgb')).toBe(300);
    expect(documentBytes(10, 10, 'grayscale')).toBe(100);
  });
  it('validates stored specs', () => {
    expect(validSpec({ width: 'x', height: 3 })).toBeUndefined();
    const s = validSpec({ width: 100, height: 50, unit: 'furlong', mode: 'hsv', background: 'custom', color: 'red', pixelAspect: 99 })!;
    expect(s).toMatchObject({ width: 100, height: 50, unit: 'px', mode: 'rgb', background: 'custom', color: '#ffffff', pixelAspect: 1 });
  });
});

describe('paths to vector file', () => {
  const knot = (x: number, y: number) => ({ points: [x, y, x, y, x, y], linked: false });
  it('lists saved paths and the work path, and writes an SVG at document size', () => {
    const doc = newDocument(200, 100);
    doc.paths = [{ id: 'p1', name: 'Outline <1>', mask: { paths: [{ open: false, knots: [knot(10, 10), knot(50, 10), knot(50, 40)] }] } as never }];
    doc.workPath = { paths: [{ open: true, knots: [knot(0, 0), knot(20, 20)] }] } as never;
    const paths = documentPaths(doc);
    expect(paths.map((p) => p.name)).toEqual(['Outline <1>', 'Work Path']);
    expect(paths[0].d).toBe("M10 10L50 10L50 40L10 10Z");
    const svg = pathsSvg(200, 100, paths, true);
    expect(svg).toContain('viewBox="0 0 200 100"');
    expect(svg).toContain('<title>Outline &lt;1&gt;</title>');
    expect(svg).toContain('id="document-bounds"');
    expect(pathsSvg(200, 100, paths.slice(1), false)).not.toContain('document-bounds');
  });
});

describe('package report', () => {
  it('lists the project and linked files with their origin', () => {
    const text = packageReport('Poster', [
      { name: 'Logo', file: 'logo.svg', from: 'source' },
      { name: 'Photo', file: 'photo.jpg', from: 'copy' },
    ], new Date(0));
    expect(text).toContain('Poster.photo');
    expect(text).toContain('  logo.svg\n');
    expect(text).toMatch(/photo\.jpg — copy kept in the project/);
    expect(packageReport('Empty', [])).toContain('no linked files');
  });
});
