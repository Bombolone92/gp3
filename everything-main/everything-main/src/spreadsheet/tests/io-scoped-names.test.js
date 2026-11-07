import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

function source(reverse = false) {
  const book = X.utils.book_new();
  for (const [name, value] of [['One', 3], ['Two Data', 7], ['Three', 11]]) X.utils.book_append_sheet(book, {
    '!ref': 'A1:E1', A1: { t: 'n', v: value }, B1: { t: 'n', v: 0, f: 'Rate' },
    C1: { t: 'n', v: 0, f: 'Amount' }, D1: { t: 'n', v: 0, f: 'Double(A1)' },
    E1: { t: 'n', v: 0, f: 'OnlyHere' },
  }, name);
  const names = [
    { Name: 'Rate', Ref: '10' }, { Name: 'Rate', Ref: '20', Sheet: 1 }, { Name: 'Rate', Ref: '30', Sheet: 2 },
    { Name: 'Amount', Ref: 'One!$A$1' }, { Name: 'Amount', Ref: "'Two Data'!$A$1", Sheet: 1 },
    { Name: 'Double', Ref: '_xlfn.LAMBDA(x,x*2)' }, { Name: 'Double', Ref: '_xlfn.LAMBDA(x,x*3)', Sheet: 1 },
    { Name: 'OnlyHere', Ref: '42', Sheet: 1 },
  ];
  book.Workbook = { Names: reverse ? names.reverse() : names };
  return book;
}

async function imported(format = 'xlsx', reverse = false) {
  return workbookFromFile(new Uint8Array(X.write(source(reverse), { type: 'array', bookType: format })), `scope.${format}`);
}

function values(wb, col) { return wb.sheets.map((s) => wb.getValue(s.id, 0, col)); }

it.each(['xlsx', 'ods'].flatMap((format) => [false, true].map((reverse) => ({ format, reverse }))))(
  'preserves sheet-local definitions and global fallback in $format (reverse=$reverse)', async ({ format, reverse }) => {
    let wb = await imported(format, reverse);
    for (let i = 0; i < 3; i++) {
      expect(wb.names).toHaveLength(8);
      expect(values(wb, 1)).toEqual([10, 20, 30]);
      expect(values(wb, 2)).toEqual([3, 7, 3]);
      expect(values(wb, 3)).toEqual([6, 21, 22]);
      expect(values(wb, 4)).toEqual([{ error: '#NAME?' }, 42, { error: '#NAME?' }]);
      wb = await workbookFromFile(await (format === 'xlsx' ? workbookToXlsx : workbookToOds)(wb), `again.${format}`);
    }
    wb.setInput(wb.sheets[1].id, 0, 0, '9'); expect(values(wb, 2)).toEqual([3, 9, 3]);
    wb.undo(); expect(values(wb, 2)).toEqual([3, 7, 3]);
  },
);

it.each(['xlsx', 'ods'])('writes each definition with its native %s scope after sheet reordering', async (format) => {
  const wb = await imported();
  wb.moveSheet(wb.sheets[1].id, 0);
  const bytes = await (format === 'xlsx' ? workbookToXlsx : workbookToOds)(wb);
  const raw = X.read(await bytes.arrayBuffer(), { type: 'array', xlfn: true });
  const rates = raw.Workbook.Names.filter((n) => n.Name === 'Rate');
  expect(rates.map((n) => [n.Ref, n.Sheet ?? null]).sort()).toEqual([['10', null], ['20', 0], ['30', 2]]);
  const reopened = await workbookFromFile(bytes, `reordered.${format}`);
  expect(values(reopened, 1)).toEqual([20, 10, 30]);
});

it('retains scope through JSON, rename, duplication, deletion, and undo/redo', async () => {
  let wb = new Workbook((await imported()).toJSON());
  const id = wb.sheets[1].id;
  wb.renameSheet(id, "O'Brien"); expect(values(wb, 1)).toEqual([10, 20, 30]);
  expect(wb.names.find((n) => n.name === 'Rate' && n.sheet)).toMatchObject({ sheet: "O'Brien" });
  const copy = wb.duplicateSheet(id);
  expect(wb.getValue(copy.id, 0, 1)).toBe(20);
  wb.setInput(copy.id, 0, 0, '15');
  expect(wb.getValue(copy.id, 0, 2)).toBe(15);
  expect(wb.getValue(id, 0, 2)).toBe(7);
  wb.deleteSheet(id); expect(wb.names.some((n) => n.sheet === "O'Brien")).toBe(false);
  expect(wb.getValue(copy.id, 0, 1)).toBe(20);
  wb.undo(); expect(wb.getValue(id, 0, 1)).toBe(20);
  wb.redo(); expect(wb.names.some((n) => n.sheet === "O'Brien")).toBe(false);
});

it('edits and deletes only the selected name scope', async () => {
  const wb = await imported();
  expect(wb.defineName('rate', '50', 'Two Data')).toBe(null);
  expect(values(wb, 1)).toEqual([10, 50, 30]);
  wb.undo(); expect(values(wb, 1)).toEqual([10, 20, 30]);
  wb.deleteName('RATE', 'Two Data'); expect(values(wb, 1)).toEqual([10, 10, 30]);
  wb.undo(); expect(values(wb, 1)).toEqual([10, 20, 30]);
  wb.defineName('Rate', '60'); expect(values(wb, 1)).toEqual([60, 20, 30]);
  expect(wb.defineName('NewName', '1', 'Missing')).toBeTruthy();
});

