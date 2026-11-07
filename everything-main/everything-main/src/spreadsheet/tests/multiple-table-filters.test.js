import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

function setup(secondRow = 7, secondCol = 0) {
  const wb = new Workbook(), id = wb.activeSheetId;
  const add = (r, c, name, criterion) => {
    wb.setCells(id, [['Item', 'Amount'], ['A', 5], ['B', 15], ['C', 25]].flatMap((row, i) => row.map((v, j) => ({ r: r + i, c: c + j, cell: { v } }))));
    const tid = wb.addTable(id, { r1: r, c1: c, r2: r + 3, c2: c + 1 }, { name });
    wb.setFilterCriteria(id, c + 1, criterion);
    return tid;
  };
  const first = add(0, 0, 'First', { op: 'gt', value: 10 });
  const second = add(secondRow, secondCol, 'Second', { op: 'lt', value: 20 });
  wb.clearHistory();
  return { wb, id, first, second, hidden: () => [...wb.sheet(id).filterHidden].sort((a, b) => a - b) };
}
const byRow = (wb, id, r) => wb.filtersForSheet(id).find(f => f.range.r1 === r);

it('retains independent criteria and visibility when changing context, clearing, undoing and redoing', () => {
  const { wb, id, hidden } = setup();
  expect(hidden()).toEqual([1, 10]);
  wb.activateFilter(id, byRow(wb, id, 0));
  expect(wb.canUndo()).toBe(false);
  expect(wb.filterValues(id, 1).map(v => v.value)).toEqual(['5', '15', '25']);
  wb.clearFilter(id);
  expect(hidden()).toEqual([10]);
  expect(wb.filtersForSheet(id)).toHaveLength(1);
  wb.undo();
  expect(hidden()).toEqual([1, 10]);
  expect(wb.filtersForSheet(id)).toHaveLength(2);
  wb.redo();
  expect(hidden()).toEqual([10]);
});

it('updates shared physical rows while retaining both tables’ predicates', () => {
  const { wb, id, hidden } = setup(0, 4);
  // Applying the right-hand table governs shared row visibility. Clearing it
  // shows those rows; the left table keeps its predicate for a later reapply.
  expect(hidden()).toEqual([3]);
  wb.clearFilter(id);
  expect(hidden()).toEqual([]);
  expect(wb.sheet(id).filter.criteria[1]).toEqual({ op: 'gt', value: 10 });
  wb.undo();
  expect(hidden()).toEqual([3]);
});

it('keeps an independent worksheet filter alongside tables, and replaces only that worksheet filter', () => {
  const { wb, id, hidden } = setup();
  wb.setCells(id, ['Group', 'keep', 'drop'].map((v, i) => ({ r: i + 16, c: 4, cell: { v } })));
  wb.setFilterRange(id, parseRange('E17:E19'));
  wb.setFilterCriteria(id, 4, { values: ['keep'] });
  expect(hidden()).toEqual([1, 10, 18]);
  wb.setFilterRange(id, parseRange('G20:H23'));
  expect(wb.filtersForSheet(id)).toHaveLength(3);
  expect(hidden()).toEqual([1, 10]);
});

it('retains all contexts in drafts, duplicate sheets and copies into another workbook', () => {
  const { wb, id, hidden } = setup();
  byRow(wb, id, 0).hiddenButtons = [0];
  const draft = new Workbook(wb.toJSON());
  expect(draft.filtersForSheet(id)).toEqual(wb.filtersForSheet(id));
  expect([...draft.sheet(id).filterHidden].sort((a, b) => a - b)).toEqual(hidden());
  const copy = wb.duplicateSheet(id);
  expect(wb.filtersForSheet(copy.id)).toHaveLength(2);
  expect([...copy.filterHidden].sort((a, b) => a - b)).toEqual(hidden());
  byRow(wb, copy.id, 0).hiddenButtons.push(1);
  expect(byRow(wb, id, 0).hiddenButtons).toEqual([0]);
  const other = new Workbook();
  other.importSheets(new Workbook(wb.toJSON()));
  const imported = other.sheets[1];
  expect(other.filtersForSheet(imported.id)).toHaveLength(2);
});

