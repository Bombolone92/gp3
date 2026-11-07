import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A running total names a fresh range in every row — $A$1:A1, $A$1:A2, … — and each was read cell by
// cell from the top, so a column of them cost the square of its length: 8,006,000 cell reads over
// 4,000 rows against 12,000 for the same total written as B{r-1}+A{r}. Anything that reads the whole
// column — a total over it, a chart, Print, Export, F9 — froze the tab for seconds.

function column(n, formula = (r) => `SUM($A$1:A${r})`, values = () => 1) {
  const cells = {};
  for (let r = 0; r < n; r++) {
    cells[`${r},0`] = { v: values(r) };
    cells[`${r},1`] = { f: formula(r + 1) };
  }
  const wb = new Workbook({ sheets: [{ name: 'Sheet1', rows: n + 8, cols: 6, cells }] });
  return { wb, id: wb.activeSheetId };
}

/** How many cells the workbook read while `run` ran. */
function reads(wb, run) {
  let calls = 0;
  const compute = wb._compute.bind(wb);
  wb._compute = (s, r, c) => { calls++; return compute(s, r, c); };
  try { run(); } finally { delete wb._compute; }
  return calls;
}

describe('a range that carries a shorter one of the same family further down', () => {
  it('gives every row the same total, in whatever order the rows are read', () => {
    const n = 300;
    const down = column(n);
    for (let r = 0; r < n; r++) expect(down.wb.getValue(down.id, r, 1)).toBe(r + 1);

    const up = column(n);
    for (let r = n - 1; r >= 0; r--) expect(up.wb.getValue(up.id, r, 1)).toBe(r + 1);

    const mixed = column(n);
    for (const r of [299, 50, 120, 5, 299, 0, 298, 121]) expect(mixed.wb.getValue(mixed.id, r, 1)).toBe(r + 1);
  });

  it('follows an edit anywhere in what it totals', () => {
    const { wb, id } = column(500);
    expect(wb.getValue(id, 499, 1)).toBe(500);
    wb.setInput(id, 4, 0, '11');
    expect(wb.getValue(id, 499, 1)).toBe(510);
    expect(wb.getValue(id, 3, 1)).toBe(4);
    expect(wb.getValue(id, 4, 1)).toBe(15);
    wb.setInput(id, 499, 0, '0');
    expect(wb.getValue(id, 499, 1)).toBe(509);
    expect(wb.getValue(id, 498, 1)).toBe(509);
    wb.undo();
    expect(wb.getValue(id, 499, 1)).toBe(510);
    wb.undo();
    expect(wb.getValue(id, 499, 1)).toBe(500);
  });

  it('sees a spill land inside the prefix, and sees it shrink again', () => {
    const { wb, id } = column(40, (r) => `SUM($C$1:C${r})`);
    for (let r = 0; r < 40; r++) expect(wb.getValue(id, r, 1)).toBe(0);
    wb.setInput(id, 0, 2, '=SEQUENCE(5)');
    expect(wb.getValue(id, 39, 1)).toBe(15);
    expect(wb.getValue(id, 2, 1)).toBe(6);
    wb.setInput(id, 0, 2, '=SEQUENCE(2)');
    expect(wb.getValue(id, 39, 1)).toBe(3);
    expect(wb.getValue(id, 2, 1)).toBe(3);
    wb.undo();
    expect(wb.getValue(id, 39, 1)).toBe(15);
  });

  it('does not mix up families that differ in their columns, or lie on other sheets', () => {
    const cells = {};
    for (let r = 0; r < 50; r++) {
      cells[`${r},0`] = { v: 1 };
      cells[`${r},1`] = { v: 10 };
      cells[`${r},2`] = { f: `SUM($A$1:A${r + 1})` };
      cells[`${r},3`] = { f: `SUM($A$1:B${r + 1})` };
      cells[`${r},4`] = { f: `SUM(Data!$A$1:A${r + 1})` };
    }
    const wb = new Workbook({ sheets: [
      { name: 'Sheet1', rows: 60, cols: 8, cells },
      { name: 'Data', rows: 60, cols: 4, cells: Object.fromEntries(Array.from({ length: 50 }, (_, r) => [`${r},0`, { v: 2 }])) },
    ] });
    const id = wb.sheets[0].id;
    for (const r of [49, 10, 30, 0]) {
      expect(wb.getValue(id, r, 2)).toBe(r + 1);
      expect(wb.getValue(id, r, 3)).toBe((r + 1) * 11);
      expect(wb.getValue(id, r, 4)).toBe((r + 1) * 2);
    }
  });

  it('reads each cell of the column once instead of once per row above it', { timeout: 60000 }, () => {
    const n = 2000;
    const { wb, id } = column(n);
    const calls = reads(wb, () => { for (let r = 0; r < n; r++) wb.getValue(id, r, 1); });
    // n reads of column A and n of column B, not n(n+1)/2 — which is 2,001,000 at this size.
    expect(calls).toBeLessThan(n * 4);
    expect(wb.getValue(id, n - 1, 1)).toBe(n);

    // One viewport at the bottom of the column costs the column once, not sixty prefixes.
    const view = column(n);
    const frame = reads(view.wb, () => { for (let r = n - 60; r < n; r++) view.wb.getValue(view.id, r, 1); });
    expect(frame).toBeLessThan(n * 4);

    // And a total over the whole column of running totals.
    const total = column(n);
    total.wb.setInput(total.id, n + 1, 1, `=SUM(B1:B${n})`);
    const summed = reads(total.wb, () => expect(total.wb.getValue(total.id, n + 1, 1)).toBe(n * (n + 1) / 2));
    expect(summed).toBeLessThan(n * 4);
  });
});
