import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

function source() {
  const wb = new Workbook({ sheets: [
    { name: 'One', cells: { '0,0': { v: 'Value' }, '1,0': { v: 10 }, '2,0': { v: 20 } },
      tables: [{ id: 'sales', name: 'Sales', range: { r1: 0, c1: 0, r2: 2, c2: 0 } }] },
    { name: 'Two' },
  ], names: [{ name: 'Sales', ref: '100', sheet: 'Two' },
    { name: 'Total', ref: 'SUM(Sales)', sheet: 'One' }, { name: 'Total', ref: 'SUM(Sales)', sheet: 'Two' }] });
  for (const [i,s] of wb.sheets.entries()) {
    wb.setInput(s.id,0,3,'=SUM(Sales)'); wb.setInput(s.id,1,3,'=SUM(Sales[Value])');
    wb.setInput(s.id,2,3,'=Total'); wb.setInput(s.id,3,3,'=Two!Sales'); wb.setInput(s.id,0,5,'Total');
    wb.addTable(s.id,{r1:0,c1:5,r2:2,c2:5},{name:`Summary${i+1}`});
    wb.setInput(s.id,1,5,'=SUM(Sales)');
  }
  return wb;
}
function destination(collision) {
  if (!collision) return new Workbook();
  const wb = new Workbook({sheets:[{name:'One'},{name:'Two'}]}), id=wb.sheets[0].id;
  wb.setInput(id,0,0,'Value'); wb.setInput(id,1,0,'7');
  wb.addTable(id,{r1:0,c1:0,r2:1,c2:0},{name:'Sales'}); wb.setInput(id,0,3,'=SUM(Sales)');
  return wb;
}
it.each([false,true])('keeps imported bindings when destination table/tab names collide=%s', (collision) => {
  const src=source(), before=src.toJSON(), wb=destination(collision), original=wb.sheets[0].id;
  const [one,two]=wb.importSheets(src);
  expect(wb.getCell(one.id,0,3).f).toBe('SUM(Sales2)');
  expect(wb.getValue(one.id,0,3)).toBe(30); expect(wb.getValue(two.id,0,3)).toBe(100);
  expect(wb.namedEntry('Total',one.name).ref).toBe('SUM(Sales2)');
  expect(wb.namedEntry('Total',two.name).ref).toBe('SUM(Sales)');
  expect(wb.getValue(one.id,2,3)).toBe(30); expect(wb.getValue(two.id,2,3)).toBe(100);
  expect(wb.namedEntry('Sales',two.name).ref).toBe('100');
  expect(wb.getValue(one.id,3,3)).toBe(100); expect(wb.getValue(two.id,3,3)).toBe(100);
  if(collision) expect(wb.getValue(original,0,3)).toBe(7);
  expect(src.toJSON()).toEqual(before);
});
it('keeps imported calculated templates bound to their source scope as rows are added', () => {
  const wb=destination(true), [one,two]=wb.importSheets(source());
  wb.setInput(one.id,1,0,'40');
  for(const [i,s] of [one,two].entries()) {
    const t=s.tables.find(t=>t.range.c1===5);
    expect(t.calc[0]).toBe(i?'SUM(Sales)':'SUM(Sales2)');
    const row=wb.addTableRow(s.id,t.id);
    expect(wb.getValue(s.id,row,5)).toBe(i?100:60);
  }
});
it('duplicates table references without capturing names on unrelated sheets', () => {
  const wb=source(), original=wb.sheets[0].id, copy=wb.duplicateSheet(original);
  wb.setInput(copy.id,1,0,'40');
  expect(wb.getValue(copy.id,0,3)).toBe(60);
  expect(wb.getValue(copy.id,2,3)).toBe(60);
  expect(copy.tables.find(t=>t.range.c1===5).calc[0]).toBe('SUM(Sales2)');
  expect(wb.getValue(original,0,3)).toBe(30);
});
it('preserves an actual local shadow on a duplicated sheet', () => {
  const src=source(), json=src.toJSON(); json.names.push({name:'Sales',ref:'80',sheet:'One'});
  const wb=new Workbook(json), copy=wb.duplicateSheet(wb.sheets[0].id);
  wb.setInput(copy.id,1,0,'40');
  expect(wb.getValue(copy.id,0,3)).toBe(80);
  expect(wb.getValue(copy.id,1,3)).toBe(60);
});
it('uses the replaced source sheet scope when making imported table names unique', () => {
  const wb=destination(true), target=wb.sheets[1], src=source();
  wb.replaceSheetWith(target.id,src,src.sheets[0].id);
  expect(wb.getCell(target.id,0,3).f).toBe('SUM(Sales2)');
  expect(wb.getValue(target.id,0,3)).toBe(30);
  expect(wb.getValue(wb.sheets[0].id,0,3)).toBe(7);
});
it('restores imports and copied scoped names with undo/redo', () => {
  const wb=destination(true), before=new Workbook(wb.toJSON()).toJSON(), [one,two]=wb.importSheets(source());
  wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo();
  expect(wb.getValue(one.id,0,3)).toBe(30); expect(wb.getValue(two.id,0,3)).toBe(100);
});
it.each([['xlsx',workbookToXlsx],['ods',workbookToOds]])('preserves imported scoped calculations through %s reopening', async(ext,write)=>{
  let wb=destination(true); const [one,two]=wb.importSheets(source());
  wb=await workbookFromFile(await write(wb),`imported.${ext}`);
  expect(wb.getValue(wb.sheetByName(one.name).id,0,3)).toBe(30);
  expect(wb.getValue(wb.sheetByName(two.name).id,0,3)).toBe(100);
  expect(wb.getValue(wb.sheetByName(one.name).id,2,3)).toBe(30);
  expect(wb.getValue(wb.sheetByName(two.name).id,2,3)).toBe(100);
});

it('retains a local name on a new sheet even when an existing table shares its spelling', () => {
  const src=new Workbook({sheets:[{name:'Source',cells:{'0,3':{f:'SUM(Sales)'}}}],
    names:[{name:'Sales',ref:'100',sheet:'Source'}]});
  const wb=destination(true), original=wb.sheets[0].id, [added]=wb.importSheets(src);
  expect(wb.namedEntry('Sales',added.name).ref).toBe('100');
  expect(wb.getValue(added.id,0,3)).toBe(100);
  expect(wb.getValue(original,0,3)).toBe(7);
});
