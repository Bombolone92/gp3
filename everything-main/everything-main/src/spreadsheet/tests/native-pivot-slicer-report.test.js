import { expect, it } from 'vitest';
import { planNativePivotSlicerSelection } from '../src/core/native-pivot-slicer-report.js';
import { writeNativePivotSlicerSelection, readNativePivotSlicerBinding } from '../src/core/native-pivot-slicer-state.js';
import { planNativePivotReport } from '../src/core/native-pivot-report.js';
import { parseModelXml } from '../src/core/data-model-metadata.js';
const M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const X = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
function fixture() {
  const cache = { key: 'cache', xml: `<pivotCacheDefinition xmlns="${M}" recordCount="2"><cacheSource type="worksheet"><worksheetSource sheet="Data" ref="A1:B3"/></cacheSource><cacheFields count="2"><cacheField name="Region"><sharedItems count="3"><s v="East"/><s v="West"/><s v="Unused"/></sharedItems></cacheField><cacheField name="Amount"/></cacheFields><extLst><ext uri="test"><x:pivotCacheDefinition xmlns:x="${X}" pivotCacheId="27"/></ext></extLst></pivotCacheDefinition>`, records: `<pivotCacheRecords xmlns="${M}" count="2"><r><x v="0"/><n v="4"/></r><r><x v="1"/><n v="9"/></r></pivotCacheRecords>` };
  const report = (name, owner) => ({ name, owner, cache: 'cache', ref: 'B3:C6', xml: `<pivotTableDefinition xmlns="${M}" name="${name}" dataCaption="Values"><location ref="B3:C6" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/><pivotFields count="2"><pivotField axis="axisRow" showAll="0"><items count="3"><item x="1"/><item x="0"/><item x="2"/></items></pivotField><pivotField dataField="1"/></pivotFields><rowFields count="1"><field x="0"/></rowFields><dataFields count="1"><dataField fld="1"/></dataFields></pivotTableDefinition>` });
  const slicer = { kind: 'pivot', xml: `<x:slicerCacheDefinition xmlns:x="${X}" name="Regions" sourceName="Region"><x:pivotTables><x:pivotTable tabId="13" name="First"/><x:pivotTable tabId="8" name="Second"/></x:pivotTables><x:data><x:tabular pivotCacheId="27"><x:items count="3"><x:i x="1" s="1"/><x:i x="2" s="1" nd="1"/><x:i x="0" s="1"/></x:items></x:tabular></x:data><x:extLst><x:ext uri="unknown"><extra xmlns="urn:extra"/></x:ext></x:extLst></x:slicerCacheDefinition>` };
  return { slicer, pivots: { caches: [cache], tables: [report('First', 'first'), report('Unconnected', 'other'), report('Second', 'second')] }, sheets: [{ id: 'second', name: 'Two', tabId: 8 }, { id: 'other', name: 'Other', tabId: 90 }, { id: 'first', name: 'One', tabId: 13 }] };
}
const totals = result => result.reports.map(r => r.plan.cells.filter(c => c.role === 'value').map(c => c.value));
const plan = (f, selection, options) => planNativePivotSlicerSelection(f.slicer, f.pivots, f.sheets, selection, options);
it('prepares all declared connections and shared flags without changing unconnected reports or input state', () => {
  const f = fixture(), before = structuredClone(f), result = plan(f, [0]);
  expect(totals(result)).toEqual([[4, 4], [4, 4]]);
  expect(result.reports.map(r => r.pivot.name)).toEqual(['First', 'Second']);
  expect(result.slicer.items.map(i => [i.index, i.selected, i.noData])).toEqual([[1, false, false], [2, false, true], [0, true, false]]);
  expect(result.slicer.xml).toContain('urn:extra'); expect(f).toEqual(before);
  expect(result.reports[0].pivot).toBe(f.pivots.tables[0]);
});
it('replaces the previous report selection so newly selected members can reappear and clear restores all', () => {
  const f = fixture(), first = plan(f, [0]);
  f.slicer = first.slicer;
  f.pivots.tables = f.pivots.tables.map(p => first.reports.find(r => r.pivot === p)?.plan.pivot || p);
  const second = plan(f, [1, 1]); expect(totals(second)).toEqual([[9, 9], [9, 9]]);
  for (const r of second.reports) expect(planNativePivotReport(r.plan.pivot, r.cache).cells).toEqual(r.plan.cells);
  f.slicer = second.slicer; f.pivots.tables = f.pivots.tables.map(p => second.reports.find(r => r.pivot === p)?.plan.pivot || p);
  expect(totals(plan(f, null))).toEqual([[9, 4, 13], [9, 4, 13]]);
});
it('round-trips selected flags through native XML and preserves item order, no-data flags and extensions', () => {
  const f = fixture(), selected = writeNativePivotSlicerSelection(f.slicer, [1]);
  const binding = readNativePivotSlicerBinding(parseModelXml(selected.xml));
  expect(binding.items).toEqual(selected.items);
  expect(writeNativePivotSlicerSelection({ kind: 'pivot', xml: selected.xml }, null).items.every(i => i.selected)).toBe(true);
});
it('retains an independent page-field restriction when replacing the slicer field selection', () => {
  const f = fixture(), cache = f.pivots.caches[0];
  cache.xml = cache.xml.replace('cacheFields count="2"', 'cacheFields count="3"').replace('</cacheFields>', '<cacheField name="Channel"><sharedItems count="2"><s v="A"/><s v="B"/></sharedItems></cacheField></cacheFields>');
  cache.records = cache.records.replace('<n v="4"/></r>', '<n v="4"/><x v="0"/></r>').replace('<n v="9"/></r>', '<n v="9"/><x v="1"/></r>');
  for (const pivot of f.pivots.tables) pivot.xml = pivot.xml.replace('pivotFields count="2"', 'pivotFields count="3"').replace('</pivotFields>', '<pivotField axis="axisPage"><items count="2"><item x="0"/><item x="1" h="1"/></items></pivotField></pivotFields>').replace('<dataFields', '<pageFields count="1"><pageField fld="2" item="0"/></pageFields><dataFields');
  expect(totals(plan(f, [0, 1]))).toEqual([[4, 4], [4, 4]]);
  for (const report of plan(f, [0]).reports) expect(report.plan.pivot.xml).toContain('<pageField fld="2" item="0"/>');
});
it.each([[], [-1], [3], ['0'], false, undefined])('rejects invalid or empty slicer selections without mutating state: %j', choice => {
  const f = fixture(), before = structuredClone(f); expect(() => plan(f, choice)).toThrow(/selection/); expect(f).toEqual(before);
});
it('rejects a failed connected report without returning a partial plan', () => {
  const f = fixture(); f.pivots.tables[2].xml = f.pivots.tables[2].xml.replace('name="Second"', 'name="Second" subtotalHiddenItems="1"');
  const before = structuredClone(f); expect(() => plan(f, [0])).toThrow(/hidden-item/); expect(f).toEqual(before);
});
it('bounds the total materialized rectangles across all connected reports', () => {
  const f = fixture(); expect(() => plan(f, [0], { maxCells: 11 })).toThrow(/limit/);
  expect(plan(f, [0], { maxCells: 12 }).reports).toHaveLength(2);
});
it('uses the native XML identities even if decoded metadata is stale', () => {
  const f = fixture(); f.slicer.pivotCacheId = 99; f.slicer.sourceName = 'Amount'; f.slicer.items = [];
  expect(totals(plan(f, [0]))).toEqual([[4, 4], [4, 4]]);
});
it('preserves selection state for an unconnected slicer without inventing a report', () => {
  const f = fixture(); f.slicer.xml = f.slicer.xml.replace(/<x:pivotTables>.*?<\/x:pivotTables>/, '');
  expect(plan(f, [0]).reports).toEqual([]);
});
it('refuses unavailable member lists, foreign roots and OLAP source data', () => {
  const f = fixture();
  for (const xml of [f.slicer.xml.replace(/<x:items.*?<\/x:items>/, ''), f.slicer.xml.replaceAll(X, 'urn:foreign'), f.slicer.xml.replace(/<x:tabular.*?<\/x:tabular>/, '<x:olap/>')]) {
    expect(() => writeNativePivotSlicerSelection({ kind: 'pivot', xml }, [0])).toThrow(/native slicer/);
  }
});
