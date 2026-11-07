import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

const cases = [
  ['single-cell array', 'SEQUENCE(4-COUNTA(D2:D4))', 1],
  ['scalar', 'IF(COUNTA(D2:D4),99,SEQUENCE(4))', 99],
  ['error', 'IF(COUNTA(D2:D4),1/0,SEQUENCE(4))', { error: '#DIV/0!' }],
  ['empty filter', 'IF(COUNTA(D2:D4),FILTER({1;2},{FALSE;FALSE}),SEQUENCE(4))', { error: '#CALC!' }],
];
function setup(formula) {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, `=${formula}`);
  // A1 first sees D2:D4 empty; the later producer fills them in the same discovery.
  wb.setInput(id, 0, 3, '=SEQUENCE(4)');
  return wb;
}
it.each(cases)('removes previous spill cells when recalculation returns %s', (_, formula, value) => {
  const wb = setup(formula), id = wb.activeSheetId;
  expect(wb.getValue(id, 0, 0)).toEqual(value);
  expect(wb.rangeValues(id, { r1: 1, c1: 0, r2: 3, c2: 0 })).toEqual([[null], [null], [null]]);
  expect(wb.spillAt(id, 1, 0)).toBeNull();
  expect(wb.getDisplay(id, 1, 0)).toBe('');
  expect(wb.spillEntries(id).filter((cell) => cell.c === 0)).toEqual([]);
});
it.each(cases)('settles a formula dependent on the vanished spill after %s', (_, formula) => {
  const wb = setup(formula), id = wb.activeSheetId;
  wb.setInput(id, 0, 5, '=SUM(A2:A4)');
  expect(wb.getValue(id, 0, 5)).toBe(0);
});
it('clears horizontal spill coverage and its contribution to the used range', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SEQUENCE(1,5-COUNTA(A5:C5))');
  wb.setInput(id, 3, 0, '=SEQUENCE(2,3)');
  expect(wb.rangeValues(id, { r1: 0, c1: 0, r2: 0, c2: 4 })).toEqual([[1,2,null,null,null]]);
  expect(wb.usedRange(id)).toEqual({ r1: 0, c1: 0, r2: 4, c2: 2 });
});
it('preserves correct results through changes and undo', () => {
  const wb = setup(cases[0][1]), id = wb.activeSheetId;
  expect(wb.getValue(id, 3, 0)).toBeNull();
  wb.setInput(id, 0, 3, '=SEQUENCE(2)');
  expect(wb.rangeValues(id, { r1: 0, c1: 0, r2: 3, c2: 0 })).toEqual([[1],[2],[3],[null]]);
  wb.undo(); expect(wb.getValue(id, 3, 0)).toBeNull();
});
it.each([['xlsx', workbookToXlsx], ['ods', workbookToOds]])('does not preserve ghost values in %s files', async (ext, write) => {
  let wb = setup(cases[0][1]);
  wb = await workbookFromFile(await write(wb), `shrunk.${ext}`);
  expect(wb.rangeValues(wb.activeSheetId, { r1: 0, c1: 0, r2: 3, c2: 0 })).toEqual([[1],[null],[null],[null]]);
});
