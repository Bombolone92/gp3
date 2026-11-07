import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { readXlsxFilter, writeXlsxFilter } from '../src/core/xlsx-filter.js';

// A column of codes (007, 1.50) holds text, and "equals 007" is a text criterion. Writing it as
// the number it reads as put <customFilter operator="equal" val="7"/> into the file, where Excel
// then filtered for 7 and hid every 007 row; reading such a val back turned it into 7 as well.
// A comparison (greater than, between) is numeric on both sides and still writes its number.

const range = { r1: 0, c1: 0, r2: 3, c2: 0 };

/** A book of text codes with the given criterion on column A, and the sheet part it saves. */
async function saved(criterion) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['Code', "'007", "'7", "'1.50"].forEach((v, r) => wb.setInput(id, r, 0, v));
  wb.setFilterRange(id, range);
  wb.setFilterCriteria(id, 0, criterion);
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' });
  const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/worksheets/sheet1.xml').content);
  X.CFB.utils.cfb_del(zip, '/xl/worksheets/sheet2.xml');
  const book = X.CFB.find(zip, '/xl/workbook.xml');
  book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet name="_puter_meta"[^>]*\/>/, ''));
  book.size = book.content.length;
  return { wb, id, xml, native: X.CFB.write(zip, { type: 'array', fileType: 'zip' }) };
}
const hidden = (wb, id) => [...wb.sheet(id).filterHidden].sort((a, b) => a - b);

it.each([
  ['eq', 'equal'],
  ['neq', 'notEqual'],
])('writes a text code as itself for a %s criterion and reads it back unchanged', async (op, operator) => {
  const { wb, id, xml, native } = await saved({ op, value: '007' });
  expect(xml).toContain(`<customFilter operator="${operator}" val="007"/>`);
  const back = await workbookFromFile(native, 'codes.xlsx');
  expect(back.activeSheet.filter.criteria).toEqual({ 0: { op, value: '007' } });
  expect(hidden(back, back.activeSheetId)).toEqual(hidden(wb, id));
});

it('still writes a number criterion as a number', async () => {
  const { xml, native } = await saved({ op: 'eq', value: 7 });
  expect(xml).toContain('<customFilter operator="equal" val="7"/>');
  const back = await workbookFromFile(native, 'seven.xlsx');
  expect(back.activeSheet.filter.criteria).toEqual({ 0: { op: 'eq', value: 7 } });
});

it('keeps a comparison numeric, whichever way its bound was typed', () => {
  expect(writeXlsxFilter({ range, criteria: { 0: { op: 'gt', value: '007' } } }))
    .toContain('<customFilter operator="greaterThan" val="7"/>');
  expect(writeXlsxFilter({ range, criteria: { 0: { op: 'between', value: '007', value2: 20 } } }))
    .toContain('<customFilter operator="greaterThanOrEqual" val="7"/>');
});

it.each([
  ['007', { op: 'eq', value: '007' }],
  ['1.50', { op: 'eq', value: '1.50' }],
  [' 7 ', { op: 'eq', value: 7 }],
  ['7', { op: 'eq', value: 7 }],
  ['-2.5', { op: 'eq', value: -2.5 }],
])('reads the equality val %s as %j', (val, criterion) => {
  const xml = `<autoFilter ref="A1:A4"><filterColumn colId="0"><customFilters><customFilter operator="equal" val="${val}"/></customFilters></filterColumn></autoFilter>`;
  expect(readXlsxFilter(xml, range)).toEqual({ 0: criterion });
});
