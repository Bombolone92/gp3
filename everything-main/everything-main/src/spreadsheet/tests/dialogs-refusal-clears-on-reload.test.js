// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
import { openValidationManager } from '../src/ui/validation.js';
import { openProtectedRanges } from '../src/ui/protect.js';
import { openNamesManager } from '../src/ui/names.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// A refusal's message, its aria-invalid mark and its aria-describedby link outlived the value they
// were about: loading a rule into the form, leaving an edit and changing the rule type all left a
// screen reader reporting a correct — sometimes hidden — field as invalid, reading a stale error.
const panel = () => [...document.querySelectorAll('.modal-root:not(.closing):not([inert]) .modal-panel')].at(-1);
const field = (label) => panel().querySelector(`[aria-label="${label}"]`);
const submit = () => { document.activeElement?.blur?.(); panel().querySelector('form').requestSubmit(); };
const choose = (label, v) => { field(label).value = v; field(label).dispatchEvent(new Event('change', { bubbles: true })); };
const visibleAlerts = () => [...panel().querySelectorAll('[role="alert"]')].filter((n) => !n.hidden).map((n) => n.textContent);
const marked = () => [...panel().querySelectorAll('[aria-invalid="true"]')].map((n) => n.getAttribute('aria-label'));
const described = () => [...panel().querySelectorAll('[aria-describedby]')].map((n) => n.getAttribute('aria-label'));

function expectSilent() {
  expect(visibleAlerts()).toEqual([]);
  expect(marked()).toEqual([]);
  expect(described()).toEqual([]);
}

function workbook() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['Item', 'Amount'], ['A', '10'], ['B', '20'], ['C', '30']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  return { wb, id };
}
const grid = () => ({ focus: vi.fn(), setSelection: vi.fn() });
const dataRange = { r1: 1, c1: 1, r2: 3, c2: 1 };

describe('Conditional formatting', () => {
  const open = (seed) => {
    const { wb, id } = workbook();
    if (seed) wb.addRule(id, { range: dataRange, type: 'gt', value: 10, style: { bg: '#fef3c7' } });
    openConditionalFormatting({ wb, sheetId: () => id, range: () => dataRange, grid: grid() });
    return { wb, id };
  };

  it('takes the refusal off when a rule is loaded into the form', () => {
    open(true);
    submit();
    expect(visibleAlerts()).toEqual(['Enter a value']);
    expect(marked()).toEqual(['Value']);
    panel().querySelector('.names-main').click();
    expect(field('Value').value).toBe('10');
    expectSilent();
  });

  it('takes the refusal off when the edit is left', () => {
    open(true);
    panel().querySelector('.names-main').click();
    field('Value').value = '';
    submit();
    expect(visibleAlerts()).toEqual(['Enter a value']);
    [...panel().querySelectorAll('button')].find((b) => b.textContent === 'Cancel edit').click();
    expectSilent();
  });

  it('takes the refusal off when the condition changes, rather than blaming a hidden field', () => {
    open(false);
    choose('Condition', 'icons');
    field('Low threshold percent').value = '';
    submit();
    expect(visibleAlerts()).toEqual(['Enter both thresholds']);
    expect(marked()).toEqual(['Low threshold percent']);
    choose('Condition', 'gt');
    expectSilent();
  });
});

describe('Data validation', () => {
  const open = (seed) => {
    const { wb, id } = workbook();
    if (seed) wb.addValidation(id, { range: dataRange, type: 'list', source: 'a, b' });
    openValidationManager({ wb, sheetId: () => id, range: () => dataRange, grid: grid() });
    return { wb, id };
  };

  it('takes the refusal off when a rule is loaded into the form', () => {
    open(true);
    submit();
    expect(visibleAlerts()).toEqual(['Enter the list options']);
    expect(marked()).toEqual(['List options']);
    panel().querySelector('.names-main').click();
    expect(field('List options').value).toBe('a, b');
    expectSilent();
  });

  it('takes the refusal off when the type changes, rather than blaming a hidden field', () => {
    open(false);
    submit();
    expect(visibleAlerts()).toEqual(['Enter the list options']);
    choose('Type', 'checkbox');
    expectSilent();
  });
});

describe('Protected ranges', () => {
  it('takes the refusal off when a range is loaded into the form', () => {
    const { wb, id } = workbook();
    wb.protectRange(id, { r1: 0, c1: 3, r2: 4, c2: 3 }, '');
    openProtectedRanges({ wb, sheetId: () => id, range: () => dataRange, grid: grid() });
    field('Range').value = 'nope';
    submit();
    expect(visibleAlerts()).toEqual(['Enter a range like B2:D9']);
    expect(marked()).toEqual(['Range']);
    panel().querySelector('.names-main').click();
    expect(field('Range').value).toBe('D1:D5');
    expectSilent();
  });
});

describe('Named ranges', () => {
  it('takes the refusal off when a name is loaded into the form to edit', () => {
    const { wb, id } = workbook();
    wb.defineName('Sales', 'Sheet1!$B$2:$B$4', null);
    openNamesManager({ wb, sheetId: () => id, grid: { ...grid(), range: dataRange }, run: vi.fn() });
    document.querySelector('[aria-label="New name"]').click();
    field('Name').value = 'Sales';
    submit();
    expect(visibleAlerts()).toEqual(['That name is already used. Edit it from the list to change what it refers to']);
    expect(marked()).toEqual(['Name']);
    [...panel().querySelectorAll('button')].find(b => b.textContent === 'Cancel').click();
    document.querySelector('[aria-label="Edit Sales"]').click();
    expect(field('Name').value).toBe('Sales');
    expectSilent();
  });
});
