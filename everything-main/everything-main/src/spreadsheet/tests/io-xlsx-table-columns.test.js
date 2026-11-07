// @vitest-environment jsdom
import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';

const customStyle = {
  wholeTable: { bg: '#eeeeee' }, firstRowStripe: { bg: '#ffffaa' }, secondRowStripe: { bg: '#ffeecc' },
  firstColumn: { bg: '#99ccff', bold: true, bl: true, blBorder: { bs: 'thick', bc: '#008800' }, br: true, brBorder: { bs: 'thin', bc: '#aa0000' } },
  lastColumn: { bg: '#ffaacc', bold: true }, headerRow: { bg: '#55aa55', bold: false }, totalRow: { bg: '#bb77dd', bold: false },
  firstHeaderCell: { bg: '#bb0000', bold: true }, lastHeaderCell: { bg: '#000099', color: '#ffffff', bold: true },
  firstTotalCell: { bg: '#008888', bold: true }, lastTotalCell: { bg: '#995500', bold: true },
};
function book(firstColumn = true, lastColumn = true, width = 4) {
  const cells = {};
  for (let r = 2; r < 8; r++) for (let c = 3; c < 3 + width; c++) cells[`${r},${c}`] = { v: `Row ${r} field ${c}` };
  return new Workbook({ sheets: [{ cells, tables: [{ name: 'Items', range: { r1: 2, c1: 3, r2: 7, c2: 2 + width },
    style: 'custom', customStyle, firstColumn, lastColumn, banded: true, totalsRow: true }] }] });
}
const look = (wb, r, c) => wb.conditionalStyle(wb.activeSheetId, r, c, wb.getValue(wb.activeSheetId, r, c));
async function zipOf(wb) {
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(blob); });
  return X.CFB.read(new Uint8Array(bytes), { type: 'array' });
}
const xml = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path).content);
function change(zip, path, fn) {
  const part = X.CFB.find(zip, path);
  part.content = new TextEncoder().encode(fn(xml(zip, path))); part.size = part.content.length;
}
const reopen = zip => workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');

