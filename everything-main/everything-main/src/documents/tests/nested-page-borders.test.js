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
const references = JSON.parse(readFileSync('tests/fixtures/nested-tables/nested-page-border-native-lines.json', 'utf8'));
const ink = JSON.parse(readFileSync('tests/fixtures/nested-tables/continuation-mixed-border-native-ink.json', 'utf8'));
for (const [name, expected] of Object.entries(references)) it(`matches the native reference continuation borders in ${name}`, async () => {
  const pkg = await DocxPackage.open(readFileSync(`tests/fixtures/nested-tables/${name}.docx`)), source = JSON.stringify(pkg.tables);
  const result = layoutDocument(pkg.paragraphs, (text, style) => ({ width: [...text].length * style.fontSize * 2 / 3, ascent: style.fontSize * 1.25, descent: style.fontSize * 5 / 12 }), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables);
  const labels = new Map(pkg.paragraphs.map(p => [p.id, paragraphText(p)]));
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
