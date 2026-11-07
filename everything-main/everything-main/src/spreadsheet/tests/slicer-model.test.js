import { expect, it } from 'vitest';
import { workbookToXlsx } from '../src/core/io.js';
import { Workbook } from '../src/core/workbook.js';
import { slicerTarget, slicerItems, setSlicerSelection, slicerTableReference } from '../src/core/slicer.js';

function make(header = 'Category') {
  const wb = new Workbook(), sheet = wb.activeSheet;
  [[header, 'Amount'], ['Alpha', 10], ['Beta', 20], ['Gamma', 30]].forEach((row, r) => row.forEach((v, c) => wb.setInput(sheet.id, r, c, String(v))));
  const tableId = wb.addTable(sheet.id, { r1: 0, c1: 0, r2: 3, c2: 1 }, { name: 'Orders' });
  const id = wb.addChart(sheet.id, { type: 'slicer', anchor: { r: 6, c: 4 }, tableRef: slicerTableReference('Orders', header), title: header });
  return { wb, sheet, tableId, id, control: () => wb.chartById(sheet.id, id) };
}
it.each(['Category', 'A [B]', '#tag', "O'Brien", '@row', 'two, parts'])('binds the exact escaped header %s', header => {
  const { wb, sheet, control } = make(header);
  expect(slicerTarget(wb, control())).toMatchObject({ sheetId: sheet.id, col: 0 });
  expect(slicerItems(wb, control())).toEqual(['Alpha', 'Beta', 'Gamma'].map(value => ({ value, count: 1, selected: true, available: true })));
});
it('shares selection across views, preserves availability, and undoes through the table filter', () => {
  const { wb, sheet, id, control } = make();
  const other = wb.duplicateChart(sheet.id, id);
  expect(setSlicerSelection(wb, sheet.id, id, ['Alpha', 'Gamma'])).toBe(true);
  expect(slicerItems(wb, wb.chartById(sheet.id, other)).map(i => i.selected)).toEqual([true, false, true]);
  wb.setFilterCriteria(sheet.id, 1, { op: 'gt', value: '15' });
  expect(slicerItems(wb, control()).map(i => [i.value, i.selected, i.available])).toEqual([['Beta', false, true], ['Gamma', true, true], ['Alpha', true, false]]);
  expect(setSlicerSelection(wb, sheet.id, id, null)).toBe(true);
  expect(slicerItems(wb, control()).every(i => i.selected)).toBe(true);
  wb.undo(); expect(slicerItems(wb, control()).filter(i => i.selected).map(i => i.value).sort()).toEqual(['Alpha', 'Gamma']);
  wb.redo(); expect(slicerItems(wb, control()).every(i => i.selected)).toBe(true);
});
it('follows header/table renames and inserted columns, including undo', () => {
  const { wb, sheet, tableId, control } = make();
  wb.setInput(sheet.id, 0, 0, 'New [header]');
  expect(slicerTarget(wb, control())?.col).toBe(0);
  expect(control().tableRef).toBe(slicerTableReference('Orders', 'New [header]'));
  wb.updateTable(sheet.id, tableId, { name: 'Renamed' });
  expect(control().tableRef).toBe(slicerTableReference('Renamed', 'New [header]'));
  wb.insertCols(sheet.id, 0);
  expect(slicerTarget(wb, control())?.col).toBe(1);
  wb.undo(); expect(slicerTarget(wb, control())?.col).toBe(0);
  wb.undo(); expect(control().tableRef).toBe(slicerTableReference('Orders', 'New [header]'));
});
it('rewrites a copied sheet to its copied table and keeps selections independent', () => {
  const { wb, sheet, id } = make();
  const copied = wb.duplicateSheet(sheet.id), copiedId = copied.id, ch = copied.charts[0];
  expect(slicerTarget(wb, ch)?.sheetId).toBe(copiedId);
  expect(setSlicerSelection(wb, copiedId, ch.id, ['Beta'])).toBe(true);
  expect(slicerItems(wb, wb.chartById(sheet.id, id)).every(i => i.selected)).toBe(true);
});
it('rejects stale choices, wrong references and protection without edits', () => {
  const { wb, sheet, id, control } = make();
  expect(setSlicerSelection(wb, sheet.id, id, ['Missing'])).toBe(false);
  for (const tableRef of ['A2:A4', 'Orders', 'Orders[#All]', 'Orders[@Category]', 'Orders[[Category]:[Amount]]', '#REF!']) {
    expect(slicerTarget(wb, { ...control(), tableRef })).toBeNull();
  }
  sheet.protected = true;
  expect(setSlicerSelection(wb, sheet.id, id, ['Beta'])).toBe(false);
  expect(sheet.filter.criteria).toEqual({});
});
it('fails closed when its column is deleted and restores binding on undo', () => {
  const { wb, sheet, id, control } = make();
  wb.deleteCols(sheet.id, 0);
  expect(slicerTarget(wb, control())).toBeNull();
  expect(setSlicerSelection(wb, sheet.id, id, ['Beta'])).toBe(false);
  wb.undo(); expect(slicerTarget(wb, control())?.col).toBe(0);
});

