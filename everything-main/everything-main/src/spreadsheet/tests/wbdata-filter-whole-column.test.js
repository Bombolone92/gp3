import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { MAX_ROW } from '../src/core/refs.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

/** A short list under a filter that runs to the last row of the grid, as Excel writes whole-column filters. */
function wholeColumn() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Name'], ['a'], ['b'], ['c']]));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: MAX_ROW, c2: 0 });
  return { wb, id };
}

it('judges a whole-column filter over the rows the sheet has, not a million empty ones', () => {
  const { wb, id } = wholeColumn();
  const rows = wb.sheet(id).rows;
  wb.setFilterCriteria(id, 0, { values: ['a'] });
  const hidden = wb.sheet(id).filterHidden;
  expect(hidden.size).toBe(rows - 2);
  expect([hidden.has(1), hidden.has(2), hidden.has(3), hidden.has(rows - 1), hidden.has(rows)]).toEqual([false, true, true, true, false]);
  wb.insertRows(id, 1, 1);
  expect(wb.sheet(id).filterHidden.size).toBeLessThanOrEqual(wb.sheet(id).rows);
  expect(wb.isRowHidden(id, 1)).toBe(false);
  expect(wb.getValue(id, 2, 0)).toBe('a');
});

it('lists the blanks a whole-column filter has on the sheet, not to the grid\'s end', () => {
  const { wb, id } = wholeColumn();
  const rows = wb.sheet(id).rows;
  const values = wb.filterValues(id, 0);
  expect(values.map((v) => v.value)).toEqual(['a', 'b', 'c', '']);
  expect(values.at(-1).count).toBe(rows - 4);
  expect(wb.filterColors(id, 0)).toEqual([{ color: '', count: rows - 1 }]);
});
