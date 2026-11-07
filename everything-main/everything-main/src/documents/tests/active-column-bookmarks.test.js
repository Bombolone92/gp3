import { assertPackageParts } from './helpers/assert-package-parts.js';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

const folder = 'tests/fixtures/column-bookmarks/';
const source = readFileSync(folder + 'merge-control.docx');
const reference = JSON.parse(readFileSync(folder + 'merge-native-ranges.json', 'utf8').replace(/^\uFEFF/, ''));
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
let dom, pkg;
beforeAll(async () => {
  dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer;
  pkg = await DocxPackage.open(source);
}, 60000);
afterAll(() => dom.window.close());
const cellTexts = (d, bookmark) => bookmark.columnRange.cellIds.map(id => d.paragraphs.filter(p => p.cellId === id).map(p => p.runs.map(r => r.text).join('')).join('\r'));

it('resolves all twelve native selections separately from their enclosing text intervals', async () => {
  const d = model(pkg);
  for (const native of reference.bookmarks) {
    const bookmark = d.bookmarks.find(b => b.name === native.name);
    expect(cellTexts(d, bookmark), native.name).toEqual(native.selectedCells.map(c => c.text.replace(/\r\x07$/, '')));
    expect(d.text.slice(bookmark.columnRange.target)).toMatch(/^R\dC\d/);
  }
  assertPackageParts(unzipSync(await save(pkg, d)), unzipSync(source));
});

// These integration cases import/export/reopen a native package and verify undo.
// Give them the same bounded budget as fixture import above.
it.each(['text', 'split paragraph', 'insert row', 'insert column before', 'insert column inside', 'delete row', 'delete column before', 'delete selected column', 'delete table', 'merge', 'split cell', 'rename', 'remove'])
('retains native column meaning through %s, export/reopen and exact undo', async operation => {
  const d = model(pkg), bookmark = d.bookmarks.find(b => b.name === (operation === 'split cell' ? 'TopMergedFirst' : 'PlainMiddle'));
  const table = d.tables.find(t => t.id === bookmark.columnRange.tableId);
  d.select(bookmark.columnRange.target);
  if (operation === 'text') d.replace('Added ');
  if (operation === 'split paragraph') d.replace('\n');
  if (operation === 'insert row') d.insertTableRow();
  if (operation === 'insert column before') { d.selectCell(table.rows[0].cells[0].id); d.insertTableColumn(); }
  if (operation === 'insert column inside') d.insertTableColumn();
  if (operation === 'delete row') d.deleteTablePart('row');
  if (operation === 'delete column before') { d.selectCell(table.rows[0].cells[0].id); d.deleteTablePart('column'); }
  if (operation === 'delete selected column') d.deleteTablePart('column');
  if (operation === 'delete table') d.deleteTablePart('table');
  if (operation === 'merge') {
    const first = d.paragraphs.findIndex(p => p.cellId === table.rows[0].cells[0].id);
    const second = d.paragraphs.findIndex(p => p.cellId === table.rows[0].cells[1].id);
    d.select(d.paragraphOffset(first), d.paragraphOffset(second) + 1); d.mergeCells();
  }
  if (operation === 'split cell') d.splitCell();
  if (operation === 'rename') d.renameBookmark(bookmark.id, 'RenamedColumn');
  if (operation === 'remove') d.removeBookmark(bookmark.id);
  const current = d.bookmarks.find(b => b.id === bookmark.id);
  if (['delete selected column', 'delete table', 'remove'].includes(operation)) expect(current).toBeUndefined();
  else {
    const texts = cellTexts(d, current);
    if (operation === 'insert column before' || operation === 'delete column before' || operation === 'rename') expect(texts).toEqual(['R1C2', 'R2C2', 'R3C2']);
    if (operation === 'insert column inside') expect(texts).toEqual(['R1C2', '', 'R2C2', '', 'R3C2', '']);
    if (operation === 'insert row') expect(texts).toEqual(['R1C2', '', 'R2C2', 'R3C2']);
    if (operation === 'delete row') expect(texts).toEqual(['R2C2', 'R3C2']);
    if (operation === 'merge') expect(texts).toEqual(['R1C1\rR1C2', 'R2C1', 'R2C2', 'R3C1', 'R3C2']);
    if (operation === 'split cell') expect(texts).toEqual(['R1C1\rR1C2', '', 'R2C1', 'R2C2', 'R3C1', 'R3C2']);
  }
  const bytes = await save(pkg, d), again = model(await DocxPackage.open(bytes));
  expect(again.bookmarks.map(b => [b.name, b.columnRange && cellTexts(again, b)])).toEqual(d.bookmarks.map(b => [b.name, b.columnRange && cellTexts(d, b)]));
  const original = unzipSync(source), out = unzipSync(bytes);
  // Merging, renaming and removing keep checked text, so settings stay byte exact.
  if (!['merge', 'rename', 'remove'].includes(operation)) expectBodyEditParts(out, original);
  else for (const name of Object.keys(original)) if (name !== 'word/document.xml') expect(Buffer.from(out[name]).equals(Buffer.from(original[name])), name).toBe(true);
  d.undo(); assertPackageParts(unzipSync(await save(pkg, d)), original);
}, 60000);
