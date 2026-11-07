import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// The totals row counted a date as a number, so a column of dates got a SUBTOTAL that summed their serials
// (90613 for two days in January) and, as the first column, lost the Total label to it.
it('gives a column of dates no total and keeps the Total label in it', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (const [c, text] of [[0, 'When'], [1, 'Who'], [2, 'Amt']]) wb.setInput(id, 0, c, text);
  wb.setInput(id, 1, 0, '2024-01-15'); wb.setInput(id, 2, 0, '2024-01-16');
  wb.setInput(id, 1, 2, '10'); wb.setInput(id, 2, 2, '20');
  expect(typeof wb.getValue(id, 1, 0)).toBe('number');
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 2 }, { name: 'T' });
  wb.setTableTotals(id, tid, true);
  expect(wb.getCell(id, 3, 0)).toMatchObject({ v: 'Total', f: null });
  expect(wb.getCell(id, 3, 1)?.f ?? null).toBeNull();
  expect(wb.getCell(id, 3, 2).f).toBe('SUBTOTAL(109,T[Amt])');
  expect(wb.getValue(id, 3, 2)).toBe(30);
});

it('leaves times, date-times, custom date codes and spilled dates without a total, and still totals plain numbers', () => {
  const wb = new Workbook({ sheets: [{ name: 'S', cells: {
    '0,0': { v: 'Label' }, '0,1': { v: 'Time' }, '0,2': { v: 'Stamp' }, '0,3': { v: 'Custom' }, '0,4': { v: 'Spilled' }, '0,5': { v: 'Count' },
    '1,0': { v: 'a' }, '2,0': { v: 'b' },
    '1,1': { v: 0.5, s: { fmt: 'time' } }, '2,1': { v: 0.25, s: { fmt: 'time' } },
    '1,2': { v: 45306.5, s: { fmt: 'datetime' } }, '2,2': { v: 45307.5, s: { fmt: 'datetime' } },
    '1,3': { v: 45306, s: { fmt: 'custom', code: 'dd/mm/yyyy' } }, '2,3': { v: 45307, s: { fmt: 'custom', code: 'dd/mm/yyyy' } },
    '1,4': { f: 'SEQUENCE(2,1,45306)', s: { fmt: 'date' } },
    '1,5': { v: 3 }, '2,5': { v: 4 },
  } }] });
  const id = wb.activeSheetId;
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 5 }, { name: 'T' });
  wb.setTableTotals(id, tid, true);
  expect(wb.getCell(id, 3, 0)).toMatchObject({ v: 'Total' });
  for (const c of [1, 2, 3, 4]) expect(wb.getCell(id, 3, c)?.f ?? null).toBeNull();
  expect(wb.getCell(id, 3, 5).f).toBe('SUBTOTAL(109,T[Count])');
  expect(wb.getValue(id, 3, 5)).toBe(7);
});
