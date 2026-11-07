// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { MAX_DECIMAL_PLACES } from '../src/core/format.js';
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
  wb.applyStyle(id, parseRange('A1'), style);
  const runs = [];
  const modal = openFormatCellsDialog({
    wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), range: () => parseRange('A1:A1'),
    style: () => wb.getCell(id, 0, 0)?.s || {}, run: (cmd, arg) => runs.push([cmd, arg]),
    grid: { editing: false, focus() {}, commitEdit() {} },
  });
  const field = (label) => modal.panel.querySelector(`input[aria-label="${label}"]`);
  const type = (label, text) => { field(label).value = text; field(label).dispatchEvent(new Event('input')); };
  const apply = () => modal.panel.querySelector('form.fc-form').dispatchEvent(new Event('submit', { cancelable: true }));
  return { modal, runs, field, type, apply };
}

// The count was clamped for the preview and for Apply, but the field kept
// showing what was typed.
it('shows the clamped decimal places the preview and Apply use', () => {
  const { modal, runs, field, type, apply } = open({ fmt: 'number', dec: 2 });
  type('Decimal places', '99');
  expect(field('Decimal places').value).toBe(String(MAX_DECIMAL_PLACES));
  expect(modal.panel.querySelector('.numfmt-preview').textContent).toBe(`Preview: 1,234.${'5'.padEnd(MAX_DECIMAL_PLACES, '0')}`);
  type('Decimal places', '-3');
  expect(field('Decimal places').value).toBe('0');
  expect(modal.panel.querySelector('.numfmt-preview').textContent).toBe('Preview: 1,235');
  type('Decimal places', '3');
  expect(field('Decimal places').value).toBe('3');
  apply();
  expect(runs[0][1].patch).toMatchObject({ fmt: 'number', dec: 3 });
});

it('shows clamped indent and rotation too', () => {
  const { runs, field, type, apply } = open({});
  type('Indent', '99');
  expect(field('Indent').value).toBe('10');
  type('Rotation (degrees, -90 to 90)', '-200');
  expect(field('Rotation (degrees, -90 to 90)').value).toBe('-90');
  apply();
  expect(runs[0][1].patch).toMatchObject({ indent: 10, rot: -90 });
});
