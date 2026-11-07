import { expect, it } from 'vitest';
import { NativePivotQuery } from '../src/core/native-pivot-query.js';
import { readNativePivotCache } from '../src/core/native-pivot-cache.js';
const M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function fixture() {
  return readNativePivotCache({ xml: `<pivotCacheDefinition xmlns="${M}"><cacheFields count="4">
    <cacheField name="Region"><sharedItems count="3"><s v="East"/><s v="West"/><s v="Absent" u="1"/></sharedItems></cacheField>
    <cacheField name="Computed" databaseField="0"/>
    <cacheField name="Kind"><sharedItems count="2"><s v="A"/><s v="B"/></sharedItems></cacheField>
    <cacheField name="Amount"/></cacheFields></pivotCacheDefinition>`,
    records: `<pivotCacheRecords xmlns="${M}" count="5">
    <r><x v="0"/><x v="0"/><n v="2"/></r><r><x v="1"/><x v="0"/><n v="4"/></r>
    <r><s v="EAST"/><x v="1"/><n v="6"/></r><r><x v="1"/><x v="1"/><n v="8"/></r>
    <r><x v="0"/><x v="1"/><n v="10"/></r></pivotCacheRecords>` });
}
it('intersects field selections, matches inline members, and preserves cache record order', () => {
  const cache = fixture(), before = structuredClone(cache), query = new NativePivotQuery(cache);
  expect(query.rows([{ field: 0, items: [1, 0, 1] }])).toEqual([0, 1, 2, 3, 4]);
  expect(query.rows([{ field: 0, items: [0] }, { field: 2, items: [1] }])).toEqual([2, 4]);
  expect(query.aggregate(3, 'sum', [{ field: 0, items: [0] }])).toEqual({ value: 18, records: 3 });
  expect(query.aggregate(3, 'sum', [{ field: 0, items: [0] }, { field: 2, items: [1] }])).toEqual({ value: 16, records: 2 });
  expect(query.rows([{ field: 0, items: null }])).toEqual(query.rows());
  expect(query.rows([{ field: 0, items: [] }])).toEqual([]);
  expect(query.rows([{ field: 0, items: [2] }])).toEqual([]);
  expect(query.rows([{ field: 0, items: [0] }, { field: 0, items: [1] }])).toEqual([]);
  expect(cache).toEqual(before);
});
it.each([
  ['sum', 30], ['count', 5], ['countNums', 5], ['average', 6], ['min', 2], ['max', 10],
  ['product', 3840], ['var', 10], ['varp', 8], ['stdDev', Math.sqrt(10)], ['stdDevp', Math.sqrt(8)],
])('calculates native %s summaries over cached values', (summary, value) => {
  expect(new NativePivotQuery(fixture()).aggregate(3, summary)).toEqual({ value, records: 5 });
});
it('keeps typed members distinct and does not coerce inline numeric strings', () => {
  const cache = { fields: [{ items: [{ type: 'number', value: 1 }, { type: 'string', value: '1' }, { type: 'boolean', value: true }, { type: 'blank', value: null }] }],
    recordFields: [0], records: [[{ type: 'number', value: 1 }], [{ type: 'string', value: '1' }], [{ type: 'boolean', value: true }], [{ type: 'blank', value: null }]] };
  const query = new NativePivotQuery(cache);
  for (let i = 0; i < 4; i++) expect(query.rows([{ field: 0, items: [i] }])).toEqual([i]);
});
it('distinguishes Count from Count Nums and propagates included errors in numeric summaries', () => {
  const cache = fixture();
  cache.records[0][2] = { type: 'blank', value: null };
  cache.records[1][2] = { type: 'string', value: '' };
  cache.records[2][2] = { type: 'boolean', value: true };
  cache.records[3][2] = { type: 'error', value: '#DIV/0!' };
  const query = new NativePivotQuery(cache);
  expect(query.aggregate(3, 'count')).toEqual({ value: 4, records: 5 });
  expect(query.aggregate(3, 'countNums')).toEqual({ value: 1, records: 5 });
  expect(query.aggregate(3, 'sum').value).toEqual({ error: '#DIV/0!' });
  expect(query.aggregate(3, 'sum', [{ field: 0, items: [0] }]).value).toBe(10);
});
it('keeps empty intersections distinct from zero-valued records and handles insufficient samples', () => {
  const query = new NativePivotQuery(fixture()), none = [{ field: 0, items: [] }];
  expect(query.aggregate(3, 'sum', none)).toEqual({ value: 0, records: 0 });
  expect(query.aggregate(3, 'average', none).value).toEqual({ error: '#DIV/0!' });
  expect(query.aggregate(3, 'stdDev', [{ field: 0, items: [0] }, { field: 2, items: [0] }]).value).toEqual({ error: '#DIV/0!' });
});
it('rejects unavailable records, calculated fields, stale member identities and unknown summaries', () => {
  expect(() => new NativePivotQuery({ ...fixture(), records: null })).toThrow(/unavailable/);
  const query = new NativePivotQuery(fixture());
  for (const field of [-1, 1, 9, 1.5]) expect(() => query.aggregate(field)).toThrow(/field/);
  for (const items of [[3], [-1], [0.5], ['0'], undefined]) expect(() => query.rows([{ field: 0, items }])).toThrow(/member/);
  for (const summary of ['median', 'toString', '__proto__']) expect(() => query.aggregate(3, summary)).toThrow(/summary/);
});
it('reuses member indexes rather than rescanning every record for each summary', () => {
  const cache = fixture();
  cache.records = Array.from({ length: 1000 }, (_, i) => [{ type: 'string', value: i % 2 ? 'West' : 'East', index: i % 2 }, { type: 'string', value: 'A', index: 0 }, { type: 'number', value: i }]);
  const query = new NativePivotQuery(cache);
  query.rows([{ field: 0, items: [0] }]);
  let reads = 0;
  cache.records = new Proxy(cache.records, { get(target, key) { if (/^\d+$/.test(String(key))) reads++; return Reflect.get(target, key); } });
  for (let i = 0; i < 20; i++) query.rows([{ field: 0, items: [i % 2] }]);
  expect(reads).toBe(0);
  query.aggregate(3, 'sum', [{ field: 0, items: [0] }]);
  expect(reads).toBe(500);
});

