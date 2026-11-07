// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openSeriesDialog } from '../src/ui/seriesdialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';
import { parseRange } from '../src/core/cell.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  closeAllModals();
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function open(wb, id, range) {
  const grid = { setSelection: vi.fn(), focus: vi.fn() };
  openSeriesDialog({ wb, sheetId: () => id, range: () => range, grid });
  const panel = document.querySelector('.modal-panel');
  const q = (label) => panel.querySelector(`[aria-label="${label}"]`);
  return { panel, grid, q, alert: () => panel.querySelector('[role="alert"]'), closing: () => panel.closest('.modal-root').classList.contains('closing'), submit: () => panel.querySelector('form').requestSubmit() };
}

it('asks for a step other than zero when only a stop value bounds a single-cell fill', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1');
  const before = wb.toJSON();
  const { q, alert, closing, submit } = open(wb, id, parseRange('A1'));
  q('Step').value = '0';
  q('Stop value').value = '10';
  submit();
  expect(alert().hidden).toBe(false);
  expect(alert().textContent).toMatch(/step/i);
  expect(closing()).toBe(false);
  expect(document.activeElement).toBe(q('Step'));
  expect(wb.toJSON()).toEqual(before);
  expect(toast).not.toHaveBeenCalled();
});

it('stops a series that cannot move towards its stop value instead of writing thousands of cells', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '5');
  const before = wb.toJSON();
  expect(wb.fillSeries(id, parseRange('A1'), { step: 0, stop: 10 })).toBe(0);
  expect(wb.fillSeries(id, parseRange('A1'), { type: 'growth', step: 1, stop: 100 })).toBe(0);
  expect(wb.fillSeries(id, parseRange('A1'), { type: 'date', step: 0, unit: 'month', stop: 50000 })).toBe(0);
  expect(wb.fillSeries(id, parseRange('A1'), { type: 'date', step: 0, unit: 'weekday', stop: 50000 })).toBe(0);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.sheet(id).rows).toBe(100);
  // A range bounds its own fill: a zero step still writes the constant into it.
  expect(wb.fillSeries(id, parseRange('A1:A3'), { step: 0 })).toBe(2);
  expect(wb.getValue(id, 2, 0)).toBe(5);
  // A moving series still runs to its stop value.
  expect(wb.fillSeries(id, parseRange('B1:B1'), { step: 2, stop: 9 })).toBe(0);
  wb.setInput(id, 0, 1, '1');
  expect(wb.fillSeries(id, parseRange('B1'), { step: 2, stop: 9 })).toBe(4);
});
