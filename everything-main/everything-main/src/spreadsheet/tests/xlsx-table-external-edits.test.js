import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { xmlText } from '../src/core/xlsx-export-styles.js';

const decode = part => new TextDecoder().decode(part.content);
const address = (r, c) => X.utils.encode_cell({ r, c });
const reference = range => X.utils.encode_range({ s: { r: range.r1, c: range.c1 }, e: { r: range.r2, c: range.c2 } });
function edit(zip, path, fn) {
  const part = X.CFB.find(zip, path);
  part.content = new TextEncoder().encode(fn(decode(part))); part.size = part.content.length;
}
const read = zip => workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'edited.xlsx');
async function setup(r = 0, c = 0) {
  const wb = new Workbook(), id = wb.activeSheetId;
  [['Quantity', 'Price', 'Amount'], [2, 5], [3, 7]].forEach((row, rr) => row.forEach((v, cc) => wb.setInput(id, r + rr, c + cc, String(v))));
  const tid = wb.addTable(id, { r1: r, c1: c, r2: r + 2, c2: c + 2 }, { name: 'Items', style: 'purple' });
  wb.setInput(id, r + 1, c + 2, '=Items[@Quantity]*Items[@Price]');
  wb.setInput(id, 0, c + 5, '=SUM(Items[Amount])');
  wb.activeSheet.filter.showButtons = false;
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' });
  return { wb, zip, tid, r, c };
}
function meta(zip, fn) {
  const bytes = X.CFB.write(zip, { type: 'array', fileType: 'zip' });
  const book = X.read(bytes, { type: 'array' });
  const value = JSON.parse(book.Sheets._puter_meta.A1.v);
  fn(value.sheets.Sheet1);
  edit(zip, '/xl/worksheets/sheet2.xml', xml => xml.replace(/<sheetData>[\s\S]*?<\/sheetData>/,
    `<sheetData><row r="1"><c r="A1" t="str"><v>${xmlText(JSON.stringify(value))}</v></c></row></sheetData>`));
}
function formula(zip, r, c, f) {
  const ref = address(r, c);
  edit(zip, '/xl/worksheets/sheet1.xml', xml => xml.replace(new RegExp(`<c\\b[^>]*r="${ref}"[^>]*>[\\s\\S]*?</c>`),
    `<c r="${ref}"><f>${xmlText(f)}</f><v>0</v></c>`));
}

it.each([[0, 0], [7, 4]])('uses expanded native table and filter bounds at row %i, column %i', async (r, c) => {
  const { zip, tid } = await setup(r, c), row = r + 3;
  const range = { r1: r, c1: c, r2: row, c2: c + 2 };
  edit(zip, '/xl/tables/table1.xml', xml => xml.replaceAll(`ref="${reference({ ...range, r2: row - 1 })}"`, `ref="${reference(range)}"`));
  edit(zip, '/xl/worksheets/sheet1.xml', xml => xml.replace(/<dimension[^>]*\/>/, `<dimension ref="A1:${address(row, c + 5)}"/>`)
    .replace('</sheetData>', `<row r="${row + 1}"><c r="${address(row, c)}"><v>11</v></c><c r="${address(row, c + 1)}"><v>4</v></c><c r="${address(row, c + 2)}"><f>Items[@Quantity]*Items[@Price]</f><v>44</v></c></row></sheetData>`));
  let back = await read(zip), sheet = back.activeSheet;
  expect(sheet.tables[0]).toMatchObject({ id: tid, range, style: 'purple' });
  expect(sheet.filter).toMatchObject({ range, showButtons: false });
  expect(back.getValue(sheet.id, row, c + 2)).toBe(44);
  expect(back.getValue(sheet.id, 0, c + 5)).toBe(75);
  back = await workbookFromFile(await workbookToXlsx(back), 'again.xlsx'); sheet = back.activeSheet;
  const next = back.addTableRow(sheet.id, sheet.tables[0].id);
  back.setInput(sheet.id, next, c, '4'); back.setInput(sheet.id, next, c + 1, '6');
  expect(back.getValue(sheet.id, next, c + 2)).toBe(24);
  expect(back.getValue(sheet.id, 0, c + 5)).toBe(99);
});