it('adjusts every table filter and hidden button through inserted/deleted rows and columns', () => {
  const { wb, id, hidden } = setup();
  byRow(wb, id, 0).hiddenButtons = [0];
  wb.insertRows(id, 0, 2);
  wb.insertCols(id, 0, 3);
  expect(wb.filterAt(id, 2, 3)).toMatchObject({ range: parseRange('D3:E6'), criteria: { 4: { op: 'gt', value: 10 } }, hiddenButtons: [3] });
  expect(wb.filterAt(id, 9, 3)).toMatchObject({ range: parseRange('D10:E13'), criteria: { 4: { op: 'lt', value: 20 } } });
  expect(hidden()).toEqual([3, 12]);
  wb.deleteRows(id, 0, 2); wb.deleteCols(id, 0, 3);
  expect(hidden()).toEqual([1, 10]);
  expect(wb.filtersForSheet(id)).toHaveLength(2);
});

it('resizes and converts an inactive table without altering the selected table filter', () => {
  const { wb, id, first, hidden } = setup();
  expect(wb.resizeTable(id, first, parseRange('A1:C5'))).toBe(true);
  expect(wb.sheet(id).filter.range).toEqual(parseRange('A8:B11'));
  expect(byRow(wb, id, 0).range).toEqual(parseRange('A1:C5'));
  wb.reapplyFilter(id);
  expect(hidden()).toEqual([1, 4, 10]);
  wb.deleteTable(id, first);
  expect(wb.filtersForSheet(id)).toHaveLength(1);
  expect(hidden()).toEqual([10]);
  wb.undo();
  expect(wb.filtersForSheet(id)).toHaveLength(2);
  expect(hidden()).toEqual([1, 4, 10]);
});

it.each(['drag', 'cut'])('moves multiple filters with their tables (%s)', method => {
  const { wb, id, hidden } = setup();
  byRow(wb, id, 0).hiddenButtons = [0];
  const range = parseRange('A1:B11');
  if (method === 'drag') wb.moveRange(id, range, 2, 4);
  else wb.placeMoved(id, 2, 4, wb.copyRange(id, range), { sheetId: id, range });
  expect(wb.filtersForSheet(id).map(f => f.range).sort((a, b) => a.r1 - b.r1)).toEqual([parseRange('E3:F6'), parseRange('E10:F13')]);
  expect(wb.filterAt(id, 2, 4).hiddenButtons).toEqual([4]);
  expect(hidden()).toEqual([3, 12]);
  wb.undo();
  expect(hidden()).toEqual([1, 10]);
});

it('cuts an inactive filtered table onto a sheet with another filter', () => {
  const { wb, id } = setup();
  const dest = wb.addSheet('Destination').id;
  wb.setInput(dest, 0, 0, 'Heading'); wb.setInput(dest, 1, 0, 'keep'); wb.setInput(dest, 2, 0, 'drop');
  wb.setFilterRange(dest, parseRange('A1:A3')); wb.setFilterCriteria(dest, 0, { values: ['keep'] });
  const range = parseRange('A1:B4');
  wb.placeMoved(dest, 5, 3, wb.copyRange(id, range), { sheetId: id, range });
  expect(wb.filtersForSheet(id)).toHaveLength(1);
  expect(wb.filtersForSheet(dest)).toHaveLength(2);
  expect([...wb.sheet(dest).filterHidden].sort((a, b) => a - b)).toEqual([2, 6]);
  wb.undo();
  expect(wb.filtersForSheet(id)).toHaveLength(2);
  expect(wb.filtersForSheet(dest)).toHaveLength(1);
});

it('rewrites formulas in inactive contexts when their sheet and table references change', () => {
  const { wb, id, first } = setup();
  wb.activateFilter(id, byRow(wb, id, 0));
  wb.setFilterCriteria(id, 1, { formula: `${wb.sheet(id).name}!B2>10` });
  wb.activateFilter(id, byRow(wb, id, 7));
  wb.renameSheet(id, 'Renamed');
  expect(byRow(wb, id, 0).criteria[1].formula).toContain('Renamed');
  wb.activateFilter(id, byRow(wb, id, 0)); wb.setFilterCriteria(id, 1, { formula: 'SUM(First[Amount])>10' });
  wb.activateFilter(id, byRow(wb, id, 7)); wb.updateTable(id, first, { name: 'Changed' });
  expect(byRow(wb, id, 0).criteria[1].formula).toBe('SUM(Changed[Amount])>10');
});

