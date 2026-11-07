import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToOds, workbookToXlsx } from '../src/core/io.js';

function xlsxWithCells(sheetData) {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([['x']]), 'Data');
  const zip = X.CFB.read(new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const sheet = X.CFB.find(zip, '/xl/worksheets/sheet1.xml');
  sheet.content = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`);
  sheet.size = sheet.content.length;
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

const NUM = { error: '#NUM!' };

// A number cell whose value is not a number (<v>abc</v>) or is past the double's range
// (<v>1e999</v>) came in as NaN or Infinity, values no cell can hold: the sheet showed
// #NUM! but SUM over them gave NaN, and the .ods writer, having no way to store them,
// wrote the formulas =#NUM! and =1/0 in their place.
it('reads a non-finite number from an .xlsx as a #NUM! error cell', async () => {
  const wb = await workbookFromFile(xlsxWithCells('<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>abc</v></c></row><row r="2"><c r="B2"><v>1e999</v></c><c r="C2"><v>-1e999</v></c><c r="D2"><v>2.5</v></c></row>'), 'bad.xlsx');
  const id = wb.activeSheetId;
  expect(wb.getCell(id, 0, 1)).toMatchObject({ v: NUM, f: null });
  expect(wb.getCell(id, 1, 1)).toMatchObject({ v: NUM, f: null });
  expect(wb.getCell(id, 1, 2)).toMatchObject({ v: NUM, f: null });
  expect(wb.getValue(id, 0, 1)).toEqual(NUM);
  expect(wb.getDisplay(id, 1, 1)).toBe('#NUM!');
  expect(wb.getCell(id, 0, 0)).toMatchObject({ v: 1, f: null });
  expect(wb.getCell(id, 1, 3)).toMatchObject({ v: 2.5, f: null });
  wb.setInput(id, 2, 0, '=SUM(A1:D2)');
  expect(wb.getValue(id, 2, 0)).toEqual(NUM);
  wb.setInput(id, 2, 1, '=ISERROR(B1)');
  expect(wb.getValue(id, 2, 1)).toBe(true);
});

it('keeps such cells as error cells through .ods and .xlsx round trips, not as formulas', async () => {
  const wb = await workbookFromFile(xlsxWithCells('<row r="1"><c r="A1"><v>abc</v></c><c r="B1"><v>1e999</v></c><c r="C1"><v>7</v></c></row>'), 'bad.xlsx');
  for (const [save, name] of [[workbookToOds, 'bad.ods'], [workbookToXlsx, 'bad.xlsx']]) {
    const back = await workbookFromFile(await save(wb), name);
    const id = back.activeSheetId;
    expect(back.getCell(id, 0, 0)).toMatchObject({ v: NUM, f: null });
    expect(back.getCell(id, 0, 1)).toMatchObject({ v: NUM, f: null });
    expect(back.getCell(id, 0, 2)).toMatchObject({ v: 7, f: null });
  }
});

it('reads a non-numeric office:value of a float cell in an .ods as #NUM!', async () => {
  const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet"';
  const fods = `<?xml version="1.0"?><office:document ${NS}><office:body><office:spreadsheet><table:table table:name="Data"><table:table-row><table:table-cell office:value-type="float" office:value="abc"><text:p>abc</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="1e999"><text:p>inf</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="3"><text:p>3</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document>`;
  const wb = await workbookFromFile(new TextEncoder().encode(fods), 'bad.fods');
  const id = wb.activeSheetId;
  expect(wb.getCell(id, 0, 0)).toMatchObject({ v: NUM, f: null });
  expect(wb.getCell(id, 0, 1)).toMatchObject({ v: NUM, f: null });
  expect(wb.getCell(id, 0, 2)).toMatchObject({ v: 3, f: null });
});
