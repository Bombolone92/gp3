import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds, META_SHEET } from '../src/core/io.js';

const cases = [
  ['LAMBDA(x,x*2)', '_xlfn.LAMBDA(_xlpm.x,_xlpm.x*2)', 'Result(21)', 42],
  ['LET(x,7,x*2)', '_xlfn.LET(_xlpm.x,7,_xlpm.x*2)', 'Result', 14],
  ['SORT(Sheet1!A1:A2)', '_xlfn._xlws.SORT(Sheet1!A1:A2)', 'SUM(Result)', 30],
  ['FILTER(Sheet1!A1:A2,Sheet1!A1:A2>10)', '_xlfn._xlws.FILTER(Sheet1!A1:A2,Sheet1!A1:A2>10)', 'SUM(Result)', 20],
  ['SUM(SEQUENCE(3))', 'SUM(_xlfn.SEQUENCE(3))', 'Result', 6],
  ['Sheet1!D1#', '_xlfn.ANCHORARRAY(Sheet1!D1)', 'SUM(Result)', 6],
  ['IFNA(#N/A,"_xlfn.literal ANCHORARRAY(A1)")', '_xlfn.IFNA(#N/A,"_xlfn.literal ANCHORARRAY(A1)")', 'Result', '_xlfn.literal ANCHORARRAY(A1)'],
  ['"_xlpm.x"', '"_xlpm.x"', 'Result', '_xlpm.x'],
  ['SUM(Sheet1!A1:A2)', 'SUM(Sheet1!A1:A2)', 'Result', 30],
];
it.each(cases)('writes native XLSX syntax for the named formula %s', async (ref, fileRef, formula, expected) => {
  let wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '10'); wb.setInput(id, 1, 0, '20'); wb.setInput(id, 0, 3, '=SEQUENCE(3)');
  wb.defineName('Result', ref); wb.setInput(id, 0, 2, `=${formula}`);
  expect(wb.getValue(id, 0, 2)).toBe(expected);
  for (let i = 0; i < 2; i++) {
    const bytes = await workbookToXlsx(wb);
    const raw = X.read(await bytes.arrayBuffer(), { type: 'array', xlfn: true });
    expect(raw.Workbook.Names.find((n) => n.Name === 'Result').Ref).toBe(fileRef);
    const metadata = raw.Sheets[META_SHEET] && JSON.parse(raw.Sheets[META_SHEET].A1.v);
    expect(metadata?.structuredNames).toBeUndefined();
    wb = await workbookFromFile(bytes, 'encoded.xlsx'); id = wb.sheets[0].id;
    expect(wb.names[0].ref).toBe(ref);
    expect(wb.getValue(id, 0, 2)).toBe(expected);
  }
});

it('does not duplicate native named formulas in the metadata for app defaults', async () => {
  const wb = new Workbook(); wb.defineName('Double', 'LAMBDA(x,x*2)');
  const raw = X.read(await (await workbookToXlsx(wb)).arrayBuffer(), { type: 'array', xlfn: true });
  expect(raw.SheetNames).toEqual(['Sheet1', META_SHEET]);
  expect(JSON.parse(raw.Sheets[META_SHEET].A1.v).structuredNames).toBeUndefined();
  expect(raw.Workbook.Names[0].Ref).toBe('_xlfn.LAMBDA(_xlpm.x,_xlpm.x*2)');
});

it('keeps ODS named functions in OpenFormula syntax', async () => {
  const wb = new Workbook(); wb.defineName('Double', 'LAMBDA(x,x*2)');
  const raw = X.read(await (await workbookToOds(wb)).arrayBuffer(), { type: 'array', xlfn: true });
  expect(raw.Workbook.Names[0].Ref).toBe('LAMBDA(x,x*2)');
});

it('keeps native table references in encoded named formulas', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Value'); wb.setInput(id, 1, 0, '10'); wb.setInput(id, 2, 0, '20');
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 0 }, { name: 'Sales' });
  wb.defineName('Total', 'LET(x,SUM(Sales[Value]),x)'); wb.setInput(id, 0, 2, '=Total');
  const bytes = await workbookToXlsx(wb), raw = X.read(await bytes.arrayBuffer(), { type: 'array', xlfn: true });
  const fileRef = '_xlfn.LET(_xlpm.x,SUM(Sales[Value]),_xlpm.x)';
  expect(raw.Workbook.Names[0].Ref).toBe(fileRef);
  expect(JSON.parse(raw.Sheets[META_SHEET].A1.v).structuredNames).toBeUndefined();
  const copy = await workbookFromFile(bytes, 'table.xlsx'), target = copy.sheets[0];
  expect(copy.names[0].ref).toBe('LET(x,SUM(Sales[Value]),x)');
  copy.addTableRow(target.id, target.tables[0].id); copy.setInput(target.id, 3, 0, '40');
  expect(copy.getValue(target.id, 0, 2)).toBe(70);
  expect(wb.tableById(id, tid).range.r2).toBe(2);
});
