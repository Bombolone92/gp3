import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { readXlsxFilterButtons, writeXlsxFilter } from '../src/core/xlsx-filter.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

const decode = part => new TextDecoder().decode(part.content);

it.each(['hiddenButton="1"', 'hiddenButton="true"', 'showButton="0"', 'showButton="false"'])(
  'exports imported hidden buttons without conditions (%s)', async attributes => {
    const wb = await workbookFromFile(otherProgramsXlsx({ sheetXml: { Data: {
      rows: '<row r="3"><c r="D3" t="inlineStr"><is><t>Heading</t></is></c></row>',
      tail: `<autoFilter ref="D3:E9"><filterColumn colId="0" ${attributes}/><filterColumn colId="1" ${attributes}/></autoFilter>`,
    } } }), 'filter.xlsx');
    expect(wb.activeSheet.filter.showButtons).toBe(false);
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const xml = decode(X.CFB.find(zip, '/xl/worksheets/sheet1.xml'));
    expect(xml).toContain('<autoFilter ref="D3:E9"><filterColumn colId="0" hiddenButton="1"/><filterColumn colId="1" hiddenButton="1"/></autoFilter>');
  },
);

it.each([false, true])('preserves native hidden buttons and live criteria (table: %s)', async table => {
  let wb = new Workbook(), sheet = wb.activeSheet;
  const range = { r1: 3, c1: 2, r2: 6, c2: 4 };
  [['Name', 'Quantity', 'Cost'], ['A', 1, 4], ['B', 5, 3], ['C', 9, 7]].forEach((row, r) =>
    row.forEach((value, c) => wb.setInput(sheet.id, r + range.r1, c + range.c1, String(value))));
  if (table) wb.addTable(sheet.id, range, { name: 'Stock' });
  else wb.setFilterRange(sheet.id, range);
  sheet.filter.showButtons = false;
  wb.setFilterCriteria(sheet.id, 3, { op: 'gt', value: 2 });
  for (let pass = 0; pass < 2; pass++) {
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const xml = decode(X.CFB.find(zip, table ? '/xl/tables/table1.xml' : '/xl/worksheets/sheet1.xml'));
    expect(xml.match(/<filterColumn\b/g)).toHaveLength(3);
    expect(xml).toContain('<filterColumn colId="0" hiddenButton="1"/>');
    expect(xml).toContain('<filterColumn colId="1" hiddenButton="1"><customFilters>');
    expect(xml).toContain('<filterColumn colId="2" hiddenButton="1"/>');
    if (table) expect(decode(X.CFB.find(zip, '/xl/worksheets/sheet1.xml'))).not.toContain('<autoFilter');
    // Independent readers cannot use the private sidecar to repair lost native state.
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(decode(part).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
    sheet = wb.activeSheet;
    expect(sheet.filter.showButtons).toBe(false);
    expect([...sheet.filterHidden]).toEqual([4]);
    wb.setFilterCriteria(sheet.id, 3, null);
    expect([...sheet.filterHidden]).toEqual([]);
    expect(sheet.filter.showButtons).toBe(false);
    wb.setFilterCriteria(sheet.id, 3, { op: 'gt', value: 2 });
  }
});

it('emits hidden buttons for condition-free and unsupported-condition columns, without changing visible defaults', () => {
  const range = { r1: 0, c1: 5, r2: 9, c2: 5 };
  for (const criteria of [undefined, {}, { 5: { formula: 'A2>3' } }]) {
    expect(writeXlsxFilter({ range, criteria, showButtons: false })).toBe('<filterColumn colId="0" hiddenButton="1"/>');
    expect(writeXlsxFilter({ range, criteria })).toBe('');
  }
});

it('reads independently hidden columns, namespace prefixes and malformed column ids', () => {
  const range = { c1: 3, c2: 6 };
  expect(readXlsxFilterButtons('<x:filterColumn colId="0" hiddenButton="true"/><filterColumn colId="2" showButton="false"/>', range))
    .toEqual({ hiddenButtons: [3, 5] });
  for (const id of ['', '-1', '1.5', 'NaN', '999999999999999999999999', '4']) {
    expect(readXlsxFilterButtons(`<filterColumn colId="${id}" hiddenButton="1"/>`, range)).toEqual({});
  }
  expect(readXlsxFilterButtons('<filterColumn hiddenButton="1"/>', range)).toEqual({});
  expect(readXlsxFilterButtons('<!-- <filterColumn colId="0" hiddenButton="1"/> -->', range)).toEqual({});
  expect(readXlsxFilterButtons('<filterColumn colId="1" hiddenButton="false" showButton="true"/>', range)).toEqual({});
});

async function mixed() {
  return workbookFromFile(otherProgramsXlsx({ sheetXml: { Data: {
    rows: '<row r="3"><c r="D3" t="inlineStr"><is><t>Heading</t></is></c></row>',
    tail: '<autoFilter ref="D3:G9"><filterColumn colId="0" hiddenButton="1"/><filterColumn colId="2" showButton="0"/></autoFilter>',
  } } }), 'mixed.xlsx');
}

it.each([false, true])('retains mixed visibility through native export, copies, drafts, and malformed metadata (table: %s)', async table => {
  let wb = await mixed();
  expect(wb.activeSheet.filter.hiddenButtons).toEqual([3, 5]);
  if (table) {
    wb.addTable(wb.activeSheetId, wb.activeSheet.filter.range, { name: 'Records' });
    expect(wb.activeSheet.filter.hiddenButtons).toEqual([3, 5]);
  }
  const copy = wb.duplicateSheet(wb.activeSheetId);
  copy.filter.hiddenButtons.push(4);
  expect(wb.sheets[0].filter.hiddenButtons).toEqual([3, 5]);
  wb = new Workbook(wb.toJSON());
  wb.activeSheetId = wb.sheets[0].id;
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const xml = decode(X.CFB.find(zip, table ? '/xl/tables/table1.xml' : '/xl/worksheets/sheet1.xml'));
  expect(xml).toContain('<filterColumn colId="0" hiddenButton="1"/>');
  expect(xml).toContain('<filterColumn colId="2" hiddenButton="1"/>');
  expect(xml).not.toContain('<filterColumn colId="1"');
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(decode(part).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect(wb.sheets[0].filter.hiddenButtons).toEqual([3, 5]);
  wb.sheets[0].filter.hiddenButtons = [3, 3, -1, 100, '4', null, 4.5, 5];
  expect(new Workbook(wb.toJSON()).sheets[0].filter.hiddenButtons).toEqual([3, 5]);
});

it.each([false, true])('preserves filter visibility when converting its exact range to a table (all hidden: %s)', async all => {
  const wb = await mixed(), id = wb.activeSheetId;
  if (all) { delete wb.activeSheet.filter.hiddenButtons; wb.activeSheet.filter.showButtons = false; }
  const before = structuredClone(wb.activeSheet.filter);
  wb.clearHistory();
  wb.addTable(id, before.range, { name: 'Converted' });
  expect(wb.activeSheet.filter).toEqual(before);
  wb.undo(); expect(wb.activeSheet.filter).toEqual(before);
  wb.redo(); expect(wb.activeSheet.filter).toEqual(before);
});

it.each([
  ['insert before', (wb, id) => wb.insertCols(id, 0), [4, 6]],
  ['insert inside', (wb, id) => wb.insertCols(id, 4), [3, 6]],
  ['delete hidden', (wb, id) => wb.deleteCols(id, 3), [4]],
  ['delete visible', (wb, id) => wb.deleteCols(id, 4), [3, 4]],
  ['reorder', (wb, id) => wb.moveCols(id, 3, 1, 5), [4, 5]],
  ['insert rows', (wb, id) => wb.insertRows(id, 0), [3, 5]],
  ['shift block', (wb, id) => wb.insertCells(id, { r1: 2, c1: 2, r2: 8, c2: 2 }, 'right'), [4, 6]],
])('moves hidden filter buttons with columns: %s', async (_, action, expected) => {
  const wb = await mixed(), id = wb.activeSheetId;
  wb.clearHistory(); action(wb, id);
  expect([...wb.activeSheet.filter.hiddenButtons].sort((a, b) => a - b)).toEqual(expected);
  wb.undo(); expect(wb.activeSheet.filter.hiddenButtons).toEqual([3, 5]);
  wb.redo(); expect([...wb.activeSheet.filter.hiddenButtons].sort((a, b) => a - b)).toEqual(expected);
});

it('trims hidden buttons when resizing a table and does not revive removed columns when growing it', async () => {
  const wb = await mixed(), id = wb.activeSheetId;
  wb.addTable(id, wb.activeSheet.filter.range, { name: 'Records' });
  const table = wb.activeSheet.tables[0];
  wb.activeSheet.filter.hiddenButtons = [3, 5];
  wb.clearHistory();
  expect(wb.resizeTable(id, table.id, { r1: 2, c1: 3, r2: 8, c2: 4 })).toBe(true);
  expect(wb.activeSheet.filter.hiddenButtons).toEqual([3]);
  wb.undo(); expect(wb.activeSheet.filter.hiddenButtons).toEqual([3, 5]);
  wb.redo(); expect(wb.activeSheet.filter.hiddenButtons).toEqual([3]);
  expect(wb.resizeTable(id, table.id, { r1: 2, c1: 3, r2: 8, c2: 6 })).toBe(true);
  expect(wb.activeSheet.filter.hiddenButtons).toEqual([3]);
});
