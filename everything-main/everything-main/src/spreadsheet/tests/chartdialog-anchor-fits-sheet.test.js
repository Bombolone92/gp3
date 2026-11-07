// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook, MAX_ROWS, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';
import { openChartDialog } from '../src/ui/chartdialog.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function insert(wb, range) {
  const id = wb.activeSheetId;
  for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) wb.setInput(id, r, c, r === range.r1 ? `H${c}` : String(r + c));
  wb.clearHistory();
  const grid = { focus: vi.fn(), selectChart: vi.fn() };
  const { panel } = openChartDialog({ wb, sheetId: () => id, range: () => range, grid }, { range });
  panel.querySelector('form').requestSubmit();
  const chart = wb.sheet(id).charts[0];
  expect(grid.selectChart).toHaveBeenCalledWith(chart.id);
  return { id, chart, sheet: wb.sheet(id) };
}

// A chart placed below data in the sheet's last rows was anchored past the last row; the grid drew
// it clamped onto the data's last row, and it jumped down once the sheet grew.
it('grows the sheet to hold a chart placed below data in its last rows', () => {
  const wb = new Workbook();
  const { chart, sheet } = insert(wb, { r1: 97, c1: 24, r2: 99, c2: 25 });
  expect(chart.anchor).toEqual({ r: 101, c: 24 });
  expect(sheet.rows).toBeGreaterThanOrEqual(102 + Math.ceil((chart.dy + chart.h) / DEFAULT_ROW_HEIGHT));
  expect(sheet.cols).toBe(26);
  // Growing the grid is not an edit: the one undo step is the chart.
  expect(wb.undoLabels()).toEqual(['Insert chart']);
});

it('leaves the sheet alone when the chart fits beside or below the data', () => {
  const wb = new Workbook();
  const beside = insert(wb, { r1: 0, c1: 0, r2: 3, c2: 1 });
  expect(beside.chart.anchor).toEqual({ r: 0, c: 2 });
  expect(beside.sheet.rows).toBe(100);
  const below = insert(new Workbook(), { r1: 0, c1: 22, r2: 3, c2: 25 });
  expect(below.chart.anchor).toEqual({ r: 5, c: 22 });
  expect(below.sheet.rows).toBe(100);
});

it('puts the chart right of data on the grid\'s last rows, where the sheet cannot grow downward', () => {
  const wb = new Workbook({ sheets: [{ name: 'Tall', rows: MAX_ROWS }] });
  const { chart, sheet } = insert(wb, { r1: MAX_ROWS - 3, c1: 24, r2: MAX_ROWS - 1, c2: 25 });
  expect(chart.anchor).toEqual({ r: MAX_ROWS - 3, c: 26 });
  expect(sheet.rows).toBe(MAX_ROWS);
  expect(sheet.cols).toBeGreaterThanOrEqual(27);
});
