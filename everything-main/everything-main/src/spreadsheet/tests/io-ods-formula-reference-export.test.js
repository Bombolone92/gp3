import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

const parser = new (new JSDOM('').window.DOMParser)();
const tableNS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const quoted = (s) => `'${s.replaceAll("'", "''")}'`;
const cases = [
  ['A1+1', '[.A1]+1', 3], ['$A$1+1', '[.$A$1]+1', 3],
  ['SUM(A$1:$B2)', 'SUM([.A$1:.$B2])', 17],
  ['SUM($A:$B)', 'SUM([.$A:.$B])', 17], ['SUM($1:$2)', 'SUM([.$1:.$2])', 17],
  ['SUM(Data!A1:B2)', 'SUM([$Data.A1:.B2])', 17],
  ['SUM(Q1.2026!A1:B2)', "SUM([$'Q1.2026'.A1:.B2])", 17, 'Q1.2026'],
  ...['Data', "Plan's.data", 'A"B', 'A;|~COM.MICROSOFT.Data', '$Budget', 'A1'].map((name) =>
    [`SUM(${quoted(name)}!$A$1:$B$2)`, `SUM([$${quoted(name)}.$A$1:.$B$2])`, 17, name]),
  ['SUM(First:Last!$A$1:$B$2)', 'SUM([$First.$A$1:$Last.$B$2])', 51],
  ['SUM(First:Last!A1)', 'SUM([$First.A1:$Last.A1])', 6],
  ['SUM(First:Last!$A:$B)', 'SUM([$First.$A:$Last.$B])', 51],
  ['SUM(First:Last!$1:$2)', 'SUM([$First.$1:$Last.$2])', 51],
  ['SUM(a1:b2)', 'SUM([.A1:.B2])', 17],
  ['LOG10(100)+1E10+Rate_A1', 'LOG10(100)+1E10+Rate_A1', 10000000004],
  ['IFERROR(#REF!,"A1, Data!B2")', 'IFERROR([#REF!];"A1, Data!B2")', 'A1, Data!B2'],
];

it.each(cases.map(([formula, ods, value, name = 'Data']) => ({ formula, ods, value, name })))(
  'exports $formula with valid ODS reference syntax', async ({ formula, ods, value, name }) => {
    let wb = new Workbook();
    const sheetNames = formula.includes('First:Last!') ? ['First', 'Middle', 'Last'] : [name];
    wb.renameSheet(wb.activeSheetId, sheetNames[0]);
    for (const [i, sheetName] of sheetNames.entries()) {
      const id = i ? wb.addSheet(sheetName).id : wb.activeSheetId;
      [[2, 5], [3, 7]].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
    }
    const source = wb.sheets[0].id;
    if (formula.includes('Rate_A1')) expect(wb.defineName('Rate_A1', `${quoted(sheetNames[0])}!$A$1`)).toBe(null);
    wb.setInput(source, 3, 3, `=${formula}`);
    expect(wb.getValue(source, 3, 3)).toBe(value);
    for (let round = 0; round < 2; round++) {
      const bytes = new Uint8Array(await (await workbookToOds(wb)).arrayBuffer());
      const zip = XLSX.CFB.read(bytes, { type: 'array' });
      const doc = parser.parseFromString(new TextDecoder().decode(XLSX.CFB.find(zip, 'content.xml').content), 'application/xml');
      expect(doc.querySelector('parsererror')?.textContent).toBeUndefined();
      const cells = [...doc.getElementsByTagNameNS(tableNS, 'table-cell')];
      expect(cells.find((cell) => cell.hasAttributeNS(tableNS, 'formula')).getAttributeNS(tableNS, 'formula')).toBe(`of:=${ods}`);
      wb = await workbookFromFile(bytes, 'formulas.ods');
      expect(wb.getValue(wb.sheets[0].id, 3, 3)).toBe(value);
    }
  },
);

it.each([
  ['XFD1048576', '[.XFD1048576]'], ['$XFD$1048576', '[.$XFD$1048576]'],
  ['SUM(XFD:XFD)', 'SUM([.XFD:.XFD])'], ['SUM(1048576:1048576)', 'SUM([.1048576:.1048576])'],
  ['XFE1+A1048577+A1_name+A1.value', 'XFE1+A1048577+A1_name+A1.value'],
  ['LOG10 (100)+1.25E10+0.1+_xlfn.LOG10(100)', 'LOG10 (100)+1.25E10+0.1+_xlfn.LOG10(100)'],
  ['Table1[A1]+Sales[Q1]', 'Table1[A1]+Sales[Q1]'],
  ['A1+A1+A1', '[.A1]+[.A1]+[.A1]'],
])('converts only address tokens in %s', (formula, expected) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 'n', v: 0, f: formula } }, 'Data');
  const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'ods' }));
  const zip = XLSX.CFB.read(bytes, { type: 'array' });
  const doc = parser.parseFromString(new TextDecoder().decode(XLSX.CFB.find(zip, 'content.xml').content), 'application/xml');
  expect(doc.querySelector('parsererror')?.textContent).toBeUndefined();
  expect(doc.getElementsByTagNameNS(tableNS, 'table-cell')[0].getAttributeNS(tableNS, 'formula')).toBe(`of:=${expected}`);
});
