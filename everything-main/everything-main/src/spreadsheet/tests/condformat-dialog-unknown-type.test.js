// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
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

// A file saved elsewhere carried a rule of a kind this build has no form for; clicking its row
// threw on the missing kind's arguments, and every Save after that threw the same way.
it('lists a rule of an unknown kind as a row to delete or move, and keeps the form working', () => {
  const json = new Workbook().toJSON();
  json.sheets[0].rules = [
    { id: 'x1', type: 'aboveAverage', range: { r1: 0, c1: 0, r2: 4, c2: 0 }, style: { bg: '#fef3c7' } },
    { id: 'x2', type: 'gt', value: 5, range: { r1: 0, c1: 1, r2: 4, c2: 1 }, style: { bg: '#fde8e8' } },
  ];
  const wb = new Workbook(json);
  const id = wb.activeSheetId;
  const { panel } = openConditionalFormatting({ wb, sheetId: () => id, range: () => ({ r1: 0, c1: 2, r2: 4, c2: 2 }), grid: { focus: vi.fn() } });
  const row = panel.querySelector('.names-row');
  expect(row.textContent).toContain('aboveAverage');
  const main = row.querySelector('.names-main');
  expect(main.disabled).toBe(true);
  expect(() => main.click()).not.toThrow();
  expect(panel.querySelector('[aria-label="Condition"]').value).toBe('gt');

  panel.querySelector('[aria-label="Value"]').value = '3';
  expect(() => panel.querySelector('form').requestSubmit()).not.toThrow();
  expect(wb.sheet(id).rules.map((rule) => rule.type)).toEqual(['aboveAverage', 'gt', 'gt']);
  expect(panel.querySelector('.field-error').hidden).toBe(true);

  panel.querySelector('[aria-label="Move the rule for A1:A5 down"]').click();
  expect(wb.sheet(id).rules.map((rule) => rule.id)).toEqual(['x2', 'x1', wb.sheet(id).rules[2].id]);
  panel.querySelector('[aria-label="Delete rule for A1:A5"]').click();
  expect(wb.sheet(id).rules.map((rule) => rule.type)).toEqual(['gt', 'gt']);
});
