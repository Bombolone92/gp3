import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  ['=NA()', '=1/0', 'plain', '=NA()', '42'].forEach((text, r) => wb.setInput(id, r, 0, text));
  return { wb, id, calc: formula => { wb.setInput(id, 0, 3, '=' + formula); return wb.getValue(id, 0, 3); } };
}

it('counts error literals, computed errors and error-cell references, including one-cell ranges', () => {
  const { calc } = setup();
  for (const criterion of ['NA()', '#N/A', 'A1', 'IF(TRUE,NA(),0)']) expect(calc(`COUNTIF(A1:A5,${criterion})`)).toBe(2);
  expect(calc('COUNTIF(A1:A5,1/0)')).toBe(1);
  expect(calc('COUNTIF(A1:A5,#REF!)')).toBe(0);
  expect(calc('COUNTIF(A1,A1)')).toBe(1);
  expect(calc('COUNTIF(A1:A5000,NA())')).toBe(2);
  expect(calc('COUNTIF(#REF!,NA())')).toEqual({ error: '#REF!' });
  expect(calc('LET(counter,COUNTIF,counter(A1:A5,NA()))')).toBe(2);
});

it('lifts error criteria as counts and invalidates indexed counts after edits and undo', () => {
  const { wb, id, calc } = setup();
  expect(calc('ARRAYTOTEXT(COUNTIF(A1:A5,{#N/A,#DIV/0!,"plain"}),1)')).toBe('{2,1,1}');
  expect(calc('ARRAYTOTEXT(COUNTIF(A1:A5,A1:A2),1)')).toBe('{2;1}');
  wb.setInput(id, 0, 1, '=COUNTA(A1:A5)-COUNTIF(A1:A5,NA())');
  expect(wb.getValue(id, 0, 1)).toBe(3);
  wb.setInput(id, 3, 0, 'fixed');
  expect(wb.getValue(id, 0, 1)).toBe(4);
  wb.undo();
  expect(wb.getValue(id, 0, 1)).toBe(3);
});

it('keeps native COUNTIF formulas and their calculated values when exporting and copying', async () => {
  const { wb, id } = setup();
  wb.setInput(id, 0, 1, '=COUNTIF($A$1:$A$5,NA())');
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 1, r2: 0, c2: 1 }), 1, 1, { r: 0, c: 1 });
  expect(wb.getValue(id, 1, 1)).toBe(2);
  const reopened = await workbookFromFile(await workbookToXlsx(wb), 'errors.xlsx');
  expect(reopened.getCell(reopened.activeSheetId, 1, 1).f).toBe('COUNTIF($A$1:$A$5,NA())');
  expect(reopened.getValue(reopened.activeSheetId, 1, 1)).toBe(2);
});
