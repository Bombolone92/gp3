// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { addSubtotals } from '../src/core/subtotal.js';
import { openSubtotalDialog } from '../src/ui/subtotaldialog.js';
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

/** Two interleaved groups whose rows cannot be sorted because one row carries a merge across two columns. */
function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Group', 'Value', 'Note'], ['b', 1, 'first'], ['a', 2], ['b', 3], ['a', 4]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  wb.mergeCells(id, parseRange('C2:D2'));
  wb.clearHistory();
  return { wb, id };
}

describe('subtotals over rows the sort refuses', () => {
  it('are not added, since the groups could not be gathered', () => {
    const { wb, id } = setup();
    const before = wb.toJSON();
    expect(addSubtotals(wb, id, parseRange('A1:D5'), { groupCol: 0, totalCols: [1], header: true, sort: true })).toBeNull();
    expect(wb.toJSON()).toEqual(before);
    expect(wb.canUndo()).toBe(false);
    // Without the sort the rows are grouped as they lie.
    const out = addSubtotals(wb, id, parseRange('A1:D5'), { groupCol: 0, totalCols: [1], header: true, sort: false });
    expect(out).toEqual({ r1: 0, c1: 0, r2: 9, c2: 3 });
    expect(wb.getValue(id, 9, 1)).toBe(10);
  });

  it('make the dialog say why, and how to go on, instead of reporting subtotals', () => {
    const { wb, id } = setup();
    const before = wb.toJSON();
    openSubtotalDialog({ wb, sheetId: () => id, grid: { focus() {}, setSelection() {} } }, parseRange('A1:D5'));
    const panel = document.querySelector('.modal-panel');
    panel.querySelector('form').requestSubmit();
    expect(toast).toHaveBeenCalledWith("Can't sort: the range has merged cells. Turn off sorting to subtotal the rows as they are", expect.objectContaining({ icon: 'info' }));
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/Subtotals added|Nothing to subtotal/), expect.anything());
    expect(wb.toJSON()).toEqual(before);
    expect(document.querySelector('.modal-panel')).not.toBeNull();
    // Unticking the sort lets the subtotals go in.
    const sort = [...panel.querySelectorAll('input[type="checkbox"]')].find((i) => i.nextElementSibling?.textContent.startsWith('Sort by'));
    sort.click();
    panel.querySelector('form').requestSubmit();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Subtotals added/), expect.anything());
    expect(wb.getValue(id, 9, 1)).toBe(10);
  });
});
