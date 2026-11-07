import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const formulas = {
  SUMIF: 'SUMIF(B1:B4,"yes",A1:A4)',
  SUMIFS: 'SUMIFS(A1:A4,B1:B4,"yes",C1:C4,1)',
  AVERAGEIF: 'AVERAGEIF(B1:B4,"yes",A1:A4)',
  AVERAGEIFS: 'AVERAGEIFS(A1:A4,B1:B4,"yes",C1:C4,1)',
};

it.each(Object.keys(formulas).flatMap((fn) => ['#N/A', '#DIV/0!', '#VALUE!', '#REF!', '#NUM!'].map((error) => ({ fn, error }))))(
  '$fn propagates a matched $error and recalculates when the match changes', ({ fn, error }) => {
    const wb = new Workbook(), id = wb.activeSheetId;
    [5, `=${error}`, 15, 100].forEach((value, r) => wb.setInput(id, r, 0, String(value)));
    ['yes', 'yes', 'yes', 'no'].forEach((value, r) => wb.setInput(id, r, 1, value));
    [1, 1, 1, 1].forEach((value, r) => wb.setInput(id, r, 2, String(value)));
    wb.setInput(id, 0, 4, `=${formulas[fn]}`);
    expect(wb.getValue(id, 0, 4)).toEqual({ error });
    wb.setInput(id, 0, 5, `=IFERROR(E1,"failed")`);
    expect(wb.getValue(id, 0, 5)).toBe('failed');
    wb.setInput(id, 1, 1, 'no');
    expect(wb.getValue(id, 0, 4)).toBe(fn.startsWith('SUM') ? 20 : 10);
    wb.undo();
    expect(wb.getValue(id, 0, 4)).toEqual({ error });
    if (fn.endsWith('IFS')) {
      wb.setInput(id, 1, 2, '0');
      expect(wb.getValue(id, 0, 4)).toBe(fn.startsWith('SUM') ? 20 : 10);
    }
  },
);

it.each(Object.keys(formulas))('%s keeps ignoring matched text, booleans, and blank cells', (fn) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  [5, 'text', 'TRUE', ''].forEach((value, r) => wb.setInput(id, r, 0, String(value)));
  for (let r = 0; r < 4; r++) { wb.setInput(id, r, 1, 'yes'); wb.setInput(id, r, 2, '1'); }
  wb.setInput(id, 0, 4, `=${formulas[fn]}`);
  expect(wb.getValue(id, 0, 4)).toBe(5);
});

it.each(Object.keys(formulas))('%s permits explicit exclusion of errors in the value range', (fn) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  [5, '=NA()', 15, 'text'].forEach((value, r) => wb.setInput(id, r, 0, String(value)));
  const args = fn.endsWith('IFS') ? 'A1:A4,A1:A4,"<>#N/A"' : 'A1:A4,"<>#N/A",A1:A4';
  wb.setInput(id, 0, 4, `=${fn}(${args})`);
  expect(wb.getValue(id, 0, 4)).toBe(fn.startsWith('SUM') ? 20 : 10);
});

it.each(Object.keys(formulas))('%s matches error positions correctly in two-dimensional ranges', (fn) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  [[5, '=NA()'], ['text', 15]].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  [['yes', 'no'], ['yes', 'yes']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c + 3, v)));
  const args = fn.endsWith('IFS') ? 'A1:B2,D1:E2,"yes"' : 'D1:E2,"yes",A1:B2';
  wb.setInput(id, 0, 6, `=${fn}(${args})`);
  expect(wb.getValue(id, 0, 6)).toBe(fn.startsWith('SUM') ? 20 : 10);
  wb.setInput(id, 0, 4, 'yes');
  expect(wb.getValue(id, 0, 6)).toEqual({ error: '#N/A' });
});
