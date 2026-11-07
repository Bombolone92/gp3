// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';
import { createStatusBar, summarize, summarizeAll } from '../src/ui/statusbar.js';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  // Minimum and Maximum are off by default; these checks cover their formatting too.
  localStorage.setItem('spreadsheet:status-bar', JSON.stringify({ min: true, max: true }));
});
afterEach(() => vi.unstubAllGlobals());
const range = { r1: 1, c1: 0, r2: 2, c2: 0 };
function book(lines = {}) {
  return new Workbook({ sheets: [{ name: 'Prices', ...lines,
    cells: { '0,0': { f: 'SEQUENCE(3)', s: { fmt: 'currency', cur: 'USD', dec: 2 } } },
  }] });
}
function items(wb, selectionRange = range, active = { r: 1, c: 0 }) {
  const status = createStatusBar({ wb, sheetId: () => wb.activeSheetId, subscribe: () => () => {},
    grid: { range: selectionRange, selection: { ...S.fromRange(selectionRange), active }, zoom: 1 },
  });
  const text = [...status.el.querySelectorAll('.status-item')].map((node) => node.textContent);
  status.destroy();
  return text;
}

it('shows currency totals when the selected spill results exclude their anchor', () => {
  const wb = book(), id = wb.activeSheetId;
  expect(wb.getDisplay(id, 1, 0)).toBe('$2.00');
  expect(summarize(wb, id, range)).toMatchObject({ sum: 5, count: 2, nums: 2, style: { fmt: 'currency', dec: 2 } });
  expect(items(wb)).toEqual(expect.arrayContaining(['Sum: $5.00', 'Average: $2.50', 'Minimum: $2.00', 'Maximum: $3.00', 'Count: 2']));
  expect(summarizeAll(wb, id, [range, { r1: 4, c1: 0, r2: 4, c2: 0 }]).style.fmt).toBe('currency');
});

it('uses the active spill\'s displayed format over the column default', () => {
  const wb = book({ colStyles: { 0: { fmt: 'percent', dec: 0 } } });
  expect(items(wb)).toEqual(expect.arrayContaining(['Sum: $5.00', 'Average: $2.50']));
  wb.applyStyle(wb.activeSheetId, { ...range, r1: 2 }, { fmt: 'number', dec: 3 });
  expect(items(wb, range, { r: 2, c: 0 })).toEqual(expect.arrayContaining(['Sum: 5.000', 'Average: 2.500', 'Count: 2']));
});

it('takes the first formatted number in row order, whether stored or spilled', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.setCells(id, [{ r: 3, c: 0, cell: { v: 4, s: { fmt: 'percent', dec: 0 } } }]);
  expect(summarize(wb, id, { ...range, r2: 3 }).style.fmt).toBe('currency');
  wb.applyStyle(id, { ...range, r2: 1 }, { fmt: 'percent', dec: 1 });
  expect(summarize(wb, id, { ...range, r2: 3 }).style).toMatchObject({ fmt: 'percent', dec: 1 });
  // A filter hides both the value and its format from the selection summary.
  wb.sheet(id).filterHidden.add(1);
  expect(summarize(wb, id, { ...range, r2: 3 })).toMatchObject({ sum: 7, count: 2, style: { fmt: 'currency' } });
});

it('does not use date formats for totals or read a style for every number in a large spill', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'date' });
  expect(summarize(wb, id, range)).not.toHaveProperty('style');
  wb.setCells(id, [{ r: 0, c: 0, cell: { f: 'SEQUENCE(10000)', s: { fmt: 'currency', dec: 2 } } }]);
  wb.getValue(id, 0, 0);
  const read = vi.spyOn(wb, 'spillAt');
  expect(summarize(wb, id, { ...range, r2: 9999 })).toMatchObject({ count: 9999, style: { fmt: 'currency' } });
  expect(read.mock.calls.length).toBeLessThanOrEqual(1);
});
