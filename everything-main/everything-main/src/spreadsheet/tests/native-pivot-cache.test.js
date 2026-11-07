import { expect, it } from 'vitest';
import { readNativePivotCache } from '../src/core/native-pivot-cache.js';
const M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const X = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
function fixture() {
  return { xml: `<pivotCacheDefinition xmlns="${M}" recordCount="2"><cacheFields count="3">
    <cacheField name="Region_x000A_name"><sharedItems count="3"><s v="East"/><s v="West"/><s v="Old" u="1"/></sharedItems></cacheField>
    <cacheField name="Calculated" databaseField="0"/>
    <cacheField name="Amount"><sharedItems count="1"><n v="12.5"/></sharedItems></cacheField>
    </cacheFields><extLst><ext><x:pivotCacheDefinition xmlns:x="${X}" pivotCacheId="17"/></ext></extLst></pivotCacheDefinition>`,
    records: `<pivotCacheRecords xmlns="${M}" count="2"><r><x v="1"/><n v="2.5"/></r><r><s v="North"/><x v="0"/></r></pivotCacheRecords>` };
}
it('maps record columns through database fields and resolves indexes against each field', () => {
  const cache = fixture(), before = structuredClone(cache), decoded = readNativePivotCache(cache);
  expect(decoded.recordFields).toEqual([0, 2]);
  expect(decoded.slicerCacheId).toBe(17);
  expect(decoded.fields[0]).toMatchObject({ name: 'Region\nname', unused: [false, false, true] });
  expect(decoded.records).toEqual([
    [{ type: 'string', value: 'West', index: 1 }, { type: 'number', value: 2.5 }],
    [{ type: 'string', value: 'North' }, { type: 'number', value: 12.5, index: 0 }],
  ]);
  expect(cache).toEqual(before);
});
it.each([
  ['<m/>', 'blank', null], ['<s v=""/>', 'string', ''],
  ['<s v="_x005F_x000A_ &amp; _x0009_"/>', 'string', '_x000A_ & \t'],
  ['<n v=" -1.25e+2 "/>', 'number', -125], ['<b v=" true "/>', 'boolean', true],
  ['<b v="0"/>', 'boolean', false], ['<e v="#DIV/0!"/>', 'error', '#DIV/0!'],
  ['<d v="1900-02-28T12:30:00"/>', 'date', '1900-02-28T12:30:00'],
])('preserves typed inline and shared values: %s', (xml, type, value) => {
  const cache = fixture();
  cache.xml = cache.xml.replace('<s v="West"/>', xml);
  cache.records = cache.records.replace('<n v="2.5"/>', xml);
  const decoded = readNativePivotCache(cache);
  expect(decoded.records[0]).toEqual([{ type, value, index: 1 }, { type, value }]);
});
it('distinguishes unsaved data from an empty saved cache', () => {
  const cache = fixture(); delete cache.records;
  expect(readNativePivotCache(cache).records).toBeNull();
  cache.xml = cache.xml.replace('recordCount="2"', 'recordCount="0"');
  cache.records = `<pivotCacheRecords xmlns="${M}" count="0"/>`;
  expect(readNativePivotCache(cache).records).toEqual([]);
});
it('uses only the declared extension identity and accepts absent optional counts', () => {
  const cache = fixture();
  cache.xml = cache.xml.replace('recordCount="2"', '').replaceAll(/count="\d+"/g, '').replace(`xmlns:x="${X}"`, 'xmlns:x="urn:unrelated"');
  cache.records = cache.records.replace('count="2"', '');
  expect(readNativePivotCache(cache)).toMatchObject({ slicerCacheId: null, records: [expect.any(Array), expect.any(Array)] });
});
it.each([
  ['xml', 'count="3"', 'count="4"'],
  ['xml', 'recordCount="2"', 'recordCount="3"'],
  ['xml', 'databaseField="0"', 'databaseField="invalid"'],
  ['xml', 'u="1"', 'u="bad"'],
  ['xml', 'pivotCacheId="17"', 'pivotCacheId="-1"'],
  ['xml', '<n v="12.5"/>', '<n v="0x10"/>'],
  ['xml', '<n v="12.5"/>', '<n v="Infinity"/>'],
  ['xml', '<n v="12.5"/>', '<n v=""/>'],
  ['xml', '<n v="12.5"/>', '<n/>'],
  ['xml', '<s v="West"/>', '<b v="yes"/>'],
  ['records', 'count="2"', 'count="3"'],
  ['records', '<x v="1"/>', '<x v="3"/>'],
  ['records', '<x v="1"/>', '<x v="-1"/>'],
  ['records', '<x v="1"/>', '<x/>'],
  ['records', '<n v="2.5"/>', ''],
  ['records', '<n v="2.5"/>', '<n v="2.5"/><m/>'],
  ['records', '<n v="2.5"/>', '<n xmlns="urn:other" v="2.5"/>'],
  ['records', '<n v="2.5"/>', '<unknown v="2.5"/>'],
])('rejects inconsistent %s metadata (%s)', (part, before, after) => {
  const cache = fixture(); cache[part] = cache[part].replace(before, after);
  expect(() => readNativePivotCache(cache)).toThrow(/Invalid pivot cache/);
});
it('bounds both shared values and record expansion before allocating decoded records', () => {
  const cache = fixture();
  expect(() => readNativePivotCache(cache, { maxCells: 10 })).toThrow(/limit/);
  expect(readNativePivotCache(cache, { maxCells: 11 }).records).toHaveLength(2);
  for (const maxCells of [-1, NaN, Infinity, 1.5]) expect(() => readNativePivotCache(cache, { maxCells })).toThrow(/limit/);
});
