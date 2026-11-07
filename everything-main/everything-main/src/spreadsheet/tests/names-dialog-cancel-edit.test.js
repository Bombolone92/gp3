// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openNamesManager } from '../src/ui/names.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
  toast.mockClear();
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const sheetName = wb.sheet(id).name;
  wb.setInput(id, 0, 0, '5');
  expect(wb.defineName('Sales', `${sheetName}!$A$1`)).toBeNull();
  wb.setInput(id, 1, 0, '=Sales*2');
  wb.clearHistory();
  openNamesManager({ wb, sheetId: () => id, grid: { range: { r1: 0, c1: 1, r2: 0, c2: 1 }, focus: vi.fn() }, run: vi.fn() });
  const field = (label) => document.querySelector(`.modal-root [aria-label="${label}"]`);
  const buttons = () => [...document.querySelectorAll('.modal-root .names-form button')];
  const cancel = () => buttons().find((b) => b.textContent === 'New name instead');
  const save = () => document.querySelector('.modal-root button[type="submit"]');
  return { wb, id, sheetName, field, cancel, save, submit: () => document.querySelector('.modal-root form.names-form').requestSubmit() };
}

// Once the pencil was pressed, the only way out of editing was to empty the Name field; overtyping a
// different name renamed the existing one, rewriting its formulas, where a new name was meant.
it('offers a fresh-name action while editing, which drops the draft and goes back to adding', () => {
  const { wb, id, sheetName, field, cancel, save, submit } = setup();
  expect(document.querySelector('.names-form')).toBeNull();
  document.querySelector('.modal-root [aria-label="Edit Sales"]').click();
  expect(cancel().hidden).toBe(false);
  expect(save().textContent).toBe('Save changes');
  field('Name').value = 'Costs';
  field('Refers to').value = `${sheetName}!$B$1`;
  cancel().click();
  expect(cancel().hidden).toBe(true);
  expect(save().textContent).toBe('Save name');
  expect(field('Name').value).toBe('');
  expect(field('Refers to').value).toBe('');
  expect(document.activeElement).toBe(field('Name'));
  expect(wb.names).toEqual([{ name: 'Sales', ref: `${sheetName}!$A$1` }]);
  expect(wb.getCell(id, 1, 0).f).toBe('Sales*2');
  expect(wb.canUndo()).toBe(false);
  // The form now adds: the same typing makes a second name rather than renaming Sales.
  field('Name').value = 'Costs';
  field('Refers to').value = `${sheetName}!$B$1`;
  submit();
  expect(wb.names.map((n) => n.name)).toEqual(['Costs', 'Sales']);
  expect(wb.getCell(id, 1, 0).f).toBe('Sales*2');
  expect(toast).toHaveBeenCalledWith('Saved Costs');
});

it('hides the fresh-name action once the edit is saved or the name emptied', () => {
  const { field, cancel, save, submit } = setup();
  document.querySelector('.modal-root [aria-label="Edit Sales"]').click();
  field('Name').value = '';
  field('Name').dispatchEvent(new Event('input'));
  expect(cancel().hidden).toBe(true);
  expect(save().textContent).toBe('Save name');
  document.querySelector('.modal-root [aria-label="Edit Sales"]').click();
  expect(cancel().hidden).toBe(false);
  field('Refers to').value = '7';
  submit();
  expect(cancel().hidden).toBe(true);
  expect(save().textContent).toBe('Save name');
});
