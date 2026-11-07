import { describe, expect, it } from 'vitest';
import { Workbook, MAX_ROWS, MAX_COLS } from '../src/core/workbook.js';
import { eachStoredCell, lineSpan } from '../src/core/sparse-range.js';
import { rangeToCsv } from '../src/core/io.js';

// On the full grid a whole column is a million cells and the whole sheet seventeen billion: commands
// over them walk the cells that exist, and stop where the content does.
const COLUMN_A = { r1: 0, c1: 0, r2: MAX_ROWS - 1, c2: 0 };
const SHEET = { r1: 0, c1: 0, r2: MAX_ROWS - 1, c2: MAX_COLS - 1 };

describe('whole lines on the full grid', () => {
  it('visits the stored cells of a range, never its every coordinate', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 2, 0, 'a'); wb.setInput(id, 900000, 0, 'b'); wb.setInput(id, 5, 3, 'elsewhere');
    const seen = [];
    eachStoredCell(wb.sheet(id), COLUMN_A, (r, c) => seen.push(`${r},${c}`));
    expect(seen.sort()).toEqual(['2,0', '900000,0']);
    const small = [];
    eachStoredCell(wb.sheet(id), { r1: 0, c1: 0, r2: 5, c2: 3 }, (r, c) => small.push(`${r},${c}`));
    expect(small.sort()).toEqual(['2,0', '5,3']);
  });

  it('measures lines from the sizes that differ, hidden and filtered rows counting nothing', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const s = wb.sheet(id);
    wb.setRowHeight(id, 3, 50);
    wb.setHidden(id, 'row', [7, 8], true);
    const d = s.defaultRowHeight;
    let dense = 0;
    for (let r = 0; r <= 20; r++) dense += wb.rowHeight(id, r);
    expect(lineSpan(s, 'row', 0, 20, d)).toBeCloseTo(dense);
    expect(lineSpan(s, 'row', 0, MAX_ROWS - 1, d)).toBeCloseTo(MAX_ROWS * d + (50 - d) - 2 * d);
  });

  it('exports a whole column or the whole sheet as far as the content goes', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'x'); wb.setInput(id, 2, 1, '5');
    wb.ensureSize(id, MAX_ROWS, MAX_COLS);
    expect(rangeToCsv(wb, id, COLUMN_A)).toBe('﻿x\r\n\r\n\r\n');
    expect(rangeToCsv(wb, id, SHEET)).toBe('﻿x,\r\n,\r\n,5\r\n');
  });

  it('never grows the sheet past the grid when lines are inserted', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.ensureSize(id, MAX_ROWS, MAX_COLS);
    wb.setInput(id, 0, 0, 'top');
    expect(wb.insertRows(id, 0, 3)).toBeTruthy();
    expect(wb.getValue(id, 3, 0)).toBe('top');
    expect(wb.sheet(id).rows).toBe(MAX_ROWS);
    expect(wb.insertCols(id, 0, 2)).toBeTruthy();
    expect(wb.sheet(id).cols).toBe(MAX_COLS);
  });

  it('shuffles the rows that hold something when whole columns are given', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (let r = 0; r < 20; r++) wb.setInput(id, r, 0, String(r));
    let i = 0;
    const moved = wb.shuffleRows(id, COLUMN_A, { random: () => ((i++ * 7) % 10) / 10 });
    expect(moved).toBeGreaterThan(0);
    const values = Array.from({ length: 20 }, (_, r) => wb.getValue(id, r, 0)).sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: 20 }, (_, r) => r));
    expect(wb.getValue(id, 20, 0)).toBeNull();
  });
});
