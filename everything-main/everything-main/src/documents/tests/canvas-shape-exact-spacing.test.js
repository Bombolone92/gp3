import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { DocxPackage } from '../src/engine/docx.js';
import { layoutShapeText } from '../src/engine/canvas-shapes.js';
import { layoutDocument } from '../src/engine/layout.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/shape-exact-spacing.docx');
const measure = text => ({ width: text.length * 12, ascent: 29, descent: 7 });

it('keeps exact text-box baseline placement independent of font metrics and group scaling', async () => {
  const pkg = await DocxPackage.open(source);
  const shapes = Object.values(pkg.assets).map(a => a.scene);
  expect(shapes).toHaveLength(8);
  for (const i of [0, 1, 2, 3, 6, 7]) {
    const shape = shapes[i], before = structuredClone(shape);
    const a = layoutShapeText(shape, measure), b = layoutShapeText(shape, measure, { x: 2, y: 1 });
    for (const result of [a, b]) {
      expect(result.layout.lines).toHaveLength(2);
      for (const line of result.layout.lines) {
        expect(line.baseline - line.y).toBeCloseTo(line.height * .8);
        expect(line.clip).toBe(false);
      }
    }
    expect(shape).toEqual(before);
    const body = layoutDocument(shape.text.paragraphs, measure, { width: 800, height: 1000, margin: 0 });
    expect(body.lines.every(line => line.clip)).toBe(true);
    expect(body.lines[0].baseline).toBeCloseTo(a.layout.lines[0].baseline);
  }
  const minimum = layoutShapeText(shapes[4], measure).layout;
  const automatic = layoutShapeText(shapes[5], measure).layout;
  expect(minimum.lines[0].baseline).toBe(29);
  expect(automatic.lines[0].baseline).toBe(29);
});

it('uses natural metrics for zero exact spacing in text boxes', async () => {
  const pkg = await DocxPackage.open(source), shape = Object.values(pkg.assets)[0].scene;
  shape.text.paragraphs[0].format.lineSpacing = 0;
  const { layout } = layoutShapeText(shape, measure);
  expect(layout.lines[0].height).toBe(36);
  expect(layout.lines[0].baseline).toBe(29);
  expect(layout.lines[0].clip).toBe(false);
});
