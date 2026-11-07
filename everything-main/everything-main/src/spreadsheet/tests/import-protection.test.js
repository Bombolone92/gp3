// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { openImportPlacementDialog, placeImport } from '../src/ui/importdialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  toast.mockClear();
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  closeAllModals();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function pair() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Existing');
  const other = new Workbook();
  other.setInput(other.activeSheetId, 0, 0, 'First');
  other.setInput(other.activeSheetId, 1, 1, 'Last');
  return { wb, id, other };
}

describe('importing into protected cells', () => {
  it.each([
    ['cell', 'sheet'], ['append', 'sheet'],
    ['cell', 'range'], ['append', 'range'],
  ])('keeps the dialog open when %s placement is refused by %s protection', (mode, protection) => {
    const { wb, id, other } = pair();
    if (protection === 'sheet') wb.setSheetProtected(id, true);
    else wb.protectRange(id, parseRange('B3'), 'Reserved');
    wb.clearHistory();
    wb.markClean();
    const before = wb.toJSON();
    const events = [];
    wb.addEventListener('change', (e) => { if (e.detail.type === 'protected') events.push(e.detail); });
    const modal = openImportPlacementDialog({ wb, sheetId: () => id, active: () => ({ r: 1, c: 0 }), grid: { focus() {} } }, other, 'Import.xlsx');
    modal.panel.querySelector(`input[value="${mode}"]`).click();
    modal.panel.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(modal.panel.querySelector('[role="alert"]').hidden).toBe(false);
    expect(modal.panel.closest('.modal-root').classList.contains('closing')).toBe(false);
    expect(toast).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(wb.toJSON()).toEqual(before);
    expect(wb.dirty).toBe(false);
    expect(wb.canUndo()).toBe(false);
  });

  it('allows placement next to a protected range, with undo and redo', () => {
    const { wb, id, other } = pair();
    wb.protectRange(id, parseRange('C2:C3'), 'Reserved');
    wb.clearHistory();
    expect(placeImport(wb, id, other, { mode: 'append' })).toBe('Appended 2 rows after row 1');
    expect(wb.getValue(id, 1, 0)).toBe('First');
    expect(wb.getValue(id, 2, 1)).toBe('Last');
    wb.undo();
    expect(wb.getValue(id, 1, 0)).toBeNull();
    expect(wb.getValue(id, 0, 0)).toBe('Existing');
    wb.redo();
    expect(wb.getValue(id, 2, 1)).toBe('Last');
    expect(wb.protectedRangeAt(id, 1, 2)?.description).toBe('Reserved');
  });
});
