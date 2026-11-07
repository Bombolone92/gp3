// @vitest-environment jsdom
import { beforeAll, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { openFormatCellsDialog } from '../src/ui/formatcells.js';

beforeAll(() => {
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});

function dialog(wb) {
  const id = wb.activeSheetId;
  const range = parseRange('A1');
  return openFormatCellsDialog({
    wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), range: () => range,
    style: () => wb.getCell(id, 0, 0)?.s || {},
    run: (cmd, { patch }) => wb.applyStyle(id, range, patch),
    grid: { editing: false, focus() {}, commitEdit() {} },
  });
}
const field = (modal, label) => modal.panel.querySelector(`[aria-label="${label}"]`);
const preview = (modal) => modal.panel.querySelector('.numfmt-preview').textContent;
const apply = (modal) => modal.panel.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
const dismiss = (modal) => { modal.close(); modal.panel.closest('.modal-root')?.remove(); };

it('shows the two decimal places a percent cell without its own count uses, so Apply changes nothing', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '0.5');
  // The toolbar's Percent button applies the format without a decimal count.
  wb.applyStyle(id, parseRange('A1'), { fmt: 'percent' });
  expect(wb.getDisplay(id, 0, 0)).toBe('50.00%');
  const before = JSON.stringify(wb.getCell(id, 0, 0).s);
  const modal = dialog(wb);
  try {
    expect(field(modal, 'Category').value).toBe('percent');
    expect(field(modal, 'Decimal places').value).toBe('2');
    expect(preview(modal)).toBe('Preview: 50.00%');
    apply(modal);
    expect(wb.getDisplay(id, 0, 0)).toBe('50.00%');
    expect(JSON.stringify(wb.getCell(id, 0, 0).s)).toBe(before);
  } finally { dismiss(modal); }
});

it('keeps the field, the preview and the result in step when a number becomes a percent', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '0.5');
  const modal = dialog(wb);
  try {
    const category = field(modal, 'Category');
    category.value = 'percent';
    category.dispatchEvent(new Event('change'));
    const decimals = field(modal, 'Decimal places');
    expect(decimals.value).toBe('2');
    expect(preview(modal)).toBe('Preview: 50.00%');
    decimals.value = '0';
    decimals.dispatchEvent(new Event('input'));
    expect(preview(modal)).toBe('Preview: 50%');
    apply(modal);
    expect(wb.getDisplay(id, 0, 0)).toBe('50%');
    expect(wb.getCell(id, 0, 0).s).toMatchObject({ fmt: 'percent', dec: 0 });
  } finally { dismiss(modal); }
});

it('shows a percent cell with its own count as it is', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '0.5');
  wb.applyStyle(id, parseRange('A1'), { fmt: 'percent', dec: 1 });
  const modal = dialog(wb);
  try {
    expect(field(modal, 'Decimal places').value).toBe('1');
    expect(preview(modal)).toBe('Preview: 50.0%');
  } finally { dismiss(modal); }
});
