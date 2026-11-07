import { expect, it, vi } from 'vitest';
import { nativePivotSlicerAvailability } from '../src/core/native-pivot-slicer-availability.js';
import { planNativePivotSlicerSelection } from '../src/core/native-pivot-slicer-report.js';
import { NativePivotQuery } from '../src/core/native-pivot-query.js';
const M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', X = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
function fixture() {
  const cache = { key: 'cache', xml: `<pivotCacheDefinition xmlns="${M}" recordCount="4"><cacheSource type="worksheet"><worksheetSource sheet="Data" ref="A1:C5"/></cacheSource><cacheFields count="3"><cacheField name="Region"><sharedItems count="3"><s v="East"/><s v="West"/><s v="Unused"/></sharedItems></cacheField><cacheField name="Product"><sharedItems count="3"><s v="Tea"/><s v="Coffee"/><s v="Unused"/></sharedItems></cacheField><cacheField name="Amount"/></cacheFields><extLst><ext uri="test"><x:pivotCacheDefinition xmlns:x="${X}" pivotCacheId="5"/></ext></extLst></pivotCacheDefinition>`, records: `<pivotCacheRecords xmlns="${M}" count="4">${[[0,0,10],[0,0,5],[1,1,7],[1,0,9]].map(([r,p,v]) => `<r><x v="${r}"/><x v="${p}"/><n v="${v}"/></r>`).join('')}</pivotCacheRecords>` };
  const report = (name, product) => ({ name, owner: name, cache: 'cache', ref: 'B3:C5', xml: `<pivotTableDefinition xmlns="${M}" name="${name}" dataCaption="Values"><location ref="B3:C5" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/><pivotFields count="3"><pivotField axis="axisRow" showAll="0"><items count="3"><item x="0"/><item x="1" h="1"/><item x="2" h="1"/></items></pivotField><pivotField axis="axisPage"><items count="3"><item x="0"/><item x="1"/><item x="2"/></items></pivotField><pivotField dataField="1"/></pivotFields><rowFields count="1"><field x="0"/></rowFields><pageFields count="1"><pageField fld="1" item="${product}"/></pageFields><dataFields count="1"><dataField fld="2"/></dataFields></pivotTableDefinition>` });
  const slicer = (name, sourceName, refs) => ({ kind: 'pivot', xml: `<slicerCacheDefinition xmlns="${X}" name="${name}" sourceName="${sourceName}"><pivotTables>${refs.map(([tabId,name]) => `<pivotTable tabId="${tabId}" name="${name}"/>`).join('')}</pivotTables><data><tabular pivotCacheId="5"><items count="3"><i x="2" s="1" nd="1"/><i x="0" s="1"/><i x="1" s="1"/></items></tabular></data></slicerCacheDefinition>` });
  const regions = slicer('Regions', 'Region', [[11,'A'],[7,'B']]), products = slicer('Products', 'Product', [[11,'A']]);
  return { regions, products, slicers: [regions, products], pivots: { caches: [cache], tables: [report('A', 0),report('B', 1),report('Unconnected', 2)] }, sheets: [{id:'A',name:'A',tabId:11},{id:'B',name:'B',tabId:7},{id:'Unconnected',name:'Unconnected',tabId:90}] };
}
const read = (f, options) => nativePivotSlicerAvailability(f.slicers, f.pivots, f.sheets, options);
const counts = items => items.map(item => [item.index, item.records, item.available]);
it('excludes the slicer field itself while retaining each report’s independent page restriction', () => {
  const f = fixture(), before = structuredClone(f), result = read(f);
  expect(counts(result.get(f.regions).get(f.pivots.tables[0]))).toEqual([[2,0,false],[0,2,true],[1,1,true]]);
  expect(counts(result.get(f.regions).get(f.pivots.tables[1]))).toEqual([[2,0,false],[0,0,false],[1,1,true]]);
  expect(result.get(f.regions).size).toBe(2);
  expect(counts(result.get(f.products).get(f.pivots.tables[0]))).toEqual([[2,0,false],[0,2,true],[1,0,false]]);
  expect(f).toEqual(before);
});
it('refreshes another slicer’s availability from prepared report choices before committing', () => {
  const f = fixture();
  const result = planNativePivotSlicerSelection(f.regions, f.pivots, f.sheets, [1], { slicerCaches: f.slicers });
  const first = result.reports.find(r => r.pivot.name === 'A').plan.pivot;
  expect(counts(result.availability.get(f.products).get(first))).toEqual([[2,0,false],[0,1,true],[1,1,true]]);
  expect(result.availability.get(result.slicer).size).toBe(2);
  expect(result.slicer.items.filter(i => i.selected).map(i => i.index)).toEqual([1]);
});
it('none mode retains record counts but suppresses no-data availability and styling', () => {
  const f = fixture(); f.regions.xml = f.regions.xml.replace('pivotCacheId="5"', 'pivotCacheId="5" crossFilter="none"').replace(' nd="1"', '');
  const items = read(f).get(f.regions).get(f.pivots.tables[0]);
  expect(items.every(i => i.available && !i.noData)).toBe(true); expect(items[0].records).toBe(0);
});
it('shares record scans for equivalent field/filter contexts across reports and views', () => {
  const f = fixture(); f.pivots.tables[1].xml = f.pivots.tables[1].xml.replace('item="1"', 'item="0"');
  f.slicers = [f.regions, structuredClone(f.regions)];
  const spy = vi.spyOn(NativePivotQuery.prototype, 'memberCounts');
  try { read(f); expect(spy).toHaveBeenCalledTimes(1); } finally { spy.mockRestore(); }
});
it('does not invent an availability context for an unconnected slicer', () => {
  const f = fixture(); f.regions.xml = f.regions.xml.replace(/<pivotTables>.*?<\/pivotTables>/, '');
  expect(read(f).get(f.regions).size).toBe(0);
});
it('bounds both record scans and repeated result materialization without mutation', () => {
  const f = fixture(), before = structuredClone(f); expect(() => read(f,{maxWork:1})).toThrow(/work limit/); expect(f).toEqual(before);
  expect(() => read(f,{maxWork:-1})).toThrow(/options/);
  f.pivots.tables[1].xml = f.pivots.tables[1].xml.replace('item="1"', 'item="0"');
  f.slicers = Array.from({length:20},()=>structuredClone(f.regions));
  expect(() => read(f,{maxWork:30})).toThrow(/work limit/);
});
it('refuses advanced filter and unavailable saved-record semantics instead of reporting false availability', () => {
  const f = fixture(); f.pivots.tables[0].xml = f.pivots.tables[0].xml.replace('</pivotTableDefinition>', '<filters><filter/></filters></pivotTableDefinition>');
  expect(() => read(f)).toThrow(/Advanced/);
  const missing = fixture(); delete missing.pivots.caches[0].records; expect(() => read(missing)).toThrow(/unavailable/);
});
it('counts inline typed records consistently with shared cache-member identities', () => {
  const f = fixture(); f.pivots.caches[0].records = f.pivots.caches[0].records.replace('<x v="0"/>','<s v="east"/>');
  expect(counts(read(f).get(f.regions).get(f.pivots.tables[0]))).toEqual([[2,0,false],[0,2,true],[1,1,true]]);
});