const decode = part => new TextDecoder().decode(part.content);
async function zipFor(wb) { return X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' }); }
function change(zip, path, rewrite) {
  const part = X.CFB.find(zip, path); part.content = new TextEncoder().encode(rewrite(decode(part))); part.size = part.content.length;
}
async function read(zip, native = false) {
  if (native) change(zip, '/xl/workbook.xml', xml => xml.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'filters.xlsx');
}

it.each([false, true])('round-trips every table predicate and button setting through native XLSX (no metadata: %s)', async native => {
  const { wb, id } = setup();
  byRow(wb, id, 0).showButtons = false;
  byRow(wb, id, 7).hiddenButtons = [1];
  const zip = await zipFor(wb);
  expect(decode(X.CFB.find(zip, '/xl/worksheets/sheet1.xml'))).not.toContain('<autoFilter');
  expect(decode(X.CFB.find(zip, '/xl/tables/table1.xml'))).toContain('hiddenButton="1"');
  expect(decode(X.CFB.find(zip, '/xl/tables/table2.xml'))).toContain('hiddenButton="1"');
  const back = await read(zip, native), sid = back.activeSheetId;
  expect(back.filtersForSheet(sid)).toHaveLength(2);
  expect(byRow(back, sid, 0)).toMatchObject({ showButtons: false, criteria: { 1: { op: 'gt', value: 10 } } });
  expect(byRow(back, sid, 7).hiddenButtons).toEqual([1]);
  expect([...back.activeSheet.filterHidden].sort((a, b) => a - b)).toEqual([1, 10]);
  if (!native) expect(back.activeSheet.filter.range.r1).toBe(7);
});

it('honors external edits and removals independently instead of reviving stale private filter records', async () => {
  const { wb, id } = setup();
  wb.activateFilter(id, byRow(wb, id, 0)); wb.setFilterCriteria(id, 1, { formula: 'B2>10' });
  wb.activateFilter(id, byRow(wb, id, 7));
  const zip = await zipFor(wb);
  change(zip, '/xl/tables/table2.xml', xml => xml.replace('val="20"', 'val="9"'));
  let back = await read(zip), sid = back.activeSheetId;
  expect(byRow(back, sid, 0).criteria[1]).toEqual({ formula: 'B2>10' });
  expect(byRow(back, sid, 7).criteria[1]).toEqual({ op: 'lt', value: 9 });
  // Changing only predicate XML does not apply it to the file's saved rows.
  expect([...back.activeSheet.filterHidden].sort((a, b) => a - b)).toEqual([1, 10]);
  back.reapplyFilter(sid);
  expect([...back.activeSheet.filterHidden].sort((a, b) => a - b)).toEqual([1, 9, 10]);
  change(zip, '/xl/tables/table1.xml', xml => xml.replace(/<autoFilter\b[^>]*\/>|<autoFilter\b[^>]*>[\s\S]*?<\/autoFilter>/g, ''));
  back = await read(zip);
  expect(back.filtersForSheet(back.activeSheetId)).toHaveLength(1);
});

it('translates numeric list criteria separately for each formatted table', async () => {
  const { wb, id } = setup();
  for (const r of [0, 7]) {
    wb.activateFilter(id, byRow(wb, id, r));
    wb.applyStyle(id, { r1: r + 1, c1: 1, r2: r + 3, c2: 1 }, { fmt: 'currency', dec: 2 });
    wb.setFilterCriteria(id, 1, { values: [wb.getDisplay(id, r + 2, 1)] });
  }
  const back = await read(await zipFor(wb), true);
  expect([...back.activeSheet.filterHidden].sort((a, b) => a - b)).toEqual([1, 3, 8, 10]);
  for (const f of back.filtersForSheet(back.activeSheetId)) expect(f.criteria[1].values).toEqual([back.getDisplay(back.activeSheetId, f.range.r1 + 2, 1)]);
});

it('exports each filter as its own ODF database range', async () => {
  const { wb } = setup();
  const bytes = new Uint8Array(await (await workbookToOds(wb)).arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' });
  expect(decode(X.CFB.find(zip, '/content.xml')).match(/<table:database-range\b/g)).toHaveLength(2);
  const back = await workbookFromFile(bytes, 'filters.ods');
  expect(back.filtersForSheet(back.activeSheetId)).toHaveLength(2);
  expect([...back.activeSheet.filterHidden].sort((a, b) => a - b)).toEqual([1, 10]);
});

it('does not recreate a removed table filter when saving and reopening', async () => {
  const { wb, id } = setup();
  wb.clearFilter(id);
  const zip = await zipFor(wb);
  expect(decode(X.CFB.find(zip, '/xl/tables/table1.xml'))).toContain('<autoFilter');
  expect(decode(X.CFB.find(zip, '/xl/tables/table2.xml'))).not.toContain('<autoFilter');
  const back = await read(zip, true);
  expect(back.filtersForSheet(back.activeSheetId)).toHaveLength(1);
  expect([...back.activeSheet.filterHidden]).toEqual([1]);
});

it('keeps inactive filters when tables shrink to headers and regrow', () => {
  const { wb, id, first } = setup();
  wb.deleteRows(id, 1, 3);
  expect(byRow(wb, id, 0)).toEqual({ range: parseRange('A1:B1'), criteria: {} });
  expect(wb.filtersForSheet(id)).toHaveLength(2);
  wb.addTableRow(id, first);
  expect(byRow(wb, id, 0).range).toEqual(parseRange('A1:B2'));
});

it('grows inactive filters when inserting above their totals row, keeping new rows visible', () => {
  const { wb, id, first } = setup();
  wb.setTableTotals(id, first, true);
  wb.insertRows(id, 4, 2);
  expect(byRow(wb, id, 0).range).toEqual(parseRange('A1:B6'));
  expect(wb.isRowHidden(id, 4)).toBe(false);
  expect(wb.isRowHidden(id, 5)).toBe(false);
  wb.reapplyFilter(id);
  expect(wb.isRowHidden(id, 4)).toBe(true);
  expect(wb.isRowHidden(id, 5)).toBe(true);
});

it.each([false, true])('preserves the saved view after editing data, including a metadata-free XLSX (%s)', async native => {
  const { wb, id } = setup();
  wb.setInput(id, 2, 1, '0'); // Still visible until the upper filter is reapplied.
  const back = await read(await zipFor(wb), native);
  expect([...back.activeSheet.filterHidden].sort((a, b) => a - b)).toEqual([1, 10]);
  back.reapplyFilter(back.activeSheetId);
  expect([...back.activeSheet.filterHidden].sort((a, b) => a - b)).toEqual([1, 2, 10]);
});

it('keeps the shared-row view through selection changes, copies, drafts and native reopening', async () => {
  const { wb, id } = setup(0, 4);
  wb.setFilterCriteria(id, 5, null);
  expect(wb.filtersForSheet(id)).toHaveLength(2);
  expect([...wb.activeSheet.filterHidden]).toEqual([]);
  wb.activateFilter(id, wb.filterAt(id, 0, 0));
  expect([...new Workbook(wb.toJSON()).activeSheet.filterHidden]).toEqual([]);
  const copy = wb.duplicateSheet(id);
  expect([...copy.filterHidden]).toEqual([]);
  const back = await read(await zipFor(wb), true);
  expect(back.sheets.every(s => s.filterHidden.size === 0)).toBe(true);
  wb.reapplyFilter(id);
  expect([...wb.sheet(id).filterHidden]).toEqual([1]);
});

it('keeps manual hides distinct from filter hides while the native saved view is unchanged', async () => {
  const { wb, id } = setup();
  wb.setHidden(id, 'row', [2], true); // Matches the upper filter; only hidden manually.
  const back = await read(await zipFor(wb));
  expect([...back.activeSheet.filterHidden].sort((a, b) => a - b)).toEqual([1, 10]);
  expect([...back.activeSheet.hiddenRows]).toEqual([2]);
});

it('normalizes malformed and duplicate extra contexts without losing valid sheet data', () => {
  const { wb, id } = setup(), json = wb.toJSON();
  const first = byRow(wb, id, 0);
  json.sheets[0].otherFilters = [null, 5, { range: { r1: 0, c1: 0, r2: 1e100, c2: 1 } }, first, first, json.sheets[0].filter];
  const back = new Workbook(json);
  expect(back.filtersForSheet(id)).toHaveLength(2);
  expect(back.getValue(id, 1, 0)).toBe('A');
  json.sheets[0].otherFilters = {};
  expect(new Workbook(json).filtersForSheet(id)).toHaveLength(1);
});

it('does not silently discard additional ordinary filters when the target format cannot express them', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', filter: { range: parseRange('A1:A4'), criteria: {} },
    otherFilters: [{ range: parseRange('D6:E9'), criteria: {} }] }] });
  await expect(workbookToXlsx(wb)).rejects.toThrow('one worksheet filter');
  await expect(workbookToOds(wb)).resolves.toBeInstanceOf(Blob);
});
