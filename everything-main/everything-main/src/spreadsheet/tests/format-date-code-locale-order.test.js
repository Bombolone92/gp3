import { afterEach, expect, it } from 'vitest';
import { LOCALES, formatValue, numFmtToStyle, setLocale, styleToNumFmt } from '../src/core/format.js';
import { formatCodeError, formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

// The written-out and long date presets exported and copied as the American order mmm d, yyyy in every
// regional format, so a British 15 Mar 2023 opened in Excel as Mar 15, 2023 and a German 15.03.2023 as
// Mai 18, 1903. Each regional format now writes its own order behind the [$-…] tag that names its language.
const MARCH_15 = 45000;
afterEach(() => setLocale('en-US'));

it('writes the date order of the regional format, tagged with its language', () => {
  setLocale('en-GB');
  expect(styleToNumFmt({ fmt: 'date', dateStyle: 'medium' })).toBe('[$-809]d mmm yyyy');
  expect(styleToNumFmt({ fmt: 'date', dateStyle: 'long' })).toBe('[$-809]d mmmm yyyy');
  setLocale('de-DE');
  expect(styleToNumFmt({ fmt: 'date', dateStyle: 'medium' })).toBe('[$-407]dd.mm.yyyy');
  expect(styleToNumFmt({ fmt: 'datetime', dateStyle: 'long', sec: true })).toBe('[$-407]d. mmmm yyyy hh:mm:ss');
  setLocale('ja-JP');
  expect(styleToNumFmt({ fmt: 'date', dateStyle: 'long' })).toBe('[$-411]yyyy"年"m"月"d"日"');
  // American codes keep the bare spelling they always had, and the plain Date preset stays ISO everywhere.
  setLocale('en-US');
  expect(styleToNumFmt({ fmt: 'date', dateStyle: 'medium' })).toBe('mmm d, yyyy');
  expect(styleToNumFmt({ fmt: 'date', dateStyle: 'long' })).toBe('mmmm d, yyyy');
  setLocale('fr-FR');
  expect(styleToNumFmt({ fmt: 'date' })).toBe('yyyy-mm-dd');
});

it('prints through its own code exactly what the cell shows, in every regional format', () => {
  for (const [locale] of LOCALES) {
    setLocale(locale);
    for (const dateStyle of ['medium', 'long']) {
      const code = styleToNumFmt({ fmt: 'date', dateStyle });
      expect(formatCodeError(code)).toBeNull();
      for (const serial of [MARCH_15, 44990]) { // 15 March and 5 March 2023: a padded day and month show
        expect(formatWithCode(serial, code)).toBe(formatValue(serial, { fmt: 'date', dateStyle }));
      }
    }
  }
});

it('reads a tagged code back as the preset it stood for, wherever it is opened', () => {
  for (const [locale] of LOCALES) {
    setLocale(locale);
    for (const style of [{ fmt: 'date', dateStyle: 'medium' }, { fmt: 'date', dateStyle: 'long' }, { fmt: 'datetime', dateStyle: 'medium', sec: true }]) {
      const code = styleToNumFmt(style);
      // Chinese spells a written-out date and a long one alike, so a long one reads back as the first of them.
      const expected = locale === 'zh-CN' && style.dateStyle === 'long' ? { ...style, dateStyle: 'medium' } : style;
      expect(numFmtToStyle(code)).toEqual(expected);
    }
  }
  // A German code opened under the American regional format is still the Date preset, shown the American way.
  setLocale('en-US');
  expect(numFmtToStyle('[$-407]dd.mm.yyyy')).toEqual({ fmt: 'date', dateStyle: 'medium' });
  // The codes written before there were tags still read back, and an untagged custom code stays custom.
  expect(numFmtToStyle('mmm d, yyyy')).toEqual({ fmt: 'date', dateStyle: 'medium' });
  expect(numFmtToStyle('mmmm d, yyyy')).toEqual({ fmt: 'date', dateStyle: 'long' });
  expect(numFmtToStyle('dd.mm.yyyy')).toEqual({ fmt: 'custom', code: 'dd.mm.yyyy' });
});

it('keeps a British date the fifteenth of March through a saved file', async () => {
  setLocale('en-GB');
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: MARCH_15, s: { fmt: 'date', dateStyle: 'medium' } } }]);
  expect(wb.getDisplay(id, 0, 0)).toBe('15 Mar 2023');
  const back = await workbookFromFile(await workbookToXlsx(wb), 'dates.xlsx');
  expect(back.getCell(back.activeSheetId, 0, 0).s).toMatchObject({ fmt: 'date', dateStyle: 'medium' });
  expect(back.getDisplay(back.activeSheetId, 0, 0)).toBe('15 Mar 2023');
});
