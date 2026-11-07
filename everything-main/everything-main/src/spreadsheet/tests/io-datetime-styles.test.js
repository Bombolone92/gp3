import { DEFAULT_FONT_COLOR } from '../src/core/font-color.js';
import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { numFmtToStyle, styleToNumFmt } from '../src/core/format.js';

const dates = {
  iso: ['yyyy-mm-dd', '2024-01-15'],
  medium: ['mmm d, yyyy', 'Jan 15, 2024'],
  long: ['mmmm d, yyyy', 'January 15, 2024'],
};

it.each(Object.keys(dates).flatMap((dateStyle) => [false, true].map((sec) => ({ dateStyle, sec }))))(
  'preserves $dateStyle dates and sec=$sec after changing to date-time and saving', async ({ dateStyle, sec }) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const value = 45306.5 + 15 / 86400;
    wb.setCells(id, [{ r: 0, c: 0, cell: { v: value, s: { fmt: 'date', dateStyle } } }]);
    // The toolbar changes the category while retaining the chosen date style.
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'datetime', sec });
    const code = `${dates[dateStyle][0]} ${sec ? 'hh:mm:ss' : 'hh:mm'}`;
    const display = `${dates[dateStyle][1]} 12:00${sec ? ':15' : ''}`;
    expect(wb.getDisplay(id, 0, 0)).toBe(display);
    expect(styleToNumFmt(wb.getCell(id, 0, 0).s)).toBe(code);
    const bytes = await (await workbookToXlsx(wb)).arrayBuffer();
    const raw = XLSX.read(bytes, { type: 'array', cellNF: true });
    const cell = raw.Sheets[raw.SheetNames[0]].A1;
    expect(cell.v).toBe(value);
    expect(cell.z).toBe(code);
    expect(XLSX.SSF.format(cell.z, cell.v)).toBe(display);
    const back = await workbookFromFile(bytes, 'dates.xlsx');
    const style = back.getCell(back.activeSheetId, 0, 0).s;
    expect(style.fmt).toBe('datetime');
    expect(style.dateStyle || 'iso').toBe(dateStyle);
    expect(!!style.sec).toBe(sec);
    expect(back.getValue(back.activeSheetId, 0, 0)).toBe(value);
    expect(back.getDisplay(back.activeSheetId, 0, 0)).toBe(display);
  },
);

it.each(['medium', 'long'].flatMap((dateStyle) => [false, true].map((sec) => ({ dateStyle, sec }))))(
  'recognizes an external $dateStyle date-time format with sec=$sec', async ({ dateStyle, sec }) => {
    const code = `${dates[dateStyle][0]} ${sec ? 'hh:mm:ss' : 'hh:mm'}`;
    const expected = { fmt: 'datetime', dateStyle, ...(sec ? { sec: true } : {}) };
    expect(numFmtToStyle(code)).toEqual(expected);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 'n', v: 45306.5, z: code } }, 'Data');
    const wb = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'external.xlsx');
    expect(wb.getCell(wb.activeSheetId, 0, 0).s).toEqual({ valign: 'bottom', ...expected, font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR });
  },
);

it.each(['mmm dd, yyyy hh:mm', 'mmmm d, yyyy h:mm AM/PM', 'mmmm d, yyyy hh:mm:ss.000', '"On "mmmm d, yyyy hh:mm'])(
  'preserves the custom date-time code %s when named styles cannot express it', (code) => {
    expect(numFmtToStyle(code)).toEqual({ fmt: 'custom', code });
  },
);
