import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const parser = new (new JSDOM('').window.DOMParser)();
function book(total = { f: 'SUBTOTAL(109,Revenue[Amount])' }, header = 'Amount') {
  return new Workbook({ sheets: [{ name: 'Report', cells: {
    '2,3': { v: 'Region' }, '2,4': { v: header },
    '3,3': { v: 'North' }, '3,4': { v: 4 },
    '4,3': { v: 'South' }, '4,4': { v: 7 },
    '5,3': { v: 'Total < & "sales"\r\n' }, '5,4': total,
  }, tables: [{ name: 'Revenue', range: { r1: 2, c1: 3, r2: 5, c2: 4 }, totalsRow: true }] }] });
}
async function exported(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const text = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
  const table = parser.parseFromString(text('/xl/tables/table1.xml'), 'application/xml');
  const columns = [...table.querySelectorAll('tableColumn')];
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(text('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return { table, columns, reopen: () => workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx') };
}

it.each([[101, 'average'], [102, 'countNums'], [103, 'count'], [104, 'max'], [105, 'min'], [107, 'stdDev'], [109, 'sum'], [110, 'var']])(
  'exports SUBTOTAL %i with matching native totals function %s', async (code, name) => {
    const wb = book({ f: `SUBTOTAL(${code},Revenue[Amount])` });
    const { table, columns, reopen } = await exported(wb);
    expect(table.documentElement.getAttribute('totalsRowCount')).toBe('1');
    expect(columns[0].getAttribute('totalsRowLabel')).toBe('Total < & "sales"\r\n');
    expect(columns[1].getAttribute('totalsRowFunction')).toBe(name);
    expect(columns[1].querySelector('totalsRowFormula')).toBeNull();
    const native = await reopen();
    expect(native.activeSheet.tables[0].totalsRow).toBe(true);
    expect(native.getValue(native.activeSheetId, 5, 4)).toEqual(wb.getValue(wb.activeSheetId, 5, 4));
  });

it.each(['SUBTOTAL(9,Revenue[Amount])', 'SUM(Revenue[Amount])', 'SUBTOTAL(109,Revenue[Region])',
  'SUBTOTAL(109,Another[Amount])', 'SUBTOTAL(109,Revenue[Amount],1)', 'SUBTOTAL(109,Revenue[[#All],[Amount]])',
  'IF(1<2,"A&B","")', 'FUTUREFUNCTION(Revenue[Amount])'])('preserves custom total %s verbatim', async formula => {
  const { columns, reopen } = await exported(book({ f: formula }));
  expect(columns[1].getAttribute('totalsRowFunction')).toBe('custom');
  expect(columns[1].querySelector('totalsRowFormula').textContent).toBe(formula);
  const native = await reopen();
  expect(native.getCell(native.activeSheetId, 5, 4).f).toBe(formula);
});

it('recognizes escaped headers, explicit data selectors and case-insensitive local references', async () => {
  for (const formula of ["subtotal(109,revenue[[#Data],[Gross '#]])", "SUBTOTAL(109,[Gross '#])"]) {
    const { columns } = await exported(book({ f: formula }, 'Gross #'));
    expect(columns[1].getAttribute('totalsRowFunction')).toBe('sum');
  }
});

it('keeps explicit array totals as custom formulas rather than replacing them with scalar built-ins', async () => {
  const { columns, reopen } = await exported(book({ f: 'SUBTOTAL(109,Revenue[Amount])', array: { rows: 1, cols: 1 } }));
  expect(columns[1].getAttribute('totalsRowFunction')).toBe('custom');
  expect(columns[1].querySelector('totalsRowFormula').getAttribute('array')).toBe('1');
  const native = await reopen();
  expect(native.getCell(native.activeSheetId, 5, 4).array).toEqual({ rows: 1, cols: 1 });
});

it.each([{ v: 42 }, { v: false }, { v: { error: '#DIV/0!' } }, {}, { v: 'Literal total' }])('keeps constant/empty totals cells without inventing formulas (%j)', async cell => {
  const { columns, reopen } = await exported(book(cell));
  expect(columns[1].getAttribute('totalsRowFunction')).toBe(cell.v != null && typeof cell.v !== 'string' ? 'custom' : null);
  expect(columns[1].querySelector('totalsRowFormula')).toBeNull();
  expect(columns[1].getAttribute('totalsRowLabel')).toBe(typeof cell.v === 'string' ? cell.v : null);
  const native = await reopen();
  expect(native.getCell(native.activeSheetId, 5, 4)?.f).toBeFalsy();
  expect(native.getValue(native.activeSheetId, 5, 4)).toEqual(cell.v ?? null);
});

it('derives current totals after edits, undo, column rename and row insertion', async () => {
  const wb = book(), id = wb.activeSheetId;
  wb.setInput(id, 5, 4, '=SUM(Revenue[Amount])*2');
  expect((await exported(wb)).columns[1].getAttribute('totalsRowFunction')).toBe('custom');
  wb.undo();
  expect((await exported(wb)).columns[1].getAttribute('totalsRowFunction')).toBe('sum');
  wb.setInput(id, 2, 4, 'Updated amount');
  wb.insertRows(id, 4, 2);
  const { columns, reopen } = await exported(wb);
  expect(columns[1].getAttribute('name')).toBe('Updated amount');
  expect(columns[1].getAttribute('totalsRowFunction')).toBe('sum');
  const native = await reopen();
  expect(native.getValue(native.activeSheetId, 7, 4)).toBe(11);
  wb.setInput(id, 7, 4, 'Edited label');
  expect((await exported(wb)).columns[1].getAttribute('totalsRowLabel')).toBe('Edited label');
});

it('does not label the final data row as a total when totals are disabled', async () => {
  const wb = book(); wb.activeSheet.tables[0].totalsRow = false;
  const { columns } = await exported(wb);
  expect(columns.every(c => !c.hasAttribute('totalsRowFunction') && !c.hasAttribute('totalsRowLabel'))).toBe(true);
  expect(columns.every(c => !c.querySelector('totalsRowFormula'))).toBe(true);
});
