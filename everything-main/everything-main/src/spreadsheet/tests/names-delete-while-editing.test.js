// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openNamesManager } from '../src/ui/names.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function setup() {
  const wb = new Workbook({ sheets: [{ name: 'One' }, { name: 'Two' }], names: [
    { name: 'Rate', ref: '10' }, { name: 'Rate', ref: '20', sheet: 'Two' }, { name: 'Tax', ref: '0.2' },
  ] });
  openNamesManager({ wb, sheetId: () => wb.activeSheetId, grid: { range: { r1: 0, c1: 0, r2: 0, c2: 0 } }, run: vi.fn() });
  const field = (label) => document.querySelector(`.modal-root [aria-label="${label}"]`);
  return { wb, field, save: () => document.querySelector('.modal-root button[type="submit"]') };
}

// Deleting the name being edited left the form promising to "Save changes" to a name that was gone.
it('starts a fresh name when the one being edited is deleted', () => {
  const { wb, field, save } = setup();
  document.querySelector('[aria-label="Edit Rate"]').click();
  expect(save().textContent).toBe('Save changes');
  document.querySelector('[aria-label="Delete Rate"]').click();
  expect(wb.names.map((n) => n.name)).toEqual(['Rate', 'Tax']);
  expect(save().textContent).toBe('Save name');
  expect(field('Name').value).toBe('');
  expect(field('Refers to').value).toBe('');
  field('Name').value = 'Fresh';
  field('Refers to').value = 'One!$A$1';
  document.querySelector('.modal-root form').requestSubmit();
  expect(document.querySelector('.modal-root .field-error').hidden).toBe(true);
  expect(wb.names.map((n) => n.name)).toEqual(['Fresh', 'Rate', 'Tax']);
});

it('keeps editing when a different name is deleted', () => {
  const { wb, field, save } = setup();
  document.querySelector('[aria-label="Edit Tax"]').click();
  document.querySelector('[aria-label="Delete Rate"]').click();
  expect(save().textContent).toBe('Save changes');
  expect(field('Name').value).toBe('Tax');
  field('Refers to').value = '0.25';
  document.querySelector('.modal-root form').requestSubmit();
  expect(wb.namedEntry('Tax').ref).toBe('0.25');
});

it('only stops editing for the definition with the same scope', () => {
  const { field, save } = setup();
  document.querySelector('[aria-label="Edit Two!Rate"]').click();
  document.querySelector('[aria-label="Delete Rate"]').click();
  expect(save().textContent).toBe('Save changes');
  expect(field('Scope').value).toBe('Two');
});
