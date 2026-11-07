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
});
afterEach(() => {
  closeAllModals();
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

const ctx = (wb, id) => ({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), grid: { focus() {} } });

it('says there is nothing to sort under a lone header row instead of closing silently', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['Name', 'Qty'].forEach((v, c) => wb.setInput(id, 0, c, v));
  const modal = openSortDialog(ctx(wb, id), parseRange('A1:B1'));
  const header = modal.panel.querySelector('input[type="checkbox"]');
  header.checked = true;
  modal.panel.querySelector('form').requestSubmit();
  expect(toast).toHaveBeenCalledWith('Nothing to sort below the header row', expect.objectContaining({ icon: 'info' }));
  expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/^Sorted/));
  expect(document.querySelector('.modal-panel')).not.toBeNull();
  // Unticking the header sorts the row's cells as data.
  header.click();
  modal.panel.querySelector('form').requestSubmit();
  expect(toast).toHaveBeenCalledWith('Sorted A1:B1');
});

it('says the same for a lone header column when sorting columns', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['Name', 'Qty'].forEach((v, r) => wb.setInput(id, r, 0, v));
  const modal = openSortDialog(ctx(wb, id), parseRange('A1:A2'));
  const direction = modal.panel.querySelector('[aria-label="Sort direction"]');
  direction.value = 'cols';
  direction.dispatchEvent(new Event('change'));
  modal.panel.querySelector('input[type="checkbox"]').checked = true;
  modal.panel.querySelector('form').requestSubmit();
  expect(toast).toHaveBeenCalledWith('Nothing to sort right of the header column', expect.objectContaining({ icon: 'info' }));
  expect(document.querySelector('.modal-panel')).not.toBeNull();
});
