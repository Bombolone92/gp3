import { afterEach, describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { currencyDecimals, formatValue, numFmtToStyle, setLocale, styleToNumFmt } from '../src/core/format.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

// A currency style without a dec showed two decimals whatever the currency, so a ¥1,000 typed under the Japanese
// regional format displayed ￥1,000.00 and exported as "¥"#,##0.00, where a yen amount is
// written ¥1,000: a currency without a minor unit now has none unless the style asks for some.
afterEach(() => setLocale('en-US'));

describe('a currency without a minor unit', () => {
  it('has no decimals of its own, where the dollar and its kin have two', () => {
    expect(['JPY', 'KRW', 'VND'].map(currencyDecimals)).toEqual([0, 0, 0]);
    expect(['USD', 'EUR', 'GBP', 'INR', 'CHF', undefined].map(currencyDecimals)).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it.each([['ja-JP', '￥1,000', '₩1,000'], ['ko-KR', 'JP¥1,000', '₩1,000'], ['en-US', '¥1,000', '₩1,000']])('shows without decimals under %s unless the style asks for some', (locale, yen, won) => {
    setLocale(locale);
    expect(formatValue(1000, { fmt: 'currency', cur: 'JPY' })).toBe(yen);
    expect(formatValue(1000, { fmt: 'currency', cur: 'KRW' })).toBe(won);
    expect(formatValue(1234.5, { fmt: 'currency', cur: 'JPY' })).toBe(yen.replace('1,000', '1,235'));
    // A dec of the style's own is kept, two or none.
    expect(formatValue(1000, { fmt: 'currency', cur: 'JPY', dec: 2 })).toBe(`${yen}.00`);
    expect(formatValue(1000, { fmt: 'currency', cur: 'JPY', dec: 0 })).toBe(yen);
    // The dollar keeps its two.
    expect(formatValue(1000, { fmt: 'currency' })).toMatch(/1,000\.00$/);
  });

  it('exports a format code without decimals, which reads back as the same format', () => {
    expect(styleToNumFmt({ fmt: 'currency', cur: 'JPY' })).toBe('"¥"#,##0');
    expect(styleToNumFmt({ fmt: 'currency', cur: 'KRW' })).toBe('"₩"#,##0');
    expect(styleToNumFmt({ fmt: 'currency', cur: 'JPY', dec: 2 })).toBe('"¥"#,##0.00');
    expect(styleToNumFmt({ fmt: 'currency' })).toBe('"$"#,##0.00');
    expect(numFmtToStyle(styleToNumFmt({ fmt: 'currency', cur: 'JPY' }))).toEqual({ fmt: 'currency', cur: 'JPY', dec: 0 });
    expect(formatValue(1000, numFmtToStyle(styleToNumFmt({ fmt: 'currency', cur: 'JPY' })))).toBe('¥1,000');
  });

  it('keeps a typed ¥1,000 whole and a typed ¥12.50 with its decimals, through a save and a reload', async () => {
    setLocale('ja-JP');
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '¥1,000');
    wb.setInput(id, 1, 0, '￥12.50');
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'currency', cur: 'JPY', dec: 0 }); // typed without decimals, so none, as typed
    expect(wb.getDisplay(id, 0, 0)).toBe('￥1,000');
    expect(wb.getCell(id, 1, 0).s).toEqual({ fmt: 'currency', cur: 'JPY', dec: 2 });
    expect(wb.getDisplay(id, 1, 0)).toBe('￥12.50');
    const back = await workbookFromFile(await workbookToXlsx(wb), 'yen.xlsx');
    expect(back.getDisplay(back.activeSheetId, 0, 0)).toBe('￥1,000');
    expect(back.getDisplay(back.activeSheetId, 1, 0)).toBe('￥12.50');
    setLocale('en-US');
    expect(back.getDisplay(back.activeSheetId, 0, 0)).toBe('¥1,000');
    // A typed dollar amount keeps the decimals it was typed with, none here, as any typed currency does.
    wb.setInput(id, 2, 0, '$1,000');
    expect(wb.getDisplay(id, 2, 0)).toBe('$1,000');
    wb.setInput(id, 3, 0, '$1,000.50');
    expect(wb.getDisplay(id, 3, 0)).toBe('$1,000.50');
  });
});
