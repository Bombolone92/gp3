import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

/** Column A alternates a, a, b, a, b, a under a header; filtering on "a" hides rows 3 and 5 (0-based). */
function filtered() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['Key', 'Value'], ['a', '10'], ['a', '20'], ['b', ''], ['a', ''], ['b', ''], ['a', '']].forEach((row, r) => row.forEach((t, c) => t !== '' && wb.setInput(id, r, c, t)));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 6, c2: 1 });
  wb.setFilterCriteria(id, 0, { formula: 'A2="a"' });
  expect([...wb.sheet(id).filterHidden].sort()).toEqual([3, 5]);
  return { wb, id };
}

it('continues a series through the shown rows and leaves hidden rows untouched', () => {
  const { wb, id } = filtered();
  wb.fill(id, { r1: 1, c1: 1, r2: 2, c2: 1 }, { r1: 1, c1: 1, r2: 6, c2: 1 });
  expect([1, 2, 3, 4, 5, 6].map((r) => wb.getValue(id, r, 1))).toEqual([10, 20, null, 30, null, 40]);
});

it('copies a single value into the shown rows only', () => {
  const { wb, id } = filtered();
  wb.setInput(id, 1, 1, 'x');
  wb.fill(id, { r1: 1, c1: 1, r2: 1, c2: 1 }, { r1: 1, c1: 1, r2: 6, c2: 1 });
  expect([1, 2, 3, 4, 5, 6].map((r) => wb.getValue(id, r, 1))).toEqual(['x', 'x', null, 'x', null, 'x']);
});

it('fills upward over a filter and fills every row when nothing is filtered', () => {
  // Here the filter hides rows 2 and 4; the source sits in the shown rows 5 and 6.
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['Key', 'Value'], ['a', ''], ['b', ''], ['a', ''], ['b', ''], ['a', '5'], ['a', '6']].forEach((row, r) => row.forEach((t, c) => t !== '' && wb.setInput(id, r, c, t)));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 6, c2: 1 });
  wb.setFilterCriteria(id, 0, { formula: 'A2="a"' });
  expect([...wb.sheet(id).filterHidden].sort()).toEqual([2, 4]);
  wb.fill(id, { r1: 5, c1: 1, r2: 6, c2: 1 }, { r1: 1, c1: 1, r2: 6, c2: 1 });
  expect([1, 2, 3, 4, 5, 6].map((r) => wb.getValue(id, r, 1))).toEqual([3, null, 4, null, 5, 6]);
  const plain = new Workbook();
  const pid = plain.activeSheetId;
  plain.setInput(pid, 0, 0, '1');
  plain.setInput(pid, 1, 0, '2');
  plain.fill(pid, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 4, c2: 0 });
  expect([0, 1, 2, 3, 4].map((r) => plain.getValue(pid, r, 0))).toEqual([1, 2, 3, 4, 5]);
});
