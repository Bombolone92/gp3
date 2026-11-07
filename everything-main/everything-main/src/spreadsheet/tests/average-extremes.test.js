import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { columnStats } from '../src/core/stats.js';
import { summarize, summarizeAll } from '../src/ui/statusbar.js';

const overflow = { error: '#NUM!' };

it.each([
  [[1e308, 1e308], 1e308, overflow],
  [[-1e308, -1e308], -1e308, overflow],
  [[Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE], Number.MAX_VALUE, overflow],
  [[1e308, 1e308, -1e308], 1e308 / 3, overflow],
  [[Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE, 1e-100], 1e-100 / 5, overflow],
  [[Number.MIN_VALUE, 2 * Number.MIN_VALUE], 2 * Number.MIN_VALUE],
  [[1, 3, 5], 3],
  [[Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, 2 * Number.MIN_VALUE], 0, overflow],
  [[Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE, 4 * Number.MIN_VALUE, 5 * Number.MIN_VALUE], 2 * Number.MIN_VALUE, overflow],
  [[-Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, -Number.MIN_VALUE], -0, overflow],
])('retains native worksheet overflow and independent summary averages for %j', (values, expected, worksheetExpected = expected) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, values.flatMap((v, r) => [{ r, c: 0, cell: { v } }, { r, c: 1, cell: { v: 'yes' } }]));
  const range = { r1: 0, c1: 0, r2: values.length - 1, c2: 0 };
  const ref = `A1:A${values.length}`;
  const criteria = `B1:B${values.length}`;
  const formulas = [`AVERAGE(${ref})`, `AVERAGEA(${ref})`, `AVERAGEIF(${criteria},"yes",${ref})`,
    `AVERAGEIFS(${ref},${criteria},"yes")`, `TRIMMEAN(${ref},0)`, `SUBTOTAL(101,${ref})`, `AGGREGATE(1,0,${ref})`];
  for (const [r, f] of formulas.entries()) {
    wb.setInput(id, r, 3, `=${f}`);
    expect(wb.getValue(id, r, 3), f).toEqual(worksheetExpected);
  }
  // QUERY retains its separate exact-recovery calculation.
  for (const f of [`INDEX(QUERY(${ref},"select avg(A)",0),1,1)`]) {
    wb.setInput(id, 20, 3, '=' + f);
    expect(wb.getValue(id, 20, 3), f).toBe(expected);
  }
  expect(columnStats(wb, id, 0, range).avg).toBe(expected);
  expect(summarize(wb, id, range).avg).toBe(expected);
  const separate = values.map((_, r) => ({ r1: r, c1: 0, r2: r, c2: 0 }));
  expect(summarizeAll(wb, id, separate).avg).toBe(expected);
});

it('retains sum overflow before dividing matching database rows', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Value', 'Use'], [1e308, 'yes'], [1e308, 'yes'], [7, 'no']].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  wb.setInput(id, 0, 3, 'Use');
  wb.setInput(id, 1, 3, 'yes');
  wb.setInput(id, 0, 5, '=DAVERAGE(A1:B4,1,D1:D2)');
  expect(wb.getValue(id, 0, 5)).toEqual(overflow);
});

it.each(['STDEV', 'STDEV.P', 'VAR', 'VAR.P', 'AVEDEV', 'DEVSQ'])('retains native %s overflow for identical large observations', (name) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, `=${name}(1e307*10,1e307*10)`);
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#NUM!' });
});
