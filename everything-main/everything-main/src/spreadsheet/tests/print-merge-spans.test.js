// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildPrintTable, printMergeSpans } from '../src/ui/print.js';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

describe('the merge pass of the print table', () => {
  it('finds the printed rows and columns of each merge without walking every row per merge', () => {
    const rows = Array.from({ length: 100000 }, (_, i) => i);
    const cols = [0, 1, 2];
    const merges = Array.from({ length: 5000 }, (_, i) => ({ r1: i * 4, r2: i * 4 + 1, c1: 0, c2: 1 }));
    printMergeSpans(rows.slice(0, 10), cols, merges.slice(0, 2), 0); // warm the code before timing it
    const t = performance.now();
    const merged = printMergeSpans(rows, cols, merges, 0);
    // Walking all 100,000 rows for each of the 5,000 merges took seconds; a search of the sorted rows takes tens of milliseconds.
    expect(performance.now() - t).toBeLessThan(400);
    expect(merged.size).toBe(5000 * 4);
    expect(merged.get('0,0')).toEqual({ rowSpan: 2, colSpan: 2, from: merges[0] });
    expect(merged.get('1,1')).toBeNull();
    expect(merged.get('19996,0')).toEqual({ rowSpan: 2, colSpan: 2, from: merges[4999] });
  }, 20000);

  it('spans only the rows and columns that print, splits at the repeating head, and skips overlaps', () => {
    // Rows 1 and 3 hidden, column 1 hidden.
    const rows = [0, 2, 4, 5];
    const cols = [0, 2, 3];
    const merges = [
      { r1: 0, c1: 0, r2: 3, c2: 2 }, // rows 0 and 2 print, columns 0 and 2: a 2 by 2 span
      { r1: 4, c1: 3, r2: 5, c2: 3 }, // a plain 2-row span
      { r1: 1, c1: 3, r2: 1, c2: 3 }, // entirely hidden: no span
      { r1: 5, c1: 3, r2: 5, c2: 3 }, // overlaps the second: skipped
    ];
    const merged = printMergeSpans(rows, cols, merges, 0);
    expect(merged.get('0,0')).toEqual({ rowSpan: 2, colSpan: 2, from: merges[0] });
    expect(merged.get('2,2')).toBeNull();
    expect(merged.get('4,3')).toEqual({ rowSpan: 2, colSpan: 1, from: merges[1] });
    expect(merged.has('1,3')).toBe(false);
    expect(merged.size).toBe(6);
    // A span across the repeating head and the body is cut in two; only the upper part shows the cell.
    const tall = { r1: 0, c1: 0, r2: 3, c2: 0 };
    const split = printMergeSpans([0, 1, 2, 3], [0], [tall], 2);
    expect(split.get('0,0')).toEqual({ rowSpan: 2, colSpan: 1, from: tall });
    expect(split.get('2,0')).toEqual({ rowSpan: 2, colSpan: 1, from: null });
  });

  it('prints merged cells as before', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'Title');
    wb.setInput(id, 2, 0, 'x');
    wb.mergeCells(id, parseRange('A1:B2'));
    const tds = [...buildPrintTable(wb, id).querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => [td.textContent, td.rowSpan, td.colSpan]));
    expect(tds[0]).toEqual([['Title', 2, 2]]);
    expect(tds[1]).toEqual([]);
    expect(tds[2][0]).toEqual(['x', 1, 1]);
  });
});
