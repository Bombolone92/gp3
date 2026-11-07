import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

it.each(['Rate', 'SUM', 'DAYS', 'PI', 'TODAY', 'LET', 'LAMBDA', 'ISOMITTED'])('reads the defined constant %s as a name when used without parentheses', (name) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  expect(wb.defineName(name, '=0.2')).toBeNull();
  wb.setInput(id, 0, 0, `=${name.toLowerCase()}*100`);
  expect(wb.getValue(id, 0, 0)).toBe(20);
});

it.each(['SUM', 'DAYS', 'PI', 'LET'])('preserves the named range %s and its address while keeping function calls available', (name) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 1, 1, '42');
  expect(wb.defineName(name, 'Sheet1!$B$2')).toBeNull();
  wb.setInput(id, 0, 0, `=${name}`);
  wb.setInput(id, 0, 1, `=ROW(${name})`);
  wb.setInput(id, 0, 2, '=SUM(1,2)+DAYS(3,1)+LET(x,4,x)');
  expect(wb.getValue(id, 0, 0)).toBe(42);
  expect(wb.getValue(id, 0, 1)).toBe(2);
  expect(wb.getValue(id, 0, 2)).toBe(9);
  wb.setInput(id, 1, 1, '7');
  expect(wb.getValue(id, 0, 0)).toBe(7);
  wb.undo();
  expect(wb.getValue(id, 0, 0)).toBe(42);
});

it('resolves defined formulas before bare built-ins, while local bindings retain precedence', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 1, 1, '3');
  wb.defineName('SUM', '=Sheet1!B2*2');
  wb.setInput(id, 0, 0, '=SUM+SUM(1,2)');
  wb.setInput(id, 0, 1, '=LET(SUM,10,SUM+1)');
  expect(wb.getValue(id, 0, 0)).toBe(9);
  expect(wb.getValue(id, 0, 1)).toBe(11);
});

it('uses a colliding named LAMBDA as a value without changing built-in calls', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.defineName('ABS', '=LAMBDA(x,x+10)');
  wb.setInput(id, 0, 0, '=MAP({-2;3},ABS)');
  wb.setInput(id, 0, 2, '=ABS(-2)');
  expect(wb.getValue(id, 0, 0)).toBe(8);
  expect(wb.getValue(id, 1, 0)).toBe(13);
  expect(wb.getValue(id, 0, 2)).toBe(2);
});

it('detects cycles in colliding names instead of invoking the built-in', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.defineName('SUM', '=SUM+1');
  wb.setInput(id, 0, 0, '=SUM');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#CYCLE!' });
});

it('retains colliding names and their formula results through XLSX reopening', async () => {
  let wb = new Workbook();
  const id = wb.activeSheetId;
  wb.defineName('Rate', '=0.2');
  wb.defineName('DAYS', 'Sheet1!$B$2');
  wb.setInput(id, 1, 1, '42');
  wb.setInput(id, 0, 0, '=Rate*100+DAYS');
  wb = await workbookFromFile(await workbookToXlsx(wb), 'names.xlsx');
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(62);
});
