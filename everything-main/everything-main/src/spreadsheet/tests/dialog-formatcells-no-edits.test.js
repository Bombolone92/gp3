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
  wb.applyStyle(id, parseRange('A1'), style);
  const runs = [];
  const modal = openFormatCellsDialog({
    wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), range: () => parseRange('A1:A1'),
    style: () => wb.getCell(id, 0, 0)?.s || {}, run: (cmd, arg) => runs.push([cmd, arg]),
    grid: { editing: false, focus() {}, commitEdit() {} },
  });
  const select = (label, value) => { const sel = modal.panel.querySelector(`select[aria-label="${label}"]`); sel.value = value; sel.dispatchEvent(new Event('change')); };
  const apply = () => modal.panel.querySelector('form.fc-form').dispatchEvent(new Event('submit', { cancelable: true }));
  const type = (label, value) => { const input = modal.panel.querySelector(`input[aria-label="${label}"]`); input.value = value; input.dispatchEvent(new Event('input')); };
  return { runs, select, type, apply };
}

// A style that stores a default outright (middle alignment, the default font,
// size 13) looks the same as one without; Apply with nothing changed used to
// send a patch clearing those fields, and so pushed an undo step.
it.each([
  [{ valign: 'middle' }],
  [{ color: 'windowtext' }],
  [{ color: { theme: 4, base: '#286844', rgb: '#286844' } }],
  [{ bg: { theme: 4, base: '#286844', rgb: '#286844' } }],
  [{ font: 'default' }],
  [{ size: 13 }],
  [{ fmt: 'number', valign: 'middle', font: 'default', size: 13, bold: true }],
])('applies nothing when no field was changed on a cell styled %j', (style) => {
  const { runs, apply } = open(style);
  apply();
  expect(runs).toEqual([]);
});

it('still applies a real change on such a cell, without the unchanged fields', () => {
  const { runs, select, apply } = open({ valign: 'middle', font: 'default', size: 13 });
  select('Size', '14'); // points, as the list shows sizes; cells keep pixels
  apply();
  expect(runs).toHaveLength(1);
  expect(runs[0][1].patch).toEqual({ size: 14 * 4 / 3 });
});

it('still clears an explicit non-default when the field is set back to its default', () => {
  const { runs, select, type, apply } = open({ valign: 'top', size: 16 });
  select('Vertical', 'middle');
  type('Font size', '9.75'); // the default 13px, in points
  apply();
  expect(runs[0][1].patch).toEqual({ valign: null, size: null });
});
