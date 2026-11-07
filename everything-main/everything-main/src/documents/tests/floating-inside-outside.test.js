import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const folder = 'tests/fixtures/aligned-multipage-floating/';
const measure = text => ({ width: text.length * 6, ascent: 12, descent: 4 });
const layout = (pkg, bestEffort = false) => layoutDocument(pkg.paragraphs, measure, pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories, { bestEffort });

it('imports all page-relative alignments without treating inside/outside as table justification', async () => {
  const bytes = readFileSync(folder + 'single-page.docx'), pkg = await DocxPackage.open(bytes);
  expect(pkg.readOnly).toBeFalsy();
  expect(pkg.tables).toHaveLength(5);
  expect(pkg.tables.map(t => t.floating.tblpXSpec)).toEqual(['left', 'center', 'right', 'inside', 'outside']);
  expect(pkg.tables.slice(3).map(t => t.alignment)).toEqual(['left', 'left']);
  const actual = layout(pkg);
  expect(actual.pageCount).toBe(5);
  expect(actual.floatingTables).toHaveLength(5);
  for (const [index, alignment] of ['left', 'center', 'right', 'inside', 'outside'].entries()) {
    const rows = actual.lines.filter(l => l.fragments.map(f => f.text || '').join('').startsWith(alignment + ' row'));
    expect(rows).toHaveLength(3);
    expect(rows.every(l => l.page === index)).toBe(true);
  }
  expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
});

it('supports every horizontal alignment during multi-page flow without changing the source', async () => {
  const bytes = readFileSync(folder + 'control.docx'), pkg = await DocxPackage.open(bytes);
  expect(pkg.tables).toHaveLength(5);
  const before = JSON.stringify({ paragraphs: pkg.paragraphs, tables: pkg.tables });
  const actual = layout(pkg);
  expect(actual.pageCount).toBe(10);
  expect(actual.floatingTableApproximations).toBeUndefined();
  expect(actual.floatingTables).toHaveLength(10);
  for (const alignment of ['left', 'center', 'right', 'inside', 'outside']) {
    expect(actual.lines.filter(l => l.fragments.map(f => f.text || '').join('').startsWith(alignment + ' row'))).toHaveLength(18);
  }
  expect(JSON.stringify({ paragraphs: pkg.paragraphs, tables: pkg.tables })).toBe(before);
  expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
});

it('positions odd/even-start multi-section holdouts without mutating the source', async () => {
  const root = 'tests/fixtures/aligned-floating-parity-holdout/';
  const bytes = readFileSync(root + 'control.docx'), pkg = await DocxPackage.open(bytes);
  const cases = JSON.parse(readFileSync(root + 'cases.json')).cases;
  expect(pkg.tables).toHaveLength(4);
  expect(pkg.tables.map(t => t.floating.tblpXSpec)).toEqual(cases.map(c => c.alignment));
  const before = JSON.stringify({ paragraphs: pkg.paragraphs, tables: pkg.tables });
  const actual = layout(pkg);
  expect(actual.pageCount).toBe(11);
  expect(actual.floatingTableApproximations).toBeUndefined();
  expect(actual.floatingTables).toHaveLength(8);
  for (const testCase of cases) {
    const rows = actual.lines.filter(l => l.fragments.map(f => f.text || '').join('').startsWith(testCase.label + ' row'));
    expect(rows).toHaveLength(18);
    expect(Math.min(...rows.map(l => l.page))).toBe(testCase.predictedFirstPage);
    expect(Math.max(...rows.map(l => l.page))).toBe(testCase.predictedLastPage);
  }
  expect(JSON.stringify({ paragraphs: pkg.paragraphs, tables: pkg.tables })).toBe(before);
  expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
});
