import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A spill that grew the sheet announced the new layout while its anchor was still calculating,
// so a listener reading a dependent of the spill at that moment saw a provisional #CYCLE!.
it('announces a sheet grown by a spill once the calculation has finished', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SEQUENCE(150)'); // past the sheet's 100 rows
  wb.setInput(id, 0, 2, '=SUM(A1:A150)');
  wb.setInput(id, 0, 3, '=A150*2');
  const seen = [];
  wb.addEventListener('change', (e) => {
    if (e.detail.type === 'layout') seen.push([wb.sheet(id).rows, wb.getValue(id, 0, 2), wb.getValue(id, 0, 3), wb.getValue(id, 149, 0)]);
  });
  expect(wb.getValue(id, 0, 3)).toBe(300);
  expect(seen).toEqual([[150, 11325, 300, 150]]);
  expect(wb.getValue(id, 0, 2)).toBe(11325);
  expect(wb.getValue(id, 0, 0)).toBe(1);
});

it('announces growth found while working out the spills of a sheet', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SEQUENCE(150)');
  wb.setInput(id, 0, 1, '=A150+1');
  const seen = [];
  wb.addEventListener('change', (e) => { if (e.detail.type === 'layout') seen.push([wb.sheet(id).rows, wb.getValue(id, 0, 1)]); });
  expect(wb.usedRange(id)).toEqual({ r1: 0, c1: 0, r2: 149, c2: 1 });
  expect(seen).toEqual([[150, 151]]);
});
