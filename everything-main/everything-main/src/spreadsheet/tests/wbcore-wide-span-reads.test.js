import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A1 and ZZ20000 filled made SUM(Data!A:ZZ) build fourteen million cells, on every recalculation.
it('reads a wide, mostly empty span without building a slot for every empty cell', () => {
  const wb = new Workbook({ sheets: [
    { name: 'Data', rows: 20000, cols: 702, cells: { '0,0': { v: 1 }, '19999,701': { v: 2 }, '5,3': { v: 4 } } },
    { name: 'Report', rows: 10, cols: 5 },
  ] });
  const report = wb.sheets[1].id;
  wb.setInput(report, 0, 0, '=SUM(Data!A:ZZ)');
  wb.setInput(report, 1, 0, '=COUNTA(Data!A:ZZ)');
  wb.setInput(report, 2, 0, '=INDEX(Data!A:ZZ,20000,702)');
  wb.setInput(report, 3, 0, '=COUNTBLANK(Data!A1:ZZ20000)');
  let computes = 0;
  const compute = wb._compute.bind(wb);
  wb._compute = (...args) => { computes++; return compute(...args); };
  const t0 = performance.now();
  expect(wb.getValue(report, 0, 0)).toBe(7);
  expect(computes).toBeLessThan(100);
  expect(wb.getValue(report, 1, 0)).toBe(3);
  expect(wb.getValue(report, 2, 0)).toBe(2);
  expect(wb.getValue(report, 3, 0)).toBe(20000 * 702 - 3);
  // The empty rows are one shared, unchangeable row.
  const values = wb.contextFor(report, 0, 0).getRangeValues({ sheet: 'Data', kind: 'range', r1: 0, c1: 0, r2: 19999, c2: 701 });
  expect(values).toHaveLength(20000);
  expect(values[1]).toBe(values[2]);
  expect(Object.isFrozen(values[1])).toBe(true);
  expect(values[5][3]).toBe(4);
  expect(values[5]).not.toBe(values[1]);
  // Summing fourteen million shared slots is what remains, about half a second a formula.
  expect(performance.now() - t0).toBeLessThan(30000);
}, 90000);
