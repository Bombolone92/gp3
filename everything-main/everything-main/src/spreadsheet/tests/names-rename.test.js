// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openNamesManager } from '../src/ui/names.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => { vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { closeAllModals(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe('renaming a defined name', () => {
  it('renames it and every formula that uses it, in one undo step', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const sheetName = wb.sheet(id).name;
    wb.setInput(id, 0, 0, '5');
    expect(wb.defineName('Sales', `${sheetName}!$A$1`)).toBeNull();
    wb.setInput(id, 1, 0, '=Sales*2');
    wb.setInput(id, 2, 0, '=SUM(Sales, sales)');
    expect(wb.renameName('Sales', null, 'Revenue', `${sheetName}!$A$1`)).toBeNull();
    expect(wb.names.map((n) => n.name)).toEqual(['Revenue']);
    expect(wb.getCell(id, 1, 0).f).toBe('Revenue*2');
    expect(wb.getCell(id, 2, 0).f).toBe('SUM(Revenue, Revenue)');
    expect(wb.getValue(id, 1, 0)).toBe(10);
    expect(wb.undoLabel()).toBe('Rename name');
    wb.undo();
    expect(wb.names.map((n) => n.name)).toEqual(['Sales']);
    expect(wb.getCell(id, 1, 0).f).toBe('Sales*2');
    expect(wb.getValue(id, 1, 0)).toBe(10);
  });

  it('leaves a sheet-scoped name of the same spelling alone', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const first = wb.sheet(id).name;
    const other = wb.addSheet().id;
    const second = wb.sheet(other).name;
    expect(wb.defineName('Total', `${first}!$A$1`)).toBeNull();
    expect(wb.defineName('Total', `${second}!$B$2`, second)).toBeNull();
    wb.setInput(id, 0, 1, '=Total');
    wb.setInput(other, 0, 1, '=Total');
    wb.setInput(other, 0, 2, `=${first}!Total`);
    expect(wb.renameName('Total', null, 'Grand', `${first}!$A$1`)).toBeNull();
    expect(wb.getCell(id, 0, 1).f).toBe('Grand');
    expect(wb.getCell(other, 0, 1).f).toBe('Total'); // reaches the sheet's own Total
    expect(wb.getCell(other, 0, 2).f).toBe(`${first}!Grand`);
  });

  it('refuses a spelling already in use', () => {
    const wb = new Workbook();
    const sheetName = wb.sheet(wb.activeSheetId).name;
    wb.defineName('A_One', `${sheetName}!$A$1`);
    wb.defineName('B_Two', `${sheetName}!$B$1`);
    expect(wb.renameName('A_One', null, 'b_two', `${sheetName}!$A$1`)).toBe('That name is already used');
    expect(wb.names.map((n) => n.name)).toEqual(['A_One', 'B_Two']);
  });
});

describe('saving a name unchanged', () => {
  it('records no undo step', () => {
    const wb = new Workbook();
    const sheetName = wb.sheet(wb.activeSheetId).name;
    wb.defineName('Sales', `${sheetName}!$A$1`);
    expect(wb.defineName('Sales', `${sheetName}!$A$1`)).toBeNull();
    wb.undo();
    expect(wb.names).toHaveLength(0);
  });
});

describe('the names manager', () => {
  it('renames through the edit form instead of adding a duplicate', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const sheetName = wb.sheet(id).name;
    wb.defineName('Sales', `${sheetName}!$A$1`);
    wb.setInput(id, 1, 0, '=Sales');
    openNamesManager({ wb, run() {}, sheetId: () => id, grid: { range: { r1: 0, c1: 0, r2: 0, c2: 0 } } });
    document.querySelector('[aria-label="Edit Sales"]').click();
    const nameInput = document.querySelector('[aria-label="Name"]');
    expect(document.querySelector('button[type="submit"]').textContent).toBe('Save changes');
    nameInput.value = 'Revenue';
    document.querySelector('form.names-form').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(wb.names.map((n) => n.name)).toEqual(['Revenue']);
    expect(wb.getCell(id, 1, 0).f).toBe('Revenue');
    expect(document.querySelector('button[type="submit"]').textContent).toBe('Save name');
  });
});
