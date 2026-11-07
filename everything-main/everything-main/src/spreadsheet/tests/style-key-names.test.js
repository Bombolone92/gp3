import { describe, expect, it } from 'vitest';
import { stampClipboardHtml } from './helpers/clipboard.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import { parseHtmlClipboard, cellsToHtml } from '../src/core/clipboard.js';

describe('cell style keys that every object inherits', () => {
  it('do not stop a saved file from opening again', async () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setCells(id, [{ r: 0, c: 0, cell: { v: 'x', s: { toString: true, bold: true, constructor: 'y', hasOwnProperty: 1, align: 'center' } } }], 'paste');
    const buf = await workbookToXlsx(wb);
    const back = await workbookFromFile(buf, 'styles.xlsx');
    const cell = back.getCell(back.activeSheetId, 0, 0);
    expect(cell.v).toBe('x');
    expect(cell.s).toEqual({ bold: true, align: 'center' });
  });
});

describe('embedded cells pasted from another tab', () => {
  it('refuse style keys named like inherited object members', () => {
    if (typeof DOMParser === 'undefined') return;
    const html = (style) => stampClipboardHtml(`<table data-spreadsheet-cells='${JSON.stringify([[{ v: 'x', s: style }]])}'><tr><td>x</td></tr></table>`);
    expect(parseHtmlClipboard(html({ bold: true, color: '#ff0000', bc: '#112233', bs: 'dashed' }))?.cells?.[0]?.[0]?.s).toEqual({ bold: true, color: '#ff0000', bc: '#112233', bs: 'dashed' });
    expect(parseHtmlClipboard(html({ toString: true }))?.cells).toBeUndefined();
    expect(parseHtmlClipboard(html({ __proto__: { bold: true }, constructor: 'x' }))?.cells).toBeUndefined();
  });
});
