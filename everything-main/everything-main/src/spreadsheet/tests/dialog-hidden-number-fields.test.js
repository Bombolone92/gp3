// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { openFormatCellsDialog } from '../src/ui/formatcells.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.unstubAllGlobals(); });

const setNumber = (input, value) => { input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); };

// A number field left out of range on a tab the user has moved away from used
// to fail the browser's own form check. With the field hidden there was
// nowhere to show the message, so Apply and Enter simply did nothing.
it('applies a format from another tab when a hidden rotation field holds an out-of-range value', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const runs = [];
  const { panel } = openFormatCellsDialog({
    wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), range: () => parseRange('A1'), style: () => ({}),
    run: (cmd, arg) => runs.push([cmd, arg]), grid: { editing: false, focus() {}, commitEdit() {} },
  }, { panel: 'alignment' });
  const rotation = panel.querySelector('[aria-label^="Rotation"]');
  setNumber(rotation, 100);
  panel.querySelector('[role="tab"][data-key="font"]').click();
  const bold = [...panel.querySelectorAll('label')].find((l) => l.textContent.trim() === 'Bold').querySelector('input');
  bold.click();
  panel.querySelector('form').requestSubmit();
  expect(runs).toHaveLength(1);
  expect(runs[0][1].patch).toMatchObject({ bold: true, rot: 90 }); // rotation is kept within ±90
});

it('adds a conditional format after an icon threshold was left out of range on a hidden field', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 3; r++) wb.setInput(id, r, 0, String(r + 1));
  const { panel } = openConditionalFormatting({ wb, sheetId: () => id, range: () => parseRange('A1:A3'), grid: { focus() {} } });
  const type = panel.querySelector('[aria-label="Condition"]');
  type.value = 'icons';
  type.dispatchEvent(new Event('change'));
  setNumber(panel.querySelector('[aria-label="Low threshold percent"]'), 150);
  type.value = 'gt';
  type.dispatchEvent(new Event('change'));
  const value = panel.querySelector('[aria-label="Value"]') || panel.querySelectorAll('input.input')[1];
  value.value = '2';
  panel.querySelector('form').requestSubmit();
  expect(wb.sheet(id).rules).toHaveLength(1);
  expect(wb.sheet(id).rules[0]).toMatchObject({ type: 'gt', value: 2 });
});
