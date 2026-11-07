import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('does not read spilled values outside a large formatting selection', () => {
  const wb = new Workbook({ sheets: [{ name: 'Large', rows: 20000, cols: 100,
    cells: { '0,0': { f: 'SEQUENCE(5000,20)' } },
  }] });
  const id = wb.activeSheetId;
  wb.getValue(id, 0, 0);
  const anchor = wb._spills.get(id).anchors.get('0,0');
  const values = anchor.values;
  let reads = 0;
  Object.defineProperty(anchor, 'values', { get() { reads++; return values; } });
  wb.applyStyle(id, { r1: 10000, c1: 50, r2: 19998, c2: 99 }, { fmt: null });
  expect(reads).toBe(0);
  expect(wb.canUndo()).toBe(false);
  expect(wb.sheet(id).cells.size).toBe(1);
});

it('bounds spill entries to the requested cells while excluding the stored anchor', () => {
  const wb = new Workbook({ sheets: [{ name: 'Arrays', cells: {
    '2,3': { f: 'SEQUENCE(3,3)' }, '0,0': { f: 'SEQUENCE(2)' },
  } }] });
  const id = wb.activeSheetId;
  expect(wb.spillEntries(id, { r1: 2, c1: 3, r2: 3, c2: 4 })).toEqual([
    { r: 2, c: 4, value: 2 }, { r: 3, c: 3, value: 4 }, { r: 3, c: 4, value: 5 },
  ]);
  expect(wb.spillEntries(id, { r1: 4, c1: 5, r2: 4, c2: 5 })).toEqual([{ r: 4, c: 5, value: 9 }]);
  expect(wb.spillEntries(id, { r1: 7, c1: 0, r2: 9, c2: 9 })).toEqual([]);
  expect(wb.spillEntries(id)).toHaveLength(9);
});
