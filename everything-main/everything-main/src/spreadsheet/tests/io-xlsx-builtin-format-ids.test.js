import { DEFAULT_FONT_COLOR } from '../src/core/font-color.js';
import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

/**
 * An .xlsx whose cells use built-in number format ids with no <numFmt> entry
 * for them, as openpyxl and other generators write Currency, Accounting and
 * the locale date formats; cell n of column A uses styleIds[n].
 */
function withBuiltinIds(styleIds, values) {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([['x']]), 'Data');
  const zip = X.CFB.read(new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const sheet = X.CFB.find(zip, '/xl/worksheets/sheet1.xml');
  const rows = styleIds.map((_, i) => `<row r="${i + 1}"><c r="A${i + 1}" s="${i + 1}"><v>${values[i]}</v></c></row>`).join('');
  sheet.content = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`);
  sheet.size = sheet.content.length;
  const styles = X.CFB.find(zip, '/xl/styles.xml');
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', ...styleIds.map((id) => `<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`)];
  const xml = new TextDecoder().decode(styles.content).replace(/<numFmts[\s\S]*?<\/numFmts>/, '').replace(/<cellXfs[\s\S]*?<\/cellXfs>/, `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`);
  expect(xml).not.toContain('<numFmt ');
  styles.content = new TextEncoder().encode(xml); styles.size = styles.content.length;
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

const ACCOUNTING = '_("$"* #,##0.00_);_("$"* (#,##0.00);_("$"* "-"??_);_(@_)';
const CURRENCY = '"$"#,##0_);\\("$"#,##0\\)';

// The reader's table of built-in formats lacks Excel's Currency (5-8), Accounting (41-44)
// and locale date ids. It knows Excel's code for such an id and fills it in on meeting the
// id, but only after handing the cell the table's entry, so the first cell of each such id
// (every cell, where the id was used once) opened as General: -1234.5 for an Accounting
// cell Excel shows as $ (1,234.50).
it('reads cells formatted by a built-in id alone with that format, from the first cell on', async () => {
  const ids = [44, 44, 5, 8, 41, 43, 42];
  const wb = await workbookFromFile(withBuiltinIds(ids, ids.map(() => -1234.5)), 'accounting.xlsx');
  const id = wb.activeSheetId;
  expect(wb.getCell(id, 0, 0).s).toEqual({ valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, fmt: 'custom', code: ACCOUNTING });
  expect(wb.getCell(id, 1, 0).s).toEqual({ valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, fmt: 'custom', code: ACCOUNTING });
  expect(wb.getCell(id, 2, 0).s).toEqual({ valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, fmt: 'custom', code: CURRENCY });
  expect(wb.getCell(id, 3, 0).s).toEqual({ valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, fmt: 'custom', code: '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)' });
  expect(wb.getCell(id, 4, 0).s).toEqual({ valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, fmt: 'custom', code: '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)' });
  expect(wb.getCell(id, 5, 0).s).toEqual({ valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, fmt: 'custom', code: '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)' });
  expect(wb.getCell(id, 6, 0).s).toEqual({ valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, fmt: 'custom', code: '_("$"* #,##0_);_("$"* (#,##0);_("$"* "-"_);_(@_)' });
  expect(wb.getDisplay(id, 0, 0)).toContain('(1,234.50)');
  expect(wb.getDisplay(id, 2, 0).replace(/\s/g, '')).toBe('($1,235)');
  expect(wb.getDisplay(id, 4, 0).replace(/\s/g, '')).toBe('(1,235)');
  // Saved again, the file spells the codes out, as Excel does for these ids.
  const saved = X.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array', cellNF: true });
  expect(saved.Sheets.Data.A1.z).toBe(ACCOUNTING);
  expect(saved.Sheets.Data.A3.z).toBe(CURRENCY);
});

it('reads the locale calendar, time and Thai number ids as the short date, time and plain number codes', async () => {
  const ids = [27, 30, 58, 32, 33, 71, 59, 62, 67];
  const values = [45306.5, 45306.5, 45306.5, 0.75, 0.75, 45306.5, -1234.5, -1234.5, 0.125];
  const wb = await workbookFromFile(withBuiltinIds(ids, values), 'locale.xlsx');
  const id = wb.activeSheetId;
  for (const r of [0, 1, 2, 5]) {
    expect(wb.getCell(id, r, 0).s).toEqual({ valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, fmt: 'custom', code: 'm/d/yy' });
    expect(wb.getDisplay(id, r, 0)).toBe('1/15/24');
  }
  for (const r of [3, 4]) {
    expect(wb.getCell(id, r, 0).s).toEqual({ valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, fmt: 'custom', code: 'h:mm:ss' });
    expect(wb.getDisplay(id, r, 0)).toBe('18:00:00');
  }
  expect(wb.getCell(id, 6, 0).s).toEqual({ valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, fmt: 'number', dec: 0, group: false });
  expect(wb.getCell(id, 7, 0).s).toEqual({ valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, fmt: 'number', dec: 2, group: true });
  expect(wb.getCell(id, 8, 0).s).toEqual({ valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, fmt: 'percent', dec: 0, group: false });
  expect(wb.getDisplay(id, 7, 0)).toBe('-1,234.50');
});

it('leaves the ids the reader defines, cells with a spelled-out code, and plain cells as they were', async () => {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([[{ t: 'n', v: 0.125, z: '0.00%' }, { t: 'n', v: 45306.5, z: 'm/d/yy' }, { t: 'n', v: 1234.5, z: '#,##0.00' }, 1234.5, 'text', true]]), 'Data');
  const wb = await workbookFromFile(X.write(book, { type: 'array', bookType: 'xlsx' }), 'plain.xlsx');
  const id = wb.activeSheetId;
  expect(wb.getCell(id, 0, 0).s).toEqual({ valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, fmt: 'percent', dec: 2, group: false });
  expect(wb.getCell(id, 0, 1).s).toEqual({ valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, fmt: 'custom', code: 'm/d/yy' });
  expect(wb.getCell(id, 0, 2).s).toEqual({ valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, fmt: 'number', dec: 2, group: true });
  for (const c of [3, 4, 5]) expect(wb.getCell(id, 0, c).s).toEqual({ valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR });
});
