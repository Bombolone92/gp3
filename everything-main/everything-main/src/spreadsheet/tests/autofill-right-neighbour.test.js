import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function book(columns) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (const [c, values] of Object.entries(columns)) values.forEach((v, r) => { if (v != null) wb.setInput(id, r, Number(c), String(v)); });
  return { wb, id };
}

// A double-click on the fill handle measured the column to the left alone, so a cell whose only neighbour
// with data stood to its right filled nothing; it now fills as far as either neighbour reaches.
it('fills down as far as the right neighbour when the left column is empty', () => {
  const { wb, id } = book({ 1: [1], 2: ['x', 'y', 'z'] });
  expect(wb.autoFillTarget(id, { r1: 0, c1: 1, r2: 0, c2: 1 })).toEqual({ r1: 0, c1: 1, r2: 2, c2: 1 });
});

it('takes the longer of the two neighbouring runs, and nothing when both are empty', () => {
  const longerRight = book({ 0: ['a', 'b'], 1: [1], 2: ['x', 'y', 'z', 'w', 'v'] });
  expect(longerRight.wb.autoFillTarget(longerRight.id, { r1: 0, c1: 1, r2: 0, c2: 1 })).toEqual({ r1: 0, c1: 1, r2: 4, c2: 1 });
  const longerLeft = book({ 0: ['a', 'b', 'c', 'd'], 1: [1], 2: ['x', 'y'] });
  expect(longerLeft.wb.autoFillTarget(longerLeft.id, { r1: 0, c1: 1, r2: 0, c2: 1 })).toEqual({ r1: 0, c1: 1, r2: 3, c2: 1 });
  const alone = book({ 1: [1] });
  expect(alone.wb.autoFillTarget(alone.id, { r1: 0, c1: 1, r2: 0, c2: 1 })).toBeNull();
  // A first column looks to its right alone.
  const first = book({ 0: [1], 1: ['x', 'y'] });
  expect(first.wb.autoFillTarget(first.id, { r1: 0, c1: 0, r2: 0, c2: 0 })).toEqual({ r1: 0, c1: 0, r2: 1, c2: 0 });
});
