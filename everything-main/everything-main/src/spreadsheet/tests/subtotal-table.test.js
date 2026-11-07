// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { addSubtotals } from '../src/core/subtotal.js';
import { openSubtotalDialog } from '../src/ui/subtotaldialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

// Subtotal rows added inside a table became its data rows, so SUM(Table[Col])
// counted every group total again and ROWS(Table) grew. Subtotals are now
// refused on a table, and the dialog says the way out.
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

function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['G', 'V'], ['a', 1], ['b', 2], ['a', 3], [null, null], ['G', 'V'], ['x', 5], ['y', 6]].flatMap((row, r) => row.map((v, c) => (v == null ? null : { r, c, cell: { v } }))).filter(Boolean));
  wb.addTable(id, parseRange('A1:B4'), { name: 'TT' });
  wb.setInput(id, 0, 5, '=SUM(TT[V])');
  wb.setInput(id, 0, 6, '=ROWS(TT)');
  wb.clearHistory();
  return { wb, id };
}
const ctx = (wb, id) => ({ wb, sheetId: () => id, grid: { focus() {}, setSelection() {} } });

describe('subtotals and tables', () => {
  it('are refused over a table, or a range sharing cells with one, and the table\'s references keep their values', () => {
    const { wb, id } = book();
    const before = JSON.stringify(wb.toJSON());
    expect(addSubtotals(wb, id, parseRange('A1:B4'), { groupCol: 0, code: 9, totalCols: [1] })).toBeNull();
    expect(addSubtotals(wb, id, parseRange('A3:B8'), { groupCol: 0, code: 9, totalCols: [1], header: false })).toBeNull();
    expect(JSON.stringify(wb.toJSON())).toBe(before);
    expect(wb.canUndo()).toBe(false);
    expect([wb.getValue(id, 0, 5), wb.getValue(id, 0, 6)]).toEqual([6, 3]);
    // A range beside the table is subtotalled as ever.
    expect(addSubtotals(wb, id, parseRange('A6:B8'), { groupCol: 0, code: 9, totalCols: [1] })).toEqual(parseRange('A6:B11'));
    expect(wb.getValue(id, 10, 1)).toBe(11);
    expect([wb.getValue(id, 0, 5), wb.getValue(id, 0, 6)]).toEqual([6, 3]);
  });

  it('the dialog says to convert the table to a range first instead of opening', () => {
    const { wb, id } = book();
    expect(openSubtotalDialog(ctx(wb, id), parseRange('A1:B4'))).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Convert the table to a range first/), expect.objectContaining({ icon: 'info' }));
    expect(document.querySelector('select[aria-label="At each change in"]')).toBeNull();
    expect(openSubtotalDialog(ctx(wb, id), parseRange('A6:B8'))).not.toBeNull();
    expect(document.querySelector('select[aria-label="At each change in"]')).not.toBeNull();
  });
});
