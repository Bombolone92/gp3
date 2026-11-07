import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, sheetToCsv, sheetToTsv } from '../src/core/io.js';
import { parseInput } from '../src/core/format.js';

const open = (text, name = 'data.csv') => workbookFromFile(new TextEncoder().encode(text), name);

// Excel and Sheets read the seven error spellings in delimited text as error values; here
// they arrived as text, so a CSV this app wrote from =1/0 came back as the words "#DIV/0!".
it('reads the seven error spellings in delimited text as error values', async () => {
  const wb = await open('#N/A,#DIV/0!,#VALUE!,#REF!,#NAME?,#NUM!,#NULL!\n');
  const id = wb.activeSheetId;
  expect(['#N/A', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#NULL!'].map((code, c) => [wb.getCell(id, 0, c), wb.getDisplay(id, 0, c), code]))
    .toEqual(['#N/A', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#NULL!'].map((code) => [{ v: { error: code }, f: null }, code, code]));
  wb.setInput(id, 1, 0, '=ISNA(A1)');
  wb.setInput(id, 1, 1, '=ISERROR(B1)');
  wb.setInput(id, 1, 2, '=IFERROR(C1,"caught")');
  expect([wb.getValue(id, 1, 0), wb.getValue(id, 1, 1), wb.getValue(id, 1, 2)]).toEqual([true, true, 'caught']);
});

it.each([
  ['#n/a', '#N/A'], [' #DIV/0! ', '#DIV/0!'], ['"#VALUE!"', '#VALUE!'], ['#Name?', '#NAME?'],
])('reads %j as the error %s whatever its case, spacing or quoting', async (field, code) => {
  const wb = await open(`${field},1\n`);
  expect(wb.getCell(wb.activeSheetId, 0, 0)).toEqual({ v: { error: code }, f: null });
});

it.each(['#ERROR!', '#SPILL!', '#CALC!', '#N/A!', '#REF', "'#N/A", '#DIV/0', 'N/A'])('keeps %s as text', async (field) => {
  const wb = await open(`"${field.replace(/"/g, '""')}",1\n`);
  expect(wb.getCell(wb.activeSheetId, 0, 0)).toEqual({ v: field, f: null });
});

it.each([['csv', sheetToCsv], ['tsv', sheetToTsv]])('round-trips error cells through %s as errors, not text', async (extension, exportSheet) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=1/0');
  wb.setInput(id, 0, 1, '=NA()');
  wb.setInput(id, 0, 2, '=SQRT(-1)');
  wb.setInput(id, 0, 3, 'text');
  const back = await open(exportSheet(wb, id), `data.${extension}`);
  const out = back.activeSheetId;
  expect([0, 1, 2].map((c) => back.getValue(out, 0, c))).toEqual([{ error: '#DIV/0!' }, { error: '#N/A' }, { error: '#NUM!' }]);
  expect(back.getValue(out, 0, 3)).toBe('text');
  expect(exportSheet(back, out)).toBe(exportSheet(wb, id));
});

it('reads typed input the same way: #N/A typed into a cell is the error value too', () => {
  expect(parseInput('#N/A')).toEqual({ v: { error: '#N/A' }, f: null, fmt: null });
});
