// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openNamesManager } from '../src/ui/names.js';
import { closeAllModals } from '../src/ui/modal.js';
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true })); document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
function open(wb = new Workbook({ sheets: [{ name: 'Data' }, { name: 'Other' }], names: [
  { name: 'Rate', ref: '0.2' }, { name: 'Rate', ref: '0.3', sheet: 'Other' }, { name: 'Units', ref: 'Data!$A$2:$A$4' }, { name: 'Private', ref: '99', hidden: true },
] })) {
  const id = wb.activeSheetId;
  ['Units', '3', '4', '5'].forEach((v, r) => wb.setInput(id, r, 0, v));
  wb.setInput(id, 0, 1, 'Echo'); wb.addTable(id, { r1: 0, c1: 0, r2: 3, c2: 1 }, { name: 'Sales', headers: true });
  wb.clearHistory(); const beforeReview = wb.toJSON(), versionBeforeReview = wb.version, run = vi.fn();
  openNamesManager({ wb, sheetId: () => id, grid: { range: { r1: 0, c1: 0, r2: 0, c2: 0 }, focus: vi.fn() }, run });
  const field = label => document.querySelector(`.modal-panel [aria-label="${label}"]`);
  const rows = () => [...document.querySelectorAll('.names-review-row')];
  const names = () => rows().map(r => r.querySelector('.names-name').textContent);
  const filter = value => { field('Filter names').value = value; field('Filter names').dispatchEvent(new Event('change')); };
  const search = value => { field('Search names').value = value; field('Search names').dispatchEvent(new Event('input')); };
  const button = label => [...document.querySelectorAll('.modal-panel button')].find(b => b.textContent === label);
  return { wb, id, run, field, rows, names, filter, search, button, beforeReview, versionBeforeReview };
}
it('reviews visible names and tables by scope with bounded range and constant previews', () => {
  const { wb, rows, names, beforeReview: before, versionBeforeReview: version } = open();
  expect(names()).toEqual(['Sales', 'Rate', 'Other!Rate', 'Units']);
  expect(rows().map(r => r.children[1].textContent)).toEqual(['{3; ; 4; ; 5; }', '0.2', '0.3', '{3; 4; 5}']);
  expect(rows()[0].children[2].textContent).toBe('Data!$A$2:$B$4');
  expect(rows().map(r => r.children[3].textContent)).toEqual(['Workbook', 'Workbook', 'Other', 'Workbook']);
  expect(wb.toJSON()).toEqual(before); expect(wb.version).toBe(version); expect(wb.canUndo()).toBe(false);
});
it('reviews table data without counting header or totals cells and handles an empty body', () => {
  const wb = new Workbook({ sheets: [{ name: 'Data' }] }), id = wb.activeSheetId;
  const empty = wb.addTable(id, { r1: 0, c1: 4, r2: 1, c2: 4 }, { name: 'Empty' });
  wb.deleteRows(id, 1, 1);
  wb.setInput(id, 0, 2, 'Amount'); wb.setInput(id, 1, 2, '42');
  wb.addTable(id, { r1: 0, c1: 2, r2: 1, c2: 2 }, { name: 'WithTotals', totalsRow: true });
  wb.setInput(id, 2, 2, '99');
  const { rows } = open(wb);
  const totals = rows().find(row => row.querySelector('.names-name').textContent === 'WithTotals');
  expect(totals.children[1].textContent).toBe('42'); expect(totals.children[2].textContent).toBe('Data!$C$2');
  const emptyRow = rows().find(row => row.querySelector('.names-name').textContent === 'Empty');
  expect(wb.tableById(id, empty).range.r2).toBe(0); expect(emptyRow.children[1].textContent).toBe('{}');
});
it('combines native scope/type filters with case-insensitive search and keeps exact scopes for navigation', () => {
  const { filter, search, names, run } = open(); filter('workbook'); expect(names()).toEqual(['Sales', 'Rate', 'Units']);
  filter('sheet'); expect(names()).toEqual(['Other!Rate']); document.querySelector('.names-main').click(); expect(run).toHaveBeenCalledWith('goToName', { name: 'Rate', sheet: 'Other' });
});
it('filters defined names, table names, references and scopes without exposing hidden helpers', () => {
  const { filter, search, names } = open(); filter('defined'); expect(names()).toEqual(['Rate', 'Other!Rate', 'Units']);
  search('DATA!'); expect(names()).toEqual(['Units']); search('private'); expect(names()).toEqual([]);
  search(''); filter('table'); expect(names()).toEqual(['Sales']); search('Data!'); expect(names()).toEqual(['Sales']);
});
it('sorts review columns in both directions without changing workbook order or an edit draft', () => {
  const { wb, field, names } = open(), before = wb.toJSON(); field('Edit Units').click(); field('Name').value = 'Draft';
  field('Sort names by Name').click(); expect(names()).toEqual(['Rate', 'Other!Rate', 'Sales', 'Units']);
  field('Sort names by Name').click(); expect(names()).toEqual(['Units', 'Sales', 'Rate', 'Other!Rate']);
  expect(document.querySelector('[data-sort="name"]').getAttribute('aria-sort')).toBe('descending');
  field('Sort names by Scope').click(); expect(names()[0]).toBe('Other!Rate'); expect(field('Name').value).toBe('Draft'); expect(field('Scope').disabled).toBe(true); expect(wb.toJSON()).toEqual(before);
});
it('preserves draft identity while filters hide its row, then performs the scoped rename with Undo', () => {
  const { wb, field, filter } = open(); field('Edit Other!Rate').click(); filter('table'); field('Name').value = 'LocalRate';
  document.querySelector('.names-form').requestSubmit(); expect(wb.namedEntry('LocalRate', 'Other').ref).toBe('0.3'); expect(wb.namedEntry('Rate', null).ref).toBe('0.2');
  wb.undo(); expect(wb.namedEntry('Rate', 'Other').ref).toBe('0.3');
});
it('restores action focus after filtered deletion and preserves the remaining scope', () => {
  const { wb, field, filter, names } = open(); filter('defined'); field('Delete Rate').click(); expect(names()).toEqual(['Other!Rate', 'Units']);
  expect(document.activeElement.getAttribute('aria-label')).toBe('Delete Other!Rate'); expect(wb.namedEntry('Rate', 'Other').ref).toBe('0.3'); wb.undo(); expect(wb.namedEntry('Rate', null).ref).toBe('0.2');
});
it('pages large lists, clamps the last page after deletion, and navigates across pages by keyboard', () => {
  const { field, rows, filter, button } = open(new Workbook({ names: Array.from({ length: 201 }, (_, i) => ({ name: `Name${String(i).padStart(3, '0')}`, ref: String(i) })) }));
  filter('defined'); expect(rows()).toHaveLength(100); button('Next').click(); expect(rows()).toHaveLength(100);
  document.querySelector('.names-main').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  expect(rows()).toHaveLength(1); expect(document.activeElement.textContent).toBe('Name200');
  field('Delete Name200').click(); expect(rows()).toHaveLength(100); expect(document.activeElement.getAttribute('aria-label')).toBe('Delete Name100');
  document.querySelector('.names-main').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
  expect(document.activeElement.textContent).toBe('Name000'); expect(button('Previous').disabled).toBe(true);
});
it('keeps keyboard composition and modified navigation intact', () => {
  const { filter } = open(); filter('defined'); const button = document.querySelector('.names-main'); button.focus();
  for (const extra of [{ isComposing: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) button.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true, ...extra }));
  expect(document.activeElement).toBe(button);
});
it('starts a fresh name explicitly and retains the old definition and history', () => {
  const { wb, field, button } = open(), before = wb.toJSON(); field('Edit Other!Rate').click(); field('Name').value = 'Draft'; button('New name').click();
  expect(field('Name').value).toBe(''); expect(field('Scope').disabled).toBe(false); expect(field('Refers to').value).toBe('Data!$A$1'); expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
});
it('does not evaluate arbitrary, relative or spill named formulas when reviewing them', () => {
  const wb = new Workbook({ names: [{ name: 'Remote', ref: 'WEBSERVICE("https://example.test/")' }, { name: 'Relative', ref: 'Sheet1!A1', relative: true }, { name: 'Spill', ref: 'Sheet1!A1#' }, { name: 'Error', ref: '#REF!' }, { name: 'Text', ref: '"<b>Literal</b>"' }] });
  const evaluate = vi.spyOn(wb, 'evalRuleFormula'), location = vi.spyOn(wb, 'namedLocation'); const { rows, filter } = open(wb); filter('defined');
  expect(evaluate).not.toHaveBeenCalled(); expect(location).not.toHaveBeenCalled();
  expect(rows().map(r => r.children[1].textContent)).toEqual(['—', '—', '—', '#REF!', '<b>Literal</b>']); expect(document.querySelector('.names-review b')).toBeNull();
  expect([...document.querySelectorAll('[aria-label="Filter names"] option:disabled')]).toHaveLength(2);
});
it('limits previews to six cells per rendered direct range instead of scanning whole columns', () => {
  const wb = new Workbook({ names: [{ name: 'Column', ref: 'Sheet1!$A:$A' }] }); const display = vi.spyOn(wb, 'getDisplay');
  const { filter, rows } = open(wb); display.mockClear(); filter('defined'); expect(display).toHaveBeenCalledTimes(6); expect(rows()[0].children[1].textContent).toContain('…');
});
