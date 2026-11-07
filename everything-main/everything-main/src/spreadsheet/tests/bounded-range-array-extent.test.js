import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A bounded reference of more than 100,000 cells was left to its read window (about a thousand
// rows past the data) in array arithmetic, so =SUMPRODUCT(--(A1:A200000="")) answered 997 with no
// error where COUNTBLANK answered 199997. Every bounded reference now stands for its whole shape,
// its blank rows one shared row, and only an array past the four-million-cell budget is refused.
function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [1, 2, 3].forEach((v, r) => wb.setInput(id, r, 0, String(v)));
  const at = (f) => { wb.setInput(id, 50, 40, f); return wb.getValue(id, 50, 40); };
  return { wb, id, at };
}

it.each([
  ['=COUNTBLANK(A1:A200000)', 199997],
  ['=COUNTIF(A1:A200000,"")', 199997],
  ['=SUMPRODUCT(--(A1:A200000=""))', 199997],
  ['=SUM(--(A1:A200000=""))', 199997],
  ['=SUM(IF(A1:A200000="",1,0))', 199997],
  ['=ROWS(A1:A200000*1)', 200000],
  ['=AVERAGE(A1:A200000*1)', 6 / 200000],
  ['=SUMPRODUCT(--(A1:A99999=""))', 99996],
  ['=SUMPRODUCT(--(A1:A100001=""))', 99998],
  ['=SUM(A1:A200000*2)', 12],
  ['=SUMPRODUCT((A1:A200000<>"")*(A1:A200000+1))', 9],
  ['=ROWS(-A1:A200000)', 200000],
  ['=ROWS(LEN(A1:A200000))', 200000],
  ['=COUNTA(FILTER(A1:A200000,A1:A200000<>""))', 3],
])('%s answers %s over a reference past the old cap, as under it', (formula, expected) => {
  const { at } = book();
  expect(at(formula)).toBeCloseTo(expected, 12);
});

it('spills the whole shape of a large reference, and refuses only what the array budget refuses', { timeout: 60000 }, () => {
  const { at } = book();
  const t0 = performance.now();
  expect(at('=ROWS(A1:B100000*1)')).toBe(100000);
  expect(at('=ROWS(A1:B1000000*1)')).toBe(1000000); // two million cells: within the budget
  expect(at('=ROWS(A1:E1000000*1)')).toEqual({ error: '#NUM!' }); // five million: past it, refused before being built
  expect(at('=SUM(-A1:E1000000)')).toEqual({ error: '#NUM!' });
  expect(at('=SUM(LEN(A1:E1000000))')).toEqual({ error: '#NUM!' });
  // A function given the reference itself still reads its window and counts by its extent.
  expect(at('=COUNTBLANK(A1:E1000000)')).toBe(4999997);
  expect(at('=SUMPRODUCT(A1:E1000000)')).toBe(6);
  expect(performance.now() - t0).toBeLessThan(2500); // about three times a quiet run
});