it('computes cross-filter availability in one selected-record pass and retains zero-data members', () => {
  const query = new NativePivotQuery(fixture());
  expect(query.memberCounts(0)).toEqual([3, 2, 0]);
  expect(query.memberCounts(0, [{ field: 2, items: [1] }])).toEqual([2, 1, 0]);
  expect(query.memberCounts(2, [{ field: 0, items: [1] }])).toEqual([1, 1]);
  expect(query.memberCounts(0, [{ field: 2, items: [] }])).toEqual([0, 0, 0]);
});
it('reports aggregate overflow as a spreadsheet error', () => {
  const cache = fixture(); cache.records[0][2].value = 1e308; cache.records[1][2].value = 1e308;
  expect(new NativePivotQuery(cache).aggregate(3).value).toEqual({ error: '#NUM!' });
});

it('partitions records by explicit shared identity and resolves inline members without scalar coercion', () => {
  const query = new NativePivotQuery(fixture());
  expect([...query.partition(0, [0, 2, 3, 4])]).toEqual([[0, [0, 2, 4]], [1, [3]]]);
  expect(() => query.partition(0, [-1])).toThrow(/record index/);
  expect(() => query.partition(0, [99])).toThrow(/record index/);
});
it('keeps duplicate-valued shared identities distinct but rejects ambiguous inline membership', () => {
  const cache = fixture(); cache.fields[0].items.push({ type: 'string', value: 'EAST' });
  const query = new NativePivotQuery(cache);
  expect([...query.partition(0, [0])]).toEqual([[0, [0]]]);
  expect(() => query.partition(0, [2])).toThrow(/ambiguous shared member/);
});
