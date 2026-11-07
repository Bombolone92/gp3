import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
function source(lower, right = false) {
  const bytes = readFileSync('tests/fixtures/nested-tables/nested-table-deep.docx');
  if (!lower && !right) return bytes;
  const parts = unzipSync(bytes), xml = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  const outer = xml.getElementsByTagNameNS('*', 'tbl')[0];
  const rows = [...outer.children].filter(node => node.localName === 'tr');
  if (lower) outer.insertBefore(rows[1], rows[0]);
  if (right) {
    const cells = [...rows[0].children].filter(node => node.localName === 'tc');
    rows[0].insertBefore(cells[1], cells[0]);
  }
  parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml));
  return zipSync(parts);
}
function hierarchy(doc) {
  return doc.tables.map(t => ({ id: t.id, parent: t.parentCellId, rows: t.rows.map(r => r.cells.map(c => ({ id: c.id, merge: c.vMerge }))) }));
}
it.each([false, true])('preserves nested ownership through a vertical merge and owner-row deletion (nested lower: %s)', async lower => {
  const pkg = await DocxPackage.open(source(lower)), doc = model(pkg);
  const original = { text: doc.text, hierarchy: hierarchy(doc) };
  const outer = doc.tables.find(t => !t.parentCellId), child = doc.tables.find(t => t.parentCellId === outer.rows[lower ? 1 : 0].cells[0].id);
  const grandchild = doc.tables.find(t => t.parentCellId && t !== child);
  expect(child).toBeTruthy(); expect(grandchild).toBeTruthy();
  const descendants = new Map(doc.paragraphs.filter(p => p.cellId && !outer.rows.some(r => r.cells.some(c => c.id === p.cellId))).map(p => [p.id, p.cellId]));
  const first = outer.rows[0].cells[0].id;
  doc.selectCell(first); doc.mergeCellBelow();
  expect(child.parentCellId).toBe(first);
  for (const p of doc.paragraphs) if (descendants.has(p.id)) expect(p.cellId).toBe(descendants.get(p.id));
  let reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(reopened.text).toBe(doc.text); expect(reopened.tables).toHaveLength(3);
  const merged = { text: doc.text, hierarchy: hierarchy(doc) };
  doc.selectCell(first); doc.deleteTablePart('row');
  const promoted = doc.tables.find(t => !t.parentCellId).rows[0].cells[0].id;
  expect(doc.tables.find(t => t.id === child.id).parentCellId).toBe(promoted);
  for (const p of doc.paragraphs) if (descendants.has(p.id)) expect(p.cellId).toBe(descendants.get(p.id));
  const promotedBytes = await save(pkg, doc);

  reopened = model(await DocxPackage.open(promotedBytes));
  expect(reopened.text).toBe(doc.text); expect(reopened.tables).toHaveLength(3);
  expect(reopened.tables.find(t => !t.parentCellId).rows).toHaveLength(1);
  doc.undo(); expect({ text: doc.text, hierarchy: hierarchy(doc) }).toEqual(merged);
  doc.undo(); expect({ text: doc.text, hierarchy: hierarchy(doc) }).toEqual(original);
  doc.redo(); doc.redo();
  expect(model(await DocxPackage.open(await save(pkg, doc))).text).toBe(reopened.text);
});
it.each([false, true])('merges adjacent outer cells containing nested descendants (nested right: %s)', async right => {
  const pkg = await DocxPackage.open(source(false, right)), doc = model(pkg);
  const original = { text: doc.text, hierarchy: hierarchy(doc) };
  const outer = doc.tables.find(t => !t.parentCellId), first = outer.rows[0].cells[0].id;
  const child = doc.tables.find(t => t.parentCellId === outer.rows[0].cells[right ? 1 : 0].id);
  const descendants = new Map(doc.paragraphs.filter(p => p.cellId && !outer.rows.some(r => r.cells.some(c => c.id === p.cellId))).map(p => [p.id, p.cellId]));
  const start = Math.min(doc.text.indexOf('Outer before'), doc.text.indexOf('Outer side'));
  const end = Math.max(doc.text.indexOf('Outer after') + 'Outer after'.length, doc.text.indexOf('Outer side') + 'Outer side'.length);
  doc.select(start, end);
  expect(doc.mergeCellsContext?.table.id).toBe(outer.id);
  doc.mergeCells();
  expect(outer.rows[0].cells).toHaveLength(1); expect(outer.rows[0].cells[0].span).toBe(2);
  expect(child.parentCellId).toBe(first);
  for (const p of doc.paragraphs) if (descendants.has(p.id)) expect(p.cellId).toBe(descendants.get(p.id));
  expect(doc.text).toBe(original.text);
  const bytes = await save(pkg, doc);

  const reopened = model(await DocxPackage.open(bytes));
  expect(reopened.text).toBe(doc.text); expect(reopened.tables).toHaveLength(3);
  expect(reopened.tables.find(t => !t.parentCellId).rows[0].cells).toHaveLength(1);
  doc.undo(); expect({ text: doc.text, hierarchy: hierarchy(doc) }).toEqual(original);
  doc.redo(); expect(model(await DocxPackage.open(await save(pkg, doc))).text).toBe(reopened.text);
});
