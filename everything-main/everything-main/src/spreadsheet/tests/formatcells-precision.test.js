// @vitest-environment jsdom
import { beforeAll, expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile } from '../src/core/io.js';
import { styleToNumFmt } from '../src/core/format.js';
import { negativeStyleFor, openFormatCellsDialog } from '../src/ui/formatcells.js';

beforeAll(() => {
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});

async function imported(code) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 'n', v: -1234.125, z: code } }, 'Data');
  return workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'precision.xlsx');
}

function dialog(wb) {
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 0, c2: 0 };
  return openFormatCellsDialog({
    wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), range: () => range,
    style: () => wb.getCell(id, 0, 0).s,
    run: (cmd, { patch }) => wb.applyStyle(id, range, patch), grid: { focus() {} },
  });
}

it.each(['number', 'currency', 'percent', 'scientific', 'custom'].flatMap((fmt) =>
  [11, 15, 20].map((dec) => ({ fmt, dec })),
))('allows unrelated format changes on imported $fmt cells with $dec decimal places', async ({ fmt, dec }) => {
  const digits = `#,##0.${'0'.repeat(dec)}`;
  const code = fmt === 'custom' ? `${digits};[Red](${digits})` : styleToNumFmt({ fmt, dec, cur: 'CAD' });
  const wb = await imported(code);
  const id = wb.activeSheetId;
  const original = wb.getCell(id, 0, 0).s;
  const display = wb.getDisplay(id, 0, 0);
  const modal = dialog(wb);
  try {
    const precision = modal.panel.querySelector('[aria-label="Decimal places"]');
    expect(precision.value).toBe(String(dec));
    expect(precision.validity.rangeOverflow).toBe(false);
    expect(modal.panel.querySelector('.numfmt-preview').textContent).toBe(`Preview: ${display}`);
    const bold = [...modal.panel.querySelectorAll('label')].find((label) => label.textContent.trim() === 'Bold').querySelector('input');
    bold.click();
    modal.panel.querySelector('[type="submit"]').click();
    expect(wb.getCell(id, 0, 0).s).toEqual({ ...original, bold: true });
    expect(wb.getDisplay(id, 0, 0)).toBe(display);
    wb.undo();
    expect(wb.getCell(id, 0, 0).s).toEqual(original);
  } finally { modal.close(); modal.panel.closest('.modal-root')?.remove(); }
});

it.each([21, 101])('keeps a %i-place negative format editable as a custom code', async (dec) => {
  const digits = `0.${'0'.repeat(dec)}`;
  const code = `${digits};[Red](${digits})`;
  expect(negativeStyleFor(code)).toBeNull();
  const wb = await imported(code);
  const modal = dialog(wb);
  try {
    expect(modal.panel.querySelector('[aria-label="Category"]').value).toBe('custom');
    expect(modal.panel.querySelector('[aria-label="Format code"]').value).toBe(code);
    const italic = [...modal.panel.querySelectorAll('label')].find((label) => label.textContent.trim() === 'Italic').querySelector('input');
    italic.click();
    modal.panel.querySelector('[type="submit"]').click();
    expect(wb.getCell(wb.activeSheetId, 0, 0).s).toMatchObject({ fmt: 'custom', code, italic: true });
  } finally { modal.close(); modal.panel.closest('.modal-root')?.remove(); }
});

it.each(['number', 'currency'])('keeps precision when changing grouping and negative style for %s', async (fmt) => {
  const wb = await imported(styleToNumFmt({ fmt, dec: 15, cur: 'CAD' }));
  const modal = dialog(wb);
  try {
    const group = [...modal.panel.querySelectorAll('label')].find((label) => label.textContent.trim() === 'Thousands separator').querySelector('input');
    group.click();
    const negative = modal.panel.querySelector('[aria-label="Negative numbers"]');
    negative.value = 'redparen';
    negative.dispatchEvent(new Event('change'));
    modal.panel.querySelector('[type="submit"]').click();
    expect(negativeStyleFor(wb.getCell(wb.activeSheetId, 0, 0).s.code)).toMatchObject({
      category: fmt, dec: 15, group: false, neg: 'redparen',
    });
  } finally { modal.close(); modal.panel.closest('.modal-root')?.remove(); }
});
