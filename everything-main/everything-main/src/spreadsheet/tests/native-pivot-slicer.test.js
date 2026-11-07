import { expect, it } from 'vitest';
import { resolveNativePivotSlicers } from '../src/core/native-pivot-slicer.js';
import { readNativePivotCache } from '../src/core/native-pivot-cache.js';
const M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const X = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
function fixture() {
  const cache = { key: 'cache-a', xml: `<pivotCacheDefinition xmlns="${M}"><cacheFields count="1"><cacheField name="Region"><sharedItems count="2"><s v="East"/><s v="West"/></sharedItems></cacheField></cacheFields><extLst><ext><x:pivotCacheDefinition xmlns:x="${X}" pivotCacheId="71"/></ext></extLst></pivotCacheDefinition>`, records: 'not read while resolving identities' };
  const slicer = { pivotCacheId: 71, sourceName: 'region', items: [{ index: 1, selected: true }], pivotTables: [{ tabId: 9, name: 'Report' }] };
  return { slicer, pivots: { caches: [cache], tables: [{ name: 'Report', cache: 'cache-a', owner: 'report-sheet' }, { name: 'Other', cache: 'cache-a', owner: 'other-sheet' }] },
    sheets: [{ tabId: 43, id: 'other-sheet', name: 'Other sheet' }, { tabId: 9, id: 'report-sheet', name: 'Dashboard' }] };
}
it('resolves only declared report connections without decoding records or mutating metadata', () => {
  const f = fixture(), before = structuredClone(f);
  const result = resolveNativePivotSlicers([f.slicer], f.pivots, f.sheets).get(f.slicer);
  expect(result).toMatchObject({ cacheKey: 'cache-a', field: { index: 0, name: 'Region' }, reports: [{ name: 'Report', sheet: 'Dashboard' }] });
  expect(f).toEqual(before);
  expect(readNativePivotCache(f.pivots.caches[0], { includeRecords: false }).records).toBeNull();
  expect(() => readNativePivotCache(f.pivots.caches[0])).toThrow();
});
it('rejects duplicate extended cache identities instead of using package order', () => {
  const f = fixture(); f.pivots.caches.push({ ...f.pivots.caches[0], key: 'cache-b' });
  expect(() => resolveNativePivotSlicers([f.slicer], f.pivots, f.sheets)).toThrow(/duplicate pivot cache identity/);
});
it('rejects a report connected to a different cache even when its name and worksheet match', () => {
  const f = fixture(); f.pivots.tables[0].cache = 'other-cache';
  expect(() => resolveNativePivotSlicers([f.slicer], f.pivots, f.sheets)).toThrow(/different cache/);
});
it('allows an unconnected slicer cache without inventing connections to every report', () => {
  const f = fixture(); f.slicer.pivotTables = [];
  expect(resolveNativePivotSlicers([f.slicer], f.pivots, f.sheets).get(f.slicer).reports).toEqual([]);
});
it('resolves multiple slicers sharing one cache with one metadata decode', () => {
  const f = fixture(), original = f.pivots.caches[0].xml;
  let reads = 0;
  Object.defineProperty(f.pivots.caches[0], 'xml', { get() { reads++; return original; } });
  const slicers = Array.from({ length: 50 }, () => structuredClone(f.slicer));
  expect(resolveNativePivotSlicers(slicers, f.pivots, f.sheets).size).toBe(50);
  expect(reads).toBeLessThan(5);
});
