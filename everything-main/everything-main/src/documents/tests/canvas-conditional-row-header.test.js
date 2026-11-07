import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { headerRowCount } from '../src/engine/tables.js';
import { tableStyleHeaderCount } from '../src/engine/table-style-regions.js';
import { refreshConditionalTable } from '../src/engine/conditional-table-formatting.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/conditional-row-header.docx');
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables).arrayBuffer());

it('separates first-row formatting from contiguous page-repetition headers', async () => {
  const p = await DocxPackage.open(source);
  expect(p.tables.map(headerRowCount)).toEqual([1, 4, 0, 0, 1, 1, 0, 0, 0, 0]);
  expect(p.tables.map(tableStyleHeaderCount)).toEqual([1, 4, 2, 1, 1, 1, 1, 1, 2, 2]);
  const t = p.tables[2], before = structuredClone(t);
  expect(t.rows.map(r => r.header)).toEqual([false, true, false, true]);
  for (let i = 0; i < 3; i++) refreshConditionalTable(t);
  expect(t).toEqual(before);
});
it('explicitly disables inherited header repetition and retains the override through reopen/undo', async () => {
  const p = await DocxPackage.open(source), d = model(p);
  d.selectCell(d.tables[4].rows[0].cells[0].id); d.setTableHeaderRows(0);
  expect(headerRowCount(d.tables[4])).toBe(0);
  const bytes = await save(p, d), reopened = await DocxPackage.open(bytes);
  expect(headerRowCount(reopened.tables[4])).toBe(0);
  expect(reopened.tables[4].rows[0].headerExplicit).toBe(true);
  for (const [name, part] of Object.entries(unzipSync(bytes))) if (name !== 'word/document.xml') expect(part).toEqual(p.parts[name]);
  d.undo(); expect(unzipSync(await save(p, d))).toEqual(p.parts);
});
it('keeps inserted body rows outside an inherited repeating header across export and undo', async () => {
  const p = await DocxPackage.open(source), d = model(p);
  d.selectCell(d.tables[4].rows[0].cells[0].id); d.insertTableRow(); d.replace('Inserted');
  expect(headerRowCount(d.tables[4])).toBe(1);
  const reopened = await DocxPackage.open(await save(p, d));
  expect(reopened.tables[4].rows).toHaveLength(9);
  expect(headerRowCount(reopened.tables[4])).toBe(1);
  expect(reopened.tables[4].rows[1].header).toBe(false);
  while (d.history.length) d.undo(); expect(unzipSync(await save(p, d))).toEqual(p.parts);
});
it.each(['value', 'attribute', 'child', 'duplicate', 'unsupported'])('rejects malformed or unsupported conditional row %s', async kind => {
  const parts = unzipSync(source), doc = new DOMParser().parseFromString(strFromU8(parts['word/styles.xml']), 'application/xml');
  const n = doc.getElementsByTagNameNS(W, 'tblHeader')[0];
  if (kind === 'value') n.setAttributeNS(W, 'w:val', 'maybe');
  if (kind === 'attribute') n.setAttribute('unknown', '1');
  if (kind === 'child') n.appendChild(doc.createElementNS(W, 'w:foo'));
  if (kind === 'duplicate') n.parentNode.appendChild(n.cloneNode(true));
  if (kind === 'unsupported') n.parentNode.appendChild(doc.createElementNS(W, 'w:cantSplit'));
  parts['word/styles.xml'] = strToU8(new XMLSerializer().serializeToString(doc));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({ name: 'UnsupportedDocumentError' });
});
