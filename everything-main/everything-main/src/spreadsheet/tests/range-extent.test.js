import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { calc } from './helpers/calc.js';

it('counts the blank cells of a range that reaches past the data', () => {
  const data = { A1: 'x' };
  expect(calc('COUNTBLANK(A1:A1000)', data)).toBe(999);
  expect(calc('COUNTBLANK(A:A)', data)).toBe(1048575);
  expect(calc('COUNTBLANK(A1:B1000)', data)).toBe(1999);
  expect(calc('COUNTIF(A1:A1000,"")', data)).toBe(999);
  expect(calc('COUNTIF(A1:A1000,"<>x")', data)).toBe(999);
  expect(calc('COUNTIF(A1:A1000,"<>")', data)).toBe(1);
  expect(calc('COUNTIF(A1:A1000,"x")', data)).toBe(1);
  expect(calc('COUNTIFS(A1:A1000,"",B1:B1000,"")', data)).toBe(999);
  expect(calc('COUNTIFS(A1:A1000,"x",B1:B1000,"")', data)).toBe(1);
  expect(calc('COUNTA(A1:A1000)+COUNTBLANK(A1:A1000)', data)).toBe(1000);
});

it('materializes an INDEX into the blank part of a range as zero', () => {
  const data = { A1: 'x' };
  expect(calc('INDEX(A1:A1000,500)', data)).toBe(0);
  expect(calc('INDEX(A1:A1000,1)', data)).toBe('x');
  expect(calc('INDEX(A1:A1000,1001)', data)).toEqual({ error: '#REF!' });
  expect(calc('INDEX(A1:C1000,500,3)', data)).toBe(0);
  expect(calc('INDEX(A1:C1000,1,4)', data)).toEqual({ error: '#REF!' });
  expect(calc('INDEX(A1:A5,3)', { A1: '1', A2: '2', A3: '3', A4: '4', A5: '5' })).toBe(3);
});

it('gives the same answers however tall the sheet has grown', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'x');
  wb.setInput(id, 0, 2, '=COUNTBLANK(A1:A5000)');
  wb.setInput(id, 1, 2, '=COUNTIF(A1:A5000,"<>x")');
  wb.setInput(id, 2, 2, '=INDEX(A1:A5000,3000)');
  wb.setInput(id, 3, 2, '=SUM(--ISBLANK(A1:A500))');
  const before = [0, 1, 2, 3].map((r) => wb.getValue(id, r, 2));
  wb.ensureSize(id, 2000, 26);
  wb.setInput(id, 0, 5, 'later');
  expect([0, 1, 2, 3].map((r) => wb.getValue(id, r, 2))).toEqual(before);
  expect(before).toEqual([4999, 4999, 0, 499]);
});

it('spills a bounded range to its own height and stops growing the sheet', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'x');
  wb.setInput(id, 1, 0, 'y');
  wb.setInput(id, 8, 1, '=IF(A1:A2000="","",A1:A2000)');
  expect(wb.getValue(id, 8, 1)).toBe('x');
  expect(wb.getValue(id, 9, 1)).toBe('y');
  expect(wb.spillRangeAt(id, 8, 1)).toEqual({ r1: 8, c1: 1, r2: 2007, c2: 1 });
  const rows = wb.sheet(id).rows;
  for (let i = 0; i < 5; i++) { wb.setInput(id, 10 + i, 5, String(i)); wb.getValue(id, 8, 1); }
  expect(wb.sheet(id).rows).toBe(rows);
  expect(wb.spillRangeAt(id, 8, 1)).toEqual({ r1: 8, c1: 1, r2: 2007, c2: 1 });
});

it('keeps sums, lookups, and matches over large bounded ranges right', () => {
  const data = {};
  for (let r = 1; r <= 50; r++) { data[`A${r}`] = String(r); data[`B${r}`] = String(r * 2); }
  expect(calc('SUMIF(A1:A5000,">40",B1:B5000)', data)).toBe(2 * (41 + 42 + 43 + 44 + 45 + 46 + 47 + 48 + 49 + 50));
  expect(calc('VLOOKUP(37,A1:B5000,2,FALSE)', data)).toBe(74);
  expect(calc('MATCH(50,A1:A5000,0)', data)).toBe(50);
  expect(calc('SUM(A1:A5000*2)', data)).toBe(2550);
  expect(calc('ROWS(A1:A5000)', data)).toBe(5000);
  expect(calc('COUNT(A1:A5000)', data)).toBe(50);
});
