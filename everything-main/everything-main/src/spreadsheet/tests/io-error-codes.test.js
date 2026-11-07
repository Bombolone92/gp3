import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';

const modern = [['#SPILL!', 0x2d], ['#CONNECT!', 0x2e], ['#BLOCKED!', 0x2f], ['#UNKNOWN!', 0x30], ['#FIELD!', 0x31], ['#CALC!', 0x32]];

// Every error Excel added since dynamic arrays was saved as #VALUE!, so a blocked spill
// or an empty FILTER result changed its meaning in the file and on reopening.
it('writes and reads back the errors Excel added since dynamic arrays by name', async () => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 1, 0, 'block');
  wb.setInput(id, 0, 0, '=SEQUENCE(2)');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#SPILL!' });
  wb.setCells(id, modern.map(([error], c) => ({ r: 2, c, cell: { v: { error }, f: null } })));
  wb.setCells(id, [{ r: 3, c: 0, cell: { v: { error: '#CYCLE!' }, f: null } }]);
  const saved = await workbookToXlsx(wb);
  const raw = XLSX.read(await saved.arrayBuffer(), { type: 'array' });
  const sheet = raw.Sheets[raw.SheetNames[0]];
  expect(sheet.A1).toMatchObject({ t: 'e', v: 0x0f, w: '#VALUE!', f: 'SEQUENCE(2)' });
  modern.forEach((_, c) => expect(sheet[`${XLSX.utils.encode_col(c)}3`]).toMatchObject(
    { t: 'e', v: 0x0f, w: '#VALUE!' })); // modern errors use rich metadata
  expect(sheet.A4).toMatchObject({ t: 'e', v: 0x0f, w: '#VALUE!' }); // no Excel spelling
  const back = await workbookFromFile(saved, 'errors.xlsx');
  const bid = back.sheets[0].id;
  modern.forEach(([error], c) => expect(back.getValue(bid, 2, c)).toEqual({ error }));
  expect(back.getValue(bid, 0, 0)).toEqual({ error: '#SPILL!' });
  back.setInput(bid, 1, 0, '');
  expect(back.getValue(bid, 1, 0)).toBe(2);
});

it('imports the same errors from a file another program wrote', async () => {
  const book = XLSX.utils.book_new();
  const sheet = { '!ref': `A1:${XLSX.utils.encode_col(modern.length - 1)}1` };
  modern.forEach(([, code], c) => { sheet[`${XLSX.utils.encode_col(c)}1`] = { t: 'e', v: code }; });
  XLSX.utils.book_append_sheet(book, sheet, 'Errors');
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
  const wb = await workbookFromFile(bytes, 'errors.xlsx');
  const id = wb.sheets[0].id;
  modern.forEach(([error], c) => {
    expect(wb.getValue(id, 0, c)).toEqual({ error });
    expect(wb.getDisplay(id, 0, c)).toBe(error);
  });
});
