import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

/**
 * Excel judges a value list by the cell's value, not by the text the cell shows: a filter on a
 * column of amounts formatted #,##0.00 holds <filter val="1234.5"/>, never "1,234.50". Read and
 * written the other way round, a filter on any formatted number column matches no row at all.
 */

const numFmt = { numFmts: ['<numFmt numFmtId="164" formatCode="#,##0.00"/>'], cellXfs: ['<xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>'] };
const amounts = [
  '<row r="1"><c r="A1" t="inlineStr"><is><t>Amount</t></is></c></row>',
  '<row r="2"><c r="A2" s="1"><v>1234.5</v></c></row>',
  '<row r="3" hidden="1"><c r="A3" s="1"><v>2000</v></c></row>',
  '<row r="4"><c r="A4" s="1"><v>1234.5</v></c></row>',
].join('');
const filterTail = (columns) => `<autoFilter ref="A1:A4">${columns}</autoFilter>`;
const hidden = (wb) => [...wb.activeSheet.filterHidden].sort((a, b) => a - b);

/** The sheet part of a saved book, and the book without its sidecar, as another program hands it back. */
async function saved(wb) {
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' });
  const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/worksheets/sheet1.xml').content);
  X.CFB.utils.cfb_del(zip, '/xl/worksheets/sheet2.xml');
  const book = X.CFB.find(zip, '/xl/workbook.xml');
  book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet name="_puter_meta"[^>]*\/>/, ''));
  book.size = book.content.length;
  return { xml, bytes, native: X.CFB.write(zip, { type: 'array', fileType: 'zip' }) };
}

/** A book of amounts under a two-decimal thousands format, with a value filter over them. */
function amountBook(values, rows = ['1234.5', '2000', '1234.5']) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Amount');
  rows.forEach((v, i) => wb.setInput(id, i + 1, 0, v));
  wb.applyStyle(id, { r1: 1, c1: 0, r2: rows.length, c2: 0 }, { fmt: 'number', dec: 2, group: true });
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: rows.length, c2: 0 });
  wb.setFilterCriteria(id, 0, { values });
  return wb;
}

it('keeps the rows an Excel value filter names by number, whose cells show a thousands format', async () => {
  const wb = await workbookFromFile(otherProgramsXlsx({
    sheetXml: { Data: { rows: amounts, tail: filterTail('<filterColumn colId="0"><filters><filter val="1234.5"/></filters></filterColumn>') } },
    styles: numFmt,
  }), 'amounts.xlsx');
  const id = wb.activeSheetId;
  expect([1, 2, 3].map((r) => wb.getDisplay(id, r, 0))).toEqual(['1,234.50', '2,000.00', '1,234.50']);
  // The file's spelling is translated into the text the menu lists, with the number behind it.
  expect(wb.activeSheet.filter.criteria).toEqual({ 0: { caseSensitive: false, values: ['1,234.50'], keys: ['1234.5|fmt=number,dec=2,group=true'] } });
  // Only the row the file itself hides; before this the list matched no display and every row went.
  expect(hidden(wb)).toEqual([2]);
  expect([...wb.activeSheet.hiddenRows]).toEqual([]);
  wb.clearFilter(id);
  expect(hidden(wb)).toEqual([]);
  expect(wb.isRowHidden(id, 2)).toBe(false);
});

it('writes the number behind a chosen text into the value list, and the file filters the same rows back', async () => {
  const wb = amountBook(['1,234.50']);
  expect(hidden(wb)).toEqual([2]);
  const { xml, bytes, native } = await saved(wb);
  expect(xml).toContain('<autoFilter ref="A1:A4"><filterColumn colId="0"><filters><filter val="1234.5"/></filters></filterColumn></autoFilter>');
  // Our own file, sidecar and all: the criterion comes back as it was typed.
  const back = await workbookFromFile(bytes, 'amounts.xlsx');
  expect(back.activeSheet.filter.criteria).toEqual({ 0: { values: ['1,234.50'], keys: ['1234.5|fmt=number,dec=2,group=true'] } });
  expect(hidden(back)).toEqual([2]);
  // The same file without the sidecar, as Excel would hand it back: the same rows, the same displays.
  const plain = await workbookFromFile(native, 'amounts.xlsx');
  expect(plain.activeSheet.filter.criteria).toEqual({ 0: { caseSensitive: false, values: ['1,234.50'], keys: ['1234.5|fmt=number,dec=2,group=true'] } });
  expect(hidden(plain)).toEqual([2]);
  expect([1, 2, 3].map((r) => plain.getDisplay(plain.activeSheetId, r, 0))).toEqual(['1,234.50', '2,000.00', '1,234.50']);
});

