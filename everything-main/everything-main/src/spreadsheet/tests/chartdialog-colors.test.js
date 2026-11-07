// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openChartDialog } from '../src/ui/chartdialog.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true })); document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// Every colour change rebuilt all the colour inputs, detaching the one being used: focus was
// lost and the browser's colour popup closed after a single step.
it('keeps the colour input being used in place while its value changes', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (const [r, a, b] of [[0, 'Sales', 'Costs'], [1, '10', '4'], [2, '12', '5']]) { wb.setInput(id, r, 0, a); wb.setInput(id, r, 1, b); }
  openChartDialog({ wb, sheetId: () => id, range: () => ({ r1: 0, c1: 0, r2: 2, c2: 1 }), grid: { focus: vi.fn(), selectChart: vi.fn() } }, {});
  vi.runAllTimers();
  const first = document.querySelector('input.chart-color-input');
  expect(first).toBeTruthy();
  first.focus();
  first.value = '#123456';
  first.dispatchEvent(new Event('input', { bubbles: true }));
  vi.runAllTimers();
  expect(first.isConnected).toBe(true);
  expect(document.querySelector('input.chart-color-input')).toBe(first);
  expect(document.activeElement).toBe(first);
  const reset = document.querySelector('.chart-colors-reset');
  expect(reset.hidden).toBe(false);
  expect([...document.querySelectorAll('.modal-root svg')].some((svg) => svg.outerHTML.includes('#123456'))).toBe(true);
  reset.click();
  vi.runAllTimers();
  expect(document.querySelector('.chart-colors-reset').hidden).toBe(true);
  expect(document.querySelector('input.chart-color-input').value).not.toBe('#123456');
});
