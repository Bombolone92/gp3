import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPivot } from '../src/core/pivot.js';

function source(rows) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v, f: null } }))));
  return { wb, id, range: { r1: 0, c1: 0, r2: rows.length - 1, c2: rows[0].length - 1 } };
}

function place(wb, id, spec) {
  const built = buildPivot(wb, id, spec);
  const sheet = wb.addSheet('Pivot');
  wb.setCells(sheet.id, built.cells);
  const at = (r, c) => wb.getValue(sheet.id, r, c);
  return { built, sheet, at, row: (r) => Array.from({ length: built.cols }, (_, c) => at(r, c)) };
}

// AVERAGEIFS over an intersection with no rows is #DIV/0!, so a pivot with Average showed the
// error in every empty cell; such a cell is now blank, as it is in a pivot table.
describe('pivot averages', () => {
  const sales = [
    ['Region', 'Quarter', 'Amount'],
    ['East', 'Q1', 100], ['West', 'Q1', 50], ['East', 'Q2', 25], ['east', 'Q1', 10], ['North', 'Q2', 7],
  ];

  it('show nothing where a row and column share no source rows', () => {
    const { wb, id, range } = source(sales);
    const { row } = place(wb, id, { range, rowField: 0, colField: 1, valueField: 2, agg: 'average' });
    expect(row(0)).toEqual(['Region', 'Q1', 'Q2', 'Total']);
    expect(row(1)).toEqual(['East', 55, 25, 45]); // (100 + 10) / 2, 25, (100 + 25 + 10) / 3
    expect(row(2)).toEqual(['North', '', 7, 7]);
    expect(row(3)).toEqual(['West', 50, '', 50]);
    expect(row(4)).toEqual(['Total', 160 / 3, 16, 192 / 5]); // (100 + 50 + 10) / 3, (25 + 7) / 2, 192 / 5
  });

  it('show nothing for a filter that leaves a category no rows, and the error for rows with no numbers', () => {
    const { wb, id, range } = source([...sales, ['North', 'Q1', 'n/a']]);
    const { at, sheet } = place(wb, id, { range, rowField: 0, colField: null, valueField: 2, agg: 'average', filters: [{ field: 1, value: 'Q1' }] });
    // Filter in row 1, blank row, header in row 3, then East, North, West and the total.
    expect([at(3, 0), at(3, 1)]).toEqual(['East', 55]);
    expect([at(4, 0), at(4, 1)]).toEqual(['North', { error: '#DIV/0!' }]); // North's one Q1 row holds text
    expect([at(5, 0), at(5, 1)]).toEqual(['West', 50]);
    expect([at(6, 0), at(6, 1)]).toEqual(['Total', 160 / 3]);
    wb.setInput(sheet.id, 0, 1, 'Q2');
    expect(at(3, 1)).toBe(25);
    expect(at(4, 1)).toBe(7);
    expect(at(5, 1)).toBe(''); // West has no Q2 rows
    expect(at(6, 1)).toBe(16);
  });
});
