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
const references = JSON.parse(readFileSync('tests/fixtures/continuation-borders/native-small-exact.json', 'utf8'));
for (const [name, expected] of Object.entries(references)) it(`preserves the native reference border and padding floor: ${name}`, async () => {
  const pkg = await DocxPackage.open(readFileSync(`public/fixtures/continuation-exact/${name}.docx`));
  const original = JSON.stringify(pkg.tables);
  const result = layoutDocument(pkg.paragraphs, (text, style) => ({ width: [...text].length * style.fontSize * 2 / 3, ascent: style.fontSize * 1.25, descent: style.fontSize * 5 / 12 }), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables);
  const labels = new Map(pkg.paragraphs.map(p => [p.id, paragraphText(p)]));
  const actual = new Map(result.lines.map(line => [`${labels.get(line.paragraphId)}:${line.page}`, line]));
  expect(result.pageCount).toBe(expected.pages);
  expect(result.cells).toHaveLength(4);
  const pageCase = name.includes('-page-');
  for (const cell of result.cells) expect(cell.height).toBeGreaterThanOrEqual(0);
  // The tall leading paragraph is a page-positioning spacer. Compare body
  // baselines independently of its synthetic-font leading distribution.
  const first = pageCase ? expected.lines.find(line => line.text.startsWith('Inner')) : expected.lines[0];
  const shift = actual.get(`${first.text}:${first.page}`).baseline * .75 - first.baseline;
  // The native reference PDF may omit fully clipped text. The editable source must retain it.
  for (const line of expected.lines) {
    const match = actual.get(`${line.text}:${line.page}`);
    expect(match, line.text).toBeDefined();
    if (!pageCase || line.text !== 'Nested table probe') expect(Math.abs(match.baseline * .75 - line.baseline - shift), line.text).toBeLessThan(.15);
  }
  const fixedIds = new Set(pkg.tables[0].rows.filter(row => row.heightRule === 'exact').flatMap(row => row.cells.map(cell => cell.id)));
  for (const id of fixedIds) {
    const line = result.lines.find(line => line.cellId === id);
    expect(line, 'retained clipped source').toBeDefined();
    expect(line.cellClip.bottom).toBeGreaterThanOrEqual(line.cellClip.top);
  }
  if (name.endsWith('-oversized')) {
    const lastIds = pkg.tables[0].rows.at(-1).cells.map(cell => cell.id);
    for (const id of lastIds) {
      expect(result.cells.find(cell => cell.id === id).height).toBe(0);
      const line = result.lines.find(line => line.cellId === id);
      expect(line.cellClip.top).toBe(line.cellClip.bottom);
    }
  } else for (const cell of result.cells) expect(cell.height).toBeGreaterThan(0);
  expect(JSON.stringify(pkg.tables)).toBe(original);
});
