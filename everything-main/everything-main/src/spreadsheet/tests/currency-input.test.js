import { afterEach, describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { setLocale } from '../src/core/format.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

afterEach(() => setLocale('en-US'));

describe('currency input', () => {
  it.each([['€12.50', 'EUR', '€12.50'], ['£12.50', 'GBP', '£12.50'], ['¥12.50', 'JPY', '¥12.50']])('keeps the currency in %s when typing, importing, and reopening', async (text, currency, display) => {
    const wb = new Workbook();
    wb.setInput(wb.activeSheetId, 0, 0, text);
    expect(wb.getDisplay(wb.activeSheetId, 0, 0)).toBe(display);
    expect(wb.getCell(wb.activeSheetId, 0, 0).s.cur).toBe(currency);
    const imported = await workbookFromFile(new TextEncoder().encode(text), 'amount.csv');
    expect(imported.getDisplay(imported.activeSheetId, 0, 0)).toBe(display);
    const reopened = await workbookFromFile(await workbookToXlsx(imported), 'amount.xlsx');
    expect(reopened.getDisplay(reopened.activeSheetId, 0, 0)).toBe(display);
  });

  it('keeps a trailing euro symbol under a comma-decimal locale', () => {
    setLocale('de-DE');
    const wb = new Workbook();
    wb.setInput(wb.activeSheetId, 0, 0, '(12,50 €)');
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(-12.5);
    expect(wb.getCell(wb.activeSheetId, 0, 0).s.cur).toBe('EUR');
    expect(wb.getDisplay(wb.activeSheetId, 0, 0)).toContain('€');
  });

  it('respects an explicitly chosen number format', () => {
    const wb = new Workbook();
    wb.applyStyle(wb.activeSheetId, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'currency', cur: 'CAD' });
    wb.setInput(wb.activeSheetId, 0, 0, '$12.50');
    expect(wb.getCell(wb.activeSheetId, 0, 0).s.cur).toBe('CAD');
  });
});
