// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { openSortDialog } from '../src/ui/sortdialog.js';
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

// Every level has a Remove button, so a dialog with none is reachable; Sort then did nothing at all.
it('asks for a level when Sort is pressed with every level removed, then sorts once one is added', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['3', '1', '2'].forEach((v, r) => wb.setInput(id, r, 0, v));
  wb.clearHistory();
  const grid = { focus: vi.fn() };
  const { panel } = openSortDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), grid }, parseRange('A1:A3'));
  panel.querySelector('[aria-label="Remove this level"]').click();
  expect(panel.querySelectorAll('.sort-level')).toHaveLength(0);
  panel.querySelector('form').requestSubmit();
  expect(toast).toHaveBeenCalledWith('Add a level to sort by', expect.objectContaining({ icon: 'info' }));
  expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/^Sorted/));
  expect(panel.closest('.modal-root').classList.contains('closing')).toBe(false);
  expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual([3, 1, 2]);
  expect(wb.canUndo()).toBe(false);
  [...panel.querySelectorAll('button')].find((b) => b.textContent.includes('Add another level')).click();
  panel.querySelector('form').requestSubmit();
  expect(toast).toHaveBeenCalledWith('Sorted A1:A3');
  expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual([1, 2, 3]);
});
