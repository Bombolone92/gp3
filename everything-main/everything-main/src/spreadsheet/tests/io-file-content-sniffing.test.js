import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

const bytesOf = (text) => new TextEncoder().encode(text);
const CSV = 'a,b,c\n1,2024-01-15,TRUE\n"7,5",00123,=1+1\n';

// The file's extension alone chose the parser: comma-separated bytes named .xlsx went to
// the library's lax CSV reader, which made the quoted text "7,5" the number 75, and a real
// workbook named .csv opened as a column of binary garbage. Both now open by content.
it.each(['data.xlsx', 'data.xls', 'data.ods', 'data.numbers', 'data', 'DATA.XLSB'])('opens comma-separated text named %s as delimited text', async (name) => {
  const wb = await workbookFromFile(bytesOf(CSV), name);
  const id = wb.activeSheetId;
  expect(wb.getValue(id, 2, 0)).toBe('7,5');
  expect(wb.getCell(id, 2, 1)).toEqual({ v: 123, f: null });
  expect(wb.getCell(id, 2, 2)).toEqual({ v: null, f: '1+1' });
  expect(wb.getCell(id, 1, 1).s).toEqual({ fmt: 'date' });
  expect(wb.getValue(id, 1, 2)).toBe(true);
  expect(wb.fitColumnsOnOpen).toEqual([id]);
  expect(wb.sheets[0].name).toBe(name.replace(/\.[^.]+$/, ''));
});

it.each(['book.csv', 'book.tsv', 'book.txt', 'book.ods'])('opens a real .xlsx named %s as the workbook it is', async (name) => {
  const wb = new Workbook({ sheets: [{ name: 'Data' }, { name: 'More' }] });
  wb.setInput(wb.sheets[0].id, 0, 0, '=1+1');
  wb.setInput(wb.sheets[1].id, 0, 0, 'hello');
  const back = await workbookFromFile(await workbookToXlsx(wb), name);
  expect(back.sheets.map((s) => s.name)).toEqual(['Data', 'More']);
  expect(back.getCell(back.sheets[0].id, 0, 0)).toEqual({ v: null, f: '1+1' });
  expect(back.getValue(back.sheets[1].id, 0, 0)).toBe('hello');
  expect(back.fitColumnsOnOpen).toBeUndefined();
});

it('opens a real .ods named .csv as the workbook it is', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data' }] });
  wb.setInput(wb.sheets[0].id, 0, 0, '42');
  const back = await workbookFromFile(await workbookToOds(wb), 'sheet.csv');
  expect(back.sheets[0].name).toBe('Data');
  expect(back.getValue(back.sheets[0].id, 0, 0)).toBe(42);
});

// A flat XML spreadsheet or a saved web page carries its own extension (or none): those open
// through the library. Named .csv or .txt the same bytes are delimited text,
// since a CSV's first cell may start with "<?xml" or "<table" too.
it('opens a flat XML spreadsheet and an HTML table through the library unless they are named as text', async () => {
  const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet"';
  const fods = `<?xml version="1.0"?><office:document ${NS}><office:body><office:spreadsheet><table:table table:name="Flat"><table:table-row><table:table-cell office:value-type="float" office:value="7"><text:p>7</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document>`;
  for (const name of ['flat.fods', 'flat.xml', 'flat']) {
    const flat = await workbookFromFile(bytesOf(fods), name);
    expect(flat.sheets[0].name).toBe('Flat');
    expect(flat.getValue(flat.sheets[0].id, 0, 0)).toBe(7);
  }
  const page = '﻿<!DOCTYPE html>\n<html><body><table><tr><td>x</td><td>2</td></tr></table></body></html>';
  for (const name of ['page.html', 'page.htm', 'page.xls']) {
    const html = await workbookFromFile(bytesOf(page), name);
    expect(html.getValue(html.activeSheetId, 0, 0)).toBe('x');
    expect(html.getValue(html.activeSheetId, 0, 1)).toBe(2);
  }
  const text = await workbookFromFile(bytesOf(fods), 'flat.csv');
  expect(text.sheets[0].name).toBe('flat');
  expect(text.getValue(text.activeSheetId, 0, 0)).toBe(fods);
  const lines = await workbookFromFile(bytesOf(page), 'page.txt');
  expect(lines.sheets[0].name).toBe('page');
  expect(lines.getValue(lines.activeSheetId, 0, 0)).toBe('<!DOCTYPE html>');
  expect(lines.getValue(lines.activeSheetId, 1, 0)).toBe('<html><body><table><tr><td>x</td><td>2</td></tr></table></body></html>');
});

it('keeps text files with the text extensions on the text path, whatever their first characters', async () => {
  for (const [text, name, a1] of [['<b>,1\n', 'tags.csv', '<b>'], ['PK,1\n', 'zip.csv', 'PK'], ['﻿<x,1\n', 'bom.tsv', '<x,1']]) {
    const wb = await workbookFromFile(bytesOf(text), name);
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(a1);
  }
});

it('still reads an old binary .xls and a UTF-16 text file by their bytes', async () => {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([['old', 5]]), 'Legacy');
  const biff = await workbookFromFile(X.write(book, { type: 'array', bookType: 'biff5' }), 'legacy.xls');
  expect(biff.getValue(biff.activeSheetId, 0, 0)).toBe('old');
  expect(biff.getValue(biff.activeSheetId, 0, 1)).toBe(5);
  const utf16 = new Uint8Array([0xff, 0xfe, ...[...'a,b\n1,2\n'].flatMap((ch) => [ch.charCodeAt(0), 0])]);
  const wide = await workbookFromFile(utf16, 'wide.xlsx');
  expect(wide.getValue(wide.activeSheetId, 1, 1)).toBe(2);
});
