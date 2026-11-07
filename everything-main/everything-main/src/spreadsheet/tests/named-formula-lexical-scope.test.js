import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds, workbookToXlsx } from '../src/core/io.js';

function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.defineName('Tax', '0.2');
  wb.defineName('AddTax', 'LAMBDA(x,x*(1+Tax))');
  wb.defineName('TaxAmount', '10*Tax');
  const value = (formula, r = 0, c = 0) => {
    wb.setInput(id, r, c, `=${formula}`);
    return wb.getValue(id, r, c);
  };
  return { wb, id, value };
}

it.each([
  ['LET(Tax,10,AddTax(10))', 12],
  ['LET(Tax,10,TaxAmount)', 2],
  ['LAMBDA(Tax,AddTax(10))(10)', 12],
  ['LET(Tax,10,fn,AddTax,fn(10))', 12],
  ['LET(Tax,10,AddTax(Tax))', 12],
  ['LET(Tax,10,SUM(MAP({10,20},AddTax)))', 36],
  ['LET(SUM,LAMBDA(x,99),Tax,10,AddTax(10))', 12],
])('evaluates named definitions in workbook scope: %s', (formula, expected) => {
  expect(setup().value(formula)).toBe(expected);
});

it('retains closures explicitly passed to named lambdas and created inside them', () => {
  const { wb, value } = setup();
  wb.defineName('Apply', 'LAMBDA(fn,x,fn(x))');
  wb.defineName('MakeAdder', 'LAMBDA(x,LAMBDA(y,x+y+Tax))');
  expect(value('LET(Tax,10,Apply(LAMBDA(x,x+Tax),2))')).toBe(12);
  expect(value('LET(Tax,10,MakeAdder(2)(3))')).toBe(5.2);
  expect(value('LET(Tax,10,fn,LAMBDA(x,x+Tax),fn(2))')).toBe(12);
});

it('keeps caller arguments local while following chained named expressions', () => {
  const { wb, value } = setup();
  wb.defineName('GrandTotal', 'TaxAmount+1');
  expect(value('LET(Tax,10,TaxAmount,99,GrandTotal)')).toBe(3);
  expect(value('LET(Tax,10,AddTax,LAMBDA(x,x+1),AddTax(Tax))')).toBe(11);
});

it('does not expose caller optional-argument markers to named expressions', () => {
  const { wb, value } = setup();
  wb.defineName('CheckX', 'ISOMITTED(x)');
  expect(value('LAMBDA([x],CheckX)()')).toBe(false);
  expect(value('LAMBDA([x],ISOMITTED(x))()')).toBe(true);
});

it('keeps named row references anchored to the calling cell and sheet', () => {
  const { wb, id, value } = setup();
  wb.defineName('Position', 'ROW()+COLUMN()');
  expect(value('LET(ROW,LAMBDA(99),COLUMN,LAMBDA(99),Position)', 2, 3)).toBe(7);
  const other = wb.addSheet('Other').id;
  wb.setInput(other, 1, 2, '=Position');
  expect(wb.getValue(other, 1, 2)).toBe(5);
  wb.setInput(id, 0, 5, '42');
  wb.defineName('Source', 'LAMBDA(F1)');
  wb.setInput(other, 0, 5, '7');
  wb.setInput(other, 0, 0, '=LET(Fn,Source,Fn())');
  expect(wb.getValue(other, 0, 0)).toBe(7);
});

it('keeps table names in workbook scope when a named formula is called from LET', () => {
  const { wb, id, value } = setup();
  wb.setInput(id, 0, 2, 'Value'); wb.setInput(id, 1, 2, '42');
  wb.addTable(id, { r1: 0, c1: 2, r2: 1, c2: 2 }, { name: 'Sales' });
  wb.defineName('TotalSales', 'SUM(Sales)');
  expect(value('LET(Sales,99,TotalSales)')).toBe(42);
});

it('supports named recursion without capturing a caller override of its own name', () => {
  const { wb, value } = setup();
  wb.defineName('Fact', 'LAMBDA(n,IF(n<2,1,n*Fact(n-1)))');
  wb.defineName('Factorial', 'Fact');
  expect(value('LET(Fact,LAMBDA(n,99),Factorial(5))')).toBe(120);
});

it.each([['xlsx', workbookToXlsx], ['ods', workbookToOds]])('retains scope behavior after %s reopening', async (format, write) => {
  const { wb, id, value } = setup();
  expect(value('LET(Tax,10,AddTax(10))')).toBe(12);
  const reopened = await workbookFromFile(await write(wb), `scope.${format}`);
  expect(reopened.getValue(reopened.activeSheetId, 0, 0)).toBe(12);
  reopened.defineName('Tax', '0.5');
  expect(reopened.getValue(reopened.activeSheetId, 0, 0)).toBe(15);
  reopened.undo();
  expect(reopened.getValue(reopened.activeSheetId, 0, 0)).toBe(12);
  expect(wb.getValue(id, 0, 0)).toBe(12);
});