it('keeps native formula exceptions instead of resurrecting the private expression', async () => {
  const { zip } = await setup();
  // Simulate the formula backup made by older exporters.
  meta(zip, own => { own.structured = { '1,2': 'Items[@Quantity]*Items[@Price]', '0,5': 'SUM(Items[Amount])' }; });
  formula(zip, 1, 2, 'Items[@Quantity]+Items[@Price]');
  formula(zip, 0, 5, 'SUM(Items[Amount])+100');
  const back = await read(zip), id = back.activeSheetId;
  expect(back.getValue(id, 1, 2)).toBe(7);
  expect(back.getValue(id, 0, 5)).toBe(128);
  expect(back.getCell(id, 0, 5).f).toBe('SUM(Items[Amount])+100');
});

it('restores legacy A1 backups only while their native formula is unchanged', async () => {
  const { zip } = await setup();
  meta(zip, own => { delete own.nativeTables; own.structured = { '1,2': 'Items[@Quantity]*Items[@Price]', '0,5': 'SUM(Items[Amount])' }; });
  formula(zip, 1, 2, '$A$2*$B$2'); formula(zip, 0, 5, 'SUM($C$2:$C$3)+100');
  const back = await read(zip), id = back.activeSheetId;
  expect(back.getCell(id, 1, 2).f).toBe('Items[@Quantity]*Items[@Price]');
  expect(back.getCell(id, 0, 5).f).toBe('SUM($C$2:$C$3)+100');
  expect(back.canUndo()).toBe(false);
});

it('reads changed and removed native calculated-column templates', async () => {
  const { zip } = await setup();
  const f = 'Items[@Quantity]+Items[@Price]';
  edit(zip, '/xl/tables/table1.xml', xml => xml.replace(/<calculatedColumnFormula>.*?<\/calculatedColumnFormula>/, `<calculatedColumnFormula>${f}</calculatedColumnFormula>`));
  formula(zip, 1, 2, f); formula(zip, 2, 2, f);
  const back = await read(zip), sheet = back.activeSheet;
  expect(sheet.tables[0].calc[2]).toBe(f);
  const row = back.addTableRow(sheet.id, sheet.tables[0].id);
  back.setInput(sheet.id, row, 0, '11'); back.setInput(sheet.id, row, 1, '4');
  expect(back.getValue(sheet.id, row, 2)).toBe(15);
  edit(zip, '/xl/tables/table1.xml', xml => xml.replace(/<calculatedColumnFormula>.*?<\/calculatedColumnFormula>/, ''));
  expect((await read(zip)).activeSheet.tables[0].calc).toEqual({});
});

