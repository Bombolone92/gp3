// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openScrollDialog } from '../src/ui/scrolldialog.js';
import { openSlicerDialog } from '../src/ui/slicerdialog.js';

// Both dialogs appended fieldAlert()'s { alert, refuse, clear } object itself, which the page wrote out as the
// text "[object Object]", and set their message on that object, so a refused Save did nothing without a word.
beforeEach(() => { vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
const field = (label) => document.querySelector(`[aria-label="${label}"]`);
const submit = () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

it('says why the scroll bar dialog refused its values, on the field at fault', () => {
  const updateChart = vi.fn();
  const control = { id: 'c1', title: 'Scroll', linkRef: '', min: 0, max: 100, step: 1, page: 10, horizontal: false, print: true };
  openScrollDialog({ wb: { updateChart, rangeFromText: () => null }, sheetId: () => 's1', grid: { focus() {} } }, control);
  expect(document.body.textContent).not.toContain('[object Object]');
  const alert = document.querySelector('.field-error');
  expect(alert.hidden).toBe(true);
  field('Minimum').value = '50'; field('Maximum').value = '10';
  submit();
  expect(updateChart).not.toHaveBeenCalled();
  expect(alert.hidden).toBe(false);
  expect(alert.textContent).toBe('Maximum must be at least the minimum.');
  expect(field('Maximum').getAttribute('aria-invalid')).toBe('true');
  expect(field('Maximum').getAttribute('aria-describedby')).toBe(alert.id);
  expect(document.querySelector('.row.row-end button[type="submit"]').textContent).toBe('Save');
});

it('says why the slicer dialog refused its values, on the field at fault', () => {
  const updateChart = vi.fn();
  const control = { id: 'c1', title: 'Category', columnCount: 1, rowHeight: 9525 * 20, showCaption: true, lockedPosition: false, print: true, hideItemsWithNoData: false };
  openSlicerDialog({ wb: { updateChart }, sheetId: () => 's1', grid: { focus() {} } }, control);
  expect(document.body.textContent).not.toContain('[object Object]');
  field('Columns').value = '2.5';
  submit();
  const alert = document.querySelector('.field-error');
  expect(updateChart).not.toHaveBeenCalled();
  expect(alert.hidden).toBe(false);
  expect(alert.textContent).toBe('Enter a whole number of columns from 1 to 20,000.');
  expect(field('Columns').getAttribute('aria-invalid')).toBe('true');
});
