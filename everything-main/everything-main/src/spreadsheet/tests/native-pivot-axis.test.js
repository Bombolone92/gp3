import { expect, it } from 'vitest';
import { NativePivotQuery } from '../src/core/native-pivot-query.js';
import { rebuildNativePivotAxis } from '../src/core/native-pivot-axis.js';
function fixture() {
  const item = value => ({ type: 'string', value });
  const cache = { fields: [{ items: ['North', 'South', 'Unused'].map(item) }, { items: ['A', 'B', 'C'].map(item) }, { items: [] }], recordFields: [0, 1, 2],
    records: [[item('North'), item('B'), { type: 'number', value: 3 }], [item('North'), item('A'), { type: 'number', value: 5 }], [item('South'), item('C'), { type: 'number', value: 7 }]] };
  const field = order => ({ showAll: false, outline: true, defaultSubtotal: true, subtotalTop: true, insertBlankRow: false,
    items: order.map(index => ({ type: 'data', index, details: true, hidden: false })) });
  const layout = { fields: [field([1, 0, 2]), field([0, 1, 2]), field([])], measures: [{ field: 2 }, { field: 2 }],
    rows: { fields: [0, 1], items: [] }, columns: { fields: [-2], items: [] } };
  return { cache, layout, query: new NativePivotQuery(cache) };
}
const labels = result => result.items.map(row => [row.type, ...row.members.map(member => member.value)]);
it('regenerates nested members in field-item order without cached axis entries', () => {
  const { layout, query } = fixture();
  expect(labels(rebuildNativePivotAxis(layout, query, 'rows'))).toEqual([
    ['data', 'South'], ['data', 'South', 'C'], ['data', 'North'], ['data', 'North', 'A'], ['data', 'North', 'B'], ['grand'],
  ]);
});
it('filters, preserves collapsed groups and blank separators, then restores removed groups on clear', () => {
  const { layout, query } = fixture();
  layout.fields[0].insertBlankRow = true; layout.fields[0].items[0].details = false;
  const full = rebuildNativePivotAxis(layout, query, 'rows');
  expect(labels(full)).toEqual([['data', 'South'], ['blank'], ['data', 'North'], ['data', 'North', 'A'], ['data', 'North', 'B'], ['blank'], ['grand']]);
  const filtered = rebuildNativePivotAxis(layout, query, 'rows', { filters: [{ field: 0, items: [1] }] });
  expect(labels(filtered)).toEqual([['data', 'South'], ['blank'], ['grand']]);
  expect(rebuildNativePivotAxis({ ...layout, rows: filtered }, query, 'rows')).toEqual(full);
});
it('retains no-data members when requested while explicit filters still exclude them', () => {
  const { layout, query } = fixture(); layout.rows.fields = [0]; layout.fields[0].showAll = true;
  expect(labels(rebuildNativePivotAxis(layout, query, 'rows'))).toEqual([['data', 'South'], ['data', 'North'], ['data', 'Unused'], ['grand']]);
  expect(labels(rebuildNativePivotAxis(layout, query, 'rows', { filters: [{ field: 0, items: [0] }] }))).toEqual([['data', 'North'], ['grand']]);
});
it('applies hidden member filters before grouping so empty parents disappear', () => {
  const { layout, query } = fixture(); layout.fields[1].items[2].hidden = true;
  expect(labels(rebuildNativePivotAxis(layout, query, 'rows'))).toEqual([['data', 'North'], ['data', 'North', 'A'], ['data', 'North', 'B'], ['grand']]);
});
it('places bottom subtotals after children and emits custom subtotal kinds', () => {
  const { layout, query } = fixture(); layout.fields[0].subtotalTop = false;
  expect(labels(rebuildNativePivotAxis(layout, query, 'rows')).slice(0, 3)).toEqual([['data', 'South'], ['data', 'South', 'C'], ['default', 'South']]);
  layout.fields[0].defaultSubtotal = false; layout.fields[0].subtotals = ['sum', 'avg'];
  const rows = rebuildNativePivotAxis(layout, query, 'rows');
  expect(labels(rows).slice(0, 4)).toEqual([['data', 'South'], ['data', 'South', 'C'], ['sum', 'South'], ['avg', 'South']]);
  expect(rows.items[0].aggregate).toBe(false); expect(rows.items[2].subtotalField).toBe(0);
});
it('uses tabular rows without standalone group headers and can omit grand totals', () => {
  const { layout, query } = fixture(); layout.fields[0].outline = false; layout.fields[0].defaultSubtotal = false;
  expect(labels(rebuildNativePivotAxis(layout, query, 'rows', { grandTotal: false }))).toEqual([['data', 'South', 'C'], ['data', 'North', 'A'], ['data', 'North', 'B']]);
});
it('expands innermost measure axes and leaves fieldless axes as a single data position', () => {
  const { layout, query } = fixture();
  expect(rebuildNativePivotAxis(layout, query, 'columns').items.map(i => i.measure)).toEqual([0, 1]);
  layout.rows.fields = [0, -2];
  expect(rebuildNativePivotAxis(layout, query, 'rows').items.map(i => [i.type, i.measure])).toEqual([
    ['data', 0], ['data', 1], ['data', 0], ['data', 1], ['grand', 0], ['grand', 1],
  ]);
  layout.rows.fields = [];
  expect(rebuildNativePivotAxis(layout, query, 'rows').items).toEqual([{ type: 'data', measure: 0, members: [] }]);
});
it('generates column group subtotals without row-only headers or blank separators', () => {
  const { layout, query } = fixture(); layout.columns.fields = [0, 1]; layout.fields[0].insertBlankRow = true;
  expect(labels(rebuildNativePivotAxis(layout, query, 'columns'))).toEqual([
    ['data', 'South', 'C'], ['default', 'South'], ['data', 'North', 'A'], ['data', 'North', 'B'], ['default', 'North'], ['grand'],
  ]);
});
it('rejects unsupported sorting/layouts and bounds no-data expansion before output grows', () => {
  const { layout, query } = fixture();
  expect(() => rebuildNativePivotAxis(layout, query, 'rows', { maxItems: 2 })).toThrow(/limit/);
  layout.fields[0].sortType = 'descending';
  expect(() => rebuildNativePivotAxis(layout, query, 'rows')).toThrow(/sorting/);
  layout.fields[0].sortType = 'manual'; layout.rows.fields = [-2, 0];
  expect(() => rebuildNativePivotAxis(layout, query, 'rows')).toThrow(/outer measure/);
});
it('rejects absent field-member identities instead of dropping their records', () => {
  const { layout, query } = fixture(); layout.fields[0].items = layout.fields[0].items.filter(i => i.index !== 1);
  expect(() => rebuildNativePivotAxis(layout, query, 'rows')).toThrow(/missing from field items/);
});
it('partitions sparse hierarchies in proportion to actual records rather than member cross products', () => {
  const count = 1000, items = Array.from({ length: count }, (_, i) => ({ type: 'string', value: `Member ${i}` }));
  let reads = 0;
  const records = new Proxy(items.map((item, index) => [{ ...item, index }, { ...item, index }]), {
    get(target, key) { if (/^\d+$/.test(String(key))) reads++; return Reflect.get(target, key); },
  });
  const query = new NativePivotQuery({ fields: [{ items }, { items }], recordFields: [0, 1], records });
  const fields = [0, 1].map(() => ({ showAll: false, items: items.map((_, index) => ({ type: 'data', index })) }));
  const result = rebuildNativePivotAxis({ fields, measures: [{}], rows: { fields: [0, 1] } }, query, 'rows');
  expect(result.items).toHaveLength(2 * count + 1);
  expect(reads).toBe(2 * count);
});

