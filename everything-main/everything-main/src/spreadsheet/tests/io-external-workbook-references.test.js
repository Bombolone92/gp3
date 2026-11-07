import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { META_SHEET, workbookFromFile, workbookToOds, workbookToXlsx } from '../src/core/io.js';

/** An .xlsx whose first sheet holds the given sheetData rows, as another program would write it. */
function fileWith(rows) {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([['x']]), 'Data');
  const zip = X.CFB.read(new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const sheet = X.CFB.find(zip, '/xl/worksheets/sheet1.xml');
  sheet.content = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`);
  sheet.size = sheet.content.length;
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

const ROWS = '<row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row>'
  + '<row r="2"><c r="E2"><f>[1]Sheet1!A1</f><v>55</v></c></row>'
  + '<row r="3"><c r="D3" t="str"><f>\'[Book1.xlsx]Sheet1\'!A1</f><v>text</v></c><c r="E3"><f>SUM([1]Sheet1!A1:A3)</f><v>99</v></c>'
  + '<c r="F3" t="b"><f>[1]Sheet1!B1</f><v>1</v></c><c r="G3" t="e"><f>[1]Sheet1!C1</f><v>#N/A</v></c><c r="H3"><f>[1]!ExtName</f><v>7</v></c><c r="I3"><f>[1]Sheet1!A1</f></c></row>';

const rawSheet = async (blob) => X.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });

function expectCached(wb) {
  const id = wb.activeSheetId;
  expect(wb.getCell(id, 0, 0)).toMatchObject({ f: '1+1' });
  expect(wb.getCell(id, 1, 4)).toMatchObject({ v: 55, f: null });
  expect(wb.getCell(id, 2, 3)).toMatchObject({ v: 'text', f: null });
  expect(wb.getCell(id, 2, 4)).toMatchObject({ v: 99, f: null });
  expect(wb.getCell(id, 2, 5)).toMatchObject({ v: true, f: null });
  expect(wb.getCell(id, 2, 6)).toMatchObject({ v: { error: '#N/A' }, f: null });
  expect(wb.getCell(id, 2, 7)).toMatchObject({ v: 7, f: null });
  expect(wb.getCell(id, 2, 8)).toBeFalsy();
  expect(wb.getDisplay(id, 1, 4)).toBe('55');
}

// A formula referencing another workbook ([1]Sheet1!A1, '[Book1.xlsx]Sheet1'!A1, [1]!Name) has
// nothing to read here, so the cell showed #REF! where Excel and Sheets show the value the file
// cached, and the next save wrote the formula back without the link part, which Excel opens only
// after a repair. The cell keeps the cached value; the formula is parked in the sidecar.
it('keeps the cached value of a formula that reaches into another workbook', async () => {
  const wb = await workbookFromFile(fileWith(ROWS), 'links.xlsx');
  expectCached(wb);
  const parked = wb.externalFormulas.get(wb.activeSheetId);
  expect([...parked].map(([key, { f }]) => [key, f])).toEqual([
    ['1,4', '[1]Sheet1!A1'], ['2,3', "'[Book1.xlsx]Sheet1'!A1"], ['2,4', 'SUM([1]Sheet1!A1:A3)'],
    ['2,5', '[1]Sheet1!B1'], ['2,6', '[1]Sheet1!C1'], ['2,7', '[1]!ExtName'], ['2,8', '[1]Sheet1!A1'],
  ]);
});

it('saves such cells as their values, never as formulas, with the formula text in the sidecar, and reads them back the same', async () => {
  const wb = await workbookFromFile(fileWith(ROWS), 'links.xlsx');
  wb.setInput(wb.activeSheetId, 2, 7, '8'); // an edited cell no longer stands for the file's formula
  const saved = await workbookToXlsx(wb);
  const raw = await rawSheet(saved);
  for (const addr of ['E2', 'D3', 'E3', 'F3', 'G3', 'H3']) expect(raw.Sheets.Data[addr].f).toBeUndefined();
  expect(raw.Sheets.Data.E2.v).toBe(55);
  expect(raw.Sheets.Data.A1.f).toBe('1+1');
  const meta = JSON.parse(X.utils.sheet_to_json(raw.Sheets[META_SHEET], { header: 1 }).map((row) => row[0]).join(''));
  expect(meta.sheets.Data.external).toEqual({ '1,4': '[1]Sheet1!A1', '2,3': "'[Book1.xlsx]Sheet1'!A1", '2,4': 'SUM([1]Sheet1!A1:A3)', '2,5': '[1]Sheet1!B1', '2,6': '[1]Sheet1!C1' });
  const back = await workbookFromFile(saved, 'links.xlsx');
  expect(back.getCell(back.activeSheetId, 1, 4)).toMatchObject({ v: 55, f: null });
  expect(back.getCell(back.activeSheetId, 2, 7)).toMatchObject({ v: 8, f: null });
  expect([...back.externalFormulas.get(back.activeSheetId).keys()]).toEqual(['1,4', '2,3', '2,4', '2,5', '2,6']);
  const ods = await workbookFromFile(await workbookToOds(wb), 'links.ods');
  expect(ods.getCell(ods.activeSheetId, 1, 4)).toMatchObject({ v: 55, f: null });
  expect(ods.getCell(ods.activeSheetId, 2, 6)).toMatchObject({ v: { error: '#N/A' }, f: null });
  expect(ods.externalFormulas.get(ods.activeSheetId).get('1,4').f).toBe('[1]Sheet1!A1');
});

it('writes a typed external reference as its text, like any formula no program could read, and takes it back', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=[1]Sheet1!A1');
  wb.setInput(id, 0, 1, "='[Book1.xlsx]Sheet1'!A1*2");
  wb.setInput(id, 0, 2, '=Sales[Total]');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#REF!' });
  const saved = await workbookToXlsx(wb);
  const raw = await rawSheet(saved);
  expect(raw.Sheets.Sheet1.A1).toMatchObject({ t: 's', v: '=[1]Sheet1!A1' });
  expect(raw.Sheets.Sheet1.A1.f).toBeUndefined();
  expect(raw.Sheets.Sheet1.B1).toMatchObject({ t: 's', v: "='[Book1.xlsx]Sheet1'!A1*2" });
  const back = await workbookFromFile(saved, 'typed.xlsx');
  expect(back.getCell(back.activeSheetId, 0, 0)).toMatchObject({ v: null, f: '[1]Sheet1!A1' });
  expect(back.getCell(back.activeSheetId, 0, 1)).toMatchObject({ v: null, f: "'[Book1.xlsx]Sheet1'!A1*2" });
  expect(back.getCell(back.activeSheetId, 0, 2).f).toBe('Sales[Total]');
});

it('leaves structured references and ordinary sheet references alone', async () => {
  const rows = '<row r="1"><c r="A1"><f>Sales[Total]</f><v>3</v></c><c r="B1"><f>Data!A1+1</f><v>4</v></c><c r="C1"><f>\'My Sheet\'!A1</f><v>5</v></c></row>';
  const wb = await workbookFromFile(fileWith(rows), 'plain.xlsx');
  const id = wb.activeSheetId;
  expect(wb.getCell(id, 0, 0).f).toBe('Sales[Total]');
  expect(wb.getCell(id, 0, 1).f).toBe('Data!A1+1');
  expect(wb.getCell(id, 0, 2).f).toBe("'My Sheet'!A1");
  expect(wb.externalFormulas).toBeUndefined();
});
