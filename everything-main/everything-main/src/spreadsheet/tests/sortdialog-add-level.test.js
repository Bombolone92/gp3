// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { openSortDialog } from '../src/ui/sortdialog.js';
import { closeAllModals } from '../src/ui/modal.js';

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

// A new level took the column at the position of its own row, so after a level was removed the
// next one added doubled a column already sorted by.
it('gives a new sort level the first column no level uses yet', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) wb.setInput(id, r, c, String((r * 7 + c) % 5));
  const { panel } = openSortDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), grid: { focus: vi.fn() } }, parseRange('A1:C5'));
  const add = [...panel.querySelectorAll('button')].find((button) => button.textContent.includes('Add another level'));
  const keys = () => [...panel.querySelectorAll('[aria-label="Sort by column"]')].map((select) => select.value);
  expect(keys()).toEqual(['0']);
  add.click();
  expect(keys()).toEqual(['0', '1']);
  panel.querySelector('[aria-label="Remove this level"]').click();
  expect(keys()).toEqual(['1']);
  add.click();
  expect(keys()).toEqual(['1', '0']);
  const [first] = panel.querySelectorAll('[aria-label="Sort by column"]');
  first.value = '2';
  first.dispatchEvent(new Event('change'));
  add.click();
  expect(keys()).toEqual(['2', '0', '1']);
});
