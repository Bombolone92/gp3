import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it.each(['INDEX(A1:A3,2)', 'INDEX(A1:B3,2,1)'])(
  'does not evaluate unrelated scalar %s lookups to read an empty cell', (formula) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '10');
    wb.setInput(id, 1, 0, '20');
    wb.setInput(id, 2, 0, '30');
    wb.setCells(id, Array.from({ length: 1000 }, (_, r) => ({ r, c: 3, cell: { v: null, f: formula } })));
    const compute = wb._compute.bind(wb);
    let reads = 0;
    const spy = vi.spyOn(wb, '_compute').mockImplementation((...args) => {
      if (++reads > 20) throw new Error('Unrelated scalar lookups were evaluated');
      return compute(...args);
    });
    try {
      expect(wb.getValue(id, 0, 5)).toBeNull();
      expect(wb.getValue(id, 0, 3)).toBe(20);
      expect(reads).toBeLessThan(20);
    } finally { spy.mockRestore(); }
  },
);

it('discovers dynamic INDEX spills as the index changes between a row and a whole column', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['10', '20', '30'].forEach((value, r) => wb.setInput(id, r, 0, value));
  wb.setInput(id, 0, 1, '2');
  wb.setInput(id, 0, 3, '=INDEX(A1:A3,B1)');
  expect(wb.getValue(id, 0, 3)).toBe(20);
  expect(wb.getValue(id, 1, 3)).toBeNull();
  wb.setInput(id, 0, 1, '0');
  expect(wb.getValue(id, 1, 3)).toBe(20);
  expect(wb.getValue(id, 2, 3)).toBe(30);
  wb.setInput(id, 0, 1, '3');
  expect(wb.getValue(id, 0, 3)).toBe(30);
  expect(wb.getValue(id, 1, 3)).toBeNull();
});

it('discovers whole-row results when the INDEX source is a two-dimensional spill', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SEQUENCE(3,3)');
  wb.setInput(id, 0, 5, '=INDEX(A1#,2)');
  expect(wb.getValue(id, 0, 6)).toBe(5);
  expect(wb.getValue(id, 0, 7)).toBe(6);
});
