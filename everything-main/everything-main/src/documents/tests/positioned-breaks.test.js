import { beforeAll, afterAll, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const measure = (text, style) => ({ width: text.length * style.fontSize * .6, ascent: style.fontSize, descent: style.fontSize * .2 });
for (const kind of ['page', 'column']) for (const base of ['paragraph', 'line']) it(`keeps ${kind}/${base} drawings in their hard-break segments and preserves source`, async () => {
  const bytes = readFileSync(`tests/fixtures/positioned-breaks/${kind}-${base}.docx`);
  const pkg = await DocxPackage.open(bytes);
  expect(pkg.readOnly).not.toBe(true);
  expect(pkg.paragraphs.flatMap(p => p.runs).filter(r => r.image)).toHaveLength(2);
  const before = JSON.stringify(pkg.paragraphs);
  const place = bestEffort => layoutDocument(pkg.paragraphs, measure, pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories, { bestEffort });
  for (const bestEffort of [false, true]) {
    const layout = place(bestEffort);
    expect(layout.pages).toHaveLength(kind === 'page' ? 2 : 1);
    expect(layout.floatingObjects).toHaveLength(2);
    const [before, after] = layout.floatingObjects;
    expect(before.page).toBe(0);
    expect(after.page).toBe(kind === 'page' ? 1 : 0);
    expect(after.y).toBeCloseTo(136, 6);
    expect(after.x).toBeCloseTo(kind === 'page' ? 256 : 592, 6);
  }
  expect(JSON.stringify(pkg.paragraphs)).toBe(before);
  expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
});

it('retains the guard for wrapping across a hard break', async () => {
  const parts = unzipSync(readFileSync('tests/fixtures/positioned-breaks/page-paragraph.docx'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replaceAll('<wp:wrapNone/>', '<wp:wrapTopAndBottom/>'));
  const pkg = await DocxPackage.open(zipSync(parts));
  const before = JSON.stringify(pkg.paragraphs);
  expect(() => layoutDocument(pkg.paragraphs, measure, pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories)).toThrow(/Wrapped positioned drawings with page\/column breaks/);
  expect(JSON.stringify(pkg.paragraphs)).toBe(before);
});