it('does not resurrect a removed table or filter from new private metadata', async () => {
  const { zip } = await setup();
  edit(zip, '/xl/worksheets/sheet1.xml', xml => xml.replace(/<tableParts\b[\s\S]*?<\/tableParts>/, ''));
  edit(zip, '/xl/worksheets/_rels/sheet1.xml.rels', xml => xml.replace(/<Relationship\b[^>]*Type="[^"]*\/table"[^>]*\/>/g, ''));
  const back = await read(zip);
  expect(back.activeSheet.tables).toEqual([]);
  expect(back.activeSheet.filter).toBeNull();
});

it('reads renamed tables, native themes and changed banding', async () => {
  const { zip } = await setup();
  edit(zip, '/xl/tables/table1.xml', xml => xml.replaceAll('Items', 'Renamed').replace(/name="PuterTableStyle\d+"/, 'name="TableStyleMedium7"').replace('showRowStripes="1"', 'showRowStripes="0"'));
  edit(zip, '/xl/worksheets/sheet1.xml', xml => xml.replaceAll('Items', 'Renamed'));
  const back = await read(zip), sheet = back.activeSheet;
  expect(sheet.tables[0]).toMatchObject({ name: 'Renamed', style: 'green', banded: false });
  expect(back.getValue(sheet.id, 0, 5)).toBe(31);
});

it('takes changed filter criteria and button visibility from the table part', async () => {
  const { zip } = await setup();
  edit(zip, '/xl/tables/table1.xml', xml => xml.replace(/<autoFilter\b[^>]*>[\s\S]*?<\/autoFilter>/,
    '<autoFilter ref="A1:C3"><filterColumn colId="0"><customFilters><customFilter operator="greaterThan" val="2"/></customFilters></filterColumn></autoFilter>'));
  const back = await read(zip), sheet = back.activeSheet;
  expect(sheet.filter.criteria).toEqual({ 0: { op: 'gt', value: 2 } });
  expect(sheet.filter.showButtons).not.toBe(false);
  back.reapplyFilter(sheet.id);
  expect([...sheet.filterHidden]).toEqual([1]);
});

it('ignores malformed private table ranges without discarding valid native data', async () => {
  const { zip } = await setup();
  meta(zip, own => { own.tables[0].range = null; });
  const back = await read(zip);
  expect(back.getValue(back.activeSheetId, 0, 5)).toBe(31);
  expect(back.activeSheet.tables[0].range).toEqual({ r1: 0, c1: 0, r2: 2, c2: 2 });
});

it('uses native contractions without retaining excluded rows in structured aggregates', async () => {
  const { zip } = await setup();
  edit(zip, '/xl/tables/table1.xml', xml => xml.replaceAll('ref="A1:C3"', 'ref="A1:C2"'));
  const back = await read(zip);
  expect(back.activeSheet.tables[0].range.r2).toBe(1);
  expect(back.activeSheet.filter.range.r2).toBe(1);
  expect(back.getValue(back.activeSheetId, 0, 5)).toBe(10);
});

it('accepts native filter changes in older files without an exported comparison record', async () => {
  const { zip } = await setup();
  meta(zip, own => { delete own.nativeFilter; delete own.nativeTables; });
  edit(zip, '/xl/tables/table1.xml', xml => xml.replaceAll(' hiddenButton="1"', ''));
  expect((await read(zip)).activeSheet.filter.showButtons).not.toBe(false);
});

it('keeps private formula origins and theme choices on an unchanged native round trip', async () => {
  const { wb } = await setup();
  const table = wb.activeSheet.tables[0];
  table.calc = { 2: 'A9*B9' }; table.calcRow = 8;
  const back = await workbookFromFile(await workbookToXlsx(wb), 'unchanged.xlsx');
  expect(back.activeSheet.tables[0]).toMatchObject({ id: table.id, style: 'purple', calc: { 2: 'A9*B9' }, calcRow: 8 });
});

it('adopts the native formula origin after moving a table in another editor', async () => {
  const { wb } = await setup();
  wb.activeSheet.tables[0].calc = { 2: 'A9*$Z$1' };
  wb.activeSheet.tables[0].calcRow = 8;
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  edit(zip, '/xl/tables/table1.xml', xml => xml.replaceAll('ref="A1:C3"', 'ref="D5:F7"')
    .replace(/<calculatedColumnFormula>.*?<\/calculatedColumnFormula>/, '<calculatedColumnFormula>D6*$Z$1</calculatedColumnFormula>'));
  edit(zip, '/xl/worksheets/sheet1.xml', xml => xml.replace(/<dimension[^>]*\/>/, '<dimension ref="A1:Z7"/>')
    .replace(/<sheetData>[\s\S]*?<\/sheetData>/, '<sheetData><row r="1"><c r="Z1"><v>6</v></c></row><row r="5"><c r="D5" t="str"><v>Quantity</v></c><c r="E5" t="str"><v>Price</v></c><c r="F5" t="str"><v>Amount</v></c></row><row r="6"><c r="D6"><v>4</v></c><c r="F6"><f>D6*$Z$1</f><v>24</v></c></row></sheetData>'));
  const back = await read(zip), sheet = back.activeSheet, table = sheet.tables[0];
  expect(table.calc[2]).toBe('D6*$Z$1');
  expect(back.getValue(sheet.id, 5, 5)).toBe(24);
  const row = back.addTableRow(sheet.id, table.id);
  back.setInput(sheet.id, row, 3, '7');
  expect(back.getCell(sheet.id, row, 5).f).toBe('D8*$Z$1');
  expect(back.getValue(sheet.id, row, 5)).toBe(42);
});
