// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { openFormatCellsDialog } from '../src/ui/formatcells.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeAll(() => {
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => { closeAllModals(); document.body.replaceChildren(); });

function open(style) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1234.5');
  if (style) wb.applyStyle(id, parseRange('A1'), style);
  const runs = [];
  const modal = openFormatCellsDialog({
    wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), range: () => parseRange('A1:A1'),
    style: () => wb.getCell(id, 0, 0)?.s || {}, run: (cmd, arg) => runs.push([cmd, arg]),
    grid: { editing: false, focus() {}, commitEdit() {} },
  });
  const control = (label) => modal.panel.querySelector(`[aria-label="${label}"]`);
  const change = (label, v) => { control(label).value = v; control(label).dispatchEvent(new Event('change')); };
  const type = (label, v) => { control(label).value = v; control(label).dispatchEvent(new Event('input')); };
  const decimals = () => control('Decimal places').value;
  const preview = () => modal.panel.querySelector('.numfmt-preview').textContent;
  const apply = () => modal.panel.querySelector('form.fc-form').dispatchEvent(new Event('submit', { cancelable: true }));
  return { runs, control, change, type, decimals, preview, apply };
}

// The field was written once, at open time, so every later Category or Currency change left it
// showing the old default while the preview and Apply used the new one.
it('follows the Category change with the decimals the preview and Apply use', () => {
  const d = open({ fmt: 'currency', cur: 'JPY' });
  expect(d.decimals()).toBe('0');
  expect(d.preview()).toBe('Preview: ¥1,235');
  d.change('Category', 'number');
  expect(d.decimals()).toBe('2');
  expect(d.preview()).toBe('Preview: 1,234.50');
  // Stepping the field up from the two places on show gives three, not one.
  d.type('Decimal places', '3');
  expect(d.preview()).toBe('Preview: 1,234.500');
  d.apply();
  expect(d.runs[0][1].patch).toMatchObject({ fmt: 'number', dec: 3 });
});

it('follows the Currency change, so Apply on a yen cell matches the field', () => {
  const d = open(null);
  d.change('Category', 'currency');
  expect(d.decimals()).toBe('2');
  expect(d.preview()).toBe('Preview: $1,234.50');
  d.change('Currency', 'JPY');
  expect(d.decimals()).toBe('0');
  expect(d.preview()).toBe('Preview: ¥1,235');
  d.apply();
  expect(d.runs[0][1].patch).toMatchObject({ fmt: 'currency', dec: null, cur: 'JPY' });
});

it('keeps a count the cell owns through a Category change', () => {
  const d = open({ fmt: 'currency', cur: 'JPY', dec: 3 });
  expect(d.decimals()).toBe('3');
  d.change('Category', 'number');
  expect(d.decimals()).toBe('3');
  expect(d.preview()).toBe('Preview: 1,234.500');
});

// A Negative numbers choice writes a format code, which used two places for every currency.
it('gives a yen cell with no count of its own no decimals in its negative-number code', () => {
  const d = open({ fmt: 'currency', cur: 'JPY' });
  d.change('Negative numbers', 'red');
  expect(d.decimals()).toBe('0');
  expect(d.preview()).toBe('Preview: ¥1,235');
  d.apply();
  expect(d.runs[0][1].patch).toMatchObject({ fmt: 'custom', code: '"¥"#,##0;[Red]-"¥"#,##0' });
});

// Clearing the field means "the category's default": it must not refill as the user deletes.
it('leaves the field empty while it is being cleared', () => {
  const d = open({ fmt: 'number', dec: 3 });
  d.type('Decimal places', '');
  expect(d.decimals()).toBe('');
  expect(d.preview()).toBe('Preview: 1,234.50');
});
