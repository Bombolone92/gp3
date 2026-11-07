// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
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

const range = { r1: 0, c1: 0, r2: 4, c2: 0 };
function sheet(first = '1') {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 5; r++) wb.setInput(id, r, 0, r === 0 ? first : String(r + 1));
  return { wb, id };
}
function saveValidation(wb, id, formula) {
  const { panel } = openValidationManager({ wb, sheetId: () => id, range: () => range });
  const type = panel.querySelector('[aria-label="Type"]');
  type.value = 'formula';
  type.dispatchEvent(new Event('change'));
  panel.querySelector('[aria-label="Formula"]').value = formula;
  panel.querySelector('form').requestSubmit();
  return panel.querySelector('.field-error');
}
function saveFormat(wb, id, formula) {
  const { panel } = openConditionalFormatting({ wb, sheetId: () => id, range: () => range, grid: { focus: vi.fn() } });
  const type = panel.querySelector('[aria-label="Condition"]');
  type.value = 'formula';
  type.dispatchEvent(new Event('change'));
  panel.querySelector('[aria-label="Value"]').value = formula;
  panel.querySelector('form').requestSubmit();
  return panel.querySelector('.field-error');
}

// A custom formula that could not be read, or named an unknown function, was stored as typed:
// the validation then refused every entry and the format never matched, with nothing said.
describe.each([
  ['=A1>', /cannot be read/],
  ['=A1>0)', /cannot be read/],
  ['=FOO(A1)', /#NAME\?/],
])('the custom formula %s', (formula, message) => {
  it('is refused by the data validation dialog', () => {
    const { wb, id } = sheet();
    const error = saveValidation(wb, id, formula);
    expect(error.hidden).toBe(false);
    expect(error.textContent).toMatch(message);
    expect(wb.sheet(id).validations).toHaveLength(0);
  });
  it('is refused by the conditional formatting dialog', () => {
    const { wb, id } = sheet();
    const error = saveFormat(wb, id, formula);
    expect(error.hidden).toBe(false);
    expect(error.textContent).toMatch(message);
    expect(wb.sheet(id).rules).toHaveLength(0);
  });
});

it('keeps a custom formula that reads and evaluates', () => {
  const { wb, id } = sheet();
  expect(saveValidation(wb, id, '=A1>2').hidden).toBe(true);
  expect(wb.sheet(id).validations[0]).toMatchObject({ type: 'formula', source: '=A1>2' });
  expect(wb.validateInput(id, 0, 0, '5').ok).toBe(true);
  expect(wb.validateInput(id, 0, 0, '1').ok).toBe(false);
  expect(saveFormat(wb, id, '=A1>2').hidden).toBe(true);
  expect(wb.sheet(id).rules[0]).toMatchObject({ type: 'formula', value: '=A1>2' });
});

// An error that hangs on the first cell's data is that cell's business, not the formula's.
it('keeps a custom formula whose result is an error for the first cell', () => {
  const { wb, id } = sheet('0');
  expect(saveValidation(wb, id, '=1/A1>0').hidden).toBe(true);
  expect(wb.sheet(id).validations).toHaveLength(1);
  expect(saveFormat(wb, id, '=1/A1>0').hidden).toBe(true);
  expect(wb.sheet(id).rules).toHaveLength(1);
});
