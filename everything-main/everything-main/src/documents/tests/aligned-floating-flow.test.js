import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const controls = [
  'aligned-multipage-floating', 'aligned-floating-parity-holdout',
  ...['page-15','text-15','margin-12','page-12','text-12','asymmetric-12','reverse-12','center-12'].map(name => 'aligned-floating-anchor-matrix/' + name),
  ...['restart-0','restart-1','restart-2','leading-first','initial-1-restart-2','initial-2-restart-1'].map(name => 'aligned-floating-flow-edge/' + name),
];
for (const name of controls) it(`${name}: matches every native row identity, page and horizontal origin`, async () => {
  const root = 'tests/fixtures/' + name + '/', bytes = readFileSync(root + 'control.docx');
  const native = JSON.parse(readFileSync(root + 'reference.json'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(native.sourceSha256);
  const pkg = await DocxPackage.open(bytes);
  const before = JSON.stringify({ paragraphs: pkg.paragraphs, tables: pkg.tables });
  const result = layoutDocument(pkg.paragraphs, text => ({ width: text.length * 6, ascent: 12, descent: 4 }), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories);
  expect(result.pageCount).toBe(native.pages);
  expect(result.floatingTableApproximations).toBeUndefined();
  const rows = native.lines.filter(l => /row\d+$/.test(l.text));
  expect(rows.length).toBe(pkg.tables.length * 18);
  for (const row of rows) {
    const actual = result.lines.filter(l => l.fragments.map(f => f.text || '').join('').replace(/\s/g, '') === row.text);
    expect(actual, row.text).toHaveLength(1);
    expect(actual[0].page, row.text).toBe(row.page);
    expect(Math.abs(actual[0].fragments[0].x * .75 - row.x), row.text).toBeLessThan(.35);
  }
  expect(JSON.stringify({ paragraphs: pkg.paragraphs, tables: pkg.tables })).toBe(before);
  expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
});
