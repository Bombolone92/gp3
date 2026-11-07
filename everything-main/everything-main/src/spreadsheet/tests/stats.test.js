import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';
import { columnStats } from '../src/core/stats.js';

function book(cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  return { wb, id };
}

describe('columnStats', () => {
  it('profiles a column of numbers, text, blanks, and errors', () => {
    const { wb, id } = book({ A1: '1', A2: '2', A3: '2', A4: '', A5: 'x', A6: '=1/0', A7: '=A1+9', B1: '=SEQUENCE(3)' });
    const s = columnStats(wb, id, 0, { r1: 0, r2: 6 });
    expect(s).toMatchObject({ count: 6, empty: 1, errors: 1, textCount: 1, numbers: 4, sum: 15, min: 1, max: 10, median: 2, unique: 4 });
    expect(s.avg).toBeCloseTo(3.75);
    expect(s.top[0]).toEqual({ value: '2', count: 2 });
    expect(s.buckets.reduce((n, b) => n + b.count, 0)).toBe(4);
    expect(s.buckets[0].from).toBe(1);
    expect(s.buckets[s.buckets.length - 1].to).toBe(10);
    // Spilled values count too.
    const spill = columnStats(wb, id, 1, { r1: 0, r2: 6 });
    expect(spill.numbers).toBe(3);
    expect(spill.sum).toBe(6);
  });

  it('handles an empty column', () => {
    const { wb, id } = book({ A1: 'x' });
    const s = columnStats(wb, id, 3, { r1: 0, r2: 9 });
    expect(s).toMatchObject({ count: 0, empty: 10, numbers: 0, sum: null, avg: null, median: null, unique: 0, top: [], buckets: [] });
  });

  it.each([
    [-Number.MAX_VALUE, 0, Number.MAX_VALUE],
    [0, Number.MIN_VALUE],
    [-Number.MIN_VALUE, 0, Number.MIN_VALUE],
  ])('profiles extreme finite numbers without crashing: %j', (...values) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setCells(id, values.map((v, r) => ({ r, c: 0, cell: { v } })));
    const stats = columnStats(wb, id, 0, { r1: 0, r2: values.length - 1 });
    expect(stats.numbers).toBe(values.length);
    expect(stats.buckets.reduce((sum, b) => sum + b.count, 0)).toBe(values.length);
    expect(stats.buckets[0].from).toBe(values[0]);
    expect(stats.buckets.at(-1).to).toBe(values.at(-1));
    expect(stats.buckets.every((b) => Number.isFinite(b.from) && Number.isFinite(b.to))).toBe(true);
    expect(stats.buckets[0].count).toBeGreaterThan(0);
    expect(stats.buckets.at(-1).count).toBeGreaterThan(0);
  });
});

describe('column statistics under a filter', () => {
  it('leave out the rows the filter hides', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'Amount');
    for (const [r, v] of [[1, '10'], [2, '20'], [3, '30'], [4, '40']]) wb.setInput(id, r, 0, v);
    wb.setFilterRange(id, { r1: 0, c1: 0, r2: 4, c2: 0 });
    wb.setFilterCriteria(id, 0, { values: ['10', '30'] });
    const stats = columnStats(wb, id, 0, { r1: 1, c1: 0, r2: 4, c2: 0 });
    expect(stats.count).toBe(2);
    expect(stats.sum).toBe(40);
  });
});
