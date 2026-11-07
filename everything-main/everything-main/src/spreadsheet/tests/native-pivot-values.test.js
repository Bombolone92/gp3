import { expect, it } from 'vitest';
import { calculateNativePivotValues } from '../src/core/native-pivot-values.js';
import { NativePivotQuery } from '../src/core/native-pivot-query.js';
import { rebuildNativePivotAxis } from '../src/core/native-pivot-axis.js';
function fixture() {
  const str = value => ({ type: 'string', value }), num = value => ({ type: 'number', value });
  const cache = { fields: [{ items: ['East', 'West'].map(str) }, { items: ['A', 'B'].map(str) }, { items: [] }, { items: [] }], recordFields: [0, 1, 2, 3],
    records: [[str('East'), str('A'), num(2), num(10)], [str('East'), str('B'), num(4), num(20)],
      [str('West'), str('A'), num(6), num(30)], [str('West'), str('B'), { type: 'blank', value: null }, num(40)]] };
  const field = order => ({ showAll: false, items: order.map(index => ({ type: 'data', index, hidden: false, details: true })) });
  const layout = { fields: [field([1, 0]), field([1, 0]), field([]), field([])], pageFields: [],
    measures: [{ field: 2, subtotal: 'sum', showDataAs: 'normal' }, { field: 3, subtotal: 'average', showDataAs: 'normal' }],
    range: { r1: 2, c1: 1, r2: 5, c2: 3 }, firstDataRow: 1, firstDataCol: 1,
    rows: { fields: [0], items: [{ type: 'data', measure: 0, members: [{ field: 0, index: 0, item: 1, ...str('East') }] },
      { type: 'data', measure: 0, members: [{ field: 0, index: 1, item: 0, ...str('West') }] }, { type: 'grand', measure: 0, members: [] }] },
    columns: { fields: [-2], items: [0, 1].map(measure => ({ type: 'data', measure, members: [] })) } };
  return { cache, layout, query: new NativePivotQuery(cache) };
}
const values = f => calculateNativePivotValues(f.layout, f.query).map(cell => cell.value);
it('computes row, column and grand-total intersections without averaging displayed summaries', () => {
  const f = fixture(), before = structuredClone({ cache: f.cache, layout: f.layout });
  expect(values(f)).toEqual([6, 15, 6, 35, 12, 25]);
  expect(calculateNativePivotValues(f.layout, f.query).map(c => [c.r, c.c, c.measure])).toEqual([[3, 2, 0], [3, 3, 1], [4, 2, 0], [4, 3, 1], [5, 2, 0], [5, 3, 1]]);
  expect({ cache: f.cache, layout: f.layout }).toEqual(before);
});
it('resolves page selections through field items and combines them with slicer selections', () => {
  const f = fixture(); f.layout.pageFields = [{ field: 1, item: 0 }]; // B, not cache item A.
  expect(values(f)).toEqual([4, 20, null, 40, 4, 30]);
  expect(calculateNativePivotValues(f.layout, f.query, { filters: [{ field: 0, items: [0] }] }).map(c => c.value)).toEqual([4, 20, null, null, 4, 20]);
  const axis = rebuildNativePivotAxis(f.layout, f.query, 'rows', { filters: [{ field: 0, items: [0] }] });
  expect(axis.items.map(i => i.members.map(m => m.value))).toEqual([['East'], []]);
});
it('uses the same hidden-member restrictions for axes and grand totals', () => {
  const f = fixture(); f.layout.fields[0].items[0].hidden = true;
  expect(values(f)).toEqual([6, 15, null, null, 6, 15]);
  expect(rebuildNativePivotAxis(f.layout, f.query, 'rows').items.map(i => i.members.map(m => m.value))).toEqual([['East'], []]);
});
it('distinguishes blank sources from numeric zero and empty strings', () => {
  const f = fixture(); f.layout.pageFields = [{ field: 1, item: 0 }];
  expect(values(f)[2]).toBeNull();
  f.cache.records[3][2] = { type: 'number', value: 0 }; expect(values(f)[2]).toBe(0);
  f.cache.records[3][2] = { type: 'string', value: '' }; expect(values(f)[2]).toBe(0);
});
it('applies missing and error captions without changing underlying totals or blank headers', () => {
  const f = fixture(); f.layout.pageFields = [{ field: 1, item: 0 }];
  f.layout.missingCaption = 'Empty'; expect(values(f)[2]).toBe('Empty');
  f.layout.showMissing = false; expect(values(f)[2]).toBe(0);
  f.cache.records[1][2] = { type: 'error', value: '#N/A' };
  expect(values(f)[0]).toEqual({ error: '#N/A' }); expect(values(f)[4]).toEqual({ error: '#N/A' });
  f.layout.showError = true; f.layout.errorCaption = 'Error';
  expect(values(f)[0]).toBe('Error'); expect(values(f)[4]).toBe('Error');
  f.layout.rows.items[0].header = true; f.layout.rows.items[0].aggregate = false;
  expect(values(f).slice(0, 2)).toEqual([null, null]);
});
it('uses custom subtotal functions and refuses conflicting intersections', () => {
  const f = fixture(); f.layout.rows.items[0].type = 'avg';
  expect(values(f).slice(0, 2)).toEqual([3, 15]);
  f.layout.columns.items[0].type = 'countA';
  expect(() => values(f)).toThrow(/Conflicting/);
});
it('rejects invalid page selections and unsupported advanced filters or show-values-as', () => {
  const f = fixture(); f.layout.pageFields = [{ field: 1, item: 99 }]; expect(() => values(f)).toThrow(/page selection/);
  f.layout.pageFields[0].item = 0; f.layout.fields[1].multipleItemSelectionAllowed = true; expect(() => values(f)).toThrow(/page selection/);
  f.layout.pageFields[0].item = null; expect(values(f)).toEqual([6, 15, 6, 35, 12, 25]);
  f.layout.hasAdvancedFilters = true; expect(() => values(f)).toThrow(/Advanced/);
  expect(() => rebuildNativePivotAxis(f.layout, f.query, 'rows')).toThrow(/Advanced/);
  f.layout.hasAdvancedFilters = false; f.layout.measures[0].showDataAs = 'percentOfRow'; expect(() => values(f)).toThrow(/show-values-as/);
});
it('bounds a complete value plan before returning results', () => {
  const f = fixture(); expect(() => calculateNativePivotValues(f.layout, f.query, { maxCells: 5 })).toThrow(/limit/);
});
