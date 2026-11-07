import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraphText } from '../src/engine/model.js';
import { documentBlocks } from '../src/engine/tables.js';
let dom;
beforeAll(() => {
  dom = new JSDOM();
  for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name];
});
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = name => readFileSync(`tests/fixtures/cell-block-recovery/${name}.docx`);
it.each(['', 'nested-'])('retains table ownership and surrounding content after a cell paragraph fails: %s', async prefix => {
  const bytes = source(prefix + 'unsupported');
  await expect(DocxPackage.open(bytes)).rejects.toThrow('paragraph page breaks inside table cells');
  const pkg = await DocxPackage.open(bytes, { bestEffort: true });
  expect(pkg.readOnly).toBe(true);
  expect(pkg.tables).toHaveLength(prefix ? 2 : 1);
  expect(pkg.parts).toEqual(unzipSync(bytes));
  expect(pkg.previewIssues).toContain('Table cell in word/document.xml: paragraph page break is ignored in this read-only preview; its text, formatting and pictures are retained.');
  expect(Object.keys(pkg.assets)).toHaveLength(2);
  const recovered = pkg.paragraphs.find(p => paragraphText(p) === 'Recovered paragraph');
  expect(recovered.cellId).toBeTruthy();
  expect(pkg.tables.some(t => t.rows.some(r => r.cells.some(c => c.id === recovered.cellId)))).toBe(true);
  expect(pkg.paragraphs.find(p => paragraphText(p) === 'Before failed block').runs[0].bold).toBe(true);
  expect(pkg.paragraphs.some(p => paragraphText(p) === 'After failed block')).toBe(true);
  expect(() => documentBlocks(pkg.paragraphs, pkg.tables)).not.toThrow();
  expect(() => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets, { displayOnly: true })).not.toThrow();
  expect(() => pkg.export()).toThrow('read-only');
});
it.each(['healthy', 'nested-healthy'])('keeps supported cells editable and source-preserving: %s', async name => {
  const bytes = source(name), pkg = await DocxPackage.open(bytes);
  expect(pkg.readOnly).not.toBe(true);
  expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
});

it('contains an invalid nested table at the inner block without losing its parent', async () => {
  const parts = unzipSync(source('nested-healthy'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>', '<w:tblGrid/>'));
  const bytes = zipSync(parts);
  await expect(DocxPackage.open(bytes)).rejects.toThrow('missing, zero or excessive grid columns');
  const pkg = await DocxPackage.open(bytes, { bestEffort: true });
  expect(pkg.readOnly).toBe(true); expect(pkg.tables).toHaveLength(1);
  const owner = pkg.tables[0].rows[0].cells[0].id;
  for (const text of ['Before failed block', 'Recovered paragraph', 'After failed block', 'Outer cell tail']) {
    expect(pkg.paragraphs.find(p => paragraphText(p) === text).cellId).toBe(owner);
  }
  expect(pkg.parts).toEqual(parts);
  expect(() => documentBlocks(pkg.paragraphs, pkg.tables)).not.toThrow();
});
