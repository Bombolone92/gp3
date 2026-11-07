import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { META_SHEET, workbookFromFile, workbookToXlsx } from '../src/core/io.js';

async function openWithFilter(filter) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Label'], ['Keep'], ['Hide']]), 'Data');
  const json = JSON.stringify({ v: 1, sheets: { Data: { filter } } });
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[json]]), META_SHEET);
  return workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'filter.xlsx');
}

const range = { r1: 0, c1: 0, r2: 2, c2: 0 };

it.each([null, 42, [], { values: 42 }, { values: {} }, { formula: 42 }].map((v) => [v]))('ignores malformed filter criteria %j while opening the cell data', async (criterion) => {
  const wb = await openWithFilter({ range, criteria: { 0: criterion } });
  expect(wb.getValue(wb.activeSheetId, 1, 0)).toBe('Keep');
  expect(wb.activeSheet.filter.criteria).toEqual({});
  expect([...wb.activeSheet.filterHidden]).toEqual([]);
});

it.each([
  { ...range, r1: 1e100, r2: 1e100 },
  { ...range, r1: -1e100 },
  { ...range, r2: 1048576 },
  { ...range, c2: 16384 },
  { ...range, r2: 1.5 },
  { ...range, c1: '0' },
  {},
])('ignores invalid filter bounds %j', async (invalid) => {
  const wb = await openWithFilter({ range: invalid, criteria: { 0: { values: ['Keep'] } } });
  expect(wb.activeSheet.filter).toBeNull();
  expect(wb.getValue(wb.activeSheetId, 2, 0)).toBe('Hide');
});

it('ignores criteria outside the filter and noncanonical column keys', async () => {
  const wb = await openWithFilter({ range, criteria: { '00': { values: [] }, '-1': null, '1': null, bad: null } });
  expect(wb.activeSheet.filter.criteria).toEqual({});
  expect([...wb.activeSheet.filterHidden]).toEqual([]);
});

it('preserves valid filters when saved and reopened', async () => {
  const filter = { range, criteria: { 0: { values: ['Keep'] } } };
  const wb = await openWithFilter(filter);
  expect(wb.activeSheet.filter).toEqual(filter);
  expect([...wb.activeSheet.filterHidden]).toEqual([2]);
  const back = await workbookFromFile(await (await workbookToXlsx(wb)).arrayBuffer(), 'saved.xlsx');
  expect(back.activeSheet.filter).toEqual(filter);
  expect([...back.activeSheet.filterHidden]).toEqual([2]);
});
