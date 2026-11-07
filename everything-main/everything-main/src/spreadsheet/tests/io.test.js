import { DEFAULT_FONT_COLOR } from '../src/core/font-color.js';
import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookToOds, workbookFromFile, sheetToCsv, rangeToCsv, sheetToTsv, sheetToHtml, META_SHEET, isSpreadsheetFile, stripExtension, decodeText } from '../src/core/io.js';
import { parseCellRef, parseRange } from '../src/core/cell.js';
import * as XLSX from '../src/vendor/xlsx.mjs';

function build() {
  const wb = new Workbook({ sheets: [{ name: 'Budget' }, { name: 'Data' }] });
  const [budget, data] = wb.sheets;
  const set = (sheet, a1, text) => { const { r, c } = parseCellRef(a1); wb.setInput(sheet.id, r, c, text); };
  set(budget, 'A1', 'Item');
  set(budget, 'B1', 'Amount');
  set(budget, 'A2', 'Rent');
  set(budget, 'B2', '1500');
  set(budget, 'A3', 'Food');
  set(budget, 'B3', '450.5');
  set(budget, 'B4', '=SUM(B2:B3)');
  set(budget, 'C2', '12%');
  set(budget, 'D2', '2024-01-15');
  set(budget, 'E2', 'TRUE');
  set(budget, 'F2', '=Data!A1*2');
  set(data, 'A1', '21');
  wb.applyStyle(budget.id, parseRange('A1:B1'), { bold: true, bg: '#eeeeee' });
  wb.applyBorders(budget.id, parseRange('A1:B4'), 'outer');
  wb.applyStyle(budget.id, parseRange('B2:B4'), { fmt: 'currency', dec: 2 });
  wb.setColWidth(budget.id, 0, 180);
  wb.setFrozen(budget.id, 1, 1);
  wb.setHidden(budget.id, 'col', [5], true);
  wb.setHidden(budget.id, 'row', [2], true);
  wb.mergeCells(budget.id, parseRange('A6:C7'));
  wb.defineName('Amounts', 'Budget!$B$2:$B$3');
  wb.setNote(budget.id, 1, 0, 'Due on the 1st');
  wb.setNote(budget.id, 9, 9, 'Note on an empty cell');
  wb.addRule(budget.id, { range: parseRange('B2:B3'), type: 'gt', value: 1000, style: { bg: '#fde8e8' } });
  wb.addValidation(budget.id, { range: parseRange('E2:E5'), type: 'checkbox' });
  wb.setSheetColor(data.id, '#1baf7a');
  wb.addSheet('Hidden one');
  wb.setSheetHidden(wb.sheets[2].id, true);
  wb.setFilterRange(budget.id, parseRange('A1:B3'));
  wb.setFilterCriteria(budget.id, 0, { values: ['Rent'] });
  set(budget, 'G2', '=SUM(Amounts)');
  set(budget, 'H1', '=SORT(B2:B3)');
  wb.addChart(budget.id, { type: 'pie', range: parseRange('A2:B3'), title: 'Spend', anchor: { r: 5, c: 4 }, dx: 3, dy: 2, w: 320, h: 200, seriesIn: 'auto', headers: false, legend: true, stacked: false });
  set(budget, 'A8', '=HYPERLINK("https://puter.com","Puter")');
  set(budget, 'A9', 'https://docs.puter.com');
  wb.setRowHeight(budget.id, 0, 36);
  wb.activeSheetId = data.id;
  return wb;
}