it('writes one element for each number a chosen text stands for', async () => {
  const wb = amountBook(['1.23'], ['1.234', '1.2345', '9']);
  expect(hidden(wb)).toEqual([3]);
  const { xml } = await saved(wb);
  expect(xml).toContain('<filters><filter val="1.234"/><filter val="1.2345"/></filters>');
});

it('writes a text value as itself and reads it back unchanged', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['Region'], ['East'], ['West'], ['007']].forEach(([v], r) => wb.setInput(id, r, 0, r === 3 ? "'007" : v));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 3, c2: 0 });
  wb.setFilterCriteria(id, 0, { values: ['East', '007'] });
  const { xml, native } = await saved(wb);
  expect(xml).toContain('<filters><filter val="East"/><filter val="007"/></filters>');
  const plain = await workbookFromFile(native, 'regions.xlsx');
  expect(plain.activeSheet.filter.criteria).toEqual({ 0: { caseSensitive: false, values: ['East', '007'] } });
  expect(hidden(plain)).toEqual([2]);
});

it('still tells 2 from 2.00 apart when the list came from this app\'s own menu', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['Amount', '2', '2', '3'].forEach((v, r) => wb.setInput(id, r, 0, v));
  wb.applyStyle(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, { fmt: 'number', dec: 2 });
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 3, c2: 0 });
  wb.setFilterCriteria(id, 0, { values: ['2'] });
  expect(wb.sheet(id).filter.criteria[0].keys).toEqual(['2']);
  // 2.00 is its own entry in the menu; picking 2 leaves its row hidden.
  expect(hidden(wb)).toEqual([2, 3]);
});

it('takes a file\'s val="2" for both the row showing 2 and the row showing 2.00, as Excel matches by value', async () => {
  const rows = [
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Amount</t></is></c></row>',
    '<row r="2"><c r="A2"><v>2</v></c></row>',
    '<row r="3" s="1"><c r="A3" s="1"><v>2</v></c></row>',
    '<row r="4"><c r="A4"><v>3</v></c></row>',
  ].join('');
  const wb = await workbookFromFile(otherProgramsXlsx({
    sheetXml: { Data: { rows, tail: filterTail('<filterColumn colId="0"><filters><filter val="2"/></filters></filterColumn>') } },
    styles: numFmt,
  }), 'both.xlsx');
  expect([1, 2, 3].map((r) => wb.getDisplay(wb.activeSheetId, r, 0))).toEqual(['2', '2.00', '3']);
  expect(wb.activeSheet.filter.criteria[0].values).toEqual(['2', '2.00']);
  expect(hidden(wb)).toEqual([]); // the source has not applied its predicate yet
  wb.reapplyFilter(wb.activeSheetId);
  expect(hidden(wb)).toEqual([3]);
});

it('leaves a file\'s list alone when the column shows its numbers plainly', async () => {
  const rows = [
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Amount</t></is></c></row>',
    '<row r="2"><c r="A2"><v>5</v></c></row>',
    '<row r="3"><c r="A3"><v>7</v></c></row>',
  ].join('');
  const wb = await workbookFromFile(otherProgramsXlsx({
    sheetXml: { Data: { rows, tail: '<autoFilter ref="A1:A3"><filterColumn colId="0"><filters><filter val="5"/></filters></filterColumn></autoFilter>' } },
  }), 'plain.xlsx');
  expect(wb.activeSheet.filter.criteria).toEqual({ 0: { caseSensitive: false, values: ['5'] } });
  expect(hidden(wb)).toEqual([]);
  wb.reapplyFilter(wb.activeSheetId);
  expect(hidden(wb)).toEqual([2]);
});
