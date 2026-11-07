import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { DocxPackage } from '../src/engine/docx.js';
import { drawingPaintColor, drawingColor } from '../src/engine/docx-drawing-style.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const color = xml => new DOMParser().parseFromString(`<a:root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${xml}</a:root>`, 'application/xml').documentElement.firstElementChild;
it('reads direct, scheme and inherited scRGB transparency without losing the layer alpha', async () => {
  const p = await DocxPackage.open(readFileSync('public/fixtures/shape-alpha.docx'));
  expect(Object.values(p.assets).map(a => a.scene.fill).filter((_, i) => i % 2)).toEqual([
    'rgba(204,51,102,0.4)', 'rgba(204,51,102,0)', '#CC3366', 'rgba(204,51,102,0.4)',
    'rgba(204,51,102,0.4)', '#BC7C59', 'rgba(0,255,188,0.4)', 'rgba(204,51,102,0.5)',
    'rgba(204,51,102,0.8)', 'rgba(34,102,170,0.4)', '#E1CBC4', 'rgba(188,124,89,0.4)',
  ]);
});
it.each([
 '<a:scrgbClr r="bad" g="0" b="0"/>', '<a:scrgbClr r="0" g="0"/>',
 '<a:scrgbClr r="0" g="0" b="0" unknown="1"/>',
 ...['-1', '100001', 'NaN'].map(v => `<a:srgbClr val="123456"><a:alpha val="${v}"/></a:srgbClr>`),
 '<a:srgbClr val="123456"><a:alphaMod val="-1"/></a:srgbClr>',
 '<a:srgbClr val="123456"><a:alphaOff val="100001"/></a:srgbClr>',
 '<a:srgbClr val="123456"><a:alpha val="50000" extra="1"/></a:srgbClr>',
])('rejects invalid color markup %s', xml => expect(() => drawingPaintColor(color(xml))).toThrow());
it('keeps fractional alpha in paint and rejects it in opaque-only consumers', () => {
 const n = color('<a:srgbClr val="123456"><a:alpha val="12.345%"/></a:srgbClr>');
 expect(drawingPaintColor(n)).toBe('rgba(18,52,86,0.12345)');
 expect(() => drawingColor(n)).toThrow(/opaque color/);
 expect(drawingPaintColor(color('<a:scrgbClr r="-10000" g="200000" b="50%"/>'))).toBe('#00FFBC');
});