it('maps report grand-total flags to their opposite display axis, retaining explicit overrides', () => {
  const { layout, query } = fixture(); layout.rows.fields = [0]; layout.columns.fields = [1];
  layout.colGrandTotals = false; layout.rowGrandTotals = true;
  expect(rebuildNativePivotAxis(layout, query, 'rows').items.some(i => i.type === 'grand')).toBe(false);
  expect(rebuildNativePivotAxis(layout, query, 'columns').items.at(-1).type).toBe('grand');
  layout.rowGrandTotals = false;
  expect(rebuildNativePivotAxis(layout, query, 'columns').items.some(i => i.type === 'grand')).toBe(false);
  expect(rebuildNativePivotAxis(layout, query, 'rows', { grandTotal: true }).items.at(-1).type).toBe('grand');
});

const valueScope = (measure = 0, extra = '') => `<autoSortScope xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><pivotArea dataOnly="0" outline="0" fieldPosition="0"><references><reference field="4294967294" count="1" selected="0"><x v="${measure}"/></reference>${extra}</references></pivotArea></autoSortScope>`;
const sortedField = (layout, field, direction = 'ascending', extra = '') => Object.assign(layout.fields[field], { sortType: direction, autoSort: true, sortScope: valueScope(0, extra) });
it.each(['ascending', 'descending'])('sorts groups by their aggregate values in %s order', direction => {
  const { layout, query } = fixture(); layout.rows.fields = [0]; sortedField(layout, 0, direction);
  expect(labels(rebuildNativePivotAxis(layout, query, 'rows'))).toEqual(direction === 'ascending'
    ? [['data', 'South'], ['data', 'North'], ['grand']] : [['data', 'North'], ['data', 'South'], ['grand']]);
});
it('sorts inner groups separately within each parent and keeps total placement', () => {
  const { layout, query } = fixture(); sortedField(layout, 1);
  expect(labels(rebuildNativePivotAxis(layout, query, 'rows'))).toEqual([
    ['data', 'South'], ['data', 'South', 'C'], ['data', 'North'], ['data', 'North', 'B'], ['data', 'North', 'A'], ['grand'],
  ]);
});
it('sorts by the declared data-field aggregation and persisted measure index', () => {
  const { layout, query } = fixture(); layout.rows.fields = [0]; sortedField(layout, 0);
  layout.measures[1].subtotal = 'average'; layout.fields[0].sortScope = valueScope(1);
  expect(labels(rebuildNativePivotAxis(layout, query, 'rows'))[0]).toEqual(['data', 'North']);
});
it('resolves a scoped member through field-item indexes instead of cache offsets', () => {
  const { layout, query } = fixture(); layout.rows.fields = [0];
  layout.fields[1].items.reverse(); // Pivot item 0 is shared member C.
  sortedField(layout, 0, 'ascending', '<reference field="1" selected="0" count="1"><x v="0"/></reference>');
  expect(labels(rebuildNativePivotAxis(layout, query, 'rows'))[0]).toEqual(['data', 'South']);
  layout.fields[0].sortScope = layout.fields[0].sortScope.replace('<pivotArea ', '<pivotArea cacheIndex="1" ');
  expect(labels(rebuildNativePivotAxis(layout, query, 'rows'))[0]).toEqual(['data', 'North']);
});
it('sorts column groups and applies filters before computing the keys', () => {
  const { layout, query } = fixture(); layout.columns.fields = [0]; sortedField(layout, 0);
  const result = rebuildNativePivotAxis(layout, query, 'columns', { filters: [{ field: 1, items: [1, 2] }] });
  expect(labels(result)).toEqual([['data', 'North'], ['data', 'South'], ['grand']]);
});
it('retains persisted tie order, keeps missing-data members last and respects manual mode', () => {
  const { layout, query, cache } = fixture(); layout.rows.fields = [0]; layout.fields[0].showAll = true;
  cache.records[2][2].value = 8; sortedField(layout, 0, 'descending');
  expect(labels(rebuildNativePivotAxis(layout, query, 'rows'))).toEqual([['data', 'South'], ['data', 'North'], ['data', 'Unused'], ['grand']]);
  layout.fields[0].sortType = 'manual';
  expect(labels(rebuildNativePivotAxis(layout, query, 'rows'))).toEqual([['data', 'South'], ['data', 'North'], ['data', 'Unused'], ['grand']]);
});
it.each([
  xml => xml.replace('v="0"', 'v="99"'),
  xml => xml.replace('count="1"', 'count="2"'),
  xml => xml.replace('selected="0"', 'selected="wrong"'),
  xml => xml.replace('selected="0"', 'relative="1"'),
  xml => xml.replace('selected="0"', 'sumSubtotal="1"'),
  xml => xml.replace('field="4294967294"', 'field="0"'),
])('rejects malformed or unsupported automatic sort scopes', update => {
  const { layout, query } = fixture(); sortedField(layout, 0); layout.fields[0].sortScope = update(layout.fields[0].sortScope);
  expect(() => rebuildNativePivotAxis(layout, query, 'rows')).toThrow(/sorting/);
});
it('aggregates each group once instead of rescanning every record for each sort comparison', () => {
  const count = 1000, items = Array.from({ length: count }, (_, i) => ({ type: 'string', value: `Group ${i}` })); let reads = 0;
  const records = new Proxy(items.map((item, index) => [{ ...item, index }, { type: 'number', value: count - index }]), {
    get(target, key) { if (/^\d+$/.test(String(key))) reads++; return Reflect.get(target, key); },
  });
  const query = new NativePivotQuery({ fields: [{ items }, { items: [] }], recordFields: [0, 1], records });
  const layout = { fields: [{ showAll: false, items: items.map((_, index) => ({ type: 'data', index })) }, { items: [] }], measures: [{ field: 1, subtotal: 'sum' }], rows: { fields: [0], items: [] }, columns: { fields: [], items: [] } };
  sortedField(layout, 0);
  const result = rebuildNativePivotAxis(layout, query, 'rows');
  expect(result.items[0].members[0].index).toBe(count - 1); expect(reads).toBeLessThan(count * 4);
});

