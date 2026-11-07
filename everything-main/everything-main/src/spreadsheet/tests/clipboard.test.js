// @vitest-environment jsdom
import { stampClipboardHtml } from './helpers/clipboard.js';
import { describe, it, expect } from 'vitest';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';
import { sheetToHtml, workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { editText } from '../src/core/format.js';

describe('rich clipboard', () => {
  // A 5,001-row snapshot takes a few seconds on a busy machine; the default 5 s test timeout is too tight for it.
it('keeps exact value snapshots beyond the formula-metadata size limit', { timeout: 60000 }, () => {
    const values = Array.from({ length: 5001 }, () => [1.23456]);
    const cells = values.map(() => [{ f: '1.23456', s: { fmt: 'number', dec: 2 } }]);
    const html = cellsToHtml(values.map(() => ['1.23']), cells, null, values);
    const parsed = parseHtmlClipboard(html);
    expect(parsed.cells).toBeUndefined();
    expect(parsed.values).toEqual(values);
    expect(parsed.rows).toHaveLength(5001);
  });

  it.each(['[[1,2]]', '[[1],[2]]', '[[{"toString":null}]]', '[[{"error":{}}]]', '[[1e400]]', '{invalid'])
    ('ignores a malformed optional value snapshot: %s', (snapshot) => {
      const parsed = parseHtmlClipboard(stampClipboardHtml(`<table data-spreadsheet-cells='[[{"v":10}]]' data-spreadsheet-values='${snapshot}'><tr><td>10</td></tr></table>`));
      expect(parsed.cells).toEqual([[{ v: 10 }]]);
      expect(parsed.values).toBeUndefined();
    });

  it('escapes copied literal values in snapshot metadata', () => {
    const value = '"><img src=x onerror="alert(1)">';
    const html = cellsToHtml([[value]], [[{ v: value }]], null, [[value]]);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('img, [onerror]')).toBeNull();
    expect(parseHtmlClipboard(html).values).toEqual([[value]]);
  });

  it.each([0, 1, 2])('preserves an empty HTML row at index %s when pasting over existing cells', (emptyRow) => {
    const markup = ['<tr><td>A</td><td>10</td></tr>', '<tr><td>B</td><td>20</td></tr>'];
    markup.splice(emptyRow, 0, '<tr style="height:26px"></tr>');
    const parsed = parseHtmlClipboard(`<table>${markup.join('')}</table>`);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[emptyRow]).toEqual([{ text: '', style: undefined }, { text: '', style: undefined }]);
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, emptyRow, 0, 'Old value');
    wb.setInput(id, emptyRow, 1, '99');
    wb.setCells(id, cellsFromHtmlRows(parsed.rows).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
    expect(wb.getValue(id, emptyRow, 0)).toBeNull();
    expect(wb.getValue(id, emptyRow, 1)).toBeNull();
    const expected = ['A', 'B']; expected.splice(emptyRow, 0, null);
    expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual(expected);
  });

  it('ignores tables with no cell columns instead of clearing a destination', () => {
    expect(parseHtmlClipboard('<table><tbody><tr></tr><tr></tr></tbody></table>')).toBeNull();
  });

  it.each([
    { f: { toString: null } },
    { f: ['SUM(A1)'] },
    { v: { toString: null } },
    { v: { error: { toString: null } } },
    { v: ['hidden', 'values'] },
    { v: 10, s: 'currency' },
    { v: 10, s: { cur: { toString: null } } },
  ])('falls back to visible text for malformed embedded cell content: %j', (cell) => {
    const parsed = parseHtmlClipboard(stampClipboardHtml(`<table data-spreadsheet-cells='${JSON.stringify([[cell]])}'><tr><td>Visible value</td></tr></table>`));
    expect(parsed.cells).toBeUndefined();
    const cells = cellsFromHtmlRows(parsed.rows).map(({ i, j, cell: value }) => ({ r: i, c: j, cell: value }));
    const wb = new Workbook();
    wb.setCells(wb.activeSheetId, cells);
    expect(wb.getDisplay(wb.activeSheetId, 0, 0)).toBe('Visible value');
    expect(editText(wb.getCell(wb.activeSheetId, 0, 0))).toBe('Visible value');
  });

  it('preserves valid embedded scalar values, error constants, formulas, and styles', () => {
    const cells = [[null, { v: true }, { v: 1.5 }, { v: 'Text' }, { v: { error: '#N/A' } },
      { f: 'SUM(A1:A3)', s: { fmt: 'currency', cur: 'EUR', dec: 2, bold: true, bc: '#112233', bs: 'dashed' } }]];
    const html = cellsToHtml([['', 'TRUE', '1.5', 'Text', '#N/A', '1.50']], cells);
    expect(parseHtmlClipboard(html).cells).toEqual(cells);
  });

  it.each([
    [[{ v: 'Value' }], null],
    [[{ v: 'Value' }], []],
    [[]],
    [['Value']],
  ])('falls back to visible table cells for malformed embedded data %#', (...cells) => {
    const html = stampClipboardHtml(`<table data-spreadsheet-cells='${JSON.stringify(cells)}'><tr><td>Visible value</td></tr></table>`);
    const parsed = parseHtmlClipboard(html);
    expect(parsed.cells).toBeUndefined();
    expect(parsed.rows).toEqual([[{ text: 'Visible value', style: undefined }]]);
  });

  it.each(['200001', '99999999999999999999'])('bounds column span %s to the browser’s table dimensions', (span) => {
    const parsed = parseHtmlClipboard(`<table><tr><td colspan="${span}">Value</td></tr></table>`);
    expect(parsed.rows[0]).toHaveLength(1000);
    expect(parsed.rows[0][0].text).toBe('Value');
  });

  it('keeps imported style values inside the style attribute in clipboard and exported HTML', async () => {
    const wb = new Workbook();
    const sheet = wb.sheets[0];
    wb.setInput(sheet.id, 0, 0, 'Untrusted style');
    wb.applyStyle(sheet.id, { r1: 0, c1: 0, r2: 0, c2: 0 }, {
      color: 'red\"><img src=x onerror="window.injected=true"><span title="',
    });
    // Imported metadata preserves cell styles, including values outside the color picker.
    const blob = await workbookToXlsx(wb);
    const bytes = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    const imported = await workbookFromFile(new Uint8Array(bytes), 'styles.xlsx');
    const id = imported.sheets[0].id;
    const cell = imported.getCell(id, 0, 0);
    const clipboard = cellsToHtml([['Untrusted style']], [[cell]]);
    for (const html of [clipboard, sheetToHtml(imported, id)]) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      expect(doc.querySelector('img, [onerror]')).toBeNull();
      expect(doc.querySelector('td').textContent).toBe('Untrusted style');
    }
    expect(parseHtmlClipboard(clipboard).cells).toEqual([[cell]]);
  });

  it('writes an HTML table with inline styles and the cells embedded', () => {
    const cells = [[{ v: 'Item', f: null, s: { bold: true, bg: '#eeeeee' } }, { v: 1500, f: null, s: { fmt: 'currency' } }], [null, { v: null, f: 'SUM(B1)' }]];
    const html = cellsToHtml([['Item', '$1,500.00'], ['', '$1,500.00']], cells);
    expect(html).toContain('<td style="vertical-align:middle;font-weight:bold;background-color:#eeeeee;white-space:nowrap">Item</td>');
    expect(html).toContain('<td style="vertical-align:middle;white-space:nowrap">$1,500.00</td>');
    expect(html).toContain('data-spreadsheet-cells=');
    const back = parseHtmlClipboard(html);
    expect(back.cells).toEqual(cells);
  });

  it('reads tables from other apps with basic styling', () => {
    const html = `<html><body><table><tr><th>Name</th><th style="text-align:right">Qty</th></tr>
      <tr><td style="color: rgb(255, 0, 0); font-weight: bold">Ann<br>Lee</td><td align="right" bgcolor="#ffff00">3</td></tr>
      <tr><td colspan="2">wide</td></tr></table></body></html>`;
    const parsed = parseHtmlClipboard(html);
    expect(parsed.cells).toBeUndefined();
    expect(parsed.rows.length).toBe(3);
    expect(parsed.rows[0][0]).toEqual({ text: 'Name', style: { bold: true } });
    expect(parsed.rows[0][1].style).toEqual({ bold: true, align: 'right' });
    expect(parsed.rows[1][0]).toEqual({ text: 'Ann\nLee', style: { bold: true, color: '#ff0000' } });
    expect(parsed.rows[1][1]).toEqual({ text: '3', style: { bg: '#ffff00', align: 'right' } });
    expect(parsed.rows[2]).toEqual([{ text: 'wide', style: undefined }, { text: '', style: undefined }]);
    const entries = cellsFromHtmlRows(parsed.rows);
    expect(entries.find((e) => e.i === 1 && e.j === 1).cell).toEqual({ v: 3, f: null, s: { bg: '#ffff00', align: 'right' } });
    expect(entries.find((e) => e.i === 2 && e.j === 1).cell).toBeNull();
  });

  it('wraps pasted text that runs over several lines, as an Alt+Enter entry does', () => {
    const parsed = parseHtmlClipboard('<table><tr><td>Ann<br>Lee</td><td>one line</td><td x:str>a<br>b</td><td style="white-space:pre-wrap">x<br>y</td></tr></table>');
    const cells = cellsFromHtmlRows(parsed.rows).map(({ cell }) => cell);
    expect(cells[0]).toEqual({ v: 'Ann\nLee', f: null, s: { wrap: true } });
    expect(cells[1]).toEqual({ v: 'one line', f: null });
    expect(cells[2]).toEqual({ v: 'a\nb', f: null, s: { wrap: true } });
    expect(cells[3]).toEqual({ v: 'x\ny', f: null, s: { wrap: true } });
  });

  it('ignores markup without a table', () => {
    expect(parseHtmlClipboard('<p>hello</p>')).toBeNull();
    expect(parseHtmlClipboard('')).toBeNull();
  });

  it('keeps cells in their columns around row and column spans', () => {
    const parsed = parseHtmlClipboard('<table><tr><th rowspan="2" colspan="2">Group</th><th>Amount</th></tr><tr><td>12</td></tr><tr><td>A</td><td>B</td><td>24</td></tr></table>');
    expect(parsed.rows.map((row) => row.map((cell) => cell.text))).toEqual([
      ['Group', '', 'Amount'], ['', '', '12'], ['A', 'B', '24'],
    ]);
    const entries = cellsFromHtmlRows(parsed.rows);
    expect(entries.find((e) => e.i === 1 && e.j === 2).cell.v).toBe(12);
    expect(entries.find((e) => e.i === 1 && e.j === 0).cell).toBeNull();
  });

  it.each(['0', '999999999'])('limits row span %s to its existing row group', (span) => {
    const parsed = parseHtmlClipboard(`<table><tbody><tr><td rowspan="${span}">Group</td><td>1</td></tr><tr><td>2</td></tr></tbody><tbody><tr><td>Next group</td><td>3</td></tr></tbody></table>`);
    expect(parsed.rows.map((row) => row.map((cell) => cell.text))).toEqual([
      ['Group', '1'], ['', '2'], ['Next group', '3'],
    ]);
  });
});

describe('conditional looks in copied HTML', () => {
  it('paints the on-screen colors into the table without changing the embedded cells', () => {
    const cells = [[{ v: 5, s: { bold: true } }]];
    const html = cellsToHtml([['5']], cells, [[{ bg: '#ff0000', color: '#ffffff' }]]);
    expect(html).toContain('background-color:#ff0000');
    expect(html).toContain('color:#ffffff');
    expect(html).toContain('font-weight:bold');
    expect(html).toContain('data-spreadsheet-cells=');
    expect(html).not.toContain('ff0000&quot;'); // the embedded cells carry only the real style
    expect(cellsToHtml([['5']], cells)).not.toContain('background-color');
  });
});
