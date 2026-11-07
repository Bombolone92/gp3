// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { templateById } from '../src/core/templates.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
import { openValidationManager } from '../src/ui/validation.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// The workbook's no-op check compares the stored rule with the one the dialog hands it as text, which
// cannot help when the dialog writes keys the stored rule never had. Every built-in template defines
// its rules with a smaller key set than the dialogs write, so opening one and pressing Save — changing
// nothing — recorded an "Edit validation"/"Edit rule" step that does nothing and marked the document
// unsaved.
const panel = () => document.querySelector('.modal-panel');
const field = (label) => panel().querySelector(`[aria-label="${label}"]`);
const rows = () => [...panel().querySelectorAll('.names-main')];
const submit = () => { document.activeElement?.blur?.(); panel().querySelector('form').requestSubmit(); };
const check = (text) => [...panel().querySelectorAll('label')].find((l) => l.textContent.includes(text)).querySelector('input');
const grid = () => ({ focus: vi.fn(), setSelection: vi.fn() });
const anywhere = { r1: 0, c1: 0, r2: 0, c2: 0 };

function fromTemplate(id, key) {
  const wb = templateById(id).build();
  wb.clearHistory();
  wb.markClean();
  const sheet = wb.sheets.find((s) => (s[key] || []).length);
  return { wb, id: sheet.id, sheet };
}

it('records no step when a To-do list validation is saved untouched', () => {
  const { wb, id, sheet } = fromTemplate('todo', 'validations');
  const before = JSON.stringify(sheet.validations);
  expect(sheet.validations.map((v) => v.type)).toEqual(['checkbox', 'list', 'date']);
  sheet.validations.forEach((_, i) => {
    closeAllModals();
    openValidationManager({ wb, sheetId: () => id, range: () => anywhere, grid: grid() });
    rows()[i].click();
    submit();
  });
  expect(JSON.stringify(wb.sheet(id).validations)).toBe(before);
  expect(wb.undoLabel()).toBeNull();
  expect(wb.dirty).toBe(false);
});

it('records no step when the Weekly schedule banding rule is saved untouched', () => {
  const { wb, id, sheet } = fromTemplate('schedule', 'rules');
  const before = JSON.stringify(sheet.rules);
  openConditionalFormatting({ wb, sheetId: () => id, range: () => anywhere, grid: grid() });
  rows()[0].click();
  submit();
  expect(JSON.stringify(wb.sheet(id).rules)).toBe(before);
  expect(wb.undoLabel()).toBeNull();
  expect(wb.dirty).toBe(false);
});

it('records no step when an icon-set rule stored without thresholds is saved untouched', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [1, 5, 9, 12].forEach((v, r) => wb.setInput(id, r, 0, String(v)));
  wb.addRule(id, { range: { r1: 0, c1: 0, r2: 3, c2: 0 }, type: 'icons', set: 'arrows' });
  wb.clearHistory();
  wb.markClean();
  const before = JSON.stringify(wb.sheet(id).rules);
  openConditionalFormatting({ wb, sheetId: () => id, range: () => anywhere, grid: grid() });
  rows()[0].click();
  expect(field('Low threshold percent').value).toBe('33');
  submit();
  expect(JSON.stringify(wb.sheet(id).rules)).toBe(before);
  expect(wb.undoLabel()).toBeNull();
  expect(wb.dirty).toBe(false);
});

it('still records the step, and the key, when one of those fields is changed', () => {
  const { wb, id } = fromTemplate('todo', 'validations');
  openValidationManager({ wb, sheetId: () => id, range: () => anywhere, grid: grid() });
  rows()[1].click();
  check('Allow empty cells').checked = false;
  submit();
  expect(wb.undoLabel()).toBe('Edit validation');
  expect(wb.sheet(id).validations[1]).toMatchObject({ allowBlank: false });
  wb.undo();
  expect(wb.sheet(id).validations[1].allowBlank).not.toBe(false); // back to letting a blank through
});

it('still records the step when an icon set gets its own thresholds', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [1, 5, 9, 12].forEach((v, r) => wb.setInput(id, r, 0, String(v)));
  wb.addRule(id, { range: { r1: 0, c1: 0, r2: 3, c2: 0 }, type: 'icons', set: 'arrows' });
  wb.clearHistory();
  wb.markClean();
  openConditionalFormatting({ wb, sheetId: () => id, range: () => anywhere, grid: grid() });
  rows()[0].click();
  field('Low threshold percent').value = '20';
  submit();
  expect(wb.undoLabel()).toBe('Edit rule');
  const rule = wb.sheet(id).rules[0];
  expect(rule.lo).toBe(20);
  // The threshold that was left alone stays implied, and still reads as the 67 the form showed.
  expect(rule.hi ?? 67).toBe(67);
  wb.undo();
  expect(wb.sheet(id).rules[0].lo).toBeUndefined();
});
