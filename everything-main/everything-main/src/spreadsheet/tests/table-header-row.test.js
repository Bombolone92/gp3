// @vitest-environment jsdom
import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { setTableHeaderRow, setTableFilterButton, tableFilterButtonOn } from '../src/core/table-header-row.js';
import { slicerTableReference } from '../src/core/slicer.js';

function make({ above = null } = {}) {
  const wb = new Workbook(), id = wb.activeSheetId;
  if (above != null) wb.setInput(id, 0, 1, above);
  [['Name', 'Qty'], ['a', '1'], ['b', '2'], ['c', '3']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r + 1, c + 1, v)));
  const tableId = wb.addTable(id, { r1: 1, c1: 1, r2: 4, c2: 2 }, { name: 'T' });
  wb.setInput(id, 0, 5, '=SUM(T[Qty])');
  return { wb, id, tableId, table: () => wb.tableById(id, tableId) };
}
async function zipOf(wb) {
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(blob); });
  return X.CFB.read(new Uint8Array(bytes), { type: 'array' });
}
const part = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path).content);

it('hides the header row: the table starts at its data, the names are kept and references still work', () => {
  const { wb, id, tableId, table } = make();
  expect(setTableHeaderRow(wb, id, tableId, false)).toBeNull();
  expect(table()).toMatchObject({ headerRow: false, range: { r1: 2, r2: 4 }, columnNames: ['Name', 'Qty'] });
  expect(wb.getValue(id, 1, 1)).toBe(null);
  expect(wb.getValue(id, 0, 5)).toBe(6);
  expect(wb.tableColumns(id, table())).toEqual(['Name', 'Qty']);
  expect(wb.resolveTableRef(id, 0, 5, 'T', '[#Headers],[Qty]').error ?? wb.resolveTableRef(id, 0, 5, 'T', '[#Headers],[Qty]')).toBe('#REF!');
  // No filter without a header row.
  expect(wb.filtersForSheet(id)).toHaveLength(0);
  // Undo brings the header back exactly.
  wb.undo();
  expect(table().headerRow).toBeUndefined();
  expect(table().range.r1).toBe(1);
  expect(wb.getValue(id, 1, 1)).toBe('Name');
});

it('shows the header row in the empty row above, restoring the names and a filter', () => {
  const { wb, id, tableId, table } = make();
  setTableHeaderRow(wb, id, tableId, false);
  expect(setTableHeaderRow(wb, id, tableId, true)).toBeNull();
  expect(table().range).toEqual({ r1: 1, c1: 1, r2: 4, c2: 2 });
  expect(table().headerRow).toBeUndefined();
  expect([wb.getValue(id, 1, 1), wb.getValue(id, 1, 2)]).toEqual(['Name', 'Qty']);
  expect(wb.filtersForSheet(id)).toHaveLength(1);
  expect(wb.getValue(id, 0, 5)).toBe(6);
});

it('inserts a row for the header when the row above holds something', () => {
  const { wb, id, tableId, table } = make();
  setTableHeaderRow(wb, id, tableId, false);
  wb.setInput(id, 1, 1, 'note');
  expect(setTableHeaderRow(wb, id, tableId, true)).toBeNull();
  expect(wb.getValue(id, 1, 1)).toBe('note');
  expect(table().range).toEqual({ r1: 2, c1: 1, r2: 5, c2: 2 });
  expect(wb.getValue(id, 2, 1)).toBe('Name');
});

it('keeps the stored names in step when columns are inserted, deleted or the table is resized', () => {
  const { wb, id, tableId, table } = make();
  setTableHeaderRow(wb, id, tableId, false);
  wb.insertCols(id, 2, 1);
  expect(wb.tableColumns(id, table())).toEqual(['Name', 'Column2', 'Qty']);
  expect(wb.getValue(id, 2, 1)).toBe('a'); // no name written over the first data row
  wb.deleteCols(id, 2, 1);
  expect(wb.tableColumns(id, table())).toEqual(['Name', 'Qty']);
  expect(wb.resizeTable(id, tableId, { ...table().range, c2: 3 })).toBe(true);
  expect(wb.tableColumns(id, table())).toEqual(['Name', 'Qty', 'Column3']);
  expect(wb.getValue(id, 2, 3)).toBe(null);
});

it('editing the first data row of a headerless table does not rename a column', () => {
  const { wb, id, tableId, table } = make();
  setTableHeaderRow(wb, id, tableId, false);
  wb.setInput(id, 2, 2, '10');
  expect(wb.tableColumns(id, table())).toEqual(['Name', 'Qty']);
  expect(wb.getValue(id, 0, 5)).toBe(15);
});

it('refuses to hide the header of a table that has slicers', () => {
  const { wb, id, tableId } = make();
  wb.addChart(id, { type: 'slicer', tableRef: slicerTableReference('T', 'Name'), anchor: { r: 1, c: 4 }, w: 160, h: 120, paint: { frame: {}, items: {} } });
  expect(setTableHeaderRow(wb, id, tableId, false)).toMatch(/slicers/);
});

it('writes headerRowCount="0" with the column names and reads it back', async () => {
  const { wb, id, tableId } = make();
  setTableHeaderRow(wb, id, tableId, false);
  const zip = await zipOf(wb);
  const xml = part(zip, '/xl/tables/table1.xml');
  expect(xml).toContain('headerRowCount="0"');
  expect(xml).toContain('ref="B3:C5"');
  expect(xml).not.toContain('<autoFilter');
  expect(xml).toMatch(/<tableColumn id="1" name="Name"\/><tableColumn id="2" name="Qty"\/>/);
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'headerless.xlsx');
  const t = back.tableByName('T').table;
  expect(t).toMatchObject({ headerRow: false, range: { r1: 2, r2: 4 } });
  expect(back.tableColumns(back.activeSheetId, t)).toEqual(['Name', 'Qty']);
  expect(back.getValue(back.activeSheetId, 0, 5)).toBe(6);
  // And the sidecar alone (JSON) keeps it too.
  expect(new Workbook(wb.toJSON()).tableById(id, tableId)).toMatchObject({ headerRow: false, columnNames: ['Name', 'Qty'] });
});

it('turns the filter buttons off and on, keeping the criteria', async () => {
  const { wb, id, tableId, table } = make();
  wb.setFilterCriteria(id, 1, { values: ['a', 'b'] }, wb.filtersForSheet(id)[0]);
  expect(tableFilterButtonOn(wb, id, table())).toBe(true);
  expect(setTableFilterButton(wb, id, tableId, false)).toBeNull();
  expect(tableFilterButtonOn(wb, id, table())).toBe(false);
  expect(wb.filtersForSheet(id)[0].criteria[1].values).toEqual(['a', 'b']);
  expect(wb.sheet(id).filterHidden.has(4)).toBe(true);
  const xml = part(await zipOf(wb), '/xl/tables/table1.xml');
  expect(xml).toContain('<filterColumn colId="1" hiddenButton="1"/>');
  setTableFilterButton(wb, id, tableId, true);
  expect(tableFilterButtonOn(wb, id, table())).toBe(true);
  // With the header row hidden there are no buttons to show.
  setTableFilterButton(wb, id, tableId, false);
  setTableHeaderRow(wb, id, tableId, false);
  expect(setTableFilterButton(wb, id, tableId, true)).toMatch(/Header Row/);
  setTableHeaderRow(wb, id, tableId, true);
  expect(tableFilterButtonOn(wb, id, table())).toBe(false);
});
