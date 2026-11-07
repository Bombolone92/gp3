import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('keeps moved cells inside the protection and formula bounds of a large imported range', () => {
  const range = { r1: 0, c1: 0, r2: 200001, c2: 0 };
  const wb = new Workbook({ sheets: [{ name: 'Imported', rows: 300001, cells: {
    '100000,0': { v: 'Keep' }, '250000,0': { v: 'Moved' }, '300000,1': { f: 'SUM(A1:A200002)' },
  } }] });
  const id = wb.activeSheetId;
  wb.protectRange(id, range, 'Keep');
  wb.clearHistory();
  // Protected lines never move themselves, so an unprotected row from
  // below the range lands at the top and pushes the whole range down by one.
  expect(wb.moveRows(id, 250000, 1, 0)).toBe(0);
  expect(wb.getValue(id, 0, 0)).toBe('Moved');
  expect(wb.lockedAt(id, 0, 0)).toBe(false);
  expect(wb.getValue(id, 100001, 0)).toBe('Keep');
  expect(wb.lockedAt(id, 100001, 0)).toBe(true);
  expect(wb.sheet(id).protectedRanges[0].range).toEqual({ ...range, r1: 1, r2: 200002 });
  expect(wb.getCell(id, 300000, 1).f).toBe('SUM(A2:A200003)');
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo();
  expect(wb.sheet(id).protectedRanges[0].range).toEqual(range);
  expect(wb.getValue(id, 100000, 0)).toBe('Keep');
  wb.redo();
  expect(wb.lockedAt(id, 100001, 0)).toBe(true);
});

it('refuses to move an interior row out of a large merge, which the move would tear apart, without walking it', () => {
  const wb = new Workbook({ sheets: [{ name: 'Imported', rows: 300001,
    merges: [{ r1: 0, c1: 0, r2: 200001, c2: 0 }],
  }] });
  const id = wb.activeSheetId;
  expect(wb.moveRows(id, 100000, 1, 300000)).toBeNull();
  expect(wb.sheet(id).merges).toEqual([{ r1: 0, c1: 0, r2: 200001, c2: 0 }]);
  expect(wb.undoLabel()).toBeNull();
  // A row moved from below the merge to above it carries no part of it: the merge follows its lines.
  expect(wb.moveRows(id, 250000, 1, 0)).toBe(0);
  expect(wb.sheet(id).merges).toEqual([{ r1: 1, c1: 0, r2: 200002, c2: 0 }]);
});

it.each(['row', 'col'])('matches individual cell movement for every small %s range in both directions', (axis) => {
  // Compare every interval against the destinations of its original cells.
  // This covers intervals crossing any of the move's discontinuities.
  for (const [from, count, to] of [[2, 3, 10], [7, 3, 1]]) {
    const ranges = [];
    for (let lo = 0; lo < 12; lo++) for (let hi = lo; hi < 12; hi++) {
      ranges.push(axis === 'row' ? { r1: lo, c1: 0, r2: hi, c2: 0 } : { r1: 0, c1: lo, r2: 0, c2: hi });
    }
    const cells = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [axis === 'row' ? `${i},0` : `0,${i}`, { v: i }]));
    const wb = new Workbook({ sheets: [{ name: 'Sheet1', rows: 12, cols: 12, cells,
      protectedRanges: ranges.map((range, i) => ({ id: String(i), range })),
    }] });
    const id = wb.activeSheetId;
    if (axis === 'row') wb.moveRows(id, from, count, to); else wb.moveCols(id, from, count, to);
    const destinations = new Map();
    for (let i = 0; i < 12; i++) destinations.set(wb.getValue(id, axis === 'row' ? i : 0, axis === 'col' ? i : 0), i);
    const loKey = axis === 'row' ? 'r1' : 'c1', hiKey = axis === 'row' ? 'r2' : 'c2';
    for (const [i, range] of ranges.entries()) {
      const positions = Array.from({ length: range[hiKey] - range[loKey] + 1 }, (_, k) => destinations.get(range[loKey] + k));
      expect(wb.sheet(id).protectedRanges[i].range).toEqual({ ...range, [loKey]: Math.min(...positions), [hiKey]: Math.max(...positions) });
    }
  }
});
