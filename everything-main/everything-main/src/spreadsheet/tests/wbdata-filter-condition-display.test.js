import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

/** A dated, priced list: row 2 shows 2024-01-15 and $1,500.00, row 3 shows 2025-01-15 and $20.00. */
function list() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Date', 'Amt'], [45306, 1500], [45672, 20]]));
  wb.applyStyle(id, parseRange('A2:A3'), { fmt: 'date' });
  wb.applyStyle(id, parseRange('B2:B3'), { fmt: 'currency', dec: 2 });
  wb.setFilterRange(id, parseRange('A1:B3'));
  expect([wb.getDisplay(id, 1, 0), wb.getDisplay(id, 1, 1)]).toEqual(['2024-01-15', '$1,500.00']);
  const hidden = () => [...wb.sheet(id).filterHidden].sort();
  return { wb, id, hidden };
}

it('tests text conditions against the text the column shows, as its value list does', () => {
  const { wb, id, hidden } = list();
  wb.setFilterCriteria(id, 0, { op: 'contains', value: '2024' });
  expect(hidden()).toEqual([2]);
  wb.setFilterCriteria(id, 0, { op: 'notContains', value: '2024' });
  expect(hidden()).toEqual([1]);
  wb.setFilterCriteria(id, 0, { op: 'beginsWith', value: '2025-' });
  expect(hidden()).toEqual([1]);
  wb.setFilterCriteria(id, 0, { op: 'endsWith', value: '-15' });
  expect(hidden()).toEqual([]);
  wb.setFilterCriteria(id, 0, null);
  wb.setFilterCriteria(id, 1, { op: 'beginsWith', value: '$1' });
  expect(hidden()).toEqual([2]);
});

it('takes either spelling for equality and keeps raw values for number conditions', () => {
  const { wb, id, hidden } = list();
  wb.setFilterCriteria(id, 1, { op: 'eq', value: '$1,500.00' });
  expect(hidden()).toEqual([2]);
  wb.setFilterCriteria(id, 1, { op: 'eq', value: 1500 });
  expect(hidden()).toEqual([2]);
  wb.setFilterCriteria(id, 1, { op: 'neq', value: '$1,500.00' });
  expect(hidden()).toEqual([1]);
  wb.setFilterCriteria(id, 1, { op: 'gt', value: 100 });
  expect(hidden()).toEqual([2]);
  wb.setFilterCriteria(id, 1, { op: 'between', value: 10, value2: 30 });
  expect(hidden()).toEqual([1]);
});
