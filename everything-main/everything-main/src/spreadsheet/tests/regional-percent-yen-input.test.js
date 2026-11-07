import { afterEach, describe, expect, it } from 'vitest';
import { parseInput, setLocale, formatValue } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, sheetToCsv } from '../src/core/io.js';

afterEach(() => setLocale('en-US'));

// The Turkish regional format writes a percent as %12,5 and the Japanese one a yen amount as ￥1,235 (the
// full-width sign), and neither read back: parseInput took only a trailing % and the half-width ¥, so a CSV
// of such cells came back as text where every other regional format's round-tripped.
describe('a leading percent sign', () => {
  it('reads as the percent the Turkish regional format writes', () => {
    setLocale('tr-TR');
    const shown = formatValue(0.125, { fmt: 'percent', dec: 1 });
    expect(shown).toBe('%12,5');
    expect(parseInput(shown)).toEqual({ v: 0.125, f: null, fmt: 'percent' });
    expect(parseInput('% 50')).toEqual({ v: 0.5, f: null, fmt: 'percent' });
    expect(parseInput('%1.250,5')).toEqual({ v: 12.505, f: null, fmt: 'percent' });
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '%12,5');
    expect(wb.getCell(id, 0, 0)).toEqual({ v: 0.125, f: null, s: { fmt: 'percent', dec: 2 } });
    expect(wb.getDisplay(id, 0, 0)).toBe('%12,50');
  });

  it('reads a typed %50 in any regional format, while a lone or doubled sign stays text', () => {
    expect(parseInput('%50')).toEqual({ v: 0.5, f: null, fmt: 'percent' });
    expect(parseInput('-%5')).toEqual({ v: -0.05, f: null, fmt: 'percent' });
    setLocale('tr-TR');
    expect(formatValue(-0.125, { fmt: 'percent', dec: 1 })).toBe('-%12,5');
    expect(parseInput('-%12,5')).toEqual({ v: -0.125, f: null, fmt: 'percent' });
    setLocale('en-US');
    for (const text of ['%', '%%', '50%%', '%50%', '%abc', '%-']) expect(parseInput(text)).toEqual({ v: text, f: null, fmt: null });
  });
});

describe('the full-width yen sign', () => {
  it('reads as yen, as the Japanese regional format writes it', () => {
    setLocale('ja-JP');
    const shown = formatValue(1234.5, { fmt: 'currency', cur: 'JPY', dec: 0 });
    expect(shown).toBe('￥1,235');
    expect(parseInput(shown)).toEqual({ v: 1235, f: null, fmt: 'currency', cur: 'JPY' });
    expect(parseInput('-￥5')).toEqual({ v: -5, f: null, fmt: 'currency', cur: 'JPY' });
    expect(parseInput('(￥5)')).toEqual({ v: -5, f: null, fmt: 'currency', cur: 'JPY' });
    expect(parseInput('5 ￥')).toEqual({ v: 5, f: null, fmt: 'currency', cur: 'JPY' });
    expect(parseInput('¥1,235')).toEqual({ v: 1235, f: null, fmt: 'currency', cur: 'JPY' }); // the half-width sign as before
    expect(parseInput('￥')).toEqual({ v: '￥', f: null, fmt: null });
  });
});

it('round-trips a Turkish percent cell and a Japanese yen cell through a CSV export and import', async () => {
  for (const [locale, text, style, value] of [['tr-TR', '0,125', { fmt: 'percent', dec: 1 }, 0.125], ['ja-JP', '1234.5', { fmt: 'currency', cur: 'JPY', dec: 0 }, 1235]]) {
    setLocale(locale);
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, text);
    wb.setInput(id, 0, 1, 'note'); // a second column, so the file carries its separator
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, style);
    const back = await workbookFromFile(new TextEncoder().encode(sheetToCsv(wb, id)), 'amounts.csv');
    expect(back.getValue(back.activeSheetId, 0, 0), `${locale}: ${sheetToCsv(wb, id)}`).toBe(value);
    expect(back.getCell(back.activeSheetId, 0, 0).s.fmt).toBe(style.fmt);
  }
});
