// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openValidationManager } from '../src/ui/validation.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// The form left the browser to check its number and date fields, which are hidden for most types: a lone
// minus left in Minimum, then List chosen, made Add rule do nothing without a word, the browser having
// nowhere to show its bubble. A shown field holding what it cannot read was, for its part, taken as blank.
function open() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 2, c2: 0 };
  const { panel } = openValidationManager({ wb, sheetId: () => id, range: () => range });
  const field = (label) => panel.querySelector(`[aria-label="${label}"]`);
  const type = panel.querySelector('select');
  const choose = (value) => { type.value = value; type.dispatchEvent(new Event('change', { bubbles: true })); };
  const unreadable = (input) => Object.defineProperty(input, 'validity', { configurable: true, value: { badInput: true, valid: false } });
  return { wb, id, panel, field, choose, unreadable, submit: () => panel.querySelector('form').requestSubmit() };
}

it('checks the form itself, so a hidden field the browser cannot read does not block the save', () => {
  const { wb, id, panel, field, choose, unreadable, submit } = open();
  expect(panel.querySelector('form').noValidate).toBe(true);
  choose('number');
  unreadable(field('Minimum'));
  choose('list');
  field('List options').value = 'Yes, No';
  submit();
  expect(wb.sheet(id).validations).toHaveLength(1);
  expect(wb.sheet(id).validations[0].type).toBe('list');
});

it('refuses a shown number field it cannot read, instead of taking it as blank', () => {
  const { wb, id, panel, field, choose, unreadable, submit } = open();
  choose('number');
  unreadable(field('Minimum'));
  submit();
  expect(wb.sheet(id).validations).toHaveLength(0);
  expect(field('Minimum').getAttribute('aria-invalid')).toBe('true');
  expect(panel.querySelector('[role="alert"]').textContent).toBe('Enter a number, or leave it blank');
});
