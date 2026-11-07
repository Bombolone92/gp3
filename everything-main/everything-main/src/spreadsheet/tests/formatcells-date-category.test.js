// @vitest-environment jsdom
import { beforeAll, expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile } from '../src/core/io.js';
import { createToolbar, formatEntry } from '../src/ui/toolbar.js';
import { openFormatCellsDialog } from '../src/ui/formatcells.js';

beforeAll(() => {
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});

it.each([
  [undefined, 'date'], [null, 'date'], ['iso', 'date'], ['long', 'date'], ['medium', 'date-medium'],
])('recognizes date style %s as %s', (dateStyle, expected) => {
  expect(formatEntry({ fmt: 'date', dateStyle }).value).toBe(expected);
});

it.each(['iso', 'long'])('shows and edits %s dates as dates in the toolbar and format dialog', async (dateStyle) => {
  let wb;
  if (dateStyle === 'long') {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 'n', v: 45306, z: 'mmmm d, yyyy' } }, 'Dates');
    wb = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'dates.xlsx');
  } else {
    wb = new Workbook();
    wb.setCells(wb.activeSheetId, [{ r: 0, c: 0, cell: { v: 45306, s: { fmt: 'date', dateStyle } } }]);
  }
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 0, c2: 0 };
  const original = wb.getCell(id, 0, 0).s;
  const display = wb.getDisplay(id, 0, 0);
  const ctx = {
    wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), range: () => range,
    style: () => wb.getCell(id, 0, 0).s, activeCell: () => wb.getCell(id, 0, 0),
    run: (cmd, { patch }) => wb.applyStyle(id, range, patch), subscribe: () => () => {},
    grid: { editing: false, focus() {} },
  };
  const toolbar = createToolbar(ctx);
  document.body.append(toolbar.el);
  const modal = openFormatCellsDialog(ctx);
  try {
    expect(modal.panel.querySelector('[aria-label="Category"]').value).toBe('date');
    expect(toolbar.el.querySelector('.tb-fmt-label').textContent).toBe('Short Date');
    expect(modal.panel.querySelector('.numfmt-preview').textContent).toBe(`Preview: ${display}`);
    const date = modal.panel.querySelector('[aria-label="Date style"]');
    expect(date.value).toBe(dateStyle);
    expect(date.closest('[hidden]')).toBeNull();
    date.value = 'medium';
    date.dispatchEvent(new Event('change'));
    [...modal.panel.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === 'Font').click();
    const bold = [...modal.panel.querySelectorAll('label')].find((label) => label.textContent.trim() === 'Bold').querySelector('input');
    bold.click();
    modal.panel.querySelector('[type="submit"]').click();
    expect(wb.getCell(id, 0, 0).s).toMatchObject({ fmt: 'date', dateStyle: 'medium', bold: true });
    expect(wb.getValue(id, 0, 0)).toBe(45306);
    expect(wb.getDisplay(id, 0, 0)).toBe('Jan 15, 2024');
    wb.undo();
    expect(wb.getCell(id, 0, 0).s).toEqual(original);
    expect(wb.getDisplay(id, 0, 0)).toBe(display);
    wb.redo();
    toolbar.refresh();
    expect(toolbar.el.querySelector('.tb-fmt-label').textContent).toBe('Long Date');
  } finally {
    modal.close();
    modal.panel.closest('.modal-root')?.remove();
    toolbar.destroy?.();
    toolbar.el.remove();
  }
});

it.each(['iso', 'medium', 'long'].flatMap((dateStyle) => [false, true].map((sec) => ({ dateStyle, sec }))))(
  'previews and edits imported $dateStyle date-times with sec=$sec', async ({ dateStyle, sec }) => {
    const codes = { iso: 'yyyy-mm-dd', medium: 'mmm d, yyyy', long: 'mmmm d, yyyy' };
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 'n', v: 45306.5 + 15 / 86400, z: `${codes[dateStyle]} hh:mm${sec ? ':ss' : ''}` } }, 'Dates');
    const wb = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'datetime.xlsx');
    const id = wb.activeSheetId;
    const original = wb.getCell(id, 0, 0).s;
    const display = wb.getDisplay(id, 0, 0);
    const modal = openFormatCellsDialog({
      wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }),
      style: () => wb.getCell(id, 0, 0).s,
      run: (cmd, { patch }) => wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, patch),
      grid: { editing: false, focus() {} },
    });
    try {
      expect(modal.panel.querySelector('[aria-label="Category"]').value).toBe('datetime');
      expect(modal.panel.querySelector('.numfmt-preview').textContent).toBe(`Preview: ${display}`);
      const date = modal.panel.querySelector('[aria-label="Date style"]');
      expect(date.closest('[hidden]')).toBeNull();
      expect(date.value).toBe(dateStyle);
      const next = dateStyle === 'long' ? 'medium' : 'long';
      date.value = next;
      date.dispatchEvent(new Event('change'));
      const expected = `${next === 'long' ? 'January' : 'Jan'} 15, 2024 12:00${sec ? ':15' : ''}`;
      expect(modal.panel.querySelector('.numfmt-preview').textContent).toBe(`Preview: ${expected}`);
      modal.panel.querySelector('[type="submit"]').click();
      expect(wb.getCell(id, 0, 0).s).toMatchObject({ fmt: 'datetime', dateStyle: next });
      expect(!!wb.getCell(id, 0, 0).s.sec).toBe(sec);
      expect(wb.getDisplay(id, 0, 0)).toBe(expected);
      wb.undo();
      expect(wb.getCell(id, 0, 0).s).toEqual(original);
      expect(wb.getDisplay(id, 0, 0)).toBe(display);
      wb.redo();
      expect(wb.getDisplay(id, 0, 0)).toBe(expected);
    } finally {
      modal.close();
      modal.panel.closest('.modal-root')?.remove();
    }
  },
);

it.each(['medium', 'long'])('keeps the %s date style when changing from date to date-time in the dialog', (dateStyle) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: 45306.5, s: { fmt: 'date', dateStyle } } }]);
  const display = `${wb.getDisplay(id, 0, 0)} 12:00`;
  const modal = openFormatCellsDialog({
    wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }),
    style: () => wb.getCell(id, 0, 0).s,
    run: (cmd, { patch }) => wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, patch),
    grid: { editing: false, focus() {} },
  });
  try {
    const category = modal.panel.querySelector('[aria-label="Category"]');
    category.value = 'datetime';
    category.dispatchEvent(new Event('change'));
    expect(modal.panel.querySelector('.numfmt-preview').textContent).toBe(`Preview: ${display}`);
    modal.panel.querySelector('[type="submit"]').click();
    expect(wb.getCell(id, 0, 0).s).toMatchObject({ fmt: 'datetime', dateStyle });
    expect(wb.getDisplay(id, 0, 0)).toBe(display);
  } finally {
    modal.close();
    modal.panel.closest('.modal-root')?.remove();
  }
});
