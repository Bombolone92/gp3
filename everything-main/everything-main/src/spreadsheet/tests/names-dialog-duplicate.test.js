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

function setup(extra = []) {
  const wb = new Workbook({ sheets: [{ name: 'One' }, { name: 'Two' }] });
  const id = wb.activeSheetId;
  wb.setInput(id, 9, 3, '100');
  wb.setInput(id, 0, 1, '7');
  expect(wb.defineName('Total', 'One!$D$10')).toBeNull();
  expect(wb.defineName('Rate', 'One!$A$2', 'Two')).toBeNull();
  for (const [name, ref, sheet] of extra) expect(wb.defineName(name, ref, sheet)).toBeNull();
  wb.setInput(id, 0, 0, '=Total');
  wb.clearHistory();
  openNamesManager({ wb, sheetId: () => id, grid: { range: { r1: 0, c1: 1, r2: 0, c2: 1 }, focus: vi.fn() }, run: vi.fn() });
  document.querySelector('[aria-label="New name"]').click();
  const field = (label) => document.querySelector(`.modal-root [aria-label="${label}"]`);
  const submit = () => document.querySelector('.modal-root form.names-form').requestSubmit();
  const error = document.querySelector('.modal-root .field-error');
  return { wb, id, field, submit, error };
}

// "Save name" with the spelling of an existing name quietly redefined that name to the
// selected cell, so every formula using it changed value; the duplicate is now refused.
it('refuses to save a new name that is already used instead of redefining it', () => {
  const { wb, id, field, submit, error } = setup();
  expect(field('Refers to').value).toBe('One!$B$1');
  field('Name').value = 'total';
  submit();
  expect(error.hidden).toBe(false);
  expect(error.textContent).toMatch(/already used/i);
  expect(wb.names.find((n) => n.name === 'Total')).toEqual({ name: 'Total', ref: 'One!$D$10' });
  expect(wb.getValue(id, 0, 0)).toBe(100);
  expect(wb.canUndo()).toBe(false);
  expect(toast).not.toHaveBeenCalled();
  // The draft stays for correction; a fresh spelling saves.
  expect(field('Name').value).toBe('total');
  field('Name').value = 'Subtotal';
  submit();
  expect(error.hidden).toBe(true);
  expect(toast).toHaveBeenCalledWith('Saved Subtotal');
  expect(wb.names.map((n) => n.name)).toEqual(['Rate', 'Subtotal', 'Total']);
});

it('still lets the same spelling be a sheet-scoped name where none exists, and refuses one where it does', () => {
  const { wb, field, submit, error } = setup();
  field('Name').value = 'Rate';
  field('Refers to').value = 'One!$B$1';
  submit();
  expect(error.hidden).toBe(true);
  expect(wb.names.filter((n) => n.name === 'Rate')).toHaveLength(2);
  document.querySelector('[aria-label="New name"]').click();
  field('Name').value = 'RATE';
  field('Refers to').value = 'One!$C$1';
  field('Scope').value = 'Two';
  submit();
  expect(error.hidden).toBe(false);
  expect(error.textContent).toMatch(/already used/i);
  expect(wb.names.find((n) => n.sheet === 'Two')).toEqual({ name: 'Rate', ref: 'One!$A$2', sheet: 'Two' });
});

// An edited name keeps its scope (the Scope field is disabled while editing), so it can neither be
// moved onto the same spelling elsewhere nor overwrite that definition.
it('keeps an edited name in its own scope, leaving a same-spelled name of another scope alone', () => {
  const { wb, field, submit, error } = setup([['Rate', 'One!$B$1']]);
  document.querySelector('.modal-root [aria-label="Edit Rate"]').click();
  expect(field('Scope').value).toBe('');
  expect(field('Scope').disabled).toBe(true);
  field('Refers to').value = 'One!$C$1';
  submit();
  expect(error.hidden).toBe(true);
  const rates = wb.names.filter((n) => n.name === 'Rate');
  expect(rates).toHaveLength(2);
  expect(rates).toEqual(expect.arrayContaining([{ name: 'Rate', ref: 'One!$C$1' }, { name: 'Rate', ref: 'One!$A$2', sheet: 'Two' }]));
});

// The pencil is the one path that redefines a name, and it still does.
it('keeps redefining a name through its Edit button', () => {
  const { wb, id, field, submit, error } = setup();
  document.querySelector('.modal-root [aria-label="Edit Total"]').click();
  field('Refers to').value = 'One!$B$1';
  submit();
  expect(error.hidden).toBe(true);
  expect(wb.names.find((n) => n.name === 'Total').ref).toBe('One!$B$1');
  expect(wb.getValue(id, 0, 0)).toBe(7);
});
