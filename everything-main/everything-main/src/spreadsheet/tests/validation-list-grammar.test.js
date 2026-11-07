// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { splitList, joinList, listOptions, checkValue, describeValidation } from '../src/core/validation.js';
import { openValidationManager } from '../src/ui/validation.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  closeAllModals();
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('reads comma-separated options with double quotes around an option holding a comma', () => {
  expect(splitList('"New York, NY", Boston')).toEqual(['New York, NY', 'Boston']);
  expect(splitList(' "New York, NY" ,Boston, "Austin, TX"')).toEqual(['New York, NY', 'Boston', 'Austin, TX']);
  expect(splitList('"Say ""hi""", Plain')).toEqual(['Say "hi"', 'Plain']);
  expect(splitList('" East ", West')).toEqual([' East ', 'West']);
  expect(splitList('"Line\nBreak", d\ne')).toEqual(['Line\nBreak', 'd', 'e']);
  expect(splitList('5" screen, 6" screen')).toEqual(['5" screen', '6" screen']);
  expect(splitList(' Yes, No ,Maybe,,')).toEqual(['Yes', 'No', 'Maybe']);
  expect(splitList('"unterminated, x')).toEqual(['unterminated, x']);
  expect(splitList(['a', 1, true, null, ''])).toEqual(['a', '1', 'TRUE']);
});

it('writes options back with the same grammar, so they read in again unchanged', () => {
  const items = ['New York, NY', 'Boston', 'Say "hi"', ' East ', 'Line\nBreak', '42'];
  expect(joinList(items)).toBe('"New York, NY", Boston, "Say ""hi""", " East ", "Line\nBreak", 42');
  expect(splitList(joinList(items))).toEqual(items);
  expect(joinList(['Yes', 'No'])).toBe('Yes, No');
});

it('checks and describes a quoted literal list by its options', () => {
  const rule = { type: 'list', source: '"New York, NY", Boston' };
  expect(listOptions(rule)).toEqual(['New York, NY', 'Boston']);
  expect(checkValue(rule, 'New York, NY').ok).toBe(true);
  expect(checkValue(rule, 'New York').ok).toBe(false);
  expect(describeValidation(rule)).toBe('List: "New York, NY", Boston');
  expect(describeValidation({ type: 'list', source: 'a, b' })).toBe('List: a, b');
});

function manager(wb, id, range) {
  const { panel } = openValidationManager({ wb, sheetId: () => id, range: () => range });
  const source = panel.querySelector('[aria-label="List options"]');
  return { panel, source, hint: () => source.parentElement.querySelector('.field-hint').textContent, submit: () => panel.querySelector('form').requestSubmit() };
}

it('keeps a typed list with quoted options as one source whose options honour the quotes', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 3, c2: 0 };
  const { source, submit } = manager(wb, id, range);
  source.value = '"New York, NY", Boston';
  submit();
  const rule = wb.sheet(id).validations[0];
  expect(rule.source).toBe('"New York, NY", Boston');
  expect(wb.listOptionsFor(id, rule)).toEqual(['New York, NY', 'Boston']);
  expect(wb.validateInput(id, 0, 0, 'New York, NY').ok).toBe(true);
});

it('shows a generated list in the same grammar and keeps a quoted addition whole', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 0, c2: 0 };
  const literal = ['New York, NY', 'Boston', ' East ', 'Say "hi"', 42, true];
  wb.addValidation(id, { type: 'list', range, source: literal, strict: false });
  const { panel, source, hint, submit } = manager(wb, id, range);
  const typedHint = hint();
  panel.querySelector('.names-main').click();
  expect(source.value).toBe('"New York, NY", Boston, " East ", "Say ""hi""", 42, TRUE');
  expect(hint()).toBe(typedHint);
  expect(hint()).toMatch(/double quotes/i);
  source.value += ', "Austin, TX"';
  submit();
  expect(wb.sheet(id).validations[0].source).toEqual([...literal, 'Austin, TX']);
});