describe('xlsx round trip', () => {
  it('preserves values, formulas, formats, layout, and styles', async () => {
    const wb = build();
    const blob = await workbookToXlsx(wb);
    expect(blob.type).toContain('spreadsheetml');
    const back = await workbookFromFile(await blob.arrayBuffer(), 'test.xlsx');

    expect(back.sheets.map((s) => s.name)).toEqual(['Budget', 'Data', 'Hidden one']);
    expect(back.sheets.map((s) => s.hidden)).toEqual([false, false, true]);

    const [budget, data] = back.sheets;
    const cell = (a1) => { const { r, c } = parseCellRef(a1); return back.getCell(budget.id, r, c); };
    const show = (a1) => { const { r, c } = parseCellRef(a1); return back.getDisplay(budget.id, r, c); };
    expect(budget.charts).toHaveLength(1);
    expect(budget.charts[0]).toMatchObject({ type: 'pie', title: 'Spend', anchor: { r: 5, c: 4 }, w: 320, h: 200, headers: false });

    expect(cell('A2').v).toBe('Rent');
    expect(cell('B2').v).toBe(1500);
    expect(cell('B4').f).toBe('SUM(B2:B3)');
    expect(cell('H1').f).toBe('SORT(B2:B3)');
    expect(cell('H2')).toBeUndefined(); // spilled cells come back as spills, not values
    expect(back.getValue(budget.id, 1, 7)).toBe(1500);
    expect(cell('A8').f).toBe('HYPERLINK("https://puter.com","Puter")');
    expect(back.linkAt(budget.id, 7, 0)).toEqual({ url: 'https://puter.com', label: 'Puter' });
    expect(cell('A9').v).toBe('https://docs.puter.com');
    expect(back.linkAt(budget.id, 8, 0)?.url).toBe('https://docs.puter.com');
    expect(show('B4')).toBe('$1,950.50');
    expect(show('C2')).toBe('12%');
    expect(show('D2')).toBe('2024-01-15');
    expect(cell('E2').v).toBe(true);
    expect(cell('F2').f).toBe('Data!A1*2');
    expect(back.getValue(budget.id, 1, 5)).toBe(42);
    expect(cell('A1').s).toMatchObject({ bold: true, bg: '#eeeeee', bt: true, bl: true });
    expect(cell('B4').s).toMatchObject({ bb: true, br: true });
    expect(back.colWidth(budget.id, 0)).toBe(180);
    expect(budget).toMatchObject({ frozenRows: 1, frozenCols: 1 });
    expect([...budget.hiddenCols]).toEqual([5]);
    expect([...budget.hiddenRows]).toEqual([2]);
    expect(budget.merges).toEqual([{ r1: 5, c1: 0, r2: 6, c2: 2 }]);
    expect(back.names).toEqual([{ name: 'Amounts', ref: 'Budget!$B$2:$B$3' }]);
    expect(back.getNote(budget.id, 1, 0)).toBe('Due on the 1st');
    expect(back.getNote(budget.id, 9, 9)).toBe('Note on an empty cell');
    expect(back.getCell(budget.id, 9, 9)).toBeUndefined();
    expect(budget.rules).toHaveLength(1);
    expect(back.conditionalStyle(budget.id, 1, 1, 1500)).toEqual({ bg: '#fde8e8' });
    expect(back.validationAt(budget.id, 1, 4)).toMatchObject({ type: 'checkbox' });
    expect(data.color).toBe('#1baf7a');
    expect(budget.filter).toEqual({ range: { r1: 0, c1: 0, r2: 2, c2: 1 }, criteria: { 0: { values: ['Rent'] } } });
    expect([...budget.filterHidden]).toEqual([2]);
    expect(back.getValue(budget.id, 1, 6)).toBe(1950.5);
    expect(back.rowHeight(budget.id, 0)).toBe(36);
    expect(back.activeSheetId).toBe(data.id);
    expect(back.dirty).toBe(false);
  });

  it('writes the style sidecar as a very hidden sheet other apps ignore', async () => {
    const wb = build();
    const buf = await (await workbookToXlsx(wb)).arrayBuffer();
    const raw = XLSX.read(new Uint8Array(buf), { type: 'array' });
    expect(raw.SheetNames).toContain(META_SHEET);
    const meta = raw.Workbook.Sheets.find((s) => s.name === META_SHEET);
    expect(meta.Hidden).toBe(2);
    // Cached formula results are written so viewers without a calc engine see numbers.
    expect(raw.Sheets.Budget.B4.v).toBe(1950.5);
    expect(raw.Sheets.Budget.B4.f).toBe('SUM(B2:B3)');
  });

  it('records the app defaults even for a plain workbook', async () => {
    const wb = new Workbook();
    wb.setInput(wb.sheets[0].id, 0, 0, '1');
    const buf = await (await workbookToXlsx(wb)).arrayBuffer();
    const raw = XLSX.read(new Uint8Array(buf), { type: 'array' });
    expect(raw.SheetNames).toEqual(['Sheet1', META_SHEET]);
    expect(raw.Workbook.Sheets[1].Hidden).toBe(2);
    const back = await workbookFromFile(buf, 'plain.xlsx');
    expect(back.getCell(back.activeSheetId, 0, 0).s).toBeUndefined();
  });

  it('reads files written by other tools', async () => {
    const ws = XLSX.utils.aoa_to_sheet([['Name', 'Qty'], ['a', 1], ['b', 2], ['Total', { t: 'n', f: 'SUM(B2:B3)', v: 3 }]]);
    ws.B2.z = '0.00';
    ws['!cols'] = [{ wch: 20 }];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, ws, 'Import');
    const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
    const wb = await workbookFromFile(bytes, 'x.xlsx');
    const id = wb.sheets[0].id;
    expect(wb.sheets[0].name).toBe('Import');
    expect(wb.getValue(id, 1, 1)).toBe(1);
    expect(wb.getCell(id, 1, 1).s).toEqual({ fmt: 'number', dec: 2, group: false, font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, valign: 'bottom' });
    expect(wb.getCell(id, 3, 1).f).toBe('SUM(B2:B3)');
    expect(wb.getValue(id, 3, 1)).toBe(3);
    // The serialized width is 20.832 characters in Calibri 12 (an eight-pixel digit),
    // rather than the vendor's six-pixel guess used when it built this fixture.
    expect(wb.colWidth(id, 0)).toBe(167);
    expect(wb.sheets[0].rows).toBeGreaterThanOrEqual(100);
  });

  it('imports CSV text', async () => {
    const csv = 'name,score\nAnn,90\nBob,"7,5"\n';
    const wb = await workbookFromFile(new TextEncoder().encode(csv).buffer, 'scores.csv');
    const id = wb.sheets[0].id;
    expect(wb.getValue(id, 0, 0)).toBe('name');
    expect(wb.getValue(id, 1, 1)).toBe(90);
    expect(wb.getValue(id, 2, 1)).toBe('7,5');
  });
});

