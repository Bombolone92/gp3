import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

function setup() {
  const wb = new Workbook({ sheets: [
    { name: 'One', cells: { '0,0': { v: 'Value' }, '1,0': { v: 10 }, '2,0': { v: 20 } },
      tables: [{ id: 'sales-table', name: 'Sales', range: { r1: 0, c1: 0, r2: 2, c2: 0 } }] },
    { name: 'Two' },
  ], names: [
    { name: 'Sales', ref: '100', sheet: 'Two' },
    { name: 'LocalTotal', ref: 'SUM(Sales)', sheet: 'One' },
    { name: 'LocalTotal', ref: 'SUM(Sales)', sheet: 'Two' },
    { name: 'LocalFn', ref: 'LAMBDA(SUM(Sales))', sheet: 'One' },
    { name: 'GlobalExplicit', ref: 'SUM(Sales[Value])' },
  ] });
  for (const s of wb.sheets) {
    wb.setInput(s.id, 0, 3, '=SUM(Sales)');
    wb.setInput(s.id, 1, 3, '=SUM(Sales[Value])');
    wb.setInput(s.id, 2, 3, '=LocalTotal');
    wb.setInput(s.id, 3, 3, '=One!LocalFn()');
    wb.setInput(s.id, 4, 3, '=GlobalExplicit');
  }
  return wb;
}
const rename = (wb) => wb.updateTable(wb.sheets[0].id, 'sales-table', { name: 'Orders' });

it('rewrites table-bound cells while preserving a name local to another sheet', () => {
  const wb = setup(), [one, two] = wb.sheets;
  expect([one,two].map((s) => wb.getValue(s.id,0,3))).toEqual([30,100]);
  expect(rename(wb)).toBe(true);
  expect(wb.getCell(one.id,0,3).f).toBe('SUM(Orders)');
  expect(wb.getCell(two.id,0,3).f).toBe('SUM(Sales)');
  expect([one,two].map((s) => wb.getValue(s.id,0,3))).toEqual([30,100]);
  for (const s of wb.sheets) expect(wb.getCell(s.id,1,3).f).toBe('SUM(Orders[Value])');
});
it('rewrites each local named expression and lambda in its definition scope', () => {
  const wb = setup(); rename(wb);
  expect(wb.namedEntry('LocalTotal','One').ref).toBe('SUM(Orders)');
  expect(wb.namedEntry('LocalTotal','Two').ref).toBe('SUM(Sales)');
  expect(wb.namedEntry('LocalFn','One').ref).toBe('LAMBDA(SUM(Orders))');
  for (const [i,s] of wb.sheets.entries()) {
    expect(wb.getValue(s.id,2,3)).toBe(i ? 100 : 30);
    expect(wb.getValue(s.id,3,3)).toBe(30);
    expect(wb.getValue(s.id,4,3)).toBe(30);
  }
});
it('preserves lexical bindings while updating explicit table selectors', () => {
  const wb = setup(), id = wb.sheets[0].id;
  wb.setInput(id,5,3,'=LET(Sales,7,SUM(Sales))+SUM(Sales[Value])+SUM(Sales)');
  rename(wb);
  expect(wb.getCell(id,5,3).f).toBe('LET(Sales,7,SUM(Sales))+SUM(Orders[Value])+SUM(Orders)');
  expect(wb.getValue(id,5,3)).toBe(67);
});
it('updates protected calculated-column templates according to their sheet scope', () => {
  const wb = setup(), summaries = [];
  for (const [i,s] of wb.sheets.entries()) {
    wb.setInput(s.id,0,5,'Total');
    const tid = wb.addTable(s.id,{r1:0,c1:5,r2:2,c2:5},{name:`Summary${i+1}`});
    wb.setInput(s.id,1,5,'=SUM(Sales)'); summaries.push(tid);
  }
  wb.setSheetProtected(wb.sheets[1].id,true);
  rename(wb);
  for (const [i,s] of wb.sheets.entries()) {
    expect(wb.tableById(s.id,summaries[i]).calc[0]).toBe(i ? 'SUM(Sales)' : 'SUM(Orders)');
    wb.setSheetProtected(s.id,false); const row = wb.addTableRow(s.id,summaries[i]);
    expect(wb.getValue(s.id,row,5)).toBe(i ? 100 : 30);
  }
});
it('restores scoped formulas together with the table name through undo and redo', () => {
  const wb = setup(), before = wb.toJSON(); rename(wb); wb.undo();
  expect(wb.toJSON()).toEqual(before);
  wb.redo(); expect(wb.getValue(wb.sheets[0].id,0,3)).toBe(30);
  expect(wb.getValue(wb.sheets[1].id,0,3)).toBe(100);
});
it.each([['xlsx',workbookToXlsx],['ods',workbookToOds]])('keeps scoped calculations live after %s reopening', async (ext, write) => {
  let wb = setup(); rename(wb); wb = await workbookFromFile(await write(wb), `renamed.${ext}`);
  expect(wb.getValue(wb.sheets[0].id,0,3)).toBe(30);
  expect(wb.getValue(wb.sheets[1].id,0,3)).toBe(100);
  expect(wb.getValue(wb.sheets[0].id,2,3)).toBe(30);
  expect(wb.getValue(wb.sheets[1].id,2,3)).toBe(100);
});