it('does not rebind a converted table to ordinary cells and restores through undo', () => {
  const { wb, sheet, tableId, control } = make();
  wb.deleteTable(sheet.id, tableId);
  expect(slicerTarget(wb, control())).toBeNull();
  wb.undo(); expect(slicerTarget(wb, control())?.col).toBe(0);
});
it('preserves bindings in JSON snapshots and cross-sheet controls', () => {
  const { wb, sheet, control } = make();
  const other = wb.addSheet('Controls');
  const id = wb.addChart(other.id, { ...control(), id: undefined });
  expect(setSlicerSelection(wb, other.id, id, ['Beta'])).toBe(true);
  const restored = new Workbook(wb.toJSON()), copy = restored.sheetByName('Controls').charts[0];
  expect(slicerTarget(restored, copy)?.sheetId).toBe(sheet.id);
  expect(slicerItems(restored, copy).map(i => i.selected)).toEqual([false, true, false]);
});

it('does not silently export an unimplemented slicer as a chart', async () => {
  const { wb } = make();
  await expect(workbookToXlsx(wb)).rejects.toThrow('Cannot export slicer without a supported style');
});
it('uses insensitive item identity for selection and availability across case variants', () => {
  const { wb, sheet, id, control } = make();
  wb.setInput(sheet.id, 1, 0, 'Alpha'); wb.setInput(sheet.id, 2, 0, 'ALPHA');
  wb.setFilterCriteria(sheet.id, 0, { values: ['alpha'], caseSensitive: false });
  wb.setFilterCriteria(sheet.id, 1, { values: ['20'] });
  expect(slicerItems(wb, control())).toEqual([
    { value: 'Alpha', count: 2, selected: true, available: true },
    { value: 'Gamma', count: 1, selected: false, available: false },
  ]);
  expect(setSlicerSelection(wb, sheet.id, id, ['Alpha'])).toBe(true);
  expect([...sheet.filterHidden]).toEqual([1, 3]);
});

it('keeps case-insensitive item identities after clearing the filter', () => {
  const { wb, sheet, id, control } = make();
  wb.setInput(sheet.id, 2, 0, 'ALPHA');
  expect(slicerItems(wb, control()).map(i => [i.value, i.count])).toEqual([['Alpha', 2], ['Gamma', 1]]);
  setSlicerSelection(wb, sheet.id, id, ['Alpha']);
  setSlicerSelection(wb, sheet.id, id, null);
  expect(slicerItems(wb, control()).map(i => [i.value, i.count, i.selected])).toEqual([['Alpha', 2, true], ['Gamma', 1, true]]);
});
it('applies descending and all three native cross-filter presentation modes', () => {
  const { wb, sheet, id, control } = make();
  wb.setFilterCriteria(sheet.id, 1, { values: ['10'] });
  wb.updateChart(sheet.id, id, { sortOrder: 'descending', crossFilter: 'showItemsWithNoData' });
  expect(slicerItems(wb, control()).map(i => [i.value, i.available])).toEqual([['Gamma', false], ['Beta', false], ['Alpha', true]]);
  wb.updateChart(sheet.id, id, { crossFilter: 'showItemsWithDataAtTop' });
  expect(slicerItems(wb, control()).map(i => i.value)).toEqual(['Alpha', 'Gamma', 'Beta']);
  wb.updateChart(sheet.id, id, { crossFilter: 'none' });
  expect(slicerItems(wb, control()).map(i => [i.value, i.available])).toEqual([['Gamma', true], ['Beta', true], ['Alpha', true]]);
});

it('reads an unfiltered large source column once per refresh without stale cached state', () => {
  const wb = new Workbook(), sheet = wb.activeSheet, count = 3000;
  wb.setCells(sheet.id, [{ r: 0, c: 0, cell: { v: 'Category' } },
    ...Array.from({ length: count }, (_, i) => ({ r: i + 1, c: 0, cell: { v: `Item ${i}` } }))]);
  wb.addTable(sheet.id, { r1: 0, c1: 0, r2: count, c2: 0 }, { name: 'Large' });
  const id = wb.addChart(sheet.id, { type: 'slicer', anchor: { r: 0, c: 2 }, tableRef: 'Large[Category]' });
  let reads = 0; const getDisplay = wb.getDisplay.bind(wb);
  wb.getDisplay = (...args) => { reads++; return getDisplay(...args); };
  const items = slicerItems(wb, wb.chartById(sheet.id, id));
  expect(items).toHaveLength(count); expect(reads).toBe(count);
  expect(items.every(i => i.count === 1 && i.selected && i.available)).toBe(true);
  wb.setInput(sheet.id, 1, 0, 'Renamed'); reads = 0;
  expect(slicerItems(wb, wb.chartById(sheet.id, id)).some(i => i.value === 'Renamed')).toBe(true);
  expect(reads).toBe(count);
});

it('preserves hiding separately from none-mode paint and through copies and snapshots', () => {
  const { wb, sheet, id, control } = make();
  wb.updateChart(sheet.id, id, { hideItemsWithNoData: true, crossFilter: 'none' });
  wb.setFilterCriteria(sheet.id, 1, { op: 'gt', value: '15' });
  expect(slicerItems(wb, control()).map(i => [i.value,i.hidden,i.available])).toEqual([['Alpha',true,true],['Beta',false,true],['Gamma',false,true]]);
  expect(wb.chartById(sheet.id, wb.duplicateChart(sheet.id,id)).hideItemsWithNoData).toBe(true);
  expect(wb.duplicateSheet(sheet.id).charts.every(c => c.hideItemsWithNoData)).toBe(true);
  expect(new Workbook(wb.toJSON()).sheet(sheet.id).charts.every(c => c.hideItemsWithNoData)).toBe(true);
});
