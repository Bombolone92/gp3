import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { DocxPackage } from '../src/engine/docx.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
const folder = 'tests/fixtures/section-floating-tables';
const native = JSON.parse(readFileSync('tests/fixtures/multipage-floating/reference.json')).lines['text-480-15-native'];
const nativePages = Math.max(...native.map(line => line.page)) + 1;
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const measure = text => ({ width: text.length * 6, ascent: 12, descent: 4 });
it('composes independent native numeric floating flows across next-page sections', async () => {
  const pkg = await DocxPackage.open(readFileSync(`${folder}/separate.docx`));
  const before = JSON.stringify(pkg.tables);
  const layout = layoutDocument(pkg.paragraphs, measure, pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables);
  expect(layout.pageCount).toBe(nativePages * 2);
  for (let section = 0; section < 2; section++) for (const line of native.filter(line => /^(Row|Before)\b/.test(line.text))) {
    const page = line.page + section * nativePages;
    expect(layout.lines.some(actual => actual.page === page && actual.fragments.map(f => f.text).join('').trim() === line.text), `${page}: ${line.text}`).toBe(true);
  }
  expect(JSON.stringify(pkg.tables)).toBe(before);
});
it.each(['continuous', 'same'])('composes native overlapping floats sharing %s section flow', async name => {
  const pkg = await DocxPackage.open(readFileSync(`${folder}/${name}.docx`));
  const reference = JSON.parse(readFileSync(`${folder}/${name}-reference.json`));
  const layout = layoutDocument(pkg.paragraphs, measure, pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables);
  expect(layout.pageCount).toBe(reference.pages);
  for (const line of reference.lines.filter(l => l.text.startsWith('Row'))) {
    expect(layout.lines.some(actual => actual.page === line.page && actual.fragments.map(f => f.text).join('').replace(/\s/g, '') === line.text)).toBe(true);
  }
});
it.each([0, 1])('retains the shared-flow collision guard when table %s prohibits overlap', async index => {
  const pkg = await DocxPackage.open(readFileSync(`${folder}/same.docx`));
  pkg.tables[index].overlap = 'never';
  expect(() => layoutDocument(pkg.paragraphs, measure, pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables)).toThrow(/prohibited table overlap/);
});
