// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openNamesManager } from '../src/ui/names.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => { vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); toast.mockClear(); });
afterEach(() => { closeAllModals(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function open() {
  const wb = new Workbook();
  const sheetName = wb.sheet(wb.activeSheetId).name;
  expect(wb.defineName('sales', `${sheetName}!$A$1`)).toBeNull();
  wb.clearHistory();
  openNamesManager({ wb, sheetId: () => wb.activeSheetId, grid: { range: { r1: 0, c1: 0, r2: 0, c2: 0 } }, run: vi.fn() });
  const field = (label) => document.querySelector(`[aria-label="${label}"]`);
  document.querySelector('[aria-label="Edit sales"]').click();
  const submit = () => document.querySelector('form.names-form').requestSubmit();
  const error = document.querySelector('.field-error');
  return { wb, sheetName, field, submit, error };
}

// The workbook takes a name's spelling as typed, so a rename that only changes
// its capitalisation is a save like any other, undoable and reported as such.
it('saves a new capitalisation of the name', () => {
  const { wb, field, submit, error } = open();
  field('Name').value = 'Sales';
  submit();
  expect(error.hidden).toBe(true);
  expect(toast).toHaveBeenCalledWith('Saved Sales');
  expect(wb.names.map((n) => n.name)).toEqual(['Sales']);
  expect(wb.canUndo()).toBe(true);
});

it('reports the new spelling when the reference changes under a new capitalisation', () => {
  const { wb, sheetName, field, submit, error } = open();
  field('Name').value = 'Sales';
  field('Refers to').value = `${sheetName}!$B$2`;
  submit();
  expect(error.hidden).toBe(true);
  expect(toast).toHaveBeenCalledWith('Saved Sales');
  expect(wb.names).toEqual([{ name: 'Sales', ref: `${sheetName}!$B$2` }]);
  expect(wb.canUndo()).toBe(true);
});

it('still reports a real rename as saved', () => {
  const { wb, field, submit } = open();
  field('Name').value = 'Revenue';
  submit();
  expect(toast).toHaveBeenCalledWith('Saved Revenue');
  expect(wb.names.map((n) => n.name)).toEqual(['Revenue']);
});
