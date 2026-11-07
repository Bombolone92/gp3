import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
let dom;
beforeAll(() => {
  dom = new JSDOM();
  for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name];
});
afterAll(() => {
  dom.window.close();
  for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name];
});
const source = name => readFileSync(`tests/fixtures/table-property-recovery/${name}.docx`);
const cases = ['table-bidi', 'row-revision', 'cell-fit', 'table-spacing', 'combined', 'style-cell-fit', 'conditional-cell-fit'];

it('loads the supported surrounding document as an editable table', async () => {
  const pkg = await DocxPackage.open(source('healthy'));
  expect(pkg.readOnly).not.toBe(true); expect(pkg.tables).toHaveLength(1);
  expect(Object.keys(pkg.assets)).toHaveLength(2);
});

it.each(cases)('retains source, surrounding images, and text: %s', async name => {
  const bytes = source(name), pkg = await DocxPackage.open(bytes, { bestEffort: true });
  expect(pkg.readOnly).toBe(true); expect(pkg.previewIssues.length).toBeGreaterThan(0);
  expect(pkg.parts).toEqual(unzipSync(bytes));
  expect(Object.keys(pkg.assets)).toHaveLength(2);
  expect(pkg.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n')).toContain('Retained table cell');
});

it.each(cases)('retains table structure around unsupported properties: %s', async name => {
  const pkg = await DocxPackage.open(source(name), { bestEffort: true });
  expect(pkg.tables).toHaveLength(1);
  expect(pkg.tables[0].grid).toEqual([5000]);
  expect(pkg.tables[0].rows[0].cells[0].width).toEqual({ type: 'dxa', value: 5000 });
  expect(() => pkg.export()).toThrow('read-only');
  await expect(DocxPackage.open(source(name))).rejects.toThrow();
});

it('reports every unsupported property without discarding known conditional formatting', async () => {
  const combined = await DocxPackage.open(source('combined'), { bestEffort: true });
  expect(combined.previewIssues).toEqual(expect.arrayContaining(['tables with bidiVisual', 'tables with ins', 'tables with tcFitText']));
  const styled = await DocxPackage.open(source('conditional-cell-fit'), { bestEffort: true });
  expect(styled.tables[0].rows[0].cells[0].fill).toBe('#CCEEFF');
});

it('does not resolve ambiguous duplicate supported properties by arbitrarily choosing one', async () => {
  const parts = unzipSync(source('cell-fit'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('<w:tcPr>', '<w:tcPr><w:tcW w:w="1000" w:type="dxa"/>'));
  const bytes = zipSync(parts), pkg = await DocxPackage.open(bytes, { bestEffort: true });
  expect(pkg.readOnly).toBe(true); expect(pkg.tables).toHaveLength(0);
  expect(pkg.previewIssues).toContain('tables with duplicate tcW properties');
  expect(pkg.parts).toEqual(parts);
});
