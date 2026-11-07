// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { openSortDialog } from '../src/ui/sortdialog.js';
import { openCopySheetDialog } from '../src/ui/copysheet.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';
import * as P from '../src/lib/puter.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  toast.mockClear();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(P, 'listFiles').mockResolvedValue([]);
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// Two refusals asked for something the control could not give: a fill colour from a select that was
// empty and disabled because the column has none, and a spreadsheet from a select disabled because
// there is none to copy into — where refuse()'s focus, and most screen readers, never arrive.
const panel = () => document.querySelector('.modal-panel');
const field = (label) => panel().querySelector(`[aria-label="${label}"]`);
const submit = () => panel().querySelector('form').requestSubmit();

describe('Sort range', () => {
  const open = (wb, id, range) => openSortDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), grid: { focus() {} } }, range);
  const orderBy = (value) => { field('Sort on').value = value.startsWith('color') ? 'color' : 'value'; field('Sort on').dispatchEvent(new Event('change')); field('Order').value = value; field('Order').dispatchEvent(new Event('change')); };

  it('names the column that has no fill colors, and puts the focus on the column to change', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    [['Item', 'Amount'], ['A', '10'], ['B', '20'], ['C', '30']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
    wb.clearHistory();
    open(wb, id, parseRange('A1:B4'));
    orderBy('colorTop');
    expect(field('Fill color').disabled).toBe(true);
    submit();
    expect(toast.mock.calls.map((c) => c[0])).toEqual(['Column A has no fill colors: sort by value, or pick a column that has some']);
    expect(document.activeElement).toBe(field('Sort by column'));
    expect(panel()).toBeTruthy(); // the dialog stays open on a refusal
    expect(wb.undoLabel()).toBeNull();
  });

  it('still sorts by a fill color the column does have', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    ['1', '2', '3'].forEach((v, r) => wb.setInput(id, r, 0, v));
    wb.applyStyle(id, parseRange('A3'), { bg: '#ff0000' });
    wb.clearHistory();
    open(wb, id, parseRange('A1:A3'));
    orderBy('colorTop');
    expect(field('Fill color').value).toBe('#ff0000');
    submit();
    expect(toast.mock.calls.map((c) => c[0])).toEqual(['Sorted A1:A3']);
    expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual([3, 1, 2]);
  });
});

describe('Copy sheet', () => {
  const open = () => {
    const wb = new Workbook({ sheets: [{ name: 'Budget' }] });
    openCopySheetDialog({ wb, sheetId: () => wb.activeSheetId, grid: { focus() {} }, run: vi.fn() }, wb.activeSheetId);
    return wb;
  };
  const existing = () => panel().querySelector('input[type="radio"][value="existing"]');
  const reason = () => panel().querySelector(`#${existing().getAttribute('aria-describedby')}`);

  it('turns "Existing spreadsheet" off, with the reason beside it, when there is nothing to copy into', async () => {
    open();
    await vi.advanceTimersByTimeAsync(1);
    expect(existing().disabled).toBe(true);
    expect(reason().hidden).toBe(false);
    expect(reason().textContent).toBe('There is no other spreadsheet in your Spreadsheets folder to copy into.');
    expect(existing().closest('label').classList.contains('is-disabled')).toBe(true);
    // Nothing is marked invalid: there is no refusal to make, and no disabled control to blame.
    expect(panel().querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });

  it('says so when the listing failed, rather than offering a choice that cannot be made', async () => {
    P.listFiles.mockRejectedValue(new Error('offline'));
    open();
    await vi.advanceTimersByTimeAsync(1);
    expect(existing().disabled).toBe(true);
    expect(reason().textContent).toBe('Your spreadsheets could not be listed. Choose Try again to look once more.');
  });

  it('leaves the choice open, and unexplained, when there is a spreadsheet to copy into', async () => {
    P.listFiles.mockResolvedValue([{ name: 'Other.xlsx', path: 'Spreadsheets/Other.xlsx' }]);
    open();
    await vi.advanceTimersByTimeAsync(1);
    expect(existing().disabled).toBe(false);
    expect(existing().hasAttribute('aria-describedby')).toBe(false);
    expect(panel().querySelector('.field-hint[hidden]')).toBeTruthy();
  });
});
