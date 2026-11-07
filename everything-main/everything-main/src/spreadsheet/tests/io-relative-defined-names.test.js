import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { resolveRelativeName, shiftFormula } from '../src/core/refs.js';

function source() {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([
    ['Age', 'Deposit', 'Balance'], [40, 100, 1000],
    [null, 200], [null, 300], [null, 400],
  ]), 'Plan');
  for (let row = 3; row <= 5; row++) {
    book.Sheets.Plan[`A${row}`] = { t: 'n', f: 'Age', v: 38 + row };
    book.Sheets.Plan[`C${row}`] = { t: 'n', f: 'Balance', v: [1200, 1500, 1900][row - 3] };
  }
  book.Workbook = { Names: [
    { Name: 'Year', Ref: 'ROWS(Plan!$A$2:$A1)' },
    { Name: 'Age', Ref: 'Plan!$A$2+Year-1' },
    { Name: 'Previous', Ref: 'Plan!$C1048576' },
    { Name: 'Deposit', Ref: 'Plan!XFD1' },
    { Name: 'Balance', Ref: 'Previous+Deposit' },
    { Name: 'RowAbove', Ref: 'Plan!1048576:1048576' },
    { Name: 'ColumnBefore', Ref: 'Plan!XFD:XFD' },
    { Name: 'Local', Ref: 'Plan!$B1*2', Sheet: 0 },
  ] };
  return new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' }));
}

it('resolves relative rows, columns, wrapped negative offsets and nested names at each caller', async () => {
  const wb = await workbookFromFile(source(), 'plan.xlsx'), id = wb.activeSheetId;
  expect([2, 3, 4].map(r => wb.getValue(id, r, 0))).toEqual([41, 42, 43]);
  expect([2, 3, 4].map(r => wb.getValue(id, r, 2))).toEqual([1200, 1500, 1900]);
  wb.setInput(id, 2, 1, '500');
  expect(wb.getValue(id, 4, 2)).toBe(2200);
  wb.undo(); expect(wb.getValue(id, 4, 2)).toBe(1900);
  wb.setInput(id, 2, 3, '=Local'); expect(wb.getValue(id, 2, 3)).toBe(400);
  expect(wb.namedLocation('Previous', 'Plan', { r: 3, c: 2 })).toMatchObject({ r1: 2, c1: 2 });
  expect(wb.namedRef('RowAbove', 'Plan', { r: 3, c: 2 })).toMatchObject({ kind: 'rows', r1: 2, r2: 2 });
  expect(wb.namedRef('ColumnBefore', 'Plan', { r: 3, c: 2 })).toMatchObject({ kind: 'cols', c1: 1, c2: 1 });
});

it('keeps native relative name definitions and recalculated caches without private metadata', async () => {
  let wb = await workbookFromFile(source(), 'plan.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
    const raw = X.read(bytes, { type: 'array', xlfn: true });
    expect(raw.Workbook.Names.find(n => n.Name === 'Previous').Ref).toBe('Plan!$C1048576');
    expect(raw.Sheets.Plan.C5.v).toBe(1900);
    const zip = X.CFB.read(bytes, { type: 'array' }), file = X.CFB.find(zip, '/xl/workbook.xml');
    file.content = new TextEncoder().encode(new TextDecoder().decode(file.content).replace(/<sheet\b[^>]*name="_puter_meta"[^>]*\/>/, ''));
    file.size = file.content.length;
    wb = await workbookFromFile(new Uint8Array(X.CFB.write(zip, { type: 'array', fileType: 'zip' })), 'external.xlsx');
    expect(wb.getValue(wb.activeSheetId, 4, 2)).toBe(1900);
    expect(wb.namedEntry('Previous').relative).toBe(true);
  }
});

it('preserves relative names through app saves, JSON, rename and cell copy/paste', async () => {
  let wb = await workbookFromFile(source(), 'plan.xlsx');
  wb = new Workbook(wb.toJSON());
  wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  const id = wb.activeSheetId;
  wb.setInput(id, 5, 1, '500');
  const range = { r1: 4, c1: 2, r2: 4, c2: 2 };
  wb.pasteCells(id, wb.copyRange(id, range), 5, 2, { r: 4, c: 2 });
  expect(wb.getValue(id, 5, 2)).toBe(2400);
  wb.undo(); expect(wb.getValue(id, 5, 2)).toBe(null);
  wb.redo(); expect(wb.getValue(id, 5, 2)).toBe(2400);
  expect(wb.renameName('Previous', null, 'PriorBalance', 'Plan!$C1048576')).toBe(null);
  expect(wb.namedEntry('PriorBalance').relative).toBe(true);
  expect(wb.getValue(id, 5, 2)).toBe(2400);
  wb.renameSheet(id, 'Retirement Plan');
  expect(wb.getValue(id, 5, 2)).toBe(2400);
});

