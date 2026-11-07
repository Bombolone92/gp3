// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { openSortDialog, rearrangeProblem } from '../src/ui/sortdialog.js';
import { openDedupeDialog } from '../src/ui/dedupedialog.js';
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

function book(rows) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: v == null ? null : { v } }))));
  return { wb, id };
}
const ctx = (wb, id) => ({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), grid: { focus() {}, setSelection() {} } });

describe('a sort or duplicate removal the workbook refuses', () => {
  it('is reported by the workbook as a refusal, distinct from a sort or removal that changed nothing', () => {
    const merged = book([[3], [1], [2]]);
    merged.wb.mergeCells(merged.id, parseRange('A1:A2'));
    const before = merged.wb.toJSON();
    merged.wb.clearHistory();
    expect(merged.wb.sortRangeBy(merged.id, parseRange('A1:A3'), [{ col: 0, ascending: true }])).toBe(false);
    expect(merged.wb.toJSON()).toEqual(before);
    expect(merged.wb.canUndo()).toBe(false);
    expect(merged.wb.rearrangeBlocker(merged.id, parseRange('A1:A3'))).toBe('merged');
    const plain = book([[3], [1], [2]]);
    expect(plain.wb.rearrangeBlocker(plain.id, parseRange('A1:A3'))).toBeNull();
    expect(plain.wb.sortRangeBy(plain.id, parseRange('A1:A3'), [{ col: 0, ascending: true }])).toBe(true);
    expect([0, 1, 2].map((r) => plain.wb.getValue(plain.id, r, 0))).toEqual([1, 2, 3]);
    const locked = book([[1], [1], [2]]);
    locked.wb.protectRange(locked.id, parseRange('A3'));
    const untouched = locked.wb.toJSON();
    locked.wb.clearHistory();
    expect(locked.wb.rearrangeBlocker(locked.id, parseRange('A1:A3'))).toBe('protected');
    expect(locked.wb.removeDuplicates(locked.id, parseRange('A1:A3'))).toBe(false);
    expect(locked.wb.toJSON()).toEqual(untouched);
    expect(locked.wb.canUndo()).toBe(false);
    expect(plain.wb.removeDuplicates(plain.id, parseRange('A1:A3'))).toBe(0);
    const spilled = book([[3, 1, 2]]);
    spilled.wb.setInput(spilled.id, 1, 0, '=SEQUENCE(1,3)');
    expect(spilled.wb.rearrangeBlocker(spilled.id, parseRange('A1:C2'), 'col')).toBe('array');
    expect(rearrangeProblem(spilled.wb, spilled.id, parseRange('A1:C2'), 'col')).toBe("Can't sort: the range has an array result");
  });

  it('makes the sort dialog say why instead of announcing a sort, and leaves no undo step', () => {
    const { wb, id } = book([[3, 'c'], [1, 'a'], [2, 'b']]);
    wb.mergeCells(id, parseRange('A1:B1'));
    wb.clearHistory();
    const before = wb.toJSON();
    const modal = openSortDialog(ctx(wb, id), parseRange('A1:B3'));
    modal.panel.querySelector('input[type="checkbox"]').checked = false;
    modal.panel.querySelector('form').requestSubmit();
    expect(toast).toHaveBeenCalledWith("Can't sort: the range has merged cells", expect.objectContaining({ icon: 'info' }));
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/^Sorted/));
    expect(wb.toJSON()).toEqual(before);
    expect(wb.canUndo()).toBe(false);
    expect(document.querySelector('.modal-panel')).not.toBeNull();
  });

  it('names protected cells when a protected range sits inside the sorted rows', () => {
    const { wb, id } = book([['H'], [3], [1], [2]]);
    wb.protectRange(id, parseRange('A3'));
    const modal = openSortDialog(ctx(wb, id), parseRange('A1:A4'));
    modal.panel.querySelector('form').requestSubmit();
    expect(toast).toHaveBeenCalledWith("Can't sort: the range has protected cells", expect.objectContaining({ icon: 'info' }));
    expect([1, 2, 3].map((r) => wb.getValue(id, r, 0))).toEqual([3, 1, 2]);
  });

  it('makes the duplicates dialog say why instead of counting rows it did not remove', () => {
    const { wb, id } = book([['H'], [1], [1], [2]]);
    wb.protectRange(id, parseRange('A4'));
    wb.clearHistory();
    const before = wb.toJSON();
    openDedupeDialog(ctx(wb, id), parseRange('A1:A4'));
    document.querySelector('.modal-panel form').requestSubmit();
    expect(toast).toHaveBeenCalledWith("Can't remove duplicates: the range has protected cells", expect.objectContaining({ icon: 'info' }));
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/^Removed|^No duplicate/), expect.anything());
    expect(wb.toJSON()).toEqual(before);
    expect(wb.canUndo()).toBe(false);
  });

  it('still removes duplicates and reports the count when nothing blocks it', () => {
    const { wb, id } = book([['H'], [1], [1], [2]]);
    openDedupeDialog(ctx(wb, id), parseRange('A1:A4'));
    document.querySelector('.modal-panel form').requestSubmit();
    expect(toast).toHaveBeenCalledWith('Removed 1 duplicate row', expect.objectContaining({ icon: 'dedupe' }));
    expect([1, 2, 3].map((r) => wb.getValue(id, r, 0))).toEqual([1, 2, null]);
  });
});