it('preserves local names when copying a sheet to a new or existing workbook', async () => {
  const wb = await imported(), part = wb.sheetToWorkbook(wb.sheets[1].id);
  expect(values(part, 1)).toEqual([20]);
  const dest = new Workbook({ sheets: [{ name: 'Two Data' }] });
  dest.defineName('Rate', '90');
  const [copy] = dest.importSheets(part);
  expect(copy.name).toBe('Two Data (2)');
  expect(dest.getValue(copy.id, 0, 1)).toBe(20);
  expect(dest.getValue(copy.id, 0, 2)).toBe(7);
  expect(dest.names.find((n) => n.name === 'Rate' && n.sheet)?.sheet).toBe(copy.name);
  dest.undo(); expect(dest.names).toEqual([{ name: 'Rate', ref: '90' }]);
  dest.redo(); expect(dest.getValue(copy.id, 0, 1)).toBe(20);
});

it('adjusts unqualified local references only when their own sheet changes', async () => {
  const wb = await imported(), [one, two] = wb.sheets;
  wb.defineName('Relative', 'SUM(A1:A2)', two.name);
  wb.setInput(two.id, 0, 5, '=Relative');
  wb.insertRows(one.id, 0, 1);
  expect(wb.names.find((n) => n.name === 'Relative').ref).toBe('SUM(A1:A2)');
  wb.insertRows(two.id, 0, 1);
  expect(wb.names.find((n) => n.name === 'Relative').ref).toBe('SUM(A2:A3)');
  expect(wb.getValue(two.id, 1, 5)).toBe(7);
});

it.each(['xlsx', 'ods'])('limits spill-like defined calls to their own sheet in %s', async (format) => {
  const book = X.utils.book_new();
  for (const name of ['One', 'Two']) X.utils.book_append_sheet(book, {
    '!ref': 'A1:C3', A1: { t: 'n', v: 1, f: '_xlfn.SEQUENCE(3)' }, C1: { t: 'n', v: 0, f: 'SUM(ANCHORARRAY(A1))' },
  }, name);
  book.Workbook = { Names: [{ Name: 'ANCHORARRAY', Ref: '_xlfn.LAMBDA(x,x*10)', Sheet: 1 }] };
  const wb = await workbookFromFile(new Uint8Array(X.write(book, { type: 'array', bookType: format })), `spill.${format}`);
  expect(values(wb, 2)).toEqual([6, 10]);
  expect(wb.getCell(wb.sheets[0].id, 0, 2).f).toBe('SUM(A1#)');
  expect(wb.getCell(wb.sheets[1].id, 0, 2).f).toBe('SUM(ANCHORARRAY(A1))');
});

it('retains hidden-sheet scopes and rejects missing scopes instead of promoting them', () => {
  const wb = new Workbook({ sheets: [{ name: 'One' }, { name: 'Hidden', hidden: true }], names: [
    { name: 'Rate', ref: '10' }, { name: 'Rate', ref: '20', sheet: 'Hidden' },
    { name: 'Bad', ref: '30', sheet: 'Missing' },
  ] });
  expect(wb.names).toHaveLength(2);
  expect(wb.namedEntry('Rate', 'Hidden').ref).toBe('20');
  expect(wb.namedEntry('Rate', 'One').ref).toBe('10');
  expect(wb.namedEntry('Bad', 'One')).toBeUndefined();
});

it('offers only visible definitions for formula completion and range labels', async () => {
  const wb = await imported();
  const [one, two] = wb.sheets;
  expect(wb.namesForSheet(one.id).map((n) => n.name)).toEqual(['Rate', 'Amount', 'Double']);
  expect(wb.namesForSheet(two.id).map((n) => n.name)).toEqual(['Rate', 'Amount', 'Double', 'OnlyHere']);
  expect(wb.nameForRange(one.id, { r1: 0, c1: 0, r2: 0, c2: 0 })).toBe('Amount');
  expect(wb.namedRef('Amount', two.name).sheet).toBe(two.name);
});

it('restores each scoped table formula from its own XLSX metadata', async () => {
  let wb = new Workbook({ sheets: [{ name: 'One' }, { name: 'Two' }] });
  for (const [i, s] of wb.sheets.entries()) {
    wb.setInput(s.id, 0, 0, 'Value'); wb.setInput(s.id, 1, 0, String((i + 1) * 10));
    wb.addTable(s.id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { name: `Data${i + 1}` });
    wb.defineName('Total', `SUM(Data${i + 1}[Value])`, s.name);
    wb.setInput(s.id, 0, 2, '=Total');
  }
  wb.defineName('Total', '100');
  wb = await workbookFromFile(await workbookToXlsx(wb), 'metadata.xlsx');
  expect(wb.namedEntry('Total', 'One').ref).toBe('SUM(Data1[Value])');
  expect(wb.namedEntry('Total', 'Two').ref).toBe('SUM(Data2[Value])');
  expect(wb.namedEntry('Total', null).ref).toBe('100');
  const s = wb.sheets[1];
  wb.addTableRow(s.id, s.tables[0].id); wb.setInput(s.id, 2, 0, '30');
  expect(values(wb, 2)).toEqual([10, 50]);
  wb.undo(); expect(values(wb, 2)).toEqual([10, 20]);
});

it('redirects copied local table formulas to the copied table', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Value'); wb.setInput(id, 1, 0, '10');
  wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { name: 'Sales' });
  wb.defineName('Total', 'SUM(Sales[Value])', 'Sheet1'); wb.setInput(id, 0, 2, '=Total');
  const copy = wb.duplicateSheet(id);
  wb.setInput(copy.id, 1, 0, '40');
  expect(wb.getValue(copy.id, 0, 2)).toBe(40);
  expect(wb.getValue(id, 0, 2)).toBe(10);
});
