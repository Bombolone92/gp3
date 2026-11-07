import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
const parser = new (new JSDOM('').window.DOMParser)();
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const values = ['_x0041_', '_X00aF_', '_x005F_x0041_', '_x0041_x0042_', '_xD83D__xDE00_', '& <tag> "😀" _x0041_', 'line\n_x000A_\ttab', '_x123_ _xGGGG_'];
values.push('  Indented note', 'Trailing line\n', '\n\t  Both ends \t\n');
it.each(values)('preserves literal note text %j across repeated app saves', async value => {
  let wb = new Workbook(); wb.setInput(wb.activeSheetId, 0, 0, 'Keep');
  wb.setNote(wb.activeSheetId, 0, 0, value); wb.setNote(wb.activeSheetId, 9, 9, value);
  for (let n = 0; n < 2; n++) {
    const before = wb.toJSON(), bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
    expect(wb.toJSON()).toEqual(before);
    const zip = X.CFB.read(bytes, { type: 'array' });
    const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/comments1.xml').content);
    const doc = parser.parseFromString(xml, 'application/xml'); expect(doc.querySelector('parsererror')).toBeNull();
    const serialized = doc.getElementsByTagNameNS(NS, 't')[0].textContent;
    // Independently decode the OOXML Xstring layer after the XML parser.
    expect(serialized.replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))).toBe(value);
    wb = await workbookFromFile(bytes, 'notes.xlsx');
    expect(wb.activeSheet.notes.get('0,0')).toBe(value); expect(wb.activeSheet.notes.get('9,9')).toBe(value);
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe('Keep');
  }
});
it.each(values)('preserves the legacy projection of threaded note text %j', value => {
  const book = X.utils.book_new(), sheet = X.utils.aoa_to_sheet([['Data']]);
  sheet.A1.c = [{ a: 'First', t: value, T: true }, { a: 'Second', t: 'Reply & ' + value, T: true }];
  X.utils.book_append_sheet(book, sheet, 'Data');
  const bytes = new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' }));
  const zip = X.CFB.read(bytes, { type: 'array' }), xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/comments1.xml').content);
  const doc = parser.parseFromString(xml, 'application/xml'); expect(doc.querySelector('parsererror')).toBeNull();
  const serialized = doc.getElementsByTagNameNS(NS, 't')[0].textContent;
  expect(serialized.replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))).toBe(`Comment:\n    ${value}\nReply:\n    Reply & ${value}\n`);
});
it('continues decoding actual native Xstring escapes in imported notes', async () => {
  const wb = new Workbook(); wb.setNote(wb.activeSheetId, 0, 0, 'SENTINEL');
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const content = new TextDecoder().decode(X.CFB.find(zip, '/xl/comments1.xml').content).replace('SENTINEL', '_x0041_ &amp; _x005F_x0042_');
  const entry = X.CFB.find(zip, '/xl/comments1.xml');
  entry.content = new TextEncoder().encode(content); entry.size = entry.content.length;
  const imported = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect(imported.activeSheet.notes.get('0,0')).toBe('A & _x0042_');
});

it('keeps note indentation and trailing lines through edits, drafts and undo while blank notes still clear', () => {
  const wb = new Workbook(), id = wb.activeSheetId, value = '  First\nLast  \n';
  wb.setNote(id, 2, 3, value);
  expect(wb.getNote(id, 2, 3)).toBe(value);
  const copy = new Workbook(wb.toJSON());
  expect(copy.getNote(copy.activeSheetId, 2, 3)).toBe(value);
  wb.setNote(id, 2, 3, ' \t\n'); expect(wb.getNote(id, 2, 3)).toBeNull();
  wb.undo(); expect(wb.getNote(id, 2, 3)).toBe(value);
  wb.redo(); expect(wb.getNote(id, 2, 3)).toBeNull();
});
