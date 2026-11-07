// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openNamesManager } from '../src/ui/names.js';
import { closeAllModals } from '../src/ui/modal.js';
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true })); document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
const top = () => document.querySelector('.modal-root:not(.closing):not([inert]) .modal-panel');
const field = label => top().querySelector(`[aria-label="${label}"]`);
const button = text => [...top().querySelectorAll('button')].find(b => b.textContent === text);
const key = (key, options = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
function open(names = [{ name: 'Rate', ref: '0.2' }, { name: 'Rate', ref: '0.3', sheet: 'Other Data' }]) {
  const wb = new Workbook({ sheets: [{ name: 'Data' }, { name: 'Other Data' }], names }), id = wb.activeSheetId, focus = vi.fn();
  wb.setInput(id, 0, 0, '=Rate*10'); wb.clearHistory();
  openNamesManager({ wb, sheetId: () => id, grid: { range: { r1: 1, c1: 2, r2: 3, c2: 2 }, focus }, run: vi.fn() });
  return { wb, id, focus, manager: top() };
}
it('opens New Name with the current selection and closes only the child on Cancel or Escape', () => {
  const { wb, manager, focus } = open(), before = wb.toJSON(), version = wb.version;
  expect(manager.querySelector('form')).toBeNull(); expect(document.activeElement).toBe(button('New name'));
  button('New name').click(); expect(top().getAttribute('aria-label')).toBe('New Name');
  expect(manager.closest('.modal-root').hasAttribute('inert')).toBe(true);
  expect(field('Refers to').value).toBe('Data!$C$2:$C$4'); expect(field('Scope').disabled).toBe(false);
  expect(document.activeElement).toBe(field('Name')); expect(field('Name comment').disabled).toBe(true);
  expect(field('Choose a range (unavailable)').disabled).toBe(true);
  field('Name').value = 'Draft'; button('Cancel').click(); expect(top()).toBe(manager);
  expect(document.activeElement).toBe(button('New name')); expect(wb.toJSON()).toEqual(before); expect(wb.version).toBe(version);
  button('New name').click(); expect(field('Name').value).toBe('');
  key('Escape', { isComposing: true }); expect(top().getAttribute('aria-label')).toBe('New Name');
  key('Escape'); expect(top()).toBe(manager); expect(focus).not.toHaveBeenCalled();
  key('Escape'); expect(top()).toBeNull(); expect(focus).toHaveBeenCalledOnce(); expect(wb.canUndo()).toBe(false);
});
it('preserves a filtered, sorted later page on edit cancellation and save, with exact scope and Undo', () => {
  const names = Array.from({ length: 105 }, (_, i) => ({ name: `Name_${String(i).padStart(3, '0')}`, ref: String(i), sheet: 'Other Data' }));
  const { wb, manager } = open(names); field('Filter names').value = 'sheet'; field('Filter names').dispatchEvent(new Event('change'));
  field('Search names').value = 'Name_'; field('Search names').dispatchEvent(new Event('input'));
  field('Sort names by Name').click(); button('Next').click(); const summary = manager.querySelector('[role=status]').textContent;
  const edit = field("Edit 'Other Data'!Name_100"); edit.focus(); edit.click();
  expect(field('Scope').disabled).toBe(true); expect(field('Name').selectionStart).toBe(0); expect(field('Name').selectionEnd).toBe(8);
  field('Name').value = 'Draft'; button('Cancel').click(); expect(document.activeElement).toBe(edit);
  expect(manager.querySelector('[role=status]').textContent).toBe(summary); expect(wb.canUndo()).toBe(false);
  edit.click(); field('Name').value = 'Name_100_new'; field('Scope').value = 'Data'; top().querySelector('form').requestSubmit();
  expect(top()).toBe(manager); expect(wb.namedEntry('Name_100_new', 'Other Data').ref).toBe('100'); expect(wb.namedEntry('Name_100_new', 'Data')).toBeUndefined();
  expect(field('Filter names').value).toBe('sheet'); expect(field('Search names').value).toBe('Name_');
  expect(manager.querySelector('[role=status]').textContent).toBe(summary);
  expect(document.activeElement.getAttribute('aria-label')).toBe("Edit 'Other Data'!Name_100_new");
  wb.undo(); expect(wb.namedEntry('Name_100', 'Other Data').ref).toBe('100'); expect(wb.namedEntry('Name_100_new', 'Other Data')).toBeUndefined();
});
it('keeps invalid drafts in the child, clears errors for a fresh editor, and guards a closing form against repeat submission', () => {
  const { wb, manager } = open(); button('New name').click(); field('Name').value = 'rate'; field('Refers to').value = '9';
  top().querySelector('form').requestSubmit(); expect(field('Name').getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(field('Name')); expect(field('Refers to').value).toBe('9'); expect(wb.canUndo()).toBe(false);
  button('Cancel').click(); field('Edit Rate').click(); expect(field('Name').hasAttribute('aria-invalid')).toBe(false);
  field('Name').value = 'Revenue'; const form = top().querySelector('form'), name = field('Name'), ref = field('Refers to'); form.requestSubmit();
  expect(top()).toBe(manager); expect(wb.getCell(wb.activeSheetId, 0, 0).f).toBe('Revenue*10');
  name.value = 'Accidental'; ref.value = '99'; form.requestSubmit(); expect(wb.namedEntry('Accidental')).toBeUndefined();
  wb.undo(); expect(wb.getCell(wb.activeSheetId, 0, 0).f).toBe('Rate*10'); expect(wb.canUndo()).toBe(false);
});
it('traps Tab within the child while disabled controls and the parent remain out of the sequence', () => {
  const { manager } = open(); field('Edit Rate').click(); const panel = top();
  button('Save changes').focus(); key('Tab'); expect(document.activeElement).toBe(field('Close'));
  key('Tab', { shiftKey: true }); expect(document.activeElement).toBe(button('Save changes'));
  expect(manager.closest('.modal-root').hasAttribute('inert')).toBe(true); expect(panel.closest('.modal-root').hasAttribute('inert')).toBe(false);
});
it('focuses the child panel on phones and can close both dialogs without leaving the app inert', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false })); const { manager, focus } = open();
  button('New name').click(); expect(document.activeElement).toBe(top()); expect(document.activeElement).not.toBe(field('Name'));
  manager.querySelector('[aria-label=Close]').click(); expect(top()).toBeNull(); expect(document.getElementById('app').hasAttribute('inert')).toBe(false); expect(focus).toHaveBeenCalledOnce();
});
