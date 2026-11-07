// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openSeriesDialog } from '../src/ui/seriesdialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { ymdToSerial } from '../src/core/format.js';
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

it('reads the stop value of a date series as a typed date', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '2024-01-01');
  const { q, alert, closing, submit } = open(wb, id, parseRange('A1'));
  expect(q('Type').value).toBe('date');
  expect(q('Stop value').type).toBe('text');
  expect(q('Stop value').placeholder).toMatch(/\d{4}-\d{2}-\d{2}|date/i);
  q('Stop value').value = 'soon';
  submit();
  expect(alert().hidden).toBe(false);
  expect(alert().textContent).toMatch(/date/i);
  expect(closing()).toBe(false);
  q('Stop value').value = 'Jan 5, 2024';
  submit();
  expect(closing()).toBe(true);
  expect(wb.getValue(id, 4, 0)).toBe(ymdToSerial(2024, 1, 5));
  expect(wb.getValue(id, 5, 0)).toBeNull();
});

it('switches the stop value between a number and a date field with the series type', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1');
  const { q } = open(wb, id, parseRange('A1'));
  expect(q('Stop value').type).toBe('number');
  q('Type').value = 'date';
  q('Type').dispatchEvent(new Event('change'));
  expect(q('Stop value').type).toBe('text');
  q('Type').value = 'linear';
  q('Type').dispatchEvent(new Event('change'));
  expect(q('Stop value').type).toBe('number');
});