describe('csv export', () => {
  it('writes displayed values with quoting and a BOM', () => {
    const wb = build();
    const csv = sheetToCsv(wb, wb.sheets[0].id);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('Item,Amount,,,,,,450.5'); // H1 is the anchor of a spilled SORT
    // G2 sums a named range of amounts, so it reads as money too; H2 is spilled.
    expect(lines[1]).toBe('Rent,"$1,500.00",12%,2024-01-15,TRUE,42,"$1,950.50",1500');
    expect(lines[3]).toBe(',"$1,950.50",,,,,,');
    expect(sheetToCsv(new Workbook(), 'nope')).toBe('');
  });
});

describe('file names', () => {
  it('recognizes spreadsheet extensions', () => {
    expect(isSpreadsheetFile('a.xlsx')).toBe(true);
    expect(isSpreadsheetFile('A.CSV')).toBe(true);
    expect(isSpreadsheetFile('a.png')).toBe(false);
    expect(stripExtension('Budget 2026.xlsx')).toBe('Budget 2026');
    expect(stripExtension('noext')).toBe('noext');
  });
});

describe('delimiter detection', () => {
  it('tells commas, semicolons, tabs, and pipes apart, ignoring quoted text', async () => {
    const { detectDelimiter, workbookFromFile } = await import('../src/core/io.js');
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a;b;c\n1,5;2,5;3')).toBe(';'); // European decimals inside semicolon fields
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|');
    expect(detectDelimiter('"x, y";1\n"z, w";2')).toBe(';');
    expect(detectDelimiter('anything', 'file.tsv')).toBe('\t');
    expect(detectDelimiter('just one column\nno separators')).toBe(',');
    const wb = await workbookFromFile(new TextEncoder().encode('Name;Amount\nRent;1500\nFood;300\n'), 'budget.csv');
    const id = wb.sheets[0].id;
    expect(wb.getValue(id, 0, 1)).toBe('Amount');
    expect(wb.getValue(id, 1, 1)).toBe(1500);
    expect(wb.getValue(id, 2, 0)).toBe('Food');
  });
});

import { workbookToXlsx as toXlsxFit, workbookFromFile as fromFileFit } from '../src/core/io.js';
import { Workbook as WorkbookFit } from '../src/core/workbook.js';

describe('column fit on open', () => {
  it('marks delimited text imports for fitting, never workbooks', async () => {
    const wb = new WorkbookFit();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'hello');
    const plain = await fromFileFit(await (await toXlsxFit(wb)).arrayBuffer(), 'x.xlsx');
    expect(plain.fitColumnsOnOpen).toBeUndefined();
    const csv = await fromFileFit(new TextEncoder().encode('a,b\n1,2\n').buffer, 'data.csv');
    expect(csv.fitColumnsOnOpen).toEqual([csv.sheets[0].id]);
  });
});

describe('ods export', () => {
  it('writes an OpenDocument file that reads back with values and formulas, without the styling sheet', async () => {
    const wb = new Workbook({ sheets: [{ name: 'Data' }, { name: 'Other' }] });
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, '2');
    wb.setInput(id, 0, 1, '=A1*3');
    wb.setInput(id, 1, 0, 'label');
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: true });
    const blob = await workbookToOds(wb);
    expect(blob.type).toContain('opendocument');
    const back = await workbookFromFile(await blob.arrayBuffer(), 'x.ods');
    expect(back.sheets.map((s) => s.name)).toEqual(['Data', 'Other']);
    const bid = back.sheets[0].id;
    expect(back.getValue(bid, 0, 0)).toBe(2);
    expect(back.getValue(bid, 0, 1)).toBe(6);
    expect(back.getCell(bid, 0, 1).f).toBe('A1*3');
    expect(back.getValue(bid, 1, 0)).toBe('label');
  });
});

