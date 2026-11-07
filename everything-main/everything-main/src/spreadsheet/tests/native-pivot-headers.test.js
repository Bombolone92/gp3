import { expect, it } from 'vitest';
import { nativePivotHeaders } from '../src/core/native-pivot-headers.js';
function fixture() {
  return { fields: [{ compact: true, outline: true }, { compact: true, outline: true }],
    cacheFields: [{ name: 'Region' }, { name: 'Product' }, { name: 'Revenue' }, { name: 'Units' }],
    rows: { fields: [0, 1] }, columns: { fields: [-2], items: [1, 0].map(measure => ({ type: 'data', measure, members: [] })) },
    measures: [{ field: 2, subtotal: 'sum', caption: 'Income' }, { field: 3, subtotal: 'average', caption: null }],
    range: { r1: 9, c1: 4, r2: 20, c2: 6 }, firstDataRow: 1, firstDataCol: 1 };
}
it('places compact and measure headers at a moved origin without assuming measure order', () => {
  const layout = fixture(), before = structuredClone(layout);
  expect(nativePivotHeaders(layout).map(c => [c.r, c.c, c.value, c.measure])).toEqual([[9, 4, 'Row Labels', undefined], [9, 5, 'Average of Units', 1], [9, 6, 'Income', 0]]);
  expect(layout).toEqual(before);
});
it('uses custom captions including deliberately empty text', () => {
  const layout = fixture(); layout.rowHeaderCaption = ''; layout.measures[1].caption = '';
  expect(nativePivotHeaders(layout).map(c => c.value)).toEqual(['', '', 'Income']);
});
it('hides field headers independently of measure captions', () => {
  const layout = fixture(); layout.showHeaders = false;
  expect(nativePivotHeaders(layout).map(c => c.value)).toEqual(['Average of Units', 'Income']);
});
it.each([true, false])('uses individual field names for noncompact outline=%s layouts', outline => {
  const layout = fixture(); layout.fields.forEach(f => { f.compact = false; f.outline = outline; });
  layout.fields[1].caption = 'Item'; layout.firstDataCol = 2; layout.range.c2++;
  expect(nativePivotHeaders(layout).map(c => [c.c, c.value])).toEqual([[4, 'Region'], [5, 'Item'], [6, 'Average of Units'], [7, 'Income']]);
});
it('supports a fieldless single measure and configurable fallback language', () => {
  const layout = fixture(); layout.rows.fields = []; layout.firstDataCol = 0;
  layout.measures = [layout.measures[1]]; layout.columns = { fields: [], items: [{ type: 'data', measure: 0, members: [] }] };
  expect(nativePivotHeaders(layout, { measureCaption: (_measure, name) => `Moyenne de ${name}` })).toEqual([{ r: 9, c: 4, value: 'Moyenne de Units', type: 'string', role: 'measureHeader', measure: 0 }]);
});
it('rejects overlapping, out-of-range and over-budget headers', () => {
  const layout = fixture(); expect(() => nativePivotHeaders(layout, { maxCells: 2 })).toThrow(/limit/);
  layout.firstDataRow = 0; expect(() => nativePivotHeaders(layout)).toThrow(/location/);
  layout.firstDataRow = 1; layout.firstDataCol = 0; expect(() => nativePivotHeaders(layout)).toThrow(/overlap/);
});
it('refuses unsupported header geometry and invalid measure identities', () => {
  const layout = fixture(); layout.columns.fields = [0]; expect(() => nativePivotHeaders(layout)).toThrow(/column-member/);
  layout.columns.fields = [-2]; layout.columns.items[0].measure = 99; expect(() => nativePivotHeaders(layout)).toThrow(/measure index/);
  layout.columns.items[0].measure = 1; layout.fields[1].compact = false; expect(() => nativePivotHeaders(layout)).toThrow(/mixed/);
  layout.rows.fields.push(-2); expect(() => nativePivotHeaders(layout)).toThrow(/measure-on-rows/);
});

it('uses cache field captions below report overrides without replacing identity names', () => {
  const layout = fixture(); layout.fields.forEach(f => { f.compact = false; }); layout.firstDataCol = 2; layout.range.c2++;
  layout.cacheFields[0].caption = 'Sales area'; layout.cacheFields[1].caption = '';
  layout.cacheFields[3].caption = 'Quantity';
  expect(nativePivotHeaders(layout).map(c => c.value)).toEqual(['Sales area', '', 'Average of Quantity', 'Income']);
  layout.fields[0].caption = ''; layout.fields[1].caption = 'Item';
  expect(nativePivotHeaders(layout).map(c => c.value)).toEqual(['', 'Item', 'Average of Quantity', 'Income']);
  expect(layout.cacheFields.map(f => f.name)).toEqual(['Region', 'Product', 'Revenue', 'Units']);
});
