// @vitest-environment jsdom
import { stampClipboardHtml } from './helpers/clipboard.js';
import { describe, expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { META_SHEET, workbookFromFile } from '../src/core/io.js';
import { numFmtToStyle, styleToNumFmt } from '../src/core/format.js';
import { MAX_FORMAT_CODE_LENGTH, formatCodeError } from '../src/core/numfmt.js';
import { parseHtmlClipboard } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';

// A format code may be 255 characters at most, and the two dialogs here refused longer; a file, its
// sidecar or a paste could still bring in a 32,000-character code, which cost some ten
// milliseconds for every cell shown through it and froze the grid. Such a code now reads as
// General at every door, as a malformed one already did.
const LONG = '0'.repeat(32000);
const LONGEST = '0'.repeat(MAX_FORMAT_CODE_LENGTH);
const ROWS = 300;
const TIME_LIMIT_MS = 1500; // the 300 cells cost 3–4 seconds through the long code, a few milliseconds without

/** A file of ROWS numbers in column A, formatted by a cell code `z`, or by the sidecar's style for the first `metaCells` of them. */
function file({ z, metaCode, metaCells = 3 } = {}) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(Array.from({ length: ROWS }, (_, i) => [i + 0.5]));
  if (z) for (let i = 0; i < ROWS; i++) sheet[`A${i + 1}`].z = z;
  XLSX.utils.book_append_sheet(book, sheet, 'Data');
  if (metaCode) {
    const styles = Object.fromEntries(Array.from({ length: metaCells }, (_, i) => [`${i},0`, { fmt: 'custom', code: metaCode, bold: true }]));
    // The sidecar is written in rows of at most a cell's worth of text, as this app writes it.
    const json = JSON.stringify({ v: 1, sheets: { Data: { styles } } });
    const chunks = Array.from({ length: Math.ceil(json.length / 30000) }, (_, i) => [json.slice(i * 30000, (i + 1) * 30000)]);
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(chunks), META_SHEET);
  }
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' });
}

/** Every cell of the column shown, timed. */
function showAll(wb) {
  const id = wb.activeSheetId;
  const start = performance.now();
  const shown = Array.from({ length: ROWS }, (_, r) => wb.getDisplay(id, r, 0));
  return { shown, ms: performance.now() - start };
}

describe('a format code longer than the 255-character limit', () => {
  it('is the limit the dialogs already apply', () => {
    expect(MAX_FORMAT_CODE_LENGTH).toBe(255);
    expect(formatCodeError(LONGEST)).toBeNull();
    expect(formatCodeError(`${LONGEST}0`)).toMatch(/255 characters/);
    expect(numFmtToStyle(LONGEST)).toEqual({ fmt: 'custom', code: LONGEST });
    expect(numFmtToStyle(`${LONGEST}0`)).toBeNull();
    expect(numFmtToStyle(LONG)).toBeNull();
  });

  it('reads as General when it comes in a file\'s cell formats, and the column shows at once', { timeout: 60000 }, async () => {
    const wb = await workbookFromFile(file({ z: LONG }), 'long.xlsx');
    const cell = wb.getCell(wb.activeSheetId, 0, 0);
    expect(cell.s?.code).toBeUndefined();
    expect(cell.s?.fmt).toBeUndefined();
    expect(styleToNumFmt(cell.s)).toBe('General');
    const { shown, ms } = showAll(wb);
    expect(shown[0]).toBe('0.5');
    expect(shown[ROWS - 1]).toBe(`${ROWS - 0.5}`);
    expect(ms).toBeLessThan(TIME_LIMIT_MS);
    // At the limit, the code is kept and used.
    const kept = await workbookFromFile(file({ z: LONGEST }), 'longest.xlsx');
    expect(kept.getCell(kept.activeSheetId, 0, 0).s).toMatchObject({ fmt: 'custom', code: LONGEST });
  });

  it('reads as General when it comes in the sidecar, keeping the style\'s other fields', { timeout: 60000 }, async () => {
    const wb = await workbookFromFile(file({ metaCode: LONG }), 'meta.xlsx');
    const id = wb.activeSheetId;
    expect(wb.getCell(id, 0, 0).s).toEqual({ bold: true });
    expect(wb.getCell(id, 2, 0).s).toEqual({ bold: true });
    expect(wb.getDisplay(id, 0, 0)).toBe('0.5');
    expect(wb.getDisplay(id, 2, 0)).toBe('2.5');
    const kept = await workbookFromFile(file({ metaCode: LONGEST }), 'meta-longest.xlsx');
    expect(kept.getCell(kept.activeSheetId, 0, 0).s).toEqual({ fmt: 'custom', code: LONGEST, bold: true });
    expect(kept.getDisplay(kept.activeSheetId, 0, 0)).toHaveLength(MAX_FORMAT_CODE_LENGTH); // padded by the code, so it is in use
  });

  it('is dropped from pasted HTML, whether Excel\'s mso-number-format or this app\'s own cells', { timeout: 60000 }, () => {
    const excel = parseHtmlClipboard(`<table><tr><td style="mso-number-format:'${LONG}'">1</td><td style="mso-number-format:'0\\.00'">2</td></tr></table>`).rows[0];
    expect(excel[0].style?.code).toBeUndefined();
    expect(excel[0].style?.fmt).toBeUndefined();
    expect(excel[1].style).toMatchObject({ fmt: 'number', dec: 2 });
    const own = (code) => parseHtmlClipboard(stampClipboardHtml(`<table data-spreadsheet-cells='${JSON.stringify([[{ v: 1, f: null, s: { fmt: 'custom', code, bold: true } }]])}'><tr><td>1</td></tr></table>`)).cells[0][0];
    expect(own(LONG).s).toEqual({ bold: true });
    expect(own(LONGEST).s).toEqual({ fmt: 'custom', code: LONGEST, bold: true });
    // Pasted, the cells show at once.
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.pasteCells(id, Array.from({ length: ROWS }, (_, i) => [{ ...own(LONG), v: i + 0.5 }]), 0, 0, { r: 0, c: 0 });
    const { shown, ms } = showAll(wb);
    expect(shown[0]).toBe('0.5');
    expect(ms).toBeLessThan(TIME_LIMIT_MS);
  });
});
