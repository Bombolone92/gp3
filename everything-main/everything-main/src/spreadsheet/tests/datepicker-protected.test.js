// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { openDatePicker, partsToSerial } from '../src/ui/datepicker.js';
import { Workbook } from '../src/core/workbook.js';
import { closeMenu } from '../src/ui/menu.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
afterEach(() => { closeMenu(); document.body.replaceChildren(); vi.clearAllMocks(); });

// Picking a date on a protected cell was silently refused: the menu closed and nothing changed.
it('says the cell is protected instead of opening a picker whose choice would vanish', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: partsToSerial(2026, 3, 15), s: { fmt: 'date' } } }]);
  wb.protectRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 });
  const menu = openDatePicker({ wb, sheetId: () => id, grid: { focus() {}, cellRect: () => ({ left: 0, right: 100, top: 0, bottom: 26, width: 100, height: 26 }) } }, 0, 0);
  expect(menu).toBeNull();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/A1 is protected/), expect.objectContaining({ icon: 'lock' }));
  // An unprotected cell still gets its calendar.
  wb.setCells(id, [{ r: 1, c: 0, cell: { v: partsToSerial(2026, 3, 15), s: { fmt: 'date' } } }]);
  expect(openDatePicker({ wb, sheetId: () => id, grid: { focus() {}, cellRect: () => ({ left: 0, right: 100, top: 30, bottom: 56, width: 100, height: 26 }) } }, 1, 0)).toBeTruthy();
  expect(document.querySelectorAll('.dp-day')).toHaveLength(42);
});
