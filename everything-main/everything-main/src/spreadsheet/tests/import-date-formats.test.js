import { expect, it } from 'vitest';
import { formatValue, numFmtToStyle, styleToNumFmt, dateTimeKind, editText, formatGeneral, formatNumberText } from '../src/core/format.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as XLSX from '../src/vendor/xlsx.mjs';

const value = 45306 + 9.25 / 24;
const cases = [
  ['h:mm', '9:15'], ['h:mm:ss AM/PM', '9:15:00 AM'],
  ['mm:ss', '15:00'], ['dd/mm/yyyy', '15/01/2024'],
  ['m/d/yy', '1/15/24'], ['mmm-yy', 'Jan-24'],
  ['d mmmm yyyy', '15 January 2024'],
  ['dddd, mmmm d', 'Monday, January 15'],
  ['m/d/yy h:mm', '1/15/24 9:15'],
  ['yyyy.mm.dd', '2024.01.15'], [' yyyy-mm-dd ', ' 2024-01-15 '],
];

it.each(cases)('preserves imported date/time code %s', (code, display) => {
  const style = numFmtToStyle(code);
  expect(formatValue(value, style)).toBe(display);
  expect(styleToNumFmt(style)).toBe(code);
});

it('keeps exact built-in date/time formats as named styles', () => {
  for (const style of [
    { fmt: 'date' }, { fmt: 'date', dateStyle: 'medium' }, { fmt: 'date', dateStyle: 'long' },
    { fmt: 'time' }, { fmt: 'time', sec: true }, { fmt: 'datetime' }, { fmt: 'datetime', sec: true },
  ]) expect(numFmtToStyle(styleToNumFmt(style))).toEqual(style);
});

it.each([
  ['dd/mm/yyyy', 45306, 'date'], ['dd/mm/yyyy h:mm', value, 'datetime'],
  ['h:mm:ss AM/PM', 0.5, 'time'], ['[h]:mm', 2.5, 'time'],
  ['"day" 0', 5, null], ['0" months"', 5, null],
  ['[>1]dd/mm/yyyy;0', 2, 'date'], ['[>1]dd/mm/yyyy;0', 1, null],
])('recognizes the meaning of %s for %s', (code, v, kind) => {
  expect(dateTimeKind({ fmt: 'custom', code }, v)).toBe(kind);
});

it('keeps imported dates and times readable while editing without dropping hidden precision', () => {
  const edit = (v, code) => editText({ v, s: numFmtToStyle(code) });
  expect(edit(45306, 'dd/mm/yyyy')).toBe('2024-01-15');
  expect(edit(value, 'dd/mm/yyyy h:mm AM/PM')).toBe('2024-01-15 09:15:00');
  expect(edit(0.25, 'h:mm AM/PM')).toBe('06:00:00');
  // The raw serial is offered with the 15 digits an edit keeps.
  expect(edit(value, 'dd/mm/yyyy')).toBe(formatNumberText(value));
  expect(edit(12.3456 / 86400, 'ss.0000')).toBe(formatNumberText(12.3456 / 86400));
  // An elapsed time edits as the hours it shows, which read back as exactly the days it holds.
  expect(edit(2.5, '[h]:mm')).toBe('60:00');
  expect(edit(2.5, '[h]:mm:ss')).toBe('60:00:00');
});

it('preserves external XLSX date/time formats through import, display, and export', async () => {
  const sheet = XLSX.utils.aoa_to_sheet(cases.map(([z]) => [{ t: 'n', v: value, z }]));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Dates');
  const imported = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'dates.xlsx');
  for (const [r, [, display]] of cases.entries()) {
    expect(imported.getValue(imported.activeSheetId, r, 0)).toBe(value);
    expect(imported.getDisplay(imported.activeSheetId, r, 0)).toBe(display);
  }
  const exported = XLSX.read(await (await workbookToXlsx(imported)).arrayBuffer(), { type: 'array', cellNF: true });
  for (const [r, [code]] of cases.entries()) expect(exported.Sheets.Dates[`A${r + 1}`].z).toBe(code);
});
