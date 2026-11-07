// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openSubtotalDialog } from '../src/ui/subtotaldialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
  toast.mockClear();
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// Add subtotals on a protected sheet closed the dialog saying "Nothing to subtotal there", as if
// the data were at fault; Remove subtotals, like every other tool, names the protection.
it.each([true, false])('says the sheet is protected instead of reporting nothing to subtotal (sort first: %s)', (sort) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['Cat', 'Amt'], ['a', '1'], ['a', '2'], ['b', '3']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  wb.setSheetProtected(id, true);
  wb.clearHistory();
  const before = wb.toJSON();
  const grid = { focus: vi.fn(), setSelection: vi.fn() };
  const modal = openSubtotalDialog({ wb, sheetId: () => id, grid }, { r1: 0, c1: 0, r2: 3, c2: 1 });
  const sortBox = [...modal.panel.querySelectorAll('label')].find((label) => label.textContent.includes('Sort by that column')).querySelector('input');
  sortBox.checked = sort;
  modal.panel.querySelector('form').requestSubmit();
  expect(toast).toHaveBeenCalledWith('This sheet is protected. Unprotect it to add subtotals', expect.objectContaining({ icon: 'lock' }));
  expect(toast).not.toHaveBeenCalledWith('Nothing to subtotal there', expect.anything());
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  expect(grid.setSelection).not.toHaveBeenCalled();
  // The dialog stays for the user to unprotect and try again, as the other refusals leave it.
  expect(modal.panel.closest('.modal-root').classList.contains('closing')).toBe(false);
  wb.setSheetProtected(id, false);
  modal.panel.querySelector('form').requestSubmit();
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Subtotals added to/), expect.objectContaining({ icon: 'sigma' }));
  expect(String(wb.getValue(id, 3, 0))).toMatch(/Total/);
});
