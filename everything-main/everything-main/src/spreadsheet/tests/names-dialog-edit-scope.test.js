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

// Editing a name's spelling together with its scope went through a "Move name" (define the new,
// delete the old) that rewrote no formula, so every =SUM(Sales) became #NAME? under a "Saved Revenue"
// toast; a scope-only move likewise cut off the formulas on the other sheets without a word. An
// edited name now keeps its scope: the Scope field is disabled while editing,
// and a new spelling is a rename that every formula follows.
function setup() {
  const wb = new Workbook({ sheets: [{ name: 'Sheet1' }, { name: 'Other' }] });
  const home = wb.activeSheetId;
  const other = wb.sheetByName('Other').id;
  [10, 20, 30].forEach((v, i) => wb.setInput(home, 1 + i, 1, String(v)));
  expect(wb.defineName('Sales', 'Sheet1!$B$2:$B$4')).toBeNull();
  wb.setInput(home, 5, 0, '=SUM(Sales)');
  wb.setInput(other, 0, 0, '=SUM(Sales)');
  wb.clearHistory();
  openNamesManager({ wb, sheetId: () => home, grid: { range: { r1: 0, c1: 0, r2: 0, c2: 0 }, focus: vi.fn() }, run: vi.fn() });
  const field = (label) => document.querySelector(`.modal-root [aria-label="${label}"]`);
  const submit = () => document.querySelector('.modal-root form.names-form').requestSubmit();
  const hint = () => [...document.querySelectorAll('.modal-root .field-hint')].find((n) => /Kept while editing/.test(n.textContent));
  return { wb, home, other, field, submit, hint };
}

it('disables Scope while a name is edited, and a new spelling renames the name everywhere in its own scope', () => {
  const { wb, home, other, field, submit, hint } = setup();
  document.querySelector('.modal-root [aria-label="Edit Sales"]').click();
  expect(field('Scope').disabled).toBe(true);
  expect(field('Scope').value).toBe('');
  expect(hint().hidden).toBe(false);
  field('Name').value = 'Revenue';
  submit();
  expect(wb.names).toEqual([{ name: 'Revenue', ref: 'Sheet1!$B$2:$B$4' }]);
  expect(wb.getCell(home, 5, 0).f).toBe('SUM(Revenue)');
  expect(wb.getCell(other, 0, 0).f).toBe('SUM(Revenue)');
  expect(wb.getValue(home, 5, 0)).toBe(60);
  expect(wb.getValue(other, 0, 0)).toBe(60);
  expect(wb.undoLabel()).toBe('Rename name');
  expect(toast).toHaveBeenCalledWith('Saved Revenue');
  // A fresh New Name dialog allows choosing another scope.
  document.querySelector('[aria-label="New name"]').click();
  expect(field('Scope').disabled).toBe(false);
  expect(hint().hidden).toBe(true);
});

it('keeps the edited name in its scope even when the disabled field is given another value', () => {
  const { wb, home, other, field, submit } = setup();
  document.querySelector('.modal-root [aria-label="Edit Sales"]').click();
  field('Scope').value = 'Sheet1';
  field('Name').value = 'Revenue';
  submit();
  expect(wb.names).toEqual([{ name: 'Revenue', ref: 'Sheet1!$B$2:$B$4' }]);
  expect(wb.getValue(other, 0, 0)).toBe(60);
  expect(wb.getValue(home, 5, 0)).toBe(60);
  expect(wb.undoLabels().includes('Move name')).toBe(false);
});

it('frees the Scope field again on Cancel edit, so a name for another scope is added beside the old one', () => {
  const { wb, field, submit } = setup();
  document.querySelector('.modal-root [aria-label="Edit Sales"]').click();
  expect(field('Scope').disabled).toBe(true);
  [...document.querySelectorAll('.modal-root button')].find((b) => b.textContent === 'New name instead').click();
  expect(field('Scope').disabled).toBe(false);
  field('Name').value = 'Sales';
  field('Refers to').value = 'Sheet1!$B$2:$B$3';
  field('Scope').value = 'Sheet1';
  submit();
  expect(wb.names).toEqual([{ name: 'Sales', ref: 'Sheet1!$B$2:$B$4' }, { name: 'Sales', ref: 'Sheet1!$B$2:$B$3', sheet: 'Sheet1' }]);
});
