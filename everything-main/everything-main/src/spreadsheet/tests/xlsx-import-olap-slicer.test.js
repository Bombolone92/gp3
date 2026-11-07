import { expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ value: null }));
vi.mock('../src/core/xlsx-slicers.js', () => ({ readXlsxSlicers: () => native.value }));
const { importXlsxSlicers } = await import('../src/core/xlsx-import-slicers.js');

// A dashboard's "Representative" slicer filtered PivotTables over the Data Model: the workbook did not open.
it('opens a workbook with a Data Model slicer, leaving the slicer out', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  native.value = { caches: [{ name: 'Slicer_Representative1', kind: 'pivot', pivot: null }], views: [{ name: 'Representative', cache: 'Slicer_Representative1', owner: 'Report', drawing: null }], styles: [], defaultStyle: 'SlicerStyleLight1' };
  const book = { files: { 'xl/workbook.xml': { content: new TextEncoder().encode('<workbook><extLst><slicerCaches/></extLst></workbook>') } } };
  const sheets = [{ name: 'Report', charts: [] }];
  expect(importXlsxSlicers(book, sheets)).toBe(native.value);
  expect(sheets[0].charts).toEqual([]);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('Data Model'));
  warn.mockRestore();
});
