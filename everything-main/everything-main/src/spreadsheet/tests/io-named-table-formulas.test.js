import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookToOds, workbookToXlsx, workbookFromFile, META_SHEET } from '../src/core/io.js';

const writers = { ods: workbookToOds, xlsx: workbookToXlsx };
function setup(ref) {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.renameSheet(id, "Plan's data");
  wb.setInput(id, 0, 0, 'Value'); wb.setInput(id, 1, 0, '10'); wb.setInput(id, 2, 0, '20');
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 0 }, { name: 'Sales' });
  expect(wb.defineName('TotalSales', ref)).toBeNull();
  const other = wb.addSheet('Summary').id;
  wb.setInput(other, 0, 0, '=TotalSales');
  return { wb, id, other, tid };
}

it.each(Object.keys(writers).flatMap((format) => [
  ['SUM(Sales[Value])', "SUM('Plan''s data'!$A$2:$A$3)", 30],
  ['SUM(Sales)', "SUM('Plan''s data'!$A$2:$A$3)", 30],
  // .xlsx also carries Excel's prefixes for the newer functions and their parameters.
  ['LET(Sales,7,Sales+SUM(Sales[Value]))', "LET(Sales,7,Sales+SUM('Plan''s data'!$A$2:$A$3))", 37, "_xlfn.LET(_xlpm.Sales,7,_xlpm.Sales+SUM(Sales[Value]))"],
  ['LAMBDA(SUM(Sales))()', "LAMBDA(SUM('Plan''s data'!$A$2:$A$3))()", 30, "_xlfn.LAMBDA(SUM(Sales))()"],
].map(([ref, exported, expected, xlsx = ref]) => ({ format, ref, exported: format === 'xlsx' ? xlsx : exported, expected }))))(
  'exports $ref as a complete reference in $format', async ({ format, ref, exported, expected }) => {
    const { wb, other } = setup(ref), before = wb.toJSON();
    expect(wb.getValue(other, 0, 0)).toBe(expected);
    const bytes = new Uint8Array(await (await writers[format](wb)).arrayBuffer());
    const raw = X.read(bytes, { type: 'array' });
    expect(raw.Workbook.Names.find((n) => n.Name === 'TotalSales').Ref).toBe(exported);
    expect(wb.toJSON()).toEqual(before);
    const reopened = await workbookFromFile(bytes, `named-tables.${format}`);
    // Both formats carry the app's settings, so the original structured reference comes back.
    expect(reopened.names.find((n) => n.name === 'TotalSales').ref).toBe(ref);
    expect(reopened.getValue(reopened.sheetByName('Summary').id, 0, 0)).toBe(expected);
    reopened.setInput(reopened.sheetByName("Plan's data").id, 1, 0, '40');
    expect(reopened.getValue(reopened.sheetByName('Summary').id, 0, 0)).toBe(expected + 30);
    reopened.undo();
    expect(reopened.getValue(reopened.sheetByName('Summary').id, 0, 0)).toBe(expected);
  },
);

it('preserves dynamic table membership in native named XLSX formulas', async () => {
  const { wb, id, tid } = setup('SUM(Sales)');
  const bytes = await workbookToXlsx(wb), zip = X.CFB.read(new Uint8Array(await bytes.arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  const reopened = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'named-tables.xlsx');
  const data = reopened.sheetByName("Plan's data"), summary = reopened.sheetByName('Summary');
  reopened.addTableRow(data.id, data.tables[0].id);
  reopened.setInput(data.id, 3, 0, '50');
  expect(reopened.getValue(summary.id, 0, 0)).toBe(80);
  expect(wb.tableById(id, tid).range.r2).toBe(2);
});

it('exports a totals reference using its actual source row', async () => {
  const { wb, id, tid } = setup('SUM(Sales[Value])');
  wb.setTableTotals(id, tid, true);
  wb.defineName('TotalSales', 'SUM(Sales[[#Totals],[Value]])');
  const expected = wb.getValue(wb.sheetByName('Summary').id, 0, 0);
  const blob = await workbookToOds(wb);
  const raw = X.read(await blob.arrayBuffer(), { type: 'array' });
  expect(raw.Workbook.Names.find((n) => n.Name === 'TotalSales').Ref).toBe("SUM('Plan''s data'!$A$4)");
  const reopened = await workbookFromFile(blob, 'totals.ods');
  expect(reopened.getValue(reopened.sheetByName('Summary').id, 0, 0)).toEqual(expected);
});

it('does not replace edits to exported named formulas with stale metadata', async () => {
  const { wb } = setup('SUM(Sales)');
  const raw = X.read(await (await workbookToXlsx(wb)).arrayBuffer(), { type: 'array' });
  raw.Workbook.Names.find((n) => n.Name === 'TotalSales').Ref = '99';
  const bytes = X.write(raw, { bookType: 'xlsx', type: 'array' });
  const reopened = await workbookFromFile(bytes, 'edited.xlsx');
  expect(reopened.names.find((n) => n.name === 'TotalSales').ref).toBe('99');
  expect(reopened.getValue(reopened.sheetByName('Summary').id, 0, 0)).toBe(99);
});

it('keeps row-dependent named formulas intact instead of freezing them to an export location', async () => {
  const { wb, id } = setup('SUM(Sales[@Value])');
  wb.setInput(id, 1, 3, '=TotalSales');
  wb.setInput(id, 2, 3, '=TotalSales');
  expect(wb.getValue(id, 1, 3)).toBe(10);
  expect(wb.getValue(id, 2, 3)).toBe(20);
  const reopened = await workbookFromFile(await workbookToXlsx(wb), 'row-formulas.xlsx');
  const data = reopened.sheetByName("Plan's data");
  expect(reopened.getValue(data.id, 1, 3)).toBe(10);
  expect(reopened.getValue(data.id, 2, 3)).toBe(20);
});

it('ignores malformed named-formula metadata and cannot create extra definitions', async () => {
  const { wb } = setup('SUM(Sales)');
  const raw = X.read(await (await workbookToXlsx(wb)).arrayBuffer(), { type: 'array' });
  const meta = JSON.parse(raw.Sheets[META_SHEET].A1.v);
  meta.structuredNames = [null, { name: 'TotalSales', ref: {}, fileRef: "SUM('Plan''s data'!$A$2:$A$3)" }, { name: 'Injected', ref: '99', fileRef: '99' }];
  raw.Sheets[META_SHEET] = X.utils.aoa_to_sheet([[JSON.stringify(meta)]]);
  const reopened = await workbookFromFile(X.write(raw, { bookType: 'xlsx', type: 'array' }), 'metadata.xlsx');
  expect(reopened.names.some((n) => n.name === 'Injected')).toBe(false);
  expect(reopened.names.find((n) => n.name === 'TotalSales').ref).toBe('SUM(Sales)');
});