describe('range to CSV', () => {
  it('writes just the range, values as displayed', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'skip'); wb.setInput(id, 1, 1, 'a,b'); wb.setInput(id, 1, 2, '=1+1'); wb.setInput(id, 2, 1, '3');
    expect(rangeToCsv(wb, id, { r1: 1, c1: 1, r2: 2, c2: 2 })).toBe('\ufeff"a,b",2\r\n3,\r\n');
    expect(sheetToCsv(wb, id).startsWith('\ufeffskip,,')).toBe(true);
  });
});

describe('text encoding detection', () => {
  it('decodes Windows-1252 punctuation and currency without C1 control characters', async () => {
    const punctuation = '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';
    expect(decodeText(Uint8Array.from({ length: 32 }, (_, i) => 0x80 + i))).toBe(punctuation);
    const wb = await workbookFromFile(Uint8Array.of(0x93, 0x43, 0x61, 0x66, 0xe9, 0x94, 0x2c, 0x80, 0x31), 'prices.csv');
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe('\u201cCaf\u00e9\u201d');
    expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(1);
  });

  it('reads UTF-8, UTF-16 with a BOM, and Windows-1252 CSVs', async () => {
    expect(decodeText(new TextEncoder().encode('Caf\u00e9,1'))).toBe('Caf\u00e9,1');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0x2c, 0x42]))).toBe('A,B'); // UTF-8 BOM dropped
    expect(decodeText(new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x2c, 0x31]))).toBe('Caf\u00e9,1'); // Windows-1252 é
    expect(decodeText(new Uint8Array([0x80, 0x31]))).toBe('\u20ac1'); // 0x80 is the euro sign in Windows-1252
    const utf16 = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x2c, 0x00, 0xe9, 0x00]);
    expect(decodeText(utf16)).toBe('A,\u00e9');
    const wb = await workbookFromFile(new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0x4a, 0x6f, 0x73, 0xe9]), 'people.csv');
    expect(wb.getValue(wb.sheets[0].id, 1, 0)).toBe('Jos\u00e9');
  });
});

describe('TSV and web page export', () => {
  it('writes tab-separated text, quoting only what needs it', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const set = (a1, text) => { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); };
    set('A1', 'Item'); set('B1', 'Amount, gross'); set('A2', 'Tab\there'); set('B2', '1500'); set('A3', 'Say "hi"'); set('B3', '=B2*2');
    wb.applyStyle(id, parseRange('B2:B3'), { fmt: 'currency', dec: 0 });
    const tsv = sheetToTsv(wb, id);
    expect(tsv.startsWith('﻿')).toBe(true);
    expect(tsv.slice(1).split('\r\n')).toEqual(['Item\tAmount, gross', '"Tab\there"\t$1,500', '"Say ""hi"""\t$3,000', '']);
    expect(sheetToTsv(new Workbook(), 'nope')).toBe('');
  });

  it('writes a standalone web page with the displayed values, styles, and column widths', () => {
    const wb = new Workbook({ sheets: [{ name: 'Budget' }] });
    const id = wb.sheets[0].id;
    const set = (a1, text) => { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); };
    set('A1', 'Item'); set('B1', 'Amount'); set('A2', 'Rent <big>'); set('B2', '1500'); set('A3', 'Hidden'); set('B3', '1');
    wb.applyStyle(id, parseRange('A1:B1'), { bold: true, bg: '#eeeeee' });
    wb.applyStyle(id, parseRange('B2:B2'), { fmt: 'currency', dec: 0 });
    wb.setColWidth(id, 0, 180);
    wb.setHidden(id, 'row', [2], true);
    const html = sheetToHtml(wb, id, { title: 'Budget — 2026' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Budget — 2026</title>');
    expect(html).toContain('<h1>Budget — 2026</h1>');
    expect(html).toContain('<col style="width:180px">');
    expect(html).toContain('Rent &lt;big&gt;');
    expect(html).toContain('$1,500');
    expect(html).not.toContain('Hidden');
    expect(html).not.toContain('data-spreadsheet-cells');
    expect(html).toMatch(/<td\b[^>]* style="[^"]*font-weight:\s*(600|bold)[^"]*">Item<\/td>/);
    expect(html.endsWith('</body></html>')).toBe(true);
    expect(sheetToHtml(new Workbook(), new Workbook().sheets[0].id)).toContain('This sheet is empty');
  });
});
