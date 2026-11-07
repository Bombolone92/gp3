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
const root = 'tests/fixtures/aligned-floating-anchor-matrix/';
for (const name of ['short-12', 'center-short-12', 'asymmetric-short-12']) it(`${name}: aligns legacy writing width without changing the table grid or package`, async () => {
  const bytes = readFileSync(root + name + '/control.docx');
  const native = JSON.parse(readFileSync(root + name + '/reference.json'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(native.sourceSha256);
  const pkg = await DocxPackage.open(bytes);
  const before = JSON.stringify({ paragraphs: pkg.paragraphs, tables: pkg.tables });
  const result = layoutDocument(pkg.paragraphs, text => ({ width: text.length * 6, ascent: 12, descent: 4 }), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables);
  expect(result.pageCount).toBe(native.pages);
  expect(result.floatingTables).toHaveLength(4);
  const rows = native.lines.filter(l => /row\d+$/.test(l.text));
  expect(rows).toHaveLength(12);
  for (const row of rows) {
    const actual = result.lines.filter(l => l.fragments.map(f => f.text || '').join('').replace(/\s/g, '') === row.text);
    expect(actual).toHaveLength(1);
    expect(actual[0].page).toBe(row.page);
    expect(Math.abs(actual[0].fragments[0].x * .75 - row.x)).toBeLessThan(.15);
  }
  for (const frame of result.floatingTables) expect((frame.right - frame.left) * .75).toBeCloseTo(216, 5);
  expect(JSON.stringify({ paragraphs: pkg.paragraphs, tables: pkg.tables })).toBe(before);
  expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
});
