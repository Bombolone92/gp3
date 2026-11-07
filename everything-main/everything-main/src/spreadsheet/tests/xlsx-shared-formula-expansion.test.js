import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function editPart(zip, name, edit) {
  const entry = zip.FileIndex.find((e) => e.name === name);
  entry.content = new TextEncoder().encode(edit(new TextDecoder().decode(entry.content)));
  entry.size = entry.content.length;
}

/** An .xlsx whose Data sheet holds the given sheetData XML, beside sheets and names the formulas can reach. */
function fileWithSheetData(sheetData) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[1], [2], [3]]), 'Data');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[10], [20], [30]]), 'Q1 2024');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[100], [200], [300]]), 'Sheet2');
  book.Workbook = { Names: [{ Name: 'TAXRATE', Ref: '7' }, { Name: 'FYNAME', Ref: '5' }] };
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  editPart(zip, 'sheet1.xml', (xml) => xml.replace(/<sheetData>.*<\/sheetData>/, `<sheetData>${sheetData}</sheetData>`));
  return XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

const master = `_xlfn.CONCAT("A1",TAXRATE,FYNAME,'Q1 2024'!A1,$A$1,A1,Sheet2!A1)`;
const filledDown = fileWithSheetData(
  `<row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="shared" ref="B1:B3" si="0">${master.replace(/"/g, '&quot;')}</f><v>0</v></c></row>`
  + '<row r="2"><c r="A2"><v>2</v></c><c r="B2"><f t="shared" si="0"/><v>0</v></c></row>'
  + '<row r="3"><c r="A3"><v>3</v></c><c r="B3"><f t="shared" si="0"/><v>0</v></c></row>');

it('shifts only the relative references of a shared formula filled down', async () => {
  const wb = await workbookFromFile(filledDown, 'shared.xlsx');
  const id = wb.sheetByName('Data').id;
  expect(wb.getCell(id, 0, 1).f).toBe(`CONCAT("A1",TAXRATE,FYNAME,'Q1 2024'!A1,$A$1,A1,Sheet2!A1)`);
  expect(wb.getCell(id, 1, 1).f).toBe(`CONCAT("A1",TAXRATE,FYNAME,'Q1 2024'!A2,$A$1,A2,Sheet2!A2)`);
  expect(wb.getCell(id, 2, 1).f).toBe(`CONCAT("A1",TAXRATE,FYNAME,'Q1 2024'!A3,$A$1,A3,Sheet2!A3)`);
  expect(wb.getValue(id, 0, 1)).toBe('A1751011100');
  expect(wb.getValue(id, 1, 1)).toBe('A1752012200');
  expect(wb.getValue(id, 2, 1)).toBe('A1753013300');
  // The vendor's own reader now answers the same way once the app has loaded it.
  const raw = XLSX.read(filledDown, { type: 'array', xlfn: true });
  expect(raw.Sheets.Data.B3.f).toBe(`_xlfn.CONCAT("A1",TAXRATE,FYNAME,'Q1 2024'!A3,$A$1,A3,Sheet2!A3)`);
  // Saved again, every cell carries its own formula and reads back unchanged.
  const back = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  const backId = back.sheetByName('Data').id;
  expect(back.getCell(backId, 2, 1).f).toBe(`CONCAT("A1",TAXRATE,FYNAME,'Q1 2024'!A3,$A$1,A3,Sheet2!A3)`);
  expect(back.getValue(backId, 2, 1)).toBe('A1753013300');
});

it('shifts columns of a shared formula filled across, keeping absolute columns', async () => {
  const bytes = fileWithSheetData(
    '<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c><c r="C1"><v>3</v></c></row>'
    + '<row r="2"><c r="A2"><f t="shared" ref="A2:C2" si="0">$A1+A1+FYNAME</f><v>0</v></c><c r="B2"><f t="shared" si="0"/><v>0</v></c><c r="C2"><f t="shared" si="0"/><v>0</v></c></row>');
  const wb = await workbookFromFile(bytes, 'across.xlsx');
  const id = wb.sheetByName('Data').id;
  expect(wb.getCell(id, 1, 1).f).toBe('$A1+B1+FYNAME');
  expect(wb.getCell(id, 1, 2).f).toBe('$A1+C1+FYNAME');
  expect(wb.getValue(id, 1, 2)).toBe(9);
});

it('leaves a spill reference and a whole-column span intact while shifting them', async () => {
  const bytes = fileWithSheetData(
    '<row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="shared" ref="B1:B2" si="0">SUM(A:A)+_xlfn.ANCHORARRAY(A1)</f><v>0</v></c></row>'
    + '<row r="2"><c r="A2"><v>2</v></c><c r="B2"><f t="shared" si="0"/><v>0</v></c></row>');
  const wb = await workbookFromFile(bytes, 'spans.xlsx');
  const id = wb.sheetByName('Data').id;
  expect(wb.getCell(id, 0, 1).f).toBe('SUM(A:A)+A1#');
  expect(wb.getCell(id, 1, 1).f).toBe('SUM(A:A)+A2#');
});

it('keeps a table column named like an address in a structured reference', async () => {
  const bytes = fileWithSheetData(
    '<row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="shared" ref="B1:B2" si="0">SUM(Sales[Q1])+Sales[@Q1]+A1</f><v>0</v></c></row>'
    + '<row r="2"><c r="A2"><v>2</v></c><c r="B2"><f t="shared" si="0"/><v>0</v></c></row>');
  const wb = await workbookFromFile(bytes, 'table.xlsx');
  const id = wb.sheetByName('Data').id;
  expect(wb.getCell(id, 1, 1).f).toBe('SUM(Sales[Q1])+Sales[@Q1]+A2');
});

it('falls back to the vendor shift for text the tokenizer refuses', async () => {
  const bytes = fileWithSheetData(
    '<row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="shared" ref="B1:B2" si="0">A1&amp;"abc</f><v>0</v></c></row>'
    + '<row r="2"><c r="A2"><v>2</v></c><c r="B2"><f t="shared" si="0"/><v>0</v></c></row>');
  const wb = await workbookFromFile(bytes, 'broken.xlsx');
  const id = wb.sheetByName('Data').id;
  expect(wb.getCell(id, 1, 1).f).toBe('A2&"abc');
});
