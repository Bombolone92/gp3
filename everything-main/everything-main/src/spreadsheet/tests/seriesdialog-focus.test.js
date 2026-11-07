// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openSeriesDialog } from '../src/ui/seriesdialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { parseRange } from '../src/core/cell.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
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
  return { panel, grid, closing: () => panel.closest('.modal-root').classList.contains('closing') };
}

it('returns focus to the grid when the dialog is cancelled or dismissed with Escape', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1');
  const first = open(wb, id, parseRange('A1:A3'));
  [...first.panel.querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();
  expect(first.closing()).toBe(true);
  expect(first.grid.focus).toHaveBeenCalledTimes(1);
  const second = open(wb, id, parseRange('A1:A3'));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(second.closing()).toBe(true);
  expect(second.grid.focus).toHaveBeenCalledTimes(1);
});
