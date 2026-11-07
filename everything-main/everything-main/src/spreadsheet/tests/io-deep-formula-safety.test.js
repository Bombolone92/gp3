import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

function editPart(zip, name, edit) {
  const entry = zip.FileIndex.find((e) => e.name === name);
  entry.content = new TextEncoder().encode(edit(new TextDecoder().decode(entry.content)));
  entry.size = entry.content.length;
}
const nested = (depth) => '('.repeat(depth) + '1' + ')'.repeat(depth);

function fileWithFormula(formula) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['SENTINEL', 17]]), 'Data');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  editPart(zip, 'sheet1.xml', (xml) => xml.replace(/<sheetData>.*<\/sheetData>/,
    `<sheetData><row r="1"><c r="A1"><f>${formula}</f><v>1</v></c><c r="B1"><v>5</v></c></row></sheetData>`));
  return XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

it('imports a formula longer than Excel allows as text, so the book stays saveable', async () => {
  const formula = nested(50000);
  const wb = await workbookFromFile(fileWithFormula(formula), 'deep.xlsx');
  const id = wb.sheets[0].id;
  const cell = wb.getCell(id, 0, 0);
  expect(cell.f).toBeNull();
  expect(cell.v).toBe(`=${formula.slice(0, 32766)}`);
  expect(cell.s?.fmt).toBe('text');
  expect(wb.getValue(id, 0, 1)).toBe(5);
  for (const save of [workbookToXlsx, workbookToOds]) {
    const back = await workbookFromFile(await save(wb), save === workbookToXlsx ? 'saved.xlsx' : 'saved.ods');
    expect(back.getCell(back.sheets[0].id, 0, 0).v).toBe(cell.v);
    expect(back.getValue(back.sheets[0].id, 0, 1)).toBe(5);
  }
});

it('imports a formula at the limit as a formula', async () => {
  const ones = Math.floor((8192 - 'SUM(B1)'.length) / 2);
  const formula = `SUM(B1${',1'.repeat(ones)})`;
  expect(formula.length).toBeGreaterThan(8190);
  expect(formula.length).toBeLessThanOrEqual(8192);
  const wb = await workbookFromFile(fileWithFormula(formula), 'long.xlsx');
  const id = wb.sheets[0].id;
  expect(wb.getCell(id, 0, 0).f).toBe(formula);
  expect(wb.getValue(id, 0, 0)).toBe(5 + ones);
});

it('saves a book holding a formula too deep for the parser, writing that formula as typed', async () => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  const formula = nested(3000);
  // Typed, a formula this deep is kept as text; one read from a file is stored as a formula.
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: null, f: formula } }]);
  wb.setInput(id, 0, 1, '=A1+1');
  wb.setInput(id, 1, 0, '=SEQUENCE(2)');
  wb.setInput(id, 3, 0, '9');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#ERROR!' });
  for (const [save, name] of [[workbookToXlsx, 'saved.xlsx'], [workbookToOds, 'saved.ods']]) {
    const back = await workbookFromFile(await save(wb), name);
    const backId = back.sheets[0].id;
    expect(back.getCell(backId, 0, 0).f).toBe(formula);
    expect(back.getCell(backId, 0, 1).f).toBe('A1+1');
    expect(back.getCell(backId, 1, 0).f).toBe('SEQUENCE(2)');
    expect(back.getValue(backId, 3, 0)).toBe(9);
  }
});
