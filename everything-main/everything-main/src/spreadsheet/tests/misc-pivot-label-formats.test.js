import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { formatValue } from '../src/core/format.js';
import { buildPivot, pivotFieldValues, PIVOT_ALL } from '../src/core/pivot.js';

const day = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000 + 25569;

/** A source with a header row and the given rows; a cell is typed text, or { v, s } for a value with a style. */
function source(rows) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  rows.forEach((row, r) => row.forEach((cell, c) => {
    if (cell && typeof cell === 'object') wb.setCells(id, [{ r, c, cell: { v: cell.v, s: cell.s } }]);
    else wb.setInput(id, r, c, String(cell));
  }));
  return { wb, id, range: parseRange(`A1:${'ABCDEFG'[rows[0].length - 1]}${rows.length}`) };
}

/** The pivot placed on its own sheet, with its cells as the user sees them. */
function place(wb, id, range, spec) {
  const built = buildPivot(wb, id, { range, colField: null, valueField: 1, agg: 'sum', ...spec });
  const sheet = wb.addSheet('Pivot');
  wb.setCells(sheet.id, built.cells);
  return { built, sheet, display: (r, c) => wb.getDisplay(sheet.id, r, c) };
}

// One percent cell in a column of plain numbers made every label a percent: 1 read as 1,000%.
it('formats each row label like the cell its value came from', () => {
  const { wb, id, range } = source([
    ['Rate', 'Amount'],
    [1, 10],
    [{ v: 10, s: { fmt: 'percent', dec: 0 } }, 20],
    [20, 30],
  ]);
  const { display, built } = place(wb, id, range, { rowField: 0 });
  expect([display(1, 0), display(2, 0), display(3, 0)]).toEqual(['1', '1,000%', '20']);
  // Text labels and the totals row carry no number format.
  expect(built.cells.find(({ r, c }) => r === 4 && c === 0).cell.s.fmt).toBeUndefined();
});

it('tells a date from a same-day time on row labels and column headers', () => {
  const d = day(2024, 1, 5);
  const { wb, id, range } = source([
    ['When', 'Amount', 'Region'],
    [{ v: d, s: { fmt: 'date' } }, 10, 'East'],
    [{ v: d + 0.5, s: { fmt: 'datetime' } }, 20, 'West'],
  ]);
  const stamp = formatValue(d + 0.5, { fmt: 'datetime' });
  expect(stamp).not.toBe('2024-01-05');
  const rows = place(wb, id, range, { rowField: 0 });
  expect([rows.display(1, 0), rows.display(2, 0)]).toEqual(['2024-01-05', stamp]);
  const crossed = place(wb, id, range, { rowField: 2, colField: 0 });
  expect([crossed.display(0, 1), crossed.display(0, 2)]).toEqual(['2024-01-05', stamp]);
  expect(crossed.built.cells.find(({ r, c }) => r === 0 && c === 1).cell.s).toMatchObject({ bold: true, align: 'right', fmt: 'date' });
});

// A filter over a date field showed the chosen serial, and a date picked from its list stayed a serial.
it('shows a date filter as a date, before and after a value is picked from its list', () => {
  const d1 = day(2024, 1, 5);
  const d2 = day(2024, 2, 7);
  const { wb, id, range } = source([
    ['Date', 'Amount', 'Region'],
    [{ v: d1, s: { fmt: 'date' } }, 10, 'East'],
    [{ v: d2, s: { fmt: 'date' } }, 20, 'West'],
  ]);
  const chosen = place(wb, id, range, { rowField: 2, filters: [{ field: 0, value: d2 }] });
  const totalRow = chosen.built.rows - 1;
  expect(chosen.display(0, 1)).toBe('2024-02-07');
  expect(chosen.display(totalRow, 1)).toBe('20');
  // The list keeps the values themselves: picking one writes the number, which the cell's format shows as a date.
  expect(chosen.built.filterCells[0].values).toEqual([PIVOT_ALL, d1, d2]);
  const all = place(wb, id, range, { rowField: 2, filters: [{ field: 0, value: null }] });
  expect(all.display(0, 1)).toBe(PIVOT_ALL);
  expect(all.built.cells.find(({ r, c }) => r === 0 && c === 1).cell.s).toMatchObject({ color: '#0a63f0', fmt: 'date' });
  wb.setInput(all.sheet.id, 0, 1, String(d1));
  expect(all.display(0, 1)).toBe('2024-01-05');
  expect(all.display(totalRow, 1)).toBe('10');
  // The dialog can show the field's values the same way.
  const styles = new Map();
  expect(pivotFieldValues(wb, id, range, 0, styles)).toEqual([d1, d2]);
  expect(styles.get(d1)).toEqual({ fmt: 'date' });
  // A field whose numbers carry no format leaves the filter cell unformatted.
  const plain = place(wb, id, range, { rowField: 0, filters: [{ field: 1, value: null }] });
  expect(plain.built.cells.find(({ r, c }) => r === 0 && c === 1).cell.s).toEqual({ color: '#0a63f0' });
});
