import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

const parser = new (new JSDOM('').window.DOMParser)();
const tableNS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const officeNS = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const calcNS = 'urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0';
function xmlDoc(bytes) {
  const zip = X.CFB.read(bytes, { type: 'array' });
  const doc = parser.parseFromString(new TextDecoder().decode(X.CFB.find(zip, 'content.xml').content), 'application/xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
}

it.each([
  ['10/A1', '#DIV/0!', 2, 5],
  ['SQRT(A1)', '#NUM!', 4, 2],
  ['VALUE(A1)', '#VALUE!', 42, 42],
  ['IF(A1=0,NA(),A1)', '#N/A', 7, 7],
  ['IF(A1=0,#REF!,A1)', '#REF!', 8, 8],
  ['IF(A1=0,UnknownName,A1)', '#NAME?', 9, 9],
  ['IF(A1=0,#NULL!,A1)', '#NULL!', 10, 10],
])('retains %s while its cached result is %s', async (formula, error, corrected, expected) => {
  let wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, error === '#NUM!' ? '-1' : error === '#VALUE!' ? 'bad' : '0');
  wb.setInput(id, 0, 1, `=${formula}`);
  wb.setNote(id, 0, 1, 'Keep this calculation');
  expect(wb.getValue(id, 0, 1)).toEqual({ error });
  for (let round = 0; round < 2; round++) {
    const bytes = new Uint8Array(await (await workbookToOds(wb)).arrayBuffer());
    const raw = X.read(bytes, { type: 'array' });
    expect(raw.Sheets.Sheet1.B1.f).toBe(formula);
    expect(raw.Sheets.Sheet1.B1.t).toBe('e');
    const cells = [...xmlDoc(bytes).getElementsByTagNameNS(tableNS, 'table-cell')];
    const cell = cells.find((c) => c.hasAttributeNS(tableNS, 'formula'));
    expect(cell.getAttributeNS(officeNS, 'value-type')).toBe('string');
    expect(cell.getAttributeNS(officeNS, 'string-value')).toBe(error);
    expect(cell.getAttributeNS(calcNS, 'value-type')).toBe('error');
    expect(cell.textContent).toContain(error);
    wb = await workbookFromFile(bytes, 'errors.ods'); id = wb.activeSheetId;
    expect(wb.getCell(id, 0, 1).f).toBe(formula);
    expect(wb.getValue(id, 0, 1)).toEqual({ error });
    expect(wb.getNote(id, 0, 1)).toBe('Keep this calculation');
  }
  wb.setInput(id, 0, 0, String(corrected));
  expect(wb.getValue(id, 0, 1)).toBe(expected);
  wb.undo();
  expect(wb.getValue(id, 0, 1)).toEqual({ error });
  wb.redo();
  expect(wb.getValue(id, 0, 1)).toBe(expected);
});

it.each([0x00, 0x07, 0x0f, 0x17, 0x1d, 0x24, 0x2a, 0x2b])('preserves error constant code %s and distinguishes error-looking text', (code) => {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, { A1: { t: 'e', v: code }, B1: { t: 's', v: '#DIV/0!' }, '!ref': 'A1:B1' }, 'Data');
  const bytes = new Uint8Array(X.write(book, { bookType: 'ods', type: 'array' }));
  const raw = X.read(bytes, { type: 'array' });
  expect(raw.Sheets.Data.A1.t).toBe('e');
  expect(raw.Sheets.Data.A1.v).toBe(code);
  expect(raw.Sheets.Data.A1.f).toBeUndefined();
  expect(raw.Sheets.Data.B1.t).toBe('s');
  expect(raw.Sheets.Data.B1.v).toBe('#DIV/0!');
});

it('retains an errored array anchor and its matrix dimensions', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=1/{0,2}');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#DIV/0!' });
  expect(wb.getValue(id, 0, 1)).toBe(0.5);
  const blob = await workbookToOds(wb), raw = X.read(await blob.arrayBuffer(), { type: 'array' });
  expect(raw.Sheets.Sheet1.A1.f).toBe('1/{0,2}');
  expect(raw.Sheets.Sheet1.A1.F).toBe('A1:B1');
  const reopened = await workbookFromFile(blob, 'array-errors.ods');
  expect(reopened.getValue(reopened.activeSheetId, 0, 0)).toEqual({ error: '#DIV/0!' });
  expect(reopened.getValue(reopened.activeSheetId, 0, 1)).toBe(0.5);
});

it('retains a blocked spill formula so removing the blocker repairs it', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 1, 0, 'block'); wb.setInput(id, 0, 0, '=SEQUENCE(2)');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#SPILL!' });
  const reopened = await workbookFromFile(await workbookToOds(wb), 'blocked.ods');
  const target = reopened.activeSheetId;
  expect(reopened.getValue(target, 0, 0)).toEqual({ error: '#SPILL!' });
  reopened.setInput(target, 1, 0, '');
  expect(reopened.getValue(target, 0, 0)).toBe(1);
  expect(reopened.getValue(target, 1, 0)).toBe(2);
});
