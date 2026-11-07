import { afterEach, describe, expect, it } from 'vitest';
import { parseInput, setLocale, formatValue, LOCALES, ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, sheetToCsv } from '../src/core/io.js';

afterEach(() => setLocale('en-US'));

const day = ymdToSerial(2023, 3, 15);
const year = new Date().getFullYear();

// A written-out date in the regional language (5. März 2026, 15 mars 2023, 2023年3月15日) stayed text: the month
// names were English only and the regexes matched Latin letters alone, so the medium and long date presets'
// own output did not survive a CSV export and import, or a paste as text, in any non-English regional format.
describe('a written-out date in the regional language', () => {
  it.each(LOCALES.map(([code]) => code))('reads back the medium and long date presets, and their date and time forms, in %s', (locale) => {
    setLocale(locale);
    for (const dateStyle of ['medium', 'long']) {
      const shown = formatValue(day, { fmt: 'date', dateStyle });
      expect(parseInput(shown).v, `${locale} ${dateStyle}: ${shown}`).toBe(day);
      const withTime = formatValue(day + 10.5 / 24, { fmt: 'datetime', dateStyle });
      expect(parseInput(withTime).v, `${locale} ${dateStyle}: ${withTime}`).toBe(day + 10.5 / 24);
    }
  });

  it.each([
    ['de-DE', '5. März 2026', ymdToSerial(2026, 3, 5)],
    ['de-DE', '5 März 2026', ymdToSerial(2026, 3, 5)],
    ['de-DE', '5. Mär 2026', ymdToSerial(2026, 3, 5)],
    ['de-DE', '5. Dezember', ymdToSerial(year, 12, 5)],
    ['fr-FR', '15 mars 2023', day],
    ['fr-FR', '1er févr. 2023', null], // an ordinal the presets do not write stays text
    ['fr-FR', '15 janvier 2023', ymdToSerial(2023, 1, 15)],
    ['tr-TR', '15 Mart 2023', day],
    ['tr-TR', '15 Eyl 2023', ymdToSerial(2023, 9, 15)],
    ['es-ES', '15 de marzo de 2023', day],
    ['pt-BR', '15 de mar. de 2023', day],
    ['ru-RU', '15 марта 2023', day],
    ['ru-RU', '15 март 2023', day],
    ['ru-RU', '15 марта 2023 г.', day],
    ['pl-PL', '15 marca 2023', day],
    ['pl-PL', '15 marca 2023 r.', day],
    ['fi-FI', '15. maaliskuuta 2023', day],
    ['cs-CZ', '15. března 2023', day],
    ['cs-CZ', '15. 3. 2023', day],
    ['nl-NL', '15 maart 2023', day],
    ['ja-JP', '2023年3月15日', day],
    ['zh-CN', '2023年3月15日', day],
    ['ko-KR', '2023년 3월 15일', day],
    ['ko-KR', '2023. 3. 15.', day],
  ])('reads %s %s', (locale, text, serial) => {
    setLocale(locale);
    const { v } = parseInput(text);
    if (serial == null) expect(v).toBe(text);
    else expect(v).toBe(serial);
  });

  it('reads the regional names with a time, and a month and year', () => {
    setLocale('fr-FR');
    expect(parseInput('15 mars 2023 10:00')).toEqual({ v: day + 10 / 24, f: null, fmt: 'datetime' });
    setLocale('ja-JP');
    expect(parseInput('2023年3月15日 10:00')).toEqual({ v: day + 10 / 24, f: null, fmt: 'datetime' });
    setLocale('de-DE');
    expect(parseInput('März 2024')).toEqual({ v: ymdToSerial(2024, 3, 1), f: null, fmt: 'custom', code: 'mmm-yy' });
    expect(parseInput('15. März 2023 10:00:30')).toEqual({ v: day + (10 * 3600 + 30) / 86400, f: null, fmt: 'datetime', sec: true });
  });

  it('still reads English names in every regional format', () => {
    for (const locale of ['de-DE', 'fr-FR', 'ja-JP', 'ru-RU', 'tr-TR']) {
      setLocale(locale);
      expect(parseInput('Aug 28, 2026').v).toBe(ymdToSerial(2026, 8, 28));
      expect(parseInput('28 Aug 2026').v).toBe(ymdToSerial(2026, 8, 28));
      expect(parseInput('Sept 3 2025').v).toBe(ymdToSerial(2025, 9, 3));
      expect(parseInput('March 15, 2023').v).toBe(day);
      expect(parseInput('Feb 2024').v).toBe(ymdToSerial(2024, 2, 1));
    }
  });

  it('keeps words that are no month as text', () => {
    setLocale('es-ES');
    for (const text of ['1 de 2023', '15 xyz 2023', 'Foo 2024', 'Fe 2024', 'de marzo', '15 de']) expect(parseInput(text).v).toBe(text);
    setLocale('de-DE');
    expect(parseInput('5. Klasse').v).toBe('5. Klasse');
    expect(parseInput('1,5').v).toBe(1.5);
  });

  it('round-trips a German long date through a CSV export and import', async () => {
    setLocale('de-DE');
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '2023-03-15');
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'date', dateStyle: 'long' });
    const csv = sheetToCsv(wb, id);
    expect(csv).toContain('15. März 2023');
    const back = await workbookFromFile(new TextEncoder().encode(csv), 'dates.csv');
    expect(back.getValue(back.activeSheetId, 0, 0)).toBe(day);
    expect(back.getCell(back.activeSheetId, 0, 0).s).toEqual({ fmt: 'date', dateStyle: 'medium' });
  });
});