// The six-sheet control was opened and printed in desktop Excel.
// A one-column table uses firstColumn in the body, but lastHeader/TotalCell
// at the corners. Hidden logical edges do not transfer to visible columns.
it.each([[false, false], [true, false], [false, true], [true, true]])('composes enabled first/last columns and corners (%s/%s)', (first, last) => {
  const wb = book(first, last);
  for (const back of [wb, new Workbook(wb.toJSON())]) {
    expect([2, 3, 4, 7].map(r => look(back, r, 3).bg)).toEqual(first
      ? ['#bb0000', '#99ccff', '#99ccff', '#008888'] : ['#55aa55', '#ffffaa', '#ffeecc', '#bb77dd']);
    expect([2, 3, 4, 7].map(r => look(back, r, 6).bg)).toEqual(last
      ? ['#000099', '#ffaacc', '#ffaacc', '#995500'] : ['#55aa55', '#ffffaa', '#ffeecc', '#bb77dd']);
    expect([2, 3, 4, 7].map(r => look(back, r, 4).bg)).toEqual(['#55aa55', '#ffffaa', '#ffeecc', '#bb77dd']);
    expect(look(back, 2, 4).bold).toBe(false);
    back.setHidden(back.activeSheetId, 'col', [3, 6], true);
    expect(look(back, 3, 4).bg).toBe('#ffffaa');
    expect(look(back, 3, 5).bg).toBe('#ffffaa');
  }
});
it('uses SpreadsheetML precedence for a single-column table', () => {
  const wb = book(true, true, 1);
  expect([2, 3, 4, 7].map(r => look(wb, r, 3).bg)).toEqual(['#000099', '#99ccff', '#99ccff', '#995500']);
  expect(look(wb, 2, 3).color).toBe('#ffffff');
});
it('resolves borders relative to the column region and preserves direct overrides', () => {
  const wb = book(), id = wb.activeSheetId;
  expect(look(wb, 3, 3)).toMatchObject({ bl: true, br: true, blBorder: { bs: 'thick', bc: '#008800' }, brBorder: { bs: 'thin', bc: '#aa0000' } });
  expect(look(wb, 3, 4).br).toBeUndefined();
  wb.setCells(id, [{ r: 3, c: 3, cell: { v: 'Entry', s: { bold: false, bg: '#123456' } } }]);
  expect(look(wb, 3, 3).bold).toBe(false);
  expect(wb.styleAt(id, 3, 3).bg).toBe('#123456');
  wb.undo(); expect(look(wb, 3, 3).bold).toBe(true);
});
it('follows table edges through insertion, deletion, duplication and undo', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.insertCols(id, 5, 2);
  expect(look(wb, 3, 8).bg).toBe('#ffaacc');
  expect(look(wb, 3, 6).bg).toBe('#ffffaa');
  wb.deleteCols(id, 3, 1);
  expect(look(wb, 3, 3).bg).toBe('#99ccff');
  expect(look(wb, 3, 7).bg).toBe('#ffaacc');
  wb.undo(); wb.undo();
  expect(look(wb, 3, 6).bg).toBe('#ffaacc');
  const copy = wb.duplicateSheet(id);
  expect(copy.tables[0]).toMatchObject({ firstColumn: true, lastColumn: true });
  expect(wb.conditionalStyle(copy.id, 3, 6, 'x').bg).toBe('#ffaacc');
});
it('updates and persists flags without changing the custom definition', () => {
  const wb = book(), id = wb.activeSheetId, table = wb.activeSheet.tables[0];
  wb.updateTable(id, table.id, { firstColumn: false, lastColumn: false });
  expect(look(wb, 3, 3).bg).toBe('#ffffaa');
  expect(look(wb, 3, 6).bg).toBe('#ffffaa');
  expect(wb.activeSheet.tables[0].customStyle.firstColumn.bg).toBe('#99ccff');
  wb.undo(); expect(look(wb, 3, 6).bg).toBe('#ffaacc');
  wb.redo(); expect(look(wb, 3, 6).bg).toBe('#ffffaa');
  const restored = new Workbook(wb.toJSON());
  expect(restored.activeSheet.tables[0].firstColumn).toBeUndefined();
  restored.updateTable(restored.activeSheetId, table.id, { firstColumn: true });
  expect(look(restored, 3, 3).bg).toBe('#99ccff');
});
it('exports all edge/corner definitions and enabled flags through two metadata-free native round trips', async () => {
  let wb = book();
  for (let pass = 0; pass < 2; pass++) {
    const zip = await zipOf(wb);
    expect(xml(zip, '/xl/tables/table1.xml')).toContain('showFirstColumn="1" showLastColumn="1"');
    for (const type of Object.keys(customStyle)) expect(xml(zip, '/xl/styles.xml')).toContain(`type="${type}"`);
    change(zip, '/xl/workbook.xml', text => text.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    wb = await reopen(zip);
    expect(wb.activeSheet.tables[0]).toMatchObject({ firstColumn: true, lastColumn: true });
    expect([2, 3, 7].map(r => look(wb, r, 3).bg)).toEqual(['#bb0000', '#99ccff', '#008888']);
    expect([2, 3, 7].map(r => look(wb, r, 6).bg)).toEqual(['#000099', '#ffaacc', '#995500']);
  }
});
it.each(['false', '0', null])('uses native false/absent flags over stale app metadata (%s)', async flag => {
  const zip = await zipOf(book());
  change(zip, '/xl/tables/table1.xml', text => text.replace(/show(First|Last)Column="1"/g, (_, side) => flag == null ? '' : `show${side}Column="${flag}"`));
  const wb = await reopen(zip);
  expect(wb.activeSheet.tables[0].firstColumn).toBeUndefined();
  expect(wb.activeSheet.tables[0].lastColumn).toBeUndefined();
  expect(look(wb, 3, 3).bg).toBe('#ffffaa');
});
it('reads XML boolean words and allows row stripes to be disabled independently', async () => {
  const zip = await zipOf(book());
  change(zip, '/xl/tables/table1.xml', text => text.replace(/show(First|Last)Column="1"/g, 'show$1Column="true"').replace('showRowStripes="1"', 'showRowStripes="false"'));
  const wb = await reopen(zip);
  expect(look(wb, 3, 3).bg).toBe('#99ccff');
  expect(look(wb, 3, 4).bg).toBe('#eeeeee');
  expect(look(wb, 3, 6).bg).toBe('#ffaacc');
});
it('renders built-in edge emphasis, preserving explicit direct false and native exports', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.addTable(id, { r1: 0, c1: 0, r2: 3, c2: 2 }, { firstColumn: true, lastColumn: true, banded: false });
  expect(look(wb, 2, 0).bold).toBe(true); expect(look(wb, 2, 2).bold).toBe(true);
  expect(look(wb, 2, 1)?.bold).toBeFalsy();
  wb.setCells(id, [{ r: 2, c: 0, cell: { v: 'Entry', s: { bold: false } } }]);
  expect(look(wb, 2, 0).bold).toBe(false);
  const zip = await zipOf(wb);
  change(zip, '/xl/workbook.xml', text => text.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  const back = await reopen(zip);
  expect(look(back, 2, 2).bold).toBe(true);
});
it('copies displayed edge styles into interoperable HTML and pastes them as cell formatting', () => {
  const wb = book();
  const html = cellsToHtml([['Entry']], [[wb.getCell(wb.activeSheetId, 3, 3)]], [[look(wb, 3, 3)]]);
  expect(html).toContain('font-weight:bold'); expect(html).toContain('#99ccff');
  const rows = parseHtmlClipboard(html.replace(/ data-spreadsheet-\w+="[^"]*"/g, '')).rows;
  const pasted = cellsFromHtmlRows(rows, () => ({}));
  expect(pasted[0].cell.s).toMatchObject({ bold: true, bg: '#99ccff', brBorder: { bs: 'thin', bc: '#aa0000' } });
});
