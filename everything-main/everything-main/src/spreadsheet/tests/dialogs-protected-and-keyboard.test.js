// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openSortDialog } from '../src/ui/sortdialog.js';
import { addSubtotals } from '../src/core/subtotal.js';
import { openNamesManager } from '../src/ui/names.js';
import { openMenu, closeMenu } from '../src/ui/menu.js';
import { openAppMenu } from '../src/ui/appmenu.js';
import { findAll } from '../src/core/search.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeMenu(); closeAllModals(); vi.unstubAllGlobals(); });

const toasts = () => toast.mock.calls.map((c) => c[0]);

describe('protected sheets in dialogs', () => {
  it('sort dialog says the sheet is protected instead of "Sorted"', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    ['3', '1', '2'].forEach((v, r) => wb.setInput(id, r, 0, v));
    wb.setSheetProtected(id, true);
    const { panel } = openSortDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), grid: { focus() {} } }, { r1: 0, c1: 0, r2: 2, c2: 0 });
    panel.querySelector('form').requestSubmit();
    expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual([3, 1, 2]);
    expect(toasts().some((t) => /^Sorted/.test(t))).toBe(false);
    expect(toasts().some((t) => /protected/i.test(t))).toBe(true);
  });

  it('subtotals report nothing done on a protected sheet', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    [['Cat', 'Amt'], ['a', '1'], ['a', '2'], ['b', '3']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
    wb.setSheetProtected(id, true);
    const before = JSON.stringify(wb.toJSON());
    expect(addSubtotals(wb, id, { r1: 0, c1: 0, r2: 3, c2: 1 }, { groupCol: 0, totalCols: [1] })).toBeNull();
    expect(JSON.stringify(wb.toJSON())).toBe(before);
  });

  it('names manager refuses to convert a table on a protected sheet instead of claiming it did', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    [['Item', 'Qty'], ['a', '1']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
    wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 1 }, { name: 'Sales' });
    wb.setSheetProtected(id, true);
    openNamesManager({ wb, sheetId: () => id, range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), run() {}, grid: { range: { r1: 0, c1: 0, r2: 0, c2: 0 }, focus() {} } });
    document.querySelector('[aria-label="Convert Sales to a plain range"]').click();
    expect(wb.tablesOn(id)).toHaveLength(1);
    expect(toasts()).not.toContain('Sales is a plain range again');
    expect(toasts().some((t) => /protected/i.test(t))).toBe(true);
  });
});

describe('finding matches', () => {
  it('skips hidden and filtered-out rows and hidden columns', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'apple');
    wb.setInput(id, 1, 0, 'apple');
    wb.setInput(id, 2, 0, 'apple pie');
    wb.setInput(id, 3, 1, 'apple');
    wb.setHidden(id, 'row', [1], true);
    wb.setHidden(id, 'col', [1], true);
    wb.setFilterRange(id, { r1: 0, c1: 0, r2: 2, c2: 0 });
    wb.setFilterCriteria(id, 0, { values: ['apple'] });
    expect(findAll(wb, id, 'apple')).toEqual([{ r: 0, c: 0 }]);
  });
});

describe('menu keyboard paths', () => {
  it('reaches the last item with Up from a custom control', () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const custom = document.createElement('button');
    custom.textContent = 'Custom';
    openMenu({ anchor, items: [{ custom }, { label: 'Alpha', onSelect() {} }, { label: 'Beta', onSelect() {} }, { label: 'Gamma', onSelect() {} }] });
    custom.focus();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(document.activeElement.textContent).toBe('Gamma');
  });

  it('lets the arrow keys reach the theme switch in the account menu', () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    openAppMenu(anchor);
    let reached = false;
    for (let i = 0; i < 12 && !reached; i++) {
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      reached = document.activeElement.getAttribute('role') === 'radio';
    }
    expect(reached).toBe(true);
  });
});
