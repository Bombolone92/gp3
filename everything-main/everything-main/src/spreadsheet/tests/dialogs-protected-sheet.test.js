// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openDedupeDialog } from '../src/ui/dedupedialog.js';
import { openSeriesDialog } from '../src/ui/seriesdialog.js';
import { openSubtotalDialog } from '../src/ui/subtotaldialog.js';
import { addSubtotals, removeSubtotals } from '../src/core/subtotal.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true })); document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.replaceChildren(); });

function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (const [r, a, b] of [[0, 'Group', 'Amount'], [1, 'a', '1'], [2, 'a', '1'], [3, 'b', '2']]) { wb.setInput(id, r, 0, a); wb.setInput(id, r, 1, b); }
  return { wb, id };
}
const grid = () => ({ focus: vi.fn(), setSelection: vi.fn() });
const lockToast = () => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/protected/), expect.objectContaining({ icon: 'lock' }));

describe('data tools on a protected sheet', () => {
  it('remove duplicates says the sheet is protected instead of reporting no duplicates', () => {
    const { wb, id } = book();
    wb.setSheetProtected(id, true);
    const before = JSON.stringify(wb.toJSON());
    openDedupeDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), grid: grid() }, { r1: 0, c1: 0, r2: 3, c2: 1 });
    document.querySelector('.modal-root form').requestSubmit();
    lockToast();
    expect(toast).not.toHaveBeenCalledWith('No duplicate rows found', expect.anything());
    expect(JSON.stringify(wb.toJSON())).toBe(before);
  });

  it('fill series says the sheet is protected instead of "nothing to fill"', () => {
    const { wb, id } = book();
    wb.setSheetProtected(id, true);
    openSeriesDialog({ wb, sheetId: () => id, range: () => ({ r1: 1, c1: 1, r2: 3, c2: 1 }), grid: grid() });
    document.querySelector('.modal-root form').requestSubmit();
    lockToast();
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/Nothing to fill/), expect.anything());
  });

  it('remove subtotals says the sheet is protected instead of counting rows it did not remove', () => {
    const { wb, id } = book();
    const out = addSubtotals(wb, id, { r1: 0, c1: 0, r2: 3, c2: 1 }, { groupCol: 0, totalCols: [1] });
    expect(out).toBeTruthy();
    wb.setSheetProtected(id, true);
    const before = JSON.stringify(wb.toJSON());
    expect(removeSubtotals(wb, id, out)).toBe(0);
    openSubtotalDialog({ wb, sheetId: () => id, grid: grid() }, out);
    const remove = [...document.querySelectorAll('.modal-root button')].find((b) => /remove subtotals/i.test(b.textContent));
    expect(remove).toBeTruthy();
    remove.click();
    lockToast();
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/Removed \d+ subtotal/), expect.anything());
    expect(JSON.stringify(wb.toJSON())).toBe(before);
  });
});