it('retains relative definitions when importing or replacing a sheet, including fixed-name collisions', async () => {
  const sourceBook = await workbookFromFile(source(), 'plan.xlsx');
  const dest = new Workbook();
  dest.defineName('Previous', 'Sheet1!$C1048576');
  const added = dest.importSheets(sourceBook)[0];
  expect(dest.getValue(added.id, 4, 2)).toBe(1900);
  expect(dest.namedEntry('Previous', added.name).relative).toBe(true);
  const replacement = new Workbook();
  replacement.replaceSheetWith(replacement.activeSheetId, sourceBook, sourceBook.activeSheetId);
  expect(replacement.getValue(replacement.activeSheetId, 4, 2)).toBe(1900);
  const duplicate = replacement.duplicateSheet(replacement.activeSheetId);
  expect(replacement.getValue(duplicate.id, 4, 2)).toBe(1900);
});

it('keeps existing app-created fixed definitions fixed when reopened', async () => {
  let wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, '7');
  wb.defineName('Fixed', 'Sheet1!A1');
  wb.setInput(wb.activeSheetId, 4, 2, '=Fixed');
  wb = await workbookFromFile(await workbookToXlsx(wb), 'legacy.xlsx');
  expect(wb.getValue(wb.activeSheetId, 4, 2)).toBe(7);
  expect(wb.names[0].relative).toBeUndefined();
});

it('moves absolute anchors while preserving relative offsets during row and column edits', async () => {
  const wb = await workbookFromFile(source(), 'plan.xlsx'), id = wb.activeSheetId;
  wb.insertRows(id, 0, 2);
  expect(wb.getValue(id, 6, 0)).toBe(43);
  expect(wb.getValue(id, 6, 2)).toBe(1900);
  wb.insertCols(id, 0, 1);
  expect(wb.getValue(id, 6, 1)).toBe(43);
  expect(wb.getValue(id, 6, 3)).toBe(1900);
  wb.deleteRows(id, 0, 2);
  wb.deleteCols(id, 0, 1);
  expect(wb.getValue(id, 4, 2)).toBe(1900);
  wb.undo(); wb.undo();
  expect(wb.getValue(id, 6, 3)).toBe(1900);
});

it('only wraps relative name offsets, preserving absolute coordinates and ordinary copy errors', () => {
  expect(resolveRelativeName('SUM(Data!$B1048576,Data!XFD$2,"A1",Data!$A$1)', 2, 2))
    .toBe('SUM(Data!$B2,Data!B$2,"A1",Data!$A$1)');
  expect(resolveRelativeName('A1', 1048575, 16383)).toBe('XFD1048576');
  expect(resolveRelativeName('B2', 1048575, 16383)).toBe('A1');
  expect(shiftFormula('XFD1048576', 1, 1)).toBe('#REF!');
});

it('resolves a long running balance read from the final row without a stack error', () => {
  const cells = { '0,0': { v: 1 } };
  for (let r = 1; r < 1500; r++) cells[`${r},0`] = { f: 'Previous+1' };
  const wb = new Workbook({ sheets: [{ name: 'Plan', cells }], names: [{ name: 'Previous', ref: 'Plan!$A1048576', relative: true }] });
  expect(wb.getValue(wb.activeSheetId, 1499, 0)).toBe(1500);
  wb.setInput(wb.activeSheetId, 0, 0, '5');
  expect(wb.getValue(wb.activeSheetId, 1499, 0)).toBe(1504);
});

it('inherits the number format from the relative name’s resolved cell when typing a formula', async () => {
  const wb = await workbookFromFile(source(), 'plan.xlsx'), id = wb.activeSheetId;
  wb.setInput(id, 4, 2, '1900', { style: { fmt: 'currency', cur: 'EUR', dec: 2 } });
  wb.setInput(id, 5, 2, '=Previous');
  expect(wb.getValue(id, 5, 2)).toBe(1900);
  expect(wb.getCell(id, 5, 2).s).toMatchObject({ fmt: 'currency', cur: 'EUR', dec: 2 });
});
