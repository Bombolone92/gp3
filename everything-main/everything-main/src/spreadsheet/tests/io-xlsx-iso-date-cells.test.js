import { DEFAULT_FONT_COLOR } from '../src/core/font-color.js';
import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile } from '../src/core/io.js';

/** An .xlsx whose first sheet holds the given cells, with one extra cell style carrying a yyyy-mm-dd format. */
async function open(cells) {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([['x']]), 'Data');
  const zip = X.CFB.read(new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const sheet = X.CFB.find(zip, '/xl/worksheets/sheet1.xml');
  sheet.content = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cells}</row></sheetData></worksheet>`);
  sheet.size = sheet.content.length;
  const styles = X.CFB.find(zip, '/xl/styles.xml');
  const xml = new TextDecoder().decode(styles.content);
  expect(xml).toMatch(/<cellXfs count="\d+">/);
  styles.content = new TextEncoder().encode(xml
    .replace(/<numFmts[^>]*>[\s\S]*?<\/numFmts>|(<fonts)/, (m, fonts) => `<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>${fonts || ''}`)
    .replace(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/, (m, n, body) => `<cellXfs count="${Number(n) + 1}">${body}<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>`));
  styles.size = styles.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'dates.xlsx');
}

// A cell typed as an ISO date (t="d") is converted to a serial on the way in, and arrived
// with no number format, so the file's 2024-02-29 showed as 45351. Without a format of
// its own such a cell is a date, or a date and time when the value has a time of day.
it('shows an ISO date cell as a date rather than its serial number', async () => {
  const wb = await open('<c r="A1" t="d"><v>2024-02-29</v></c><c r="B1" t="d"><v>2024-02-29T10:30:00</v></c><c r="C1" t="d"><v>1900-03-01</v></c>');
  const id = wb.activeSheetId;
  expect(wb.getValue(id, 0, 0)).toBe(45351);
  expect(wb.getCell(id, 0, 0).s).toMatchObject({ fmt: 'date' });
  expect(wb.getDisplay(id, 0, 0)).not.toBe('45351');
  expect(wb.getDisplay(id, 0, 0)).toMatch(/2024/);
  expect(wb.getValue(id, 0, 1)).toBeCloseTo(45351 + 10.5 / 24, 6);
  expect(wb.getCell(id, 0, 1).s).toMatchObject({ fmt: 'datetime' });
  expect(wb.getDisplay(id, 0, 1)).toMatch(/10:30/);
  expect(wb.getValue(id, 0, 2)).toBe(61);
  expect(wb.getCell(id, 0, 2).s).toMatchObject({ fmt: 'date' });
});

it('keeps the number format an ISO date cell has of its own', async () => {
  const wb = await open('<c r="A1" s="1" t="d"><v>2024-02-29</v></c>');
  const id = wb.activeSheetId;
  expect(wb.getValue(id, 0, 0)).toBe(45351);
  expect(wb.getDisplay(id, 0, 0)).toBe('2024-02-29');
});

it('leaves plain number cells and ISO cells of other readers alone', async () => {
  const wb = await open('<c r="A1"><v>45351</v></c><c r="B1" t="n"><v>7</v></c>');
  const id = wb.activeSheetId;
  expect(wb.getCell(id, 0, 0).s).toEqual({ valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR });
  expect(wb.getDisplay(id, 0, 0)).toBe('45351');
  expect(wb.getDisplay(id, 0, 1)).toBe('7');
});

it('uses the 1900 calendar for real ISO instants before March without losing time', async () => {
  const wb = await open('<c r="A1" t="d"><v>1900-01-01</v></c><c r="B1" t="d"><v>1900-02-28T12:00:00Z</v></c><c r="C1" t="d"><v>1900-03-01</v></c>');
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(1);
  expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(59.5);
  expect(wb.getDisplay(wb.activeSheetId, 0, 1)).toBe('1900-02-28 12:00');
  expect(wb.getValue(wb.activeSheetId, 0, 2)).toBe(61);
});
