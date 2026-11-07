// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';
import { createStatusBar, summarize, summarizeAll } from '../src/ui/statusbar.js';

beforeEach(() => {
  // Minimum and Maximum are off by default; these checks cover their formatting too.
  localStorage.setItem('spreadsheet:status-bar', JSON.stringify({ min: true, max: true }));
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function statusItems(wb, range, active = { r: range.r1, c: range.c1 }) {
  const id = wb.activeSheetId;
  const sel = { ...S.fromRange(range), active };
  const ctx = { wb, sheetId: () => id, subscribe: () => () => {}, grid: { range, selection: sel, zoom: 1 } };
  const status = createStatusBar(ctx);
  document.querySelector('#app').append(status.el);
  const items = [...status.el.querySelectorAll('.status-item')].map((node) => node.textContent);
  status.destroy();
  return items;
}

it('shows totals in the currency format of the selected cells', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [
    { r: 0, c: 0, cell: { v: 'Planned' } },
    { r: 1, c: 0, cell: { v: 1500, s: { fmt: 'currency', dec: 0 } } },
    { r: 2, c: 0, cell: { v: 423.38, s: { fmt: 'currency', dec: 0 } } },
    { r: 3, c: 0, cell: { v: 173, s: { fmt: 'currency', dec: 0 } } },
  ]);
  // The header is the active cell, so the format comes from the first formatted number.
  const items = statusItems(wb, { r1: 0, c1: 0, r2: 3, c2: 0 });
  expect(items).toEqual(expect.arrayContaining(['Sum: $2,096', 'Average: $699', 'Minimum: $173', 'Maximum: $1,500', 'Count: 4']));
});

it('prefers the active cell\'s format and shows decimals it asks for', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [
    { r: 0, c: 0, cell: { v: 0.5, s: { fmt: 'percent', dec: 0 } } },
    { r: 1, c: 0, cell: { v: 0.25, s: { fmt: 'number', dec: 2 } } },
  ]);
  expect(statusItems(wb, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r: 1, c: 0 })).toEqual(expect.arrayContaining(['Sum: 0.75', 'Average: 0.38']));
  expect(statusItems(wb, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r: 0, c: 0 })).toEqual(expect.arrayContaining(['Sum: 75%', 'Average: 38%']));
});

it('keeps the general display for unformatted, date, and text cells', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [
    { r: 0, c: 0, cell: { v: 45000, s: { fmt: 'date' } } },
    { r: 1, c: 0, cell: { v: 0.1 } },
    { r: 2, c: 0, cell: { v: 0.2, s: { fmt: 'text' } } },
  ]);
  expect(statusItems(wb, { r1: 0, c1: 0, r2: 2, c2: 0 })).toEqual(expect.arrayContaining(['Sum: 45000.3', 'Average: 15000.1']));
  expect(summarize(wb, id, { r1: 0, c1: 0, r2: 2, c2: 0 })).not.toHaveProperty('style');
});

/** Column B formatted as US currency for its whole length, with values written into it afterwards. */
function currencyColumn() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.applyStyle(id, { r1: 0, c1: 1, r2: wb.sheet(id).rows - 1, c2: 1 }, { fmt: 'currency', cur: 'USD' });
  wb.setCells(id, [
    { r: 0, c: 1, cell: { v: 1234.5, f: null, s: null } },
    { r: 1, c: 1, cell: { v: 2345.5, f: null, s: null } },
  ]);
  return { wb, id };
}

// A format set on a whole column or row is kept on the line, not copied onto its cells, so a value
// pasted or filled into it carries no style of its own. The status bar read the cell's stored style
// alone and showed a bare 3580 under cells every one of which read $1,234.50.
it('shows totals in the format a whole-column format gives the cells', () => {
  const { wb, id } = currencyColumn();
  expect(wb.getCell(id, 0, 1).s).toBeFalsy(); // the format is on the column, not the cell
  const items = statusItems(wb, { r1: 0, c1: 1, r2: 1, c2: 1 });
  expect(items).toEqual(expect.arrayContaining(['Sum: $3,580.00', 'Average: $1,790.00', 'Count: 2']));
  expect(summarize(wb, id, { r1: 0, c1: 1, r2: 1, c2: 1 }).style).toEqual({ fmt: 'currency', cur: 'USD' });
});

it('does the same for a whole-row format', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.applyStyle(id, { r1: 3, c1: 0, r2: 3, c2: wb.sheet(id).cols - 1 }, { fmt: 'percent' });
  wb.setCells(id, [
    { r: 3, c: 0, cell: { v: 0.25, f: null, s: null } },
    { r: 3, c: 1, cell: { v: 0.5, f: null, s: null } },
  ]);
  expect(statusItems(wb, { r1: 3, c1: 0, r2: 3, c2: 1 })).toEqual(expect.arrayContaining(['Sum: 75.00%', 'Average: 37.50%', 'Count: 2']));
});

// Precedence: the column's format, then the row's, then the cell's own, each key of the
// later winning. A cell formatted by hand inside a formatted column keeps what it was given.
it('lets a cell\'s own format win over its column\'s, for the active cell and for the first number', () => {
  const { wb, id } = currencyColumn();
  wb.applyStyle(id, { r1: 0, c1: 1, r2: 0, c2: 1 }, { fmt: 'number', dec: 1 });
  const range = { r1: 0, c1: 1, r2: 1, c2: 1 };
  // B1 is the active cell and has its own format: that one wins.
  expect(statusItems(wb, range, { r: 0, c: 1 })).toEqual(expect.arrayContaining(['Sum: 3,580.0', 'Average: 1,790.0']));
  // With B2 active the column's format applies to it, so the totals read as currency again.
  expect(statusItems(wb, range, { r: 1, c: 1 })).toEqual(expect.arrayContaining(['Sum: $3,580.00', 'Average: $1,790.00']));
  // The top-left formatted number, which decides when the active cell has no numeric format, is
  // B1's own. The keys merge one by one, so the column's currency rides along unused under a
  // format that is no longer a currency one.
  expect(summarize(wb, id, range).style).toEqual({ fmt: 'number', cur: 'USD', dec: 1 });
});

// The summary is recomputed on every selection change, so a sheet with no whole-line format must
// not pay for the lookup: the two line maps are asked for their size once per range and that is all.
it('looks nothing up per cell on a sheet with no whole-line format', { timeout: 60000 }, () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const plain = [];
  for (let r = 0; r < 5000; r++) plain.push({ r, c: 0, cell: { v: r + 0.5, f: null, s: { fmt: 'number', dec: 2 } } });
  wb.setCells(id, plain);
  let lookups = 0;
  const styleAt = wb.styleAt.bind(wb);
  wb.styleAt = (...args) => { lookups++; return styleAt(...args); };
  const range = { r1: 0, c1: 0, r2: 4999, c2: 0 };
  const plainSummary = summarize(wb, id, range);
  expect(lookups).toBe(0); // not one per cell, and not one at all
  expect(plainSummary.style).toEqual({ fmt: 'number', dec: 2 }); // read straight off the cells, as before
  expect(plainSummary.count).toBe(5000);
  expect(summarizeAll(wb, id, [range, { r1: 0, c1: 0, r2: 0, c2: 0 }]).count).toBe(5001);
  expect(lookups).toBe(0);

  // Once a column carries a format the lookup is made, and only then.
  wb.applyStyle(id, { r1: 0, c1: 5, r2: wb.sheet(id).rows - 1, c2: 5 }, { fmt: 'percent' });
  summarize(wb, id, range);
  expect(lookups).toBeGreaterThan(0);
});
