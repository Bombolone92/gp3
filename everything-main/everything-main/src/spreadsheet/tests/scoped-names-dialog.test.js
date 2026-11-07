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
  const wb = new Workbook({ sheets: [{ name: 'One' }, { name: 'Two Data' }], names: [
    { name: 'Rate', ref: '10' }, { name: 'Rate', ref: '20', sheet: 'Two Data' },
  ] });
  const run = vi.fn();
  openNamesManager({ wb, sheetId: () => wb.activeSheetId, grid: { range: { r1: 0, c1: 0, r2: 0, c2: 0 } }, run });
  return { wb, run };
}

it('labels duplicate names by scope and edits only the selected definition', () => {
  const { wb } = setup();
  expect([...document.querySelectorAll('.names-name')].map((el) => el.textContent)).toEqual(['Rate', "'Two Data'!Rate"]);
  document.querySelector('[aria-label="Edit \'Two Data\'!Rate"]').click();
  expect(document.querySelector('[aria-label="Scope"]').value).toBe('Two Data');
  document.querySelector('[aria-label="Refers to"]').value = '50';
  document.querySelector('form').requestSubmit();
  expect(wb.names).toEqual([{ name: 'Rate', ref: '10' }, { name: 'Rate', ref: '50', sheet: 'Two Data' }]);
  wb.undo(); expect(wb.namedEntry('Rate', 'Two Data').ref).toBe('20');
});

it('deletes only the selected local definition and preserves undo', () => {
  const { wb } = setup();
  document.querySelector('[aria-label="Delete \'Two Data\'!Rate"]').click();
  expect(wb.names).toEqual([{ name: 'Rate', ref: '10' }]);
  wb.undo(); expect(wb.namedEntry('Rate', 'Two Data').ref).toBe('20');
});

it('creates a name in the chosen sheet scope', () => {
  const { wb } = setup();
  document.querySelector('[aria-label="New name"]').click();
  document.querySelector('[aria-label="Name"]').value = 'Rate';
  document.querySelector('[aria-label="Refers to"]').value = '30';
  document.querySelector('[aria-label="Scope"]').value = 'One';
  document.querySelector('form').requestSubmit();
  expect(wb.namedEntry('Rate', 'One')).toEqual({ name: 'Rate', ref: '30', sheet: 'One' });
  expect(wb.namedEntry('Rate', null).ref).toBe('10');
});

it.each([0, 1])('navigates using the exact selected scope (row=%s)', (index) => {
  const { run } = setup();
  document.querySelectorAll('.names-main')[index].click();
  expect(run).toHaveBeenCalledWith('goToName', { name: 'Rate', sheet: index ? 'Two Data' : null });
});
