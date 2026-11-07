import { expect, it } from 'vitest';
import { GRID_RANGE, compactRangeRecords, mapRangeRecords, removeRangeRecords, shiftRangeRecords,
  permuteRangeRecords, moveLineRangeRecords, moveRangeRecords, clearRangeRecordsAtCells,
  forEachRangeRecordAt } from '../src/core/range-records.js';

const box = (r1, c1, r2 = r1, c2 = c1) => ({ r1, c1, r2, c2 });
const inside = (g, r, c) => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2;
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const red = freeze({ br: true, brBorder: { bs: 'double', bc: '#aa3344' } });
const blue = freeze({ br: true, brBorder: { bs: 'thin', bc: '#3355aa' } });
const record = (range, style = red) => ({ range, style });
const identity = rec => JSON.stringify(rec.style);
const compact = records => compactRangeRecords(records, identity);

// A coordinate oracle uses only points, independently of rectangle splitting.
const points = records => records.flatMap(({ range: g, style }) => {
  const out = [];
  for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) out.push({ r, c, style });
  return out;
});
const signature = entries => [...new Set(entries.map(({ r, c, style }) => `${r},${c}:${JSON.stringify(style)}`))].sort();
const samePoints = (actual, expected) => expect(signature(points(actual))).toEqual(signature(expected));
const sample = () => freeze([
  record(box(1, 2, 5, 6)), record(box(4, 0, 7, 3), blue), record(box(0, 7, 3, 8), blue),
]);

it('maps only a rectangle intersection while preserving opaque nested payloads outside it', () => {
  const before = sample(), area = box(2, 3, 6, 7);
  const after = mapRangeRecords(before, area, rec => [{ ...rec, style: { bold: true } }]);
  samePoints(after, points(before).map(p => inside(area, p.r, p.c) ? { ...p, style: { bold: true } } : p));
  expect(after.find(r => r.style === red)).toBeDefined();
  samePoints(removeRangeRecords(before, area), points(before).filter(p => !inside(area, p.r, p.c)));
});

it('compacts equal values without collapsing different border descriptors or filling gaps', () => {
  const before = freeze([
    record(box(1, 1, 2, 2)), record(box(3, 1, 4, 2)), record(box(1, 3, 4, 4)),
    record(box(1, 5, 4, 6), blue), record(box(6, 1, 6, 4)),
  ]);
  const after = compact(before);
  expect(after).toHaveLength(3);
  expect(after).toEqual(expect.arrayContaining([record(box(1, 1, 4, 4)), record(box(6, 1, 6, 4)), record(box(1, 5, 4, 6), blue)]));
  samePoints(after, points(before));
  samePoints(compact(after), points(before));
  expect(after[0].style).toBe(red);
});

it.each(['row', 'col'])('matches point insertion/deletion on the %s axis across full lines and cell bands', axis => {
  const before = sample();
  for (const band of [GRID_RANGE, box(2, 2, 6, 5)]) for (const remove of [false, true]) {
    for (let at = 0; at < 9; at++) for (const count of [1, 3]) {
      const expected = points(before).flatMap(p => {
        if (!inside(band, p.r, p.c)) return [p];
        const key = axis === 'row' ? 'r' : 'c', i = p[key];
        if (remove && i >= at && i < at + count) return [];
        return [{ ...p, [key]: i >= at + (remove ? count : 0) ? i + (remove ? -count : count) : i }];
      });
      samePoints(compact(shiftRangeRecords(before, axis, at, count, remove, band)), expected);
    }
  }
});

it.each(['row', 'col'])('clips shifts at the spreadsheet limit without allocating the intervening cells (%s)', axis => {
  const lo = axis === 'row' ? 'r1' : 'c1', hi = axis === 'row' ? 'r2' : 'c2', last = GRID_RANGE[hi];
  const before = freeze([record({ ...box(0, 0), [lo]: last - 2, [hi]: last })]);
  const after = shiftRangeRecords(before, axis, last - 1, 2, false);
  expect(after).toEqual([record({ ...box(0, 0), [lo]: last - 2, [hi]: last - 2 })]);
});

