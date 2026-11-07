import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { bookmarkEntries } from '../src/engine/bookmarks.js';

let dom;
beforeAll(() => { dom = new JSDOM(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name]; });
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = name => readFileSync(`tests/fixtures/bookmark-recovery/${name}.docx`);
const ranges = entries => entries.map(({ id, name, start, end }) => ({ id, name, start, end }));

it.each(['orphan-start', 'orphan-end', 'reversed', 'duplicate-start', 'duplicate-end', 'unpaired-columns', 'combined'])('retains independent valid ranges when one bookmark is invalid: %s', async name => {
  const bytes = source(name);
  await expect(DocxPackage.open(bytes)).rejects.toThrow(name === 'combined' ? 'shading' : /bookmark/i);
  const pkg = await DocxPackage.open(bytes, { bestEffort: true }), control = await DocxPackage.open(source('healthy'));
  expect(pkg.readOnly).toBe(true);
  const model = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets, { displayOnly: true });
  expect(ranges(model.bookmarks)).toEqual(ranges(bookmarkEntries(control.paragraphs, control.tables)));
  expect(model.bookmarks.map(e => e.name)).toEqual(['Across', 'Heading', 'Overlap', 'Cell']);
  const cell = model.bookmarks.find(e => e.name === 'Cell');
  expect(model.text.slice(cell.start, cell.end)).toBe('Retained table cell');
  expect(pkg.previewIssues.some(m => m.startsWith('Bookmark 99 in word/document.xml'))).toBe(true);
  if (name === 'combined') expect(pkg.previewIssues.some(m => m.startsWith('Bookmark 98 '))).toBe(true);
  expect(pkg.paragraphs.flatMap(p => p.bookmarks || []).some(m => ['98', '99'].includes(m.id))).toBe(false);
  expect(pkg.tables).toHaveLength(1); expect(Object.keys(pkg.assets)).toHaveLength(2);
  const original = unzipSync(bytes);
  for (const part of Object.keys(original)) expect(Buffer.from(pkg.parts[part]).equals(Buffer.from(original[part])), part).toBe(true);
  expect(() => pkg.export()).toThrow();
});

it('keeps healthy overlapping, point and cell ranges editable with an unchanged package', async () => {
  const bytes = source('healthy'), pkg = await DocxPackage.open(bytes);
  expect(pkg.readOnly).not.toBe(true);
  expect(bookmarkEntries(pkg.paragraphs, pkg.tables)).toHaveLength(4);
  expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
});

it('reports one invalid-position identifier without mutating markers or rejecting other ranges', async () => {
  const pkg = await DocxPackage.open(source('healthy'));
  const p = pkg.paragraphs[0]; p.bookmarks.push({ id: '99', edge: 'start', name: 'Invalid', offset: -1, order: 100 });
  const before = JSON.stringify(pkg.paragraphs), invalid = vi.fn();
  expect(() => bookmarkEntries(pkg.paragraphs, pkg.tables)).toThrow('Invalid bookmark position.');
  expect(bookmarkEntries(pkg.paragraphs, pkg.tables, invalid)).toHaveLength(4);
  expect(invalid).toHaveBeenCalledTimes(1); expect(invalid.mock.calls[0][0]).toBe('99');
  expect(JSON.stringify(pkg.paragraphs)).toBe(before);
  expect(() => bookmarkEntries(pkg.paragraphs, pkg.tables, () => { throw new Error('callback failure'); })).toThrow('callback failure');
});

it('isolates an invalid column row range while retaining a valid column bookmark', async () => {
  const pkg = await DocxPackage.open(source('healthy')), table = pkg.tables[0], row = table.rows[0];
  const cell = pkg.paragraphs.find(p => p.cellId), first = pkg.paragraphs[0];
  cell.bookmarks.find(m => m.id === '20' && m.edge === 'start').tableColumns = { first: '0', last: '0' };
  first.bookmarks.push({ id: '99', edge: 'start', name: 'Invalid', offset: 0, order: 100, tableColumns: { first: '0', last: '0' }, tableBoundary: { tableId: table.id, rowId: row.id, side: 'after' } });
  cell.bookmarks.push({ id: '99', edge: 'end', offset: 1, order: 101 });
  const invalid = vi.fn(), before = JSON.stringify(pkg.paragraphs);
  expect(() => bookmarkEntries(pkg.paragraphs, pkg.tables)).toThrow('Invalid column bookmark row range.');
  const valid = bookmarkEntries(pkg.paragraphs, pkg.tables, invalid);
  expect(valid).toHaveLength(4); expect(valid.find(e => e.id === '20').columnRange.cellIds).toEqual([cell.cellId]);
  expect(invalid).toHaveBeenCalledTimes(1); expect(invalid.mock.calls[0][0]).toBe('99');
  expect(JSON.stringify(pkg.paragraphs)).toBe(before);
});

it('does not swallow unexpected column conversion errors in recovery', async () => {
  const pkg = await DocxPackage.open(source('healthy')), cell = pkg.paragraphs.find(p => p.cellId);
  cell.bookmarks.find(m => m.id === '20' && m.edge === 'start').tableColumns = { first: 'not-an-integer', last: '0' };
  const invalid = vi.fn();
  expect(() => bookmarkEntries(pkg.paragraphs, pkg.tables, invalid)).toThrow();
  expect(invalid).not.toHaveBeenCalled();
});
