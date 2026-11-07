import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { toFileFormula, fromFileFormula } from '../src/core/xlfn.js';

function editPart(zip, name, edit) {
  const entry = zip.FileIndex.find((e) => e.name === name);
  entry.content = new TextEncoder().encode(edit(new TextDecoder().decode(entry.content)));
  entry.size = entry.content.length;
}
function sheetXml(bytes) {
  const zip = XLSX.CFB.read(new Uint8Array(bytes), { type: 'array' });
  return new TextDecoder().decode(XLSX.CFB.find(zip, 'sheet1.xml').content);
}

it('evaluates SINGLE as implicit intersection', () => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  [[1, 10, 100], [2, 20, 200], [3, 30, 300]].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  wb.setInput(id, 1, 4, '=SINGLE(A1:A3)');
  expect(wb.getValue(id, 1, 4)).toBe(2);
  wb.setInput(id, 4, 1, '=SINGLE(A1:C1)');
  expect(wb.getValue(id, 4, 1)).toBe(10);
  wb.setInput(id, 4, 5, '=SINGLE(A1:C1)');
  expect(wb.getValue(id, 4, 5)).toEqual({ error: '#VALUE!' });
  wb.setInput(id, 5, 0, '=SINGLE(A1:B2)');
  expect(wb.getValue(id, 5, 0)).toEqual({ error: '#VALUE!' });
  wb.setInput(id, 5, 1, '=SINGLE(7)');
  expect(wb.getValue(id, 5, 1)).toBe(7);
  wb.setInput(id, 5, 2, '=SINGLE({4,5,6})');
  expect(wb.getValue(id, 5, 2)).toBe(4);
  wb.setInput(id, 2, 5, '=SINGLE(INDEX(A1:C3,0,2))*2');
  expect(wb.getValue(id, 2, 5)).toBe(60);
  // The same answers as the @ operator it spells.
  wb.setInput(id, 1, 6, '=@A1:A3');
  expect(wb.getValue(id, 1, 6)).toBe(wb.getValue(id, 1, 4));
});

it('reads _xlfn.SINGLE from a file as the @ operator and writes @ back as _xlfn.SINGLE', async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[1], [2], [3]]), 'Data');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  editPart(zip, 'sheet1.xml', (xml) => xml.replace(/<sheetData>.*<\/sheetData>/, '<sheetData>'
    + '<row r="1"><c r="A1"><v>1</v></c><c r="B1"><f>_xlfn.SINGLE(A1:A3)*10</f><v>10</v></c><c r="C1"><f>_xlfn.SINGLE(INDEX(A1:A3,0,1))</f><v>1</v></c></row>'
    + '<row r="2"><c r="A2"><v>2</v></c><c r="B2"><f>_xlfn.SINGLE(A1:A3)*10</f><v>20</v></c></row>'
    + '<row r="3"><c r="A3"><v>3</v></c></row></sheetData>'));
  let wb = await workbookFromFile(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'single.xlsx');
  for (let round = 0; round < 2; round++) {
    const id = wb.sheetByName('Data').id;
    expect(wb.getCell(id, 0, 1).f).toBe('@A1:A3*10');
    expect(wb.getValue(id, 0, 1)).toBe(10);
    expect(wb.getValue(id, 1, 1)).toBe(20);
    expect(wb.getCell(id, 0, 2).f).toBe('SINGLE(INDEX(A1:A3,0,1))');
    expect(wb.getValue(id, 0, 2)).toBe(1);
    const bytes = await (await workbookToXlsx(wb)).arrayBuffer();
    const xml = sheetXml(bytes);
    expect(xml).toContain('<f>_xlfn.SINGLE(A1:A3)*10</f>');
    expect(xml).toContain('<f>_xlfn.SINGLE(INDEX(A1:A3,0,1))</f>');
    expect(xml).not.toMatch(/<f>[^<]*@/);
    wb = await workbookFromFile(bytes, 'saved.xlsx');
  }
});

it.each([
  ['@A1:A3', '_xlfn.SINGLE(A1:A3)'],
  ['@A1:A3*10+@Sheet2!B:B', '_xlfn.SINGLE(A1:A3)*10+_xlfn.SINGLE(Sheet2!B:B)'],
  ['@(A1:A3+1)', '_xlfn.SINGLE(A1:A3+1)'],
  ['@INDEX(A1:C3,0,2)', '_xlfn.SINGLE(INDEX(A1:C3,0,2))'],
  ['@Prices', '_xlfn.SINGLE(Prices)'],
  ['SINGLE(A1:A3)', '_xlfn.SINGLE(A1:A3)'],
  ['SUM(Sales[@Q1])', 'SUM(Sales[[#This Row],[Q1]])'],
  ['"a@b"&A1', '"a@b"&A1'],
])('writes %s to a file as %s', (ours, file) => {
  expect(toFileFormula(ours)).toBe(file);
});

it.each([
  ['_xlfn.SINGLE(A1:A3)', '@A1:A3'],
  ['_xlfn.SINGLE(A1:A3)*2', '@A1:A3*2'],
  ['_xlfn.SINGLE(Prices)', '@Prices'],
  ['_xlfn.SINGLE(A1:A3+1)', 'SINGLE(A1:A3+1)'],
  ['_xlfn.SINGLE(INDEX(A1:A3,0,1))', 'SINGLE(INDEX(A1:A3,0,1))'],
  ['SINGLE(A1:A3)', 'SINGLE(A1:A3)'],
])('reads %s from a file as %s', (file, ours) => {
  expect(fromFileFormula(file)).toBe(ours);
});
