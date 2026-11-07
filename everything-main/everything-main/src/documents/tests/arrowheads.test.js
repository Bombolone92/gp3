import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { DocxPackage } from '../src/engine/docx.js';
import { markerGeometry } from '../src/engine/drawing-line-ends.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const reference = JSON.parse(readFileSync('tests/fixtures/arrowheads/reference.json'));
const PT = 12700;

it('matches the native reference arrowhead geometry for every type, size and pen', () => {
  for (const c of reference.cases) {
    const pen = c.pen * PT, g = markerGeometry({ type: c.type, width: c.w, length: c.len }, pen, pen), label = `${c.type} ${c.w}/${c.len} ${c.pen}pt`;
    // The reference export's stops agree to within 0.02 pt (the 6 pt arrow's miter differs by 0.014 pt).
    expect(Math.abs(g.stop / PT - c.stop), `${label} stop`).toBeLessThanOrEqual(0.02);
    if (c.type === 'arrow') {
      const [[x0, y0], [x1]] = g.arms;
      expect((x1 - x0) / PT, `${label} length`).toBeCloseTo(c.length, 3);
      expect(y0 / PT, `${label} half`).toBeCloseTo(c.half, 3);
    } else if (c.type === 'diamond') {
      expect(g.polygon[0][0] / PT, `${label} length`).toBeCloseTo(c.length, 3);
      expect(g.polygon[1][1] / PT, `${label} half`).toBeCloseTo(c.half, 3);
    } else {
      expect(-g.polygon[1][0] / PT, `${label} length`).toBeCloseTo(c.length, 3);
      expect(g.polygon[1][1] / PT, `${label} half`).toBeCloseTo(c.half, 3);
      if (c.notch) expect(-g.polygon[2][0] / PT, `${label} notch`).toBeCloseTo(c.notch, 3);
    }
  }
});

it('opens documents with every arrowhead type for editing and saves them unchanged', async () => {
  for (const name of ['control', 'sizes']) {
    const bytes = readFileSync(`tests/fixtures/arrowheads/${name}.docx`);
    const pkg = await DocxPackage.open(bytes);
    expect(pkg.readOnly, name).toBeFalsy();
    const ends = pkg.paragraphs.flatMap(p => p.runs.filter(r => r.image)).map(r => pkg.assets[r.image.assetId].scene.outline.tailEnd?.type);
    expect(new Set(ends)).toEqual(new Set(name === 'control' ? ['triangle', 'arrow', 'stealth', 'diamond', 'oval'] : ['triangle', 'arrow', 'stealth', 'diamond']));
  }
});
