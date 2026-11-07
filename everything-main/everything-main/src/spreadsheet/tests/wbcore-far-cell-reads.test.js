import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// One value at F1000000 made every read of column F ask a million cells one by one, on each recalculation.
it('reads a long, mostly empty span from the cells that exist', () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', rows: 1000001, cols: 8, cells: { '999999,5': { v: 1 }, '3,5': { v: 4 }, '0,0': { v: 2 } } }] });
  const id = wb.activeSheetId;
  wb.setInput(id, 10, 5, '=SEQUENCE(3)'); // F11:F13 spill into the span too
  wb.setInput(id, 0, 2, '=SUM(F:F)');
  wb.setInput(id, 1, 2, '=SUM(F1:F1000000)');
  wb.setInput(id, 2, 2, '=COUNTBLANK(F1:F1000000)');
  wb.setInput(id, 3, 2, '=COUNTA(F:F)');
  wb.setInput(id, 4, 2, '=INDEX(F:F,1000000)');
  wb.setInput(id, 5, 2, '=MATCH(4,F:F,0)');
  wb.setInput(id, 6, 2, '=SUM(D1:H1000000)');
  let computes = 0;
  const compute = wb._compute.bind(wb);
  wb._compute = (...args) => { computes++; return compute(...args); };
  const t0 = performance.now();
  expect(wb.getValue(id, 0, 2)).toBe(11);
  expect(computes).toBeLessThan(100); // the cells present, not the million rows between them
  computes = 0;
  expect(wb.getValue(id, 2, 2)).toBe(999995);
  expect(computes).toBeLessThan(100);
  expect(wb.getValue(id, 1, 2)).toBe(11);
  expect(wb.getValue(id, 3, 2)).toBe(5);
  expect(wb.getValue(id, 4, 2)).toBe(1);
  expect(wb.getValue(id, 5, 2)).toBe(4);
  expect(wb.getValue(id, 6, 2)).toBe(11);
  wb.setInput(id, 1, 5, '10'); // an edit recalculates everything
  computes = 0;
  expect(wb.getValue(id, 0, 2)).toBe(21);
  expect(computes).toBeLessThan(100);
  expect(wb.getValue(id, 2, 2)).toBe(999994);
  expect(wb.getValue(id, 6, 2)).toBe(21);
  // Building the million-row lists themselves is what remains: about a tenth of a second each.
  expect(performance.now() - t0).toBeLessThan(20000);
}, 60000);
