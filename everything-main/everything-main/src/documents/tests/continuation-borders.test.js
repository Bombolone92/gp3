import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { DocxPackage } from '../src/engine/docx.js';
import { layoutDocument } from '../src/engine/layout.js';
import { paragraphText } from '../src/engine/model.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const references = JSON.parse(readFileSync('tests/fixtures/continuation-borders/native-lines.json', 'utf8'));
const ink = JSON.parse(readFileSync('tests/fixtures/continuation-borders/native-mixed-ink.json', 'utf8'));
const directInk = JSON.parse(readFileSync('tests/fixtures/continuation-borders/native-direct-ink.json', 'utf8'));
const verticalInk = JSON.parse(readFileSync('tests/fixtures/continuation-borders/native-vertical-ink.json', 'utf8'));
for (const [name, expected] of Object.entries(references)) it(`matches the native reference continuation borders in ${name}`, async () => {
  const pkg = await DocxPackage.open(readFileSync(`public/fixtures/continuation-borders/${name}.docx`)), source = JSON.stringify(pkg.tables);
  const result = layoutDocument(pkg.paragraphs, (text, style) => ({ width: [...text].length * style.fontSize * 2 / 3, ascent: style.fontSize * 1.25, descent: style.fontSize * 5 / 12 }), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables);
  const labels = new Map(pkg.paragraphs.map(p => [p.id, paragraphText(p)]));
  expect([...result.lines, ...result.repeatedLines].filter(line => labels.get(line.paragraphId) && !line.virtual).length).toBe(expected.lines.length);
  const actual = new Map([...result.lines, ...result.repeatedLines].map(l => [`${labels.get(l.paragraphId)}:${l.page}`, l]));
  expect(result.pageCount).toBe(expected.pages);
  const first = expected.lines[0], shift = actual.get(`${first.text}:${first.page}`).baseline * .75 - first.baseline;
  for (const line of expected.lines) {
    const match = actual.get(`${line.text}:${line.page}`);
    expect(match, `${line.text} on page ${line.page + 1}`).toBeDefined();
    expect(match.page, line.text).toBe(line.page);
    expect(Math.abs(match.baseline * .75 - line.baseline - shift), line.text).toBeLessThan(.15);
  }
  expect(JSON.stringify(pkg.tables)).toBe(source);
  if (name in directInk) {
    for (const [page, expectedEdges] of verticalInk[name].entries()) {
      const vertical = new Map();
      for (const stroke of result.tableBorders.filter(border => border.page === page && !border.horizontal && !border.guide)) {
        const key = stroke.x.toFixed(5), edge = vertical.get(key) || { x: stroke.x, width: stroke.width, top: Infinity, bottom: -Infinity };
        edge.top = Math.min(edge.top, stroke.y); edge.bottom = Math.max(edge.bottom, stroke.y + stroke.height);
        vertical.set(key, edge);
      }
      const actualVertical = [...vertical.values()].sort((a, b) => a.x - b.x);
      expect(actualVertical.length).toBe(expectedEdges.length);
      for (const [index, edge] of actualVertical.entries()) for (const coordinate of ['x', 'width', 'top', 'bottom']) {
        expect(Math.abs(edge[coordinate] * .75 - expectedEdges[index][coordinate]), `page ${page + 1} vertical ${index} ${coordinate}`).toBeLessThan(.15);
      }
    }
    const expectedRight = directInk[name][1].filter(border => border.x > 150).sort((a, b) => a.top - b.top);
    const actualRight = result.tableBorders.filter(border => border.page === 1 && border.horizontal && !border.guide && border.x * .75 > 150).sort((a, b) => a.y - b.y);
    expect(actualRight.length).toBe(expectedRight.length);
    for (const [index, stroke] of actualRight.entries()) {
      expect(Math.abs(stroke.y * .75 - expectedRight[index].top), `right edge ${index}`).toBeLessThan(.15);
      expect(Math.abs(stroke.height * .75 - expectedRight[index].height), `right edge ${index} ink`).toBeLessThan(.15);
    }
    const expectedTop = directInk[name][1].find(border => border.x < 100 && border.top < 73);
    const strokes = result.tableBorders.filter(border => border.page === 1 && border.horizontal && !border.guide && border.x * .75 < 100 && border.y * .75 < 73);
    if (!expectedTop) expect(strokes).toHaveLength(0);
    else {
      expect(strokes.length).toBeGreaterThan(0);
      for (const stroke of strokes) {
        expect(Math.abs(stroke.y * .75 - expectedTop.top)).toBeLessThan(.1);
        expect(Math.abs(stroke.height * .75 - expectedTop.height)).toBeLessThan(.1);
      }
    }
  }
  if (name in ink) {
    const strokes = result.tableBorders.filter(border => border.page === 1 && border.horizontal && !border.guide && Math.abs(border.y * .75 - 72) < .1);
    if (!ink[name]) expect(strokes).toHaveLength(0);
    else {
      expect(strokes.length).toBeGreaterThan(0);
      for (const stroke of strokes) {
        expect(Math.abs(stroke.y * .75 - ink[name].top)).toBeLessThan(.1);
        expect(Math.abs(stroke.height * .75 - ink[name].height)).toBeLessThan(.1);
      }
    }
  }
});