it.each(['row', 'col'])('preserves values through a partial permutation with removed lines (%s)', axis => {
  const before = sample(), area = box(1, 1, 6, 7), key = axis === 'row' ? 'r' : 'c';
  const moved = new Map([[1, 5], [2, 1], [3, 4], [4, 3], [5, 2], [6, null], [7, 7]]);
  const after = compact(permuteRangeRecords(before, area, axis, i => moved.get(i)));
  samePoints(after, points(before).flatMap(p => !inside(area, p.r, p.c) ? [p]
    : moved.get(p[key]) == null ? [] : [{ ...p, [key]: moved.get(p[key]) }]));
});

it.each(['row', 'col'])('moves whole-line bands piecewise, retaining every value (%s)', axis => {
  const before = sample(), key = axis === 'row' ? 'r' : 'c';
  const move = i => i >= 2 && i < 4 ? i + 3 : i >= 4 && i < 7 ? i - 2 : i;
  const after = compact(moveLineRangeRecords(before, axis, [2, 4, 7], move));
  samePoints(after, points(before).map(p => ({ ...p, [key]: move(p[key]) })));
});

it.each([box(3, 3, 6, 6), box(9, 10, 12, 13), box(1, 1, 4, 4)])('moves a source snapshot over the entire destination, including overlaps (%j)', dst => {
  const before = sample(), src = box(1, 1, 4, 4), dr = dst.r1 - src.r1, dc = dst.c1 - src.c1;
  const original = points(before);
  const expected = [...original.filter(p => !inside(src, p.r, p.c) && !inside(dst, p.r, p.c)),
    ...original.filter(p => inside(src, p.r, p.c)).map(p => ({ ...p, r: p.r + dr, c: p.c + dc }))];
  samePoints(compact(moveRangeRecords(before, src, dst)), expected);
});

it('clears only edited coordinates, including duplicate and out-of-order edits', () => {
  const before = sample(), edits = [{ r: 6, c: 2 }, { r: 2, c: 4 }, { r: 2, c: 3 }, { r: 2, c: 4 }, { r: 50, c: 50 }];
  samePoints(compact(clearRangeRecordsAtCells(before, edits)), points(before).filter(p => !edits.some(e => e.r === p.r && e.c === p.c)));
  expect(clearRangeRecordsAtCells(before, [])).toBe(before);
  expect(clearRangeRecordsAtCells(before, [{ r: 50, c: 50 }])).toBe(before);
});

it('keeps full-sheet edits bounded by their geometry, not the number of formatted cells', () => {
  const before = freeze([record({ ...GRID_RANGE })]);
  expect(clearRangeRecordsAtCells(before, [{ r: 500000, c: 8000 }])).toHaveLength(4);
  expect(removeRangeRecords(before, box(100, 200, 800000, 12000))).toHaveLength(4);
  expect(shiftRangeRecords(before, 'row', 500000, 5, false, { ...GRID_RANGE, c1: 100, c2: 200 })).toHaveLength(4);
});

it('finds every containing payload and preserves source positions for overlap precedence', () => {
  const before = sample();
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
    const found = [];
    forEachRangeRecordAt(before, r, c, (rec, index) => found.push({ rec, index }));
    const expected = before.map((rec, index) => ({ rec, index })).filter(({ rec }) => inside(rec.range, r, c));
    expect(found.sort((a, b) => a.index - b.index)).toEqual(expected);
  }
  const changed = removeRangeRecords(before, box(2, 2, 4, 4));
  const found = [];
  forEachRangeRecordAt(changed, 3, 3, rec => found.push(rec));
  expect(found).toEqual([]);
  forEachRangeRecordAt(before, 3, 3, rec => found.push(rec));
  expect(found).toEqual([before[0]]); // indexing the new array cannot invalidate the old snapshot
});

it('reuses the index for repeated reads instead of scanning every sparse record', () => {
  let reads = 0;
  const records = Array.from({ length: 4096 }, (_, r) => ({
    get range() { reads++; return box(r * 2, 4); }, style: r % 2 ? red : blue,
  }));
  forEachRangeRecordAt(records, 100, 4, () => {});
  reads = 0;
  const found = [];
  forEachRangeRecordAt(records, 4000, 4, (rec, index) => found.push(index));
  expect(found).toEqual([2000]);
  expect(reads).toBeLessThan(100);
  expect(found.map(i => records[i].style)).toEqual([blue]);
});
