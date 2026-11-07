import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it.each(['#N/A', '#DIV/0!', '#VALUE!', '#REF!', '#NUM!', '#NAME?', '#NULL!'])(
  'matches and excludes %s error cells with criteria', (error) => {
    const wb = new Workbook(), id = wb.activeSheetId;
    [`=${error}`, 5, `=${error}`, 'other'].forEach((v, r) => wb.setInput(id, r, 0, String(v)));
    [10, 20, 30, 40].forEach((v, r) => wb.setInput(id, r, 1, String(v)));
    for (let r = 0; r < 4; r++) wb.setInput(id, r, 2, 'yes');
    const calc = (formula) => { wb.setInput(id, 0, 4, `=${formula}`); return wb.getValue(id, 0, 4); };
    expect(calc(`COUNTIF(A1:A4,"${error}")`)).toBe(2);
    expect(calc(`COUNTIF(A1:A4,"=${error.toLowerCase()}")`)).toBe(2);
    expect(calc(`COUNTIF(A1:A4,"<>${error}")`)).toBe(2);
    expect(calc(`COUNTIFS(A1:A4,"${error}",C1:C4,"yes")`)).toBe(2);
    expect(calc(`SUMIF(A1:A4,"${error}",B1:B4)`)).toBe(40);
    expect(calc(`SUMIFS(B1:B4,A1:A4,"<>${error}",C1:C4,"yes")`)).toBe(60);
    expect(calc(`AVERAGEIF(A1:A4,"${error}",B1:B4)`)).toBe(20);
    expect(calc('COUNTIF(A1:A4,"*")')).toBe(1);
    expect(calc('COUNTIF(A1:A4,"#*")')).toBe(0);
    expect(calc('COUNTIF(A1:A4,"")')).toBe(0);
  },
);

it('distinguishes typed error criteria from wildcard text criteria', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, "'#N/A"); wb.setInput(id, 1, 0, '=NA()');
  wb.setInput(id, 0, 1, '=COUNTIF(A1:A2,"#N/A")');
  wb.setInput(id, 1, 1, '=COUNTIF(A1:A2,"#*")');
  expect(wb.getValue(id, 0, 1)).toBe(1);
  expect(wb.getValue(id, 1, 1)).toBe(1);
});
