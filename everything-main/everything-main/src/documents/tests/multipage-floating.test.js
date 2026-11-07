import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { DocxPackage } from '../src/engine/docx.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom;
beforeAll(() => {
  dom = new JSDOM();
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer;
});
it.each(['vertical alignment', 'booklet'])('retains the layout guard for unverified multi-page %s', async kind => {
  const p = await DocxPackage.open(readFileSync(`${folder}/text-480-15.docx`));
  if (kind === 'vertical alignment') p.tables[0].floating.tblpYSpec = 'top';
  else Object.assign(p.pageSettings, { bookFoldPrinting: true, orientation: 'landscape', width: 15840, height: 12240 });
  expect(() => layoutDocument(p.paragraphs, text => ({ width: text.length * 6, ascent: 12, descent: 4 }), pageGeometry(p.pageSettings), p.numbering, p.tables)).toThrow(/Multi-page floating tables with aligned positions/);
});
afterAll(() => dom.window.close());
const folder = 'tests/fixtures/multipage-floating';
const references = ['reference.json', 'flow-reference.json', 'start-reference.json', 'border-reference.json', 'rows-reference.json'].flatMap(name =>
  Object.entries(JSON.parse(readFileSync(`${folder}/${name}`, 'utf8')).lines));
it.each(references)('retains the native reference row/page allocation: %s', async (key, native) => {
  const p = await DocxPackage.open(readFileSync(`${folder}/${key.replace(/-native$/, '')}.docx`));
  const layout = layoutDocument(p.paragraphs, text => ({ width: text.length * 6, ascent: 12, descent: 4 }), pageGeometry(p.pageSettings), p.numbering, p.tables);
  expect(layout.pageCount).toBe(Math.max(...native.map(line => line.page)) + 1);
  for (const line of native.filter(line => /^(Row|Before|Body|Long|Fill)\b/.test(line.text))) {
    const actual = [...layout.lines, ...layout.repeatedLines].find(actual => actual.page === line.page && actual.fragments.map(f => f.text).join('').trim() === line.text);
    expect(actual, line.text).toBeTruthy();
    expect(actual.page, line.text).toBe(line.page);
  }
  const anchor = p.paragraphs.find(paragraph => paragraph.runs.map(run => run.text).join('').startsWith('Anchor after table'));
  expect(layout.lines.find(line => line.paragraphId === anchor.id).page).toBe(native.find(line => line.text.startsWith('Anchor after')).page);
});
