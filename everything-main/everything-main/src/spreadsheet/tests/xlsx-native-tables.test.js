import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const TABLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/table';
const enc = (text) => new TextEncoder().encode(text);

function setPart(zip, path, text) {
  const i = zip.FullPaths.findIndex((p) => p.replace(/^Root Entry\//, '') === path);
  if (i >= 0) { zip.FileIndex[i].content = enc(text); zip.FileIndex[i].size = zip.FileIndex[i].content.length; }
  else XLSX.CFB.utils.cfb_add(zip, path, enc(text), { unsafe: true });
}
function editPart(zip, name, edit) {
  const entry = zip.FileIndex.find((e) => e.name === name);
  entry.content = enc(edit(new TextDecoder().decode(entry.content)));
  entry.size = entry.content.length;
}
const bytesOf = (zip) => XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });

const tableXml = ({ header = true, ref = 'A1:D4' } = {}) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Sales" displayName="Sales" ref="${ref}"${header ? '' : ' headerRowCount="0"'} totalsRowCount="1">`
  + '<autoFilter ref="A1:D3"/><tableColumns count="4"><tableColumn id="1" name="Item" totalsRowLabel="Total"/><tableColumn id="2" name="Qty"/><tableColumn id="3" name="Price"/>'
  + '<tableColumn id="4" name="Amount" totalsRowFunction="sum"><calculatedColumnFormula>Sales[[#This Row],[Qty]]*Sales[[#This Row],[Price]]</calculatedColumnFormula></tableColumn>'
  + '</tableColumns><tableStyleInfo name="TableStyleMedium7" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>';
const relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + `<Relationship Id="rId1" Type="${TABLE_REL}" Target="../tables/table1.xml"/></Relationships>`;

/** Attach an Excel table part named Sales to the first sheet of an .xlsx zip. */
function addNativeTable(zip, options) {
  setPart(zip, 'xl/tables/table1.xml', tableXml(options));
  setPart(zip, 'xl/worksheets/_rels/sheet1.xml.rels', relsXml);
  editPart(zip, 'sheet1.xml', (xml) => xml.replace(/<tableParts\b[^>]*>[\s\S]*?<\/tableParts>/g, '').replace('</worksheet>', '<tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>'));
  return zip;
}

function nativeTableFile(options) {
  const book = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['Item', 'Qty', 'Price', 'Amount'], ['Pen', 2, 1.5, 3], ['Ink', 4, 2, 8], ['Total', null, null, 11]]);
  ws.D2 = { t: 'n', v: 3, f: 'Sales[[#This Row],[Qty]]*Sales[[#This Row],[Price]]' };
  ws.D3 = { t: 'n', v: 8, f: 'Sales[[#This Row],[Qty]]*Sales[[#This Row],[Price]]' };
  ws.D4 = { t: 'n', v: 11, f: 'SUBTOTAL(109,Sales[Amount])' };
  ws.F1 = { t: 'n', v: 11, f: 'SUM(Sales[Amount])' };
  ws['!ref'] = 'A1:F4';
  XLSX.utils.book_append_sheet(book, ws, 'Data');
  XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 'n', v: 6, f: 'SUM(Sales[Qty])' } }, 'Other');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  return bytesOf(addNativeTable(zip, options));
}

it('imports an Excel table so structured references resolve', async () => {
  const wb = await workbookFromFile(nativeTableFile(), 'tables.xlsx');
  const data = wb.sheetByName('Data');
  expect(data.tables).toHaveLength(1);
  const table = data.tables[0];
  expect(table).toMatchObject({ name: 'Sales', range: { r1: 0, c1: 0, r2: 3, c2: 3 }, totalsRow: true, style: 'green', banded: true });
  expect(table.calc['3']).toBe('Sales[@Qty]*Sales[@Price]'); // the file's #This Row spelling, shown with @
  expect(wb.getValue(data.id, 0, 5)).toBe(11);
  expect(wb.getValue(data.id, 3, 3)).toBe(11);
  expect(wb.getValue(wb.sheetByName('Other').id, 0, 0)).toBe(6);
  // The header row gets filter buttons over the data rows, as the app's own tables do.
  expect(data.filter).toMatchObject({ range: { r1: 0, c1: 0, r2: 2, c2: 3 } });
  // A new row takes the calculated column.
  const r = wb.addTableRow(data.id, table.id);
  expect(r).toBe(3);
  wb.setInput(data.id, r, 1, '10');
  wb.setInput(data.id, r, 2, '3');
  expect(wb.getValue(data.id, r, 3)).toBe(30);
  expect(wb.getValue(data.id, 4, 3)).toBe(41);
});

it('keeps one table when the sidecar and a native part both describe it', async () => {
  const wb = await workbookFromFile(nativeTableFile(), 'tables.xlsx');
  const saved = await (await workbookToXlsx(wb)).arrayBuffer();
  const back = await workbookFromFile(saved, 'saved.xlsx');
  expect(back.sheetByName('Data').tables).toHaveLength(1);
  expect(back.getValue(back.sheetByName('Other').id, 0, 0)).toBe(6);
  const both = await workbookFromFile(bytesOf(addNativeTable(XLSX.CFB.read(new Uint8Array(saved), { type: 'array' }))), 'both.xlsx');
  expect(both.sheetByName('Data').tables).toHaveLength(1);
  expect(both.getValue(both.sheetByName('Data').id, 0, 5)).toBe(11);
});

it('opens a table whose Header Row is off, naming its columns from the table part', async () => {
  const wb = await workbookFromFile(nativeTableFile({ header: false }), 'headerless.xlsx');
  const data = wb.sheetByName('Data');
  expect(data.tables).toHaveLength(1);
  expect(data.tables[0]).toMatchObject({ headerRow: false, range: { r1: 0, r2: 3 } });
  expect(wb.tableColumns(data.id, data.tables[0])).toEqual(['Item', 'Qty', 'Price', 'Amount']);
  // Without a header row there is no AutoFilter, and every row is data or totals.
  expect(data.filter).toBeNull();
  expect(wb.getValue(wb.sheetByName('Other').id, 0, 0)).toBe(6);
});