it('keeps displayed tie order without using the cached axis to suppress restored members', () => {
  const { layout, query, cache } = fixture(); layout.rows.fields = [0]; cache.records[2][2].value = 8; sortedField(layout, 0);
  layout.rows.items = [{ type: 'data', members: [{ field: 0, index: 0 }] }];
  expect(labels(rebuildNativePivotAxis(layout, query, 'rows'))).toEqual([['data', 'North'], ['data', 'South'], ['grand']]);
});
it('compares exact model integer keys without converting them to doubles', () => {
  const { layout, query } = fixture(); layout.rows.fields = [0]; sortedField(layout, 0);
  query.aggregateRows = (_f, _s, rows) => ({ value: rows.includes(0) ? 9007199254740993n : 9007199254740992, nonEmpty: 1 });
  expect(labels(rebuildNativePivotAxis(layout, query, 'rows'))[0]).toEqual(['data', 'South']);
});

it('checks leaf output limits before computing automatic sort keys', () => {
  const { layout, query } = fixture(); layout.rows.fields = [0]; sortedField(layout, 0);
  query.aggregateRows = () => { throw new Error('sort keys must not be read'); };
  expect(() => rebuildNativePivotAxis(layout, query, 'rows', { maxItems: 1 })).toThrow(/item limit/);
});

it('does not scan old displayed rows when rebuilding a manually ordered axis', () => {
  const { layout, query } = fixture();
  layout.rows.items = new Proxy([], { get(target, key) { if (key === Symbol.iterator) throw new Error('old rows must not be scanned'); return Reflect.get(target, key); } });
  expect(rebuildNativePivotAxis(layout, query, 'rows').items).toHaveLength(6);
});
