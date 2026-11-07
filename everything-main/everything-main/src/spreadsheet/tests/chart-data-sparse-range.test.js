import { describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { chartData, defaultChart } from '../src/core/charts.js';

// chartData read every cell of a chart's range, empty or not: the dialog's largest admitted range
// (5,000 × 200) cost a million reads and about 1.4 s per read, on each change of type, headers,
// series-in or include-hidden. Nothing lies beyond the sheet's used range (values, formulas and their
// spills) but blank cells, so those are filled in without a read; the picture is the same as before,
// every row of the range a category.
function sparse() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.ensureSize(id, 5000, 200);
  const entries = [];
  for (let r = 0; r < 50; r++) for (let c = 0; c < 5; c++) entries.push({ r, c, cell: { v: r === 0 ? `h${c}` : r * c + 1, f: null } });
  wb.setCells(id, entries);
  return { wb, id };
}

describe('a chart over a sparse range', () => {
  it('reads only the cells within the used range and fills the rest in blank, with the same result', { timeout: 60000 }, () => {
    const { wb, id } = sparse();
    const chart = defaultChart({ r1: 0, c1: 0, r2: 4999, c2: 199 }, { r: 0, c: 0 });
    const reads = vi.spyOn(wb, 'getDisplay');
    const values = vi.spyOn(wb, 'getValue');
    const t0 = performance.now();
    const data = chartData(wb, id, chart);
    const ms = performance.now() - t0;
    expect(reads.mock.calls.length).toBeLessThanOrEqual(50 * 5);
    expect(values.mock.calls.length).toBeLessThanOrEqual(50 * 5);
    // The defect took about 1.4 s for the million cells; the bound is loose, the read count is the guard.
    expect(ms).toBeLessThan(700);
    // Every row of the range is still a category, and every series runs the range's length.
    expect(data.hasHeaders).toBe(true);
    expect(data.categories).toHaveLength(4999);
    expect(data.series.map((s) => s.name)).toEqual(['h0', 'h1', 'h2', 'h3', 'h4']);
    expect(data.series[1].values).toHaveLength(4999);
    expect(data.series[1].values.slice(0, 3)).toEqual([2, 3, 4]);
    expect(data.series[1].values.slice(49).every((v) => v === null)).toBe(true);
    // The same range read as rows is the same walk.
    reads.mockClear();
    const byRows = chartData(wb, id, { ...chart, seriesIn: 'rows' });
    expect(reads.mock.calls.length).toBeLessThanOrEqual(50 * 5);
    expect(byRows.categories).toHaveLength(200); // every column of the range, as before
    expect(byRows.series).toHaveLength(49); // the rows holding numbers; blank rows are left out, as before
  });

  it('still reads spilled results lying past the last typed cell', () => {
    const { wb, id } = sparse();
    wb.setInput(id, 59, 1, '=SEQUENCE(3)'); // B60:B62, past the block of typed cells
    const data = chartData(wb, id, defaultChart({ r1: 0, c1: 0, r2: 4999, c2: 4 }, { r: 0, c: 0 }));
    expect(data.series[1].values.slice(58, 62)).toEqual([1, 2, 3, null]); // the header row is not a category, so B60 is the 59th value
  });

  it('leaves hidden rows and columns out as before', () => {
    const { wb, id } = sparse();
    wb.setHidden(id, 'row', [1], true);
    wb.setHidden(id, 'col', [2], true);
    const data = chartData(wb, id, defaultChart({ r1: 0, c1: 0, r2: 4999, c2: 199 }, { r: 0, c: 0 }));
    expect(data.categories).toHaveLength(4998);
    expect(data.series.map((s) => s.name)).toEqual(['h0', 'h1', 'h3', 'h4']);
    expect(data.series[1].values[0]).toBe(3); // row 3, the second data row, since row 2 is hidden
  });
});
