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
  return { panel, grid, q, closing: () => panel.closest('.modal-root').classList.contains('closing'), submit: () => panel.querySelector('form').requestSubmit() };
}

it.each([
  ['a range', parseRange('A1:A4')],
  ['a single cell with a stop value', parseRange('A1')],
])('leaves the lock message to explain a fill into a protected cell from %s', (_, range) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1');
  wb.protectRange(id, parseRange('A3'), 'Keep');
  const refusals = [];
  wb.addEventListener('change', (e) => { if (e.detail?.type === 'protected') refusals.push(e.detail); });
  const before = wb.toJSON();
  const { q, closing, submit } = open(wb, id, range);
  q('Stop value').value = '10';
  submit();
  expect(refusals.length).toBeGreaterThan(0);
  expect(refusals[0].range).toEqual(parseRange('A3'));
  expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/Nothing to fill/), expect.anything());
  expect(wb.toJSON()).toEqual(before);
  expect(closing()).toBe(true);
});

it('still reports a series that ends before the next cell', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '20');
  const { q, submit } = open(wb, id, parseRange('A1'));
  q('Stop value').value = '10';
  submit();
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Nothing to fill/), expect.anything());
});