it('hides explicitly unused members without hiding members excluded only by another field', () => {
  const f = fixture();
  f.regions.xml = f.regions.xml.replace('pivotCacheId="5"', 'pivotCacheId="5" showMissing="0"');
  f.pivots.caches[0].xml = f.pivots.caches[0].xml.replace('<s v="Unused"/>','<s v="Unused" u="1"/>');
  const result = read(f).get(f.regions).get(f.pivots.tables[1]);
  expect(result.map(i=>[i.index,i.hidden,i.noData])).toEqual([[2,true,true],[0,false,true],[1,false,false]]);
  expect(result.every(i=>i.selected)).toBe(true);
  f.regions.xml = f.regions.xml.replace('showMissing="0"', 'showMissing="1"');
  expect(read(f).get(f.regions).get(f.pivots.tables[1]).every(i=>!i.hidden)).toBe(true);
});
it('keeps unused-member hiding independent of none cross-filter mode and selection changes', () => {
  const f=fixture();
  f.regions.xml=f.regions.xml.replace('pivotCacheId="5"','pivotCacheId="5" showMissing="0" crossFilter="none"').replace(' nd="1"','');
  f.pivots.caches[0].xml=f.pivots.caches[0].xml.replace('<s v="Unused"/>','<s v="Unused" u="1"/>');
  const result=planNativePivotSlicerSelection(f.regions,f.pivots,f.sheets,[0],{slicerCaches:f.slicers});
  const states=result.availability.get(result.slicer).get(result.reports[0].plan.pivot);
  expect(states.map(i=>[i.index,i.hidden,i.available,i.noData])).toEqual([[2,true,true,false],[0,false,true,false],[1,false,true,false]]);
  expect(result.slicer.showMissing).toBe(false);expect(result.slicer.xml).toContain('showMissing="0"');
});
