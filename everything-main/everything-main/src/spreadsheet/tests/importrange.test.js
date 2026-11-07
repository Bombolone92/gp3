import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';
import { resolveImportPath, parseImportRange, readImportRange, rowsFromDelimited, importNameFor, sniffImageType } from '../src/core/importrange.js';
import { detectDelimiter } from '../src/core/io.js';
import { parseDelimited } from '../src/core/tsv.js';
import { parseInput } from '../src/core/format.js';
import { ensureXlsx } from '../src/lib/puter.js';

function book(cells) {
  const wb = new Workbook({ sheets: [{ name: 'Data' }, { name: 'Q1 Data' }] });
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  wb.setInput(wb.sheets[1].id, 0, 0, 'q1');
  return { wb, id };
}

describe('IMPORTRANGE helpers', () => {
  it('rejects oversized whole-row imports from empty sheets before reading cells', () => {
    const wb = new Workbook({ sheets: [{ name: 'Empty', rows: 200001 }] });
    wb.getValue = () => { throw new Error('The over-limit range was read'); };
    expect(readImportRange(wb, parseImportRange('1:200001'))).toEqual({ error: '#NUM!' });
  });

  it('keeps empty imports within the cell limit, including its boundary', () => {
    const wb = new Workbook({ sheets: [{ name: 'Empty', rows: 200001 }] });
    expect(readImportRange(wb, parseImportRange('A:A'))).toEqual([[null]]);
    expect(readImportRange(wb, parseImportRange('1:3'))).toEqual([[null], [null], [null]]);
    const rows = readImportRange(wb, parseImportRange('1:200000'));
    expect(rows).toHaveLength(200000);
    expect(rows[0]).toEqual([null]);
    expect(rows.at(-1)).toEqual([null]);
  });

  it('resolves names to files in the app folder and keeps paths', () => {
    expect(resolveImportPath('Budget', 'Spreadsheets', ensureXlsx)).toBe('Spreadsheets/Budget.xlsx');
    expect(resolveImportPath(' Budget.xlsx ', 'Spreadsheets', ensureXlsx)).toBe('Spreadsheets/Budget.xlsx');
    expect(resolveImportPath('/nj/Documents/data.csv', 'Spreadsheets', ensureXlsx)).toBe('/nj/Documents/data.csv');
    expect(resolveImportPath('Work/Plan', 'Spreadsheets', ensureXlsx)).toBe('Work/Plan.xlsx');
    expect(resolveImportPath('/nj/Documents/Quarter 1/Plan', 'Spreadsheets', ensureXlsx)).toBe('/nj/Documents/Quarter 1/Plan.xlsx');
    expect(resolveImportPath('', 'Spreadsheets', ensureXlsx)).toBeNull();
  });

  it('parses ranges with and without a sheet', () => {
    expect(parseImportRange('a1:b2')).toMatchObject({ sheet: null, ref: { r1: 0, c1: 0, r2: 1, c2: 1 } });
    expect(parseImportRange('Data!B2')).toMatchObject({ sheet: 'Data', ref: { r1: 1, c1: 1, r2: 1, c2: 1 } });
    expect(parseImportRange("'Q1 Data'!A:A")).toMatchObject({ sheet: 'Q1 Data', ref: { kind: 'cols', c1: 0 } });
    expect(parseImportRange('nope')).toBeNull();
    expect(parseImportRange('')).toBeNull();
  });

  it('reads values out of a workbook, clamping whole columns to the used area', () => {
    const { wb } = book({ A1: 'x', A2: '2', B2: '=A2*3', A3: 'y' });
    expect(readImportRange(wb, parseImportRange('A1:B3'))).toEqual([['x', null], [2, 6], ['y', null]]);
    expect(readImportRange(wb, parseImportRange('A:A'))).toEqual([['x'], [2], ['y']]);
    expect(readImportRange(wb, parseImportRange("'Q1 Data'!A1"))).toEqual([['q1']]);
    expect(readImportRange(wb, parseImportRange('Missing!A1'))).toEqual({ error: '#REF!' });
  });
});

