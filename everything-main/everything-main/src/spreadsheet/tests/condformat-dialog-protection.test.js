// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
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

it.each(['add', 'edit', 'delete', 'move'])('preserves the rule draft when protection blocks %s and permits retry', (action) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 1, c2: 0 };
  const first = wb.addRule(id, { range, type: 'gt', value: 1, style: {} });
  const second = wb.addRule(id, { range, type: 'lt', value: 2, style: {} });
  openConditionalFormatting({ wb, sheetId: () => id, range: () => range, grid: { focus: vi.fn() } });
  if (action !== 'add') document.querySelector('.names-main').click();
  const value = document.querySelector('[aria-label="Value"]');
  value.value = '42';
  const submit = document.querySelector('[type="submit"]');
  const label = submit.textContent;
  const act = () => {
    if (action === 'delete') document.querySelector('[aria-label="Delete rule for A1:A2"]').click();
    else if (action === 'move') document.querySelector('[aria-label="Move the rule for A1:A2 down"]').click();
    else document.querySelector('form').requestSubmit();
  };
  wb.setSheetProtected(id, true);
  const before = JSON.stringify(wb.sheet(id).rules);
  const version = wb.version;
  act();
  expect(JSON.stringify(wb.sheet(id).rules)).toBe(before);
  expect(wb.version).toBe(version);
  expect(value.value).toBe('42');
  expect(submit.textContent).toBe(label);
  const error = document.querySelector('.field-error');
  expect(error.hidden).toBe(false);
  expect(error.textContent).toMatch(/protected/i);
  expect(toast).not.toHaveBeenCalled();

  wb.setSheetProtected(id, false);
  act();
  expect(error.hidden).toBe(true);
  const rules = wb.sheet(id).rules;
  if (action === 'add') {
    expect(rules).toHaveLength(3);
    expect(rules[2].value).toBe(42);
    expect(toast).toHaveBeenCalledWith('Rule added');
  } else if (action === 'edit') {
    expect(rules[0].value).toBe(42);
    expect(toast).toHaveBeenCalledWith('Rule updated');
  } else if (action === 'delete') expect(rules.map((rule) => rule.id)).toEqual([second]);
  else expect(rules.map((rule) => rule.id)).toEqual([second, first]);
  wb.undo();
  expect(JSON.stringify(wb.sheet(id).rules)).toBe(before);
});

it('reports rejected rule mutations without returning a phantom ID or successful move', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const rule = { range: { r1: 0, c1: 0, r2: 1, c2: 0 }, type: 'gt', value: 1, style: {} };
  const first = wb.addRule(id, rule);
  wb.addRule(id, rule);
  wb.setSheetProtected(id, true);
  expect(wb.addRule(id, rule)).toBeNull();
  expect(wb.updateRule(id, first, { value: 42 })).toBe(false);
  expect(wb.deleteRule(id, first)).toBe(false);
  expect(wb.moveRule(id, first, 1)).toBe(false);
  expect(wb.sheet(id).rules).toHaveLength(2);
  expect(wb.sheet(id).rules[0]).toMatchObject({ id: first, value: 1 });
});
