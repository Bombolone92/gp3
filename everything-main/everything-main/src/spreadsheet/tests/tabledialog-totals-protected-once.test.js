// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openTableDialog } from '../src/ui/tabledialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
  toast.mockClear();
});
afterEach(() => { closeAllModals(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// Create table with a totals row over a protected range refused twice: the dialog's inline message,
// plus the editor's lock toast raised by the `protected` event that Workbook.lockedIn emits. The
// dialog now reads the sheet's protected ranges itself, as it does for the header row.
function setup(header) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Item', 'Amount'], ['A', 10], ['B', 20], ['C', 30]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  wb.protectRange(id, { r1: 4, c1: 0, r2: 4, c2: 1 }, 'locked');
  const announced = [];
  wb.addEventListener('change', (e) => { if (e.detail?.type === 'protected') announced.push(e.detail); });
  const modal = openTableDialog({ wb, sheetId: () => id, grid: { focus() {}, setSelection() {} } }, { range: { r1: 0, c1: 0, r2: 3, c2: 1 } });
  const check = (text) => [...modal.panel.querySelectorAll('label')].find((l) => l.textContent.includes(text)).querySelector('input');
  check('My data has a header').checked = header;
  check('Totals row').checked = true;
  const before = JSON.stringify(wb.toJSON());
  return { wb, id, modal, check, announced, before, alert: modal.panel.querySelector('[role="alert"]'), submit: () => modal.panel.querySelector('form').requestSubmit() };
}

it.each([true, false])('says once that the totals row is protected, without the workbook announcing it too (header row: %s)', (header) => {
  const { wb, id, check, announced, before, alert, submit } = setup(header);
  submit();
  expect(alert.hidden).toBe(false);
  expect(alert.textContent).toMatch(/totals row is protected/i);
  expect(announced).toEqual([]);
  expect(toast).not.toHaveBeenCalled();
  expect(wb.tablesOn(id)).toHaveLength(0);
  expect(JSON.stringify(wb.toJSON())).toBe(before);
  // Turning the totals row off, as the message suggests, creates the table.
  check('Totals row').checked = false;
  submit();
  expect(wb.tablesOn(id)).toHaveLength(1);
  expect(announced).toEqual([]);
});