describe('IMPORTRANGE in a formula', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  it('spills the rows the provider returns and reports missing files', async () => {
    const { wb, id } = book({ A1: '=IMPORTRANGE("Other","Sheet1!A1:B2")', D1: '=IMPORTRANGE("Gone","A1")' });
    const calls = [];
    wb.setAsyncProvider('IMPORTRANGE', async (text) => {
      const [file] = JSON.parse(text);
      calls.push(file);
      return file === 'Gone' ? { error: '#REF!' } : [[1, 'two'], [3, 4]];
    });
    expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BUSY!' });
    await tick();
    expect(wb.getValue(id, 0, 0)).toBe(1);
    expect(wb.getValue(id, 0, 1)).toBe('two');
    expect(wb.getValue(id, 1, 1)).toBe(4);
    expect(wb.getValue(id, 0, 3)).toEqual({ error: '#REF!' });
    expect(calls.sort()).toEqual(['Gone', 'Other']);
    expect(wb.getValue(id, 5, 5)).toBeNull();
  });
});

describe('IMPORTDATA', () => {
  const helpers = { detectDelimiter, parseDelimited, parseInput };
  it('accepts a tall input within the cell limit without overflowing function arguments', () => {
    const result = rowsFromDelimited('1\n'.repeat(150000), ',', helpers);
    expect(result).toHaveLength(150000);
    expect(result[0]).toEqual([1]);
    expect(result[149999]).toEqual([1]);
  });

  it('returns a spreadsheet error for an input beyond the cell limit', () => {
    expect(rowsFromDelimited('1\n'.repeat(200001), ',', helpers)).toEqual({ error: '#NUM!' });
  });

  it('turns delimited text into typed rows', () => {
    expect(rowsFromDelimited('City,Pop\nParis,2148000\n', '', helpers)).toEqual([['City', 'Pop'], ['Paris', 2148000]]);
    expect(rowsFromDelimited('a;b\n1,5;2026-01-02\n', ';', helpers)).toEqual([['a', 'b'], ['1,5', '2026-01-02']]);
    expect(rowsFromDelimited('x\ty\n1\t2\n', '', helpers)).toEqual([['x', 'y'], [1, 2]]);
    expect(rowsFromDelimited('', '', helpers)).toEqual({ error: '#N/A' });
  });

  it('is asked through the async provider and spills', async () => {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setAsyncProvider('IMPORTDATA', async (text) => { const [url] = JSON.parse(text); return url.includes('ok') ? [['a', 'b'], [1, 2]] : { error: '#N/A' }; });
    wb.setInput(id, 0, 0, '=IMPORTDATA("https://example.com/ok.csv")');
    wb.setInput(id, 0, 5, '=IMPORTDATA("https://example.com/missing.csv")');
    wb.setInput(id, 3, 0, '=IMPORTDATA("ftp://nope")');
    expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BUSY!' });
    await tick();
    expect(wb.getValue(id, 1, 1)).toBe(2);
    expect(wb.getValue(id, 0, 5)).toEqual({ error: '#N/A' });
    expect(wb.getValue(id, 3, 0)).toEqual({ error: '#VALUE!' });
  });
});

describe('importNameFor', () => {
  it('takes the file name from the address, or sniffs the format', () => {
    expect(importNameFor('https://x.org/data/Sales%202026.xlsx?dl=1')).toBe('Sales 2026.xlsx');
    expect(importNameFor('https://x.org/export.csv')).toBe('export.csv');
    expect(importNameFor('https://x.org/api/rows', new TextEncoder().encode('a,b\n1,2'))).toBe('rows.csv');
    expect(importNameFor('https://x.org/download', new Uint8Array([0x50, 0x4b, 3, 4, 0]))).toBe('download.xlsx');
    expect(importNameFor('https://x.org/', null)).toBe('Imported.csv');
    expect(importNameFor('not a url', null)).toBe('Imported.csv');
  });
});

describe('sniffImageType', () => {
  it('recognizes image bytes by signature', () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe('image/png');
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif');
    expect(sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('image/svg+xml');
    expect(sniffImageType(new TextEncoder().encode('<html><body>nope</body></html>'))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('a,b\n1,2'))).toBeNull();
  });
});
