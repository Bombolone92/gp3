// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook, MAX_ROWS, MAX_COLS } from '../src/core/workbook.js';
import { MAX_ROW } from '../src/core/refs.js';
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

function open(wb, range) {
  const id = wb.activeSheetId;
  const modal = openTableDialog({ wb, sheetId: () => id, grid: { focus() {}, setSelection() {} } }, { range });
  const check = (text) => [...modal.panel.querySelectorAll('label')].find((label) => label.textContent.includes(text)).querySelector('input');
  return {
    id, modal,
    rangeInput: modal.panel.querySelector('[aria-label="Range"]'),
    alert: modal.panel.querySelector('[role="alert"]'),
    submit: () => modal.panel.querySelector('form').requestSubmit(),
    header: check('My data has a header'),
    totals: check('Totals row'),
    isOpen: () => !modal.panel.closest('.modal-root').classList.contains('closing'),
  };
}
const last = MAX_ROWS - 1;

// A totals row refused by the workbook then left the header row it had inserted behind.
it('refuses a totals row that would fall past the last row of the grid without inserting the header row first', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = last - 3; r <= last - 1; r++) { wb.setInput(id, r, 0, String(r)); wb.setInput(id, r, 1, String(r * 2)); }
  wb.clearHistory();
  const before = wb.toJSON();
  const { alert, submit, header, totals, isOpen } = open(wb, { r1: last - 3, c1: 0, r2: last - 1, c2: 1 });
  header.checked = false;
  totals.checked = true;
  submit();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.undoLabels()).toEqual([]);
  expect(wb.getValue(id, last - 3, 0)).toBe(last - 3);
  expect(wb.tablesOn(id)).toHaveLength(0);
  expect(isOpen()).toBe(true);
  expect(alert.hidden).toBe(false);
  expect(alert.textContent).toMatch(/within A1:XFD1048576/);
  expect(toast).not.toHaveBeenCalled();
  // Without the totals row the header fits on the last row of the grid, and the same draft creates the table.
  totals.checked = false;
  submit();
  expect(isOpen()).toBe(false);
  expect(wb.tablesOn(id)[0].range).toEqual({ r1: last - 3, c1: 0, r2: last, c2: 1 });
  expect(wb.undoLabels()).toEqual(['Create table']);
});

it.each([
  ['A1048575:B1048580', 'rows past the grid'],
  ['A1:XFE5', 'columns past the grid'],
])('refuses a typed range %s (%s) rather than creating a table where cells cannot be edited', (text) => {
  const wb = new Workbook();
  const { id, rangeInput, alert, submit, header, isOpen } = open(wb, { r1: 0, c1: 0, r2: 2, c2: 1 });
  header.checked = true;
  rangeInput.value = text;
  submit();
  expect(wb.tablesOn(id)).toHaveLength(0);
  expect(isOpen()).toBe(true);
  expect(alert.hidden).toBe(false);
  // Past the grid's limits an address is no address at all.
  expect(alert.textContent).toMatch(/Enter a range like/);
  expect(document.activeElement).toBe(rangeInput);
});

it('accepts a table that ends on the last row of the grid, and one at its last column', () => {
  const wb = new Workbook();
  const { id, rangeInput, submit, header, isOpen } = open(wb, { r1: 0, c1: 0, r2: 2, c2: 1 });
  header.checked = true;
  rangeInput.value = `A${last - 1}:B${last + 1}`;
  submit();
  expect(isOpen()).toBe(false);
  expect(wb.tablesOn(id)[0].range).toEqual({ r1: last - 2, c1: 0, r2: last, c2: 1 });
  const wide = new Workbook();
  const t = open(wide, { r1: 0, c1: MAX_COLS - 2, r2: 4, c2: MAX_COLS - 1 });
  t.header.checked = true;
  t.submit();
  expect(t.isOpen()).toBe(false);
  expect(wide.tablesOn(t.id)[0].range).toEqual({ r1: 0, c1: MAX_COLS - 2, r2: 4, c2: MAX_COLS - 1 });
});

// The header row is inserted inside the transaction; when the workbook refuses the insertion
// (content would leave the sheet), no table is made and nothing is left to undo.
it('leaves nothing behind when the header row cannot be inserted', () => {
  const wb = new Workbook({ sheets: [{ name: 'Edge', rows: MAX_ROW + 1 }] });
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1'); wb.setInput(id, 1, 0, '2');
  wb.setInput(id, MAX_ROW, 5, 'at the very last row');
  expect(wb.insertRows(id, 0, 1)).toBe(false);
  wb.clearHistory();
  const before = wb.toJSON();
  const { alert, submit, header, isOpen } = open(wb, { r1: 0, c1: 0, r2: 1, c2: 0 });
  header.checked = false;
  submit();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.undoLabels()).toEqual([]);
  expect(wb.tablesOn(id)).toHaveLength(0);
  expect(isOpen()).toBe(true);
  expect(alert.hidden).toBe(false);
  expect(alert.textContent).toMatch(/header row/i);
});
