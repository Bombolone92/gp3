import { afterEach, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { setLocale } from '../src/core/format.js';

// A filter condition typed as text was compared by plain numerals alone: under a comma-decimal
// regional format "1,5" was no number, and "1,000", "10%", "$1,500" or a date were no numbers
// anywhere, so the condition hid every row or none. The text of a number or date condition is now
// read as the cell editor reads it, under the current regional format, as the conditional-formatting
// dialog already reads its bounds; text conditions (contains, begins with) keep searching the text.
const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));
afterEach(() => setLocale('en-US'));

function list() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['N', 'Date', 'Pct', 'Amt'], [1.2, 45306, 0.125, 1500], [1.7, 45672, 0.5, 20], [3, 46000, 0.9, 2500]]));
  wb.applyStyle(id, parseRange('B2:B4'), { fmt: 'date' });
  wb.applyStyle(id, parseRange('C2:C4'), { fmt: 'percent', dec: 2 });
  wb.applyStyle(id, parseRange('D2:D4'), { fmt: 'currency', dec: 2 });
  wb.setFilterRange(id, parseRange('A1:D4'));
  const hidden = () => [...wb.sheet(id).filterHidden].sort();
  return { wb, id, hidden };
}

it('reads a comma decimal in a condition under a comma-decimal regional format', () => {
  const { wb, id, hidden } = list();
  setLocale('de-DE');
  expect(wb.getDisplay(id, 1, 0)).toBe('1,2');
  wb.setFilterCriteria(id, 0, { op: 'gt', value: '1,5' });
  expect(hidden()).toEqual([1]);
  wb.setFilterCriteria(id, 0, { op: 'between', value: '1,5', value2: '2,5' });
  expect(hidden()).toEqual([1, 3]);
  wb.setFilterCriteria(id, 0, { op: 'eq', value: '1,7' });
  expect(hidden()).toEqual([1, 3]);
  wb.setFilterCriteria(id, 0, { op: 'neq', value: '1,7' });
  expect(hidden()).toEqual([2]);
});

it('reads grouped numbers, percentages, amounts and dates as the cell editor would', () => {
  const { wb, id, hidden } = list();
  wb.setFilterCriteria(id, 3, { op: 'gte', value: '1,000' });
  expect(hidden()).toEqual([2]);
  wb.setFilterCriteria(id, 3, { op: 'lt', value: '$2,000' });
  expect(hidden()).toEqual([3]);
  wb.setFilterCriteria(id, 3, null);
  wb.setFilterCriteria(id, 2, { op: 'eq', value: '12.5%' });
  expect(hidden()).toEqual([2, 3]);
  wb.setFilterCriteria(id, 2, { op: 'between', value: '10%', value2: '50%' });
  expect(hidden()).toEqual([3]);
  wb.setFilterCriteria(id, 2, null);
  wb.setFilterCriteria(id, 1, { op: 'gt', value: '2024-01-15' });
  expect(hidden()).toEqual([1]);
  wb.setFilterCriteria(id, 1, { op: 'lte', value: '2025-01-15' });
  expect(hidden()).toEqual([3]);
  // A number given as one, and the plain spelling, keep working.
  wb.setFilterCriteria(id, 1, { op: 'eq', value: 45672 });
  expect(hidden()).toEqual([1, 3]);
  wb.setFilterCriteria(id, 1, { op: 'eq', value: '2025-01-15' });
  expect(hidden()).toEqual([1, 3]);
});

it('keeps text conditions searching the text on screen', () => {
  const { wb, id, hidden } = list();
  wb.setFilterCriteria(id, 3, { op: 'contains', value: '1,5' });
  expect(hidden()).toEqual([2, 3]);
  wb.setFilterCriteria(id, 3, { op: 'beginsWith', value: '$2' });
  expect(hidden()).toEqual([1]);
  // Text that is no number under the regional format compares as text, as before.
  wb.setFilterCriteria(id, 3, null);
  wb.setFilterCriteria(id, 0, { op: 'gt', value: 'abc' });
  expect(hidden()).toEqual([1, 2, 3]);
});
