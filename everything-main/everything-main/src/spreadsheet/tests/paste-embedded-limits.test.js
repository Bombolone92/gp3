// @vitest-environment jsdom
import { stampClipboardHtml } from './helpers/clipboard.js';
import { describe, expect, it } from 'vitest';
import { parseHtmlClipboard } from '../src/core/clipboard.js';
import { MAX_TEXT } from '../src/core/cell.js';
import { MAX_FORMULA_LENGTH, MAX_FORMULA_NESTING, Workbook } from '../src/core/workbook.js';

// Typed input keeps no more text than a file can store, and a formula longer than the format allows
// or nested deeper than the parser follows stays text. The cells embedded in HTML from another
// tab (or any page that writes the attribute) went into the sheet with no such limits, so a
// paste could store what a typed entry never could.
describe('limits on cells embedded in pasted HTML', () => {
  const embed = (cells) => parseHtmlClipboard(stampClipboardHtml(`<table data-spreadsheet-cells='${JSON.stringify(cells)}'><tr>${cells[0].map(() => '<td>x</td>').join('')}</tr></table>`)).cells;

  it('keeps no more text than a typed cell may hold', () => {
    const [[cell]] = embed([[{ v: 'x'.repeat(MAX_TEXT + 5), f: null, s: { bold: true } }]]);
    expect(cell.v).toHaveLength(MAX_TEXT);
    expect(cell.s).toEqual({ bold: true });
  });

  it('cuts the text on a character boundary, dropping an emoji that straddles the limit whole', () => {
    const [[cell]] = embed([[{ v: `${'a'.repeat(MAX_TEXT - 1)}😀tail`, f: null }]]);
    expect(cell.v).toHaveLength(MAX_TEXT - 1);
    expect(cell.v.isWellFormed()).toBe(true);
    expect(cell.v.endsWith('a')).toBe(true);
  });

  it('turns a formula longer or nested deeper than a typed one may be into the text it reads as', () => {
    const long = `${'1+'.repeat(Math.ceil(MAX_FORMULA_LENGTH / 2))}1`;
    const deep = `${'('.repeat(MAX_FORMULA_NESTING + 1)}1${')'.repeat(MAX_FORMULA_NESTING + 1)}`;
    const [[a, b, c]] = embed([[{ v: null, f: long }, { v: null, f: deep }, { v: 6, f: 'SUM(B2:B4)' }]]);
    expect(a).toEqual({ v: `=${long}`, f: null });
    expect(b).toEqual({ v: `=${deep}`, f: null });
    expect(c).toEqual({ v: 6, f: 'SUM(B2:B4)' });
    // Pasted, they land as the same entries typed would.
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.pasteCells(id, [[a, b, c]], 0, 0, { r: 0, c: 0 });
    expect(wb.getValue(id, 0, 0)).toBe(`=${long}`);
    expect(wb.getValue(id, 0, 1)).toBe(`=${deep}`);
    expect(wb.getCell(id, 0, 2).f).toBe('SUM(B2:B4)');
  });
});
