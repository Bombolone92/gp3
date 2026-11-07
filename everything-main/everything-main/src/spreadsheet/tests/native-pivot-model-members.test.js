import { it, expect } from 'vitest';
import { dataModelBytes, encodeDataModelBytes } from '../src/core/data-model.js';
import { replaceDataModelArchiveFiles } from '../src/core/data-model-archive.js';
import { encodeModelStringDictionary } from '../src/core/data-model-dictionaries.js';
import { fixture as stored } from './helpers/stored-model-workbook.js';
import { nativeRoundTrip } from './helpers/linked-model-workbook.js';
import { prepareNativeModelPivotMembers } from '../src/core/native-pivot-model-members.js';
import { readNativePivotLayout } from '../src/core/native-pivot-layout.js';
import { readNativePivotCache } from '../src/core/native-pivot-cache.js';
import { planNativePivotReport } from '../src/core/native-pivot-report.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function fixture({ items = '<s v="Gone"/><s v="A " c="Retained caption"/>', ...options } = {}) {
  const wb = stored({ base: -3n, ...options });
  const connections = `<connections xmlns="${MAIN}" xmlns:x="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><connection id="7" name="Model" type="5"><extLst><ext><x:connection model="1"/></ext></extLst></connection></connections>`;
  wb.dataModel = { ...wb.dataModel, connectionsXml: connections };
  const cache = { key: 'model', xml: `<pivotCacheDefinition xmlns="${MAIN}" recordCount="0"><cacheSource type="external" connectionId="7"/><cacheFields count="2"><cacheField name="[Measures].[Total]" hierarchy="0" level="32767"/><cacheField name="[Orders].[Group].[Group]" hierarchy="1" level="1"><sharedItems count="2">${items}</sharedItems></cacheField></cacheFields><cacheHierarchies count="2"><cacheHierarchy uniqueName="[Measures].[Total]" measure="1" measureGroup="Orders"/><cacheHierarchy uniqueName="[Orders].[Group]" dimensionUniqueName="[Orders]" attribute="1"><fieldsUsage count="2"><fieldUsage x="-1"/><fieldUsage x="1"/></fieldsUsage></cacheHierarchy></cacheHierarchies></pivotCacheDefinition>`, records: '' };
  const pivot = { name: 'Report', owner: wb.sheets[0].id, cache: 'model', ref: 'D5:E8', xml: `<pivotTableDefinition xmlns="${MAIN}" name="Report" dataCaption="Values" showEmptyRow="1"><location ref="D5:E8" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/><pivotFields count="2"><pivotField dataField="1"/><pivotField axis="axisRow"><items count="3"><item x="0"/><item x="1" n="Custom" sd="0"/><item t="default"/></items></pivotField></pivotFields><rowFields count="1"><field x="1"/></rowFields><rowItems count="3"><i><x/></i><i><x v="1"/></i><i t="grand"><x/></i></rowItems><dataFields count="1"><dataField fld="0" baseField="1" baseItem="1"/></dataFields><pivotHierarchies count="2"><pivotHierarchy/><pivotHierarchy/></pivotHierarchies></pivotTableDefinition>` };
  wb.nativePivots = { version: 1, tables: [pivot], caches: [cache], connections };
  return { wb, cache, pivot };
}
const prepare = f => prepareNativeModelPivotMembers(f.wb.nativePivots, f.cache.key, f.wb.dataModel);
it('stages cache, report items and axes by canonical identity without mutating input', () => {
  const f = fixture(), before = f.wb.toJSON(), result = prepare(f), next = result.reports[0].next;
  const layout = readNativePivotLayout(next, result.cache);
  expect(layout.cacheFields[1].items).toEqual([{ type: 'string', value: 'A ', caption: 'Retained caption' }, { type: 'string', value: 'B' }]);
  expect(layout.fields[1].items).toMatchObject([{ index: 0, caption: 'Custom', details: false }, { index: 1 }, { type: 'default' }]);
  expect(layout.rows.items.map(i => i.members.map(m => m.index))).toEqual([[0], []]);
  expect(layout.measures[0].baseItem).toBe(0);
  const plan = planNativePivotReport(next, result.cache, { dataModel: f.wb.dataModel });
  expect(plan.cells.filter(c => c.role === 'value').map(c => c.value)).toEqual([1, null, 1]);
  expect(f.wb.toJSON()).toEqual(before);
});
it('keeps an unchanged domain byte-identical and retains object identity', () => {
  const f = fixture({ items: '<s v="B"/><s v="A " c="Retained caption"/>' }), result = prepare(f);
  expect(result.cache).toBe(f.cache); expect(result.reports[0].next).toBe(f.pivot);
});
it('prepares every report sharing the cache and leaves unrelated reports alone', () => {
  const f = fixture(), copy = { ...f.pivot, name: 'Copy', xml: f.pivot.xml.replace('name="Report"', 'name="Copy"') };
  f.wb.nativePivots.tables.push(copy, { ...copy, cache: 'unrelated' });
  const result = prepare(f); expect(result.reports.map(r => r.pivot)).toEqual([f.pivot, copy]);
  expect(result.reports.every(r => readNativePivotLayout(r.next, result.cache).fields[1].items[0].index === 0)).toBe(true);
});
it.each([false, true])('preserves OLAP inclusion/exclusion policy %s for new members', exclusion => {
  const f = fixture(); f.pivot.xml = f.pivot.xml.replace('x="1" n="Custom"', 'x="1" s="1" n="Custom"')
    .replace('<pivotHierarchy/><pivotHierarchy/>', `<pivotHierarchy/><pivotHierarchy includeNewItemsInFilter="${exclusion}"/>`);
  const result = prepare(f), plan = planNativePivotReport(result.reports[0].next, result.cache, { dataModel: f.wb.dataModel });
  expect(plan.layout.rows.items.filter(i => i.type === 'data').map(i => i.members[0].value)).toEqual(exclusion ? ['B'] : ['A ']);
});
it('does not widen an inclusion filter whose last selected member disappeared', () => {
  const f = fixture(); f.pivot.xml = f.pivot.xml.replace('<item x="0"/>', '<item x="0" s="1"/>');
  expect(() => prepare(f)).toThrow(/empty inclusion/);
});
it.each([false, true])('remaps pivot-area references in the correct index space, cacheIndex %s', cacheIndex => {
  const f = fixture(); f.pivot.xml = f.pivot.xml.replace('<item x="0"/><item x="1" n="Custom" sd="0"/>', '<item x="1"/><item x="0"/>').replace('</dataFields>', `</dataFields><formats count="1"><format><pivotArea cacheIndex="${cacheIndex}"><references count="1"><reference field="1" count="1"><x v="${cacheIndex ? 1 : 0}"/></reference></references></pivotArea></format></formats>`);
  const result = prepare(f); expect(result.reports[0].next.xml).toContain('<reference field="1" count="1"><x v="0"/></reference>');
});
it.each(['relative="1"', 'byPosition="1"', ''])('rejects positional or removed-member area references: %s', flags => {
  const f = fixture(); f.pivot.xml = f.pivot.xml.replace('</dataFields>', `</dataFields><formats><format><pivotArea><references><reference field="1" ${flags}><x v="0"/></reference></references></pivotArea></format></formats>`);
  expect(() => prepare(f)).toThrow(/area references/);
});
it('preserves compressed axis member identity when earlier cached rows disappear', () => {
  const f = fixture(); f.pivot.xml = f.pivot.xml.replace('<rowItems count="3"><i><x/></i><i><x v="1"/></i><i t="grand"><x/></i></rowItems>', '<rowItems count="4"><i><x/></i><i r="1"/><i><x v="1"/></i><i r="1"/></rowItems>');
  const result = prepare(f), layout = readNativePivotLayout(result.reports[0].next, result.cache);
  expect(layout.rows.items.map(i => i.members[0].value)).toEqual(['A ', 'A ']);
});
it('rebuilds empty and numeric/blank domains with matching type summaries', () => {
  const empty = fixture({ empty: true }), result = prepare(empty);
  expect(readNativePivotCache(result.cache).fields[1].items).toEqual([]);
  const f = fixture(); f.cache.xml = f.cache.xml.replaceAll('[Orders].[Group]', '[Orders].[Net]').replace('[Net].[Group]', '[Net].[Net]').replace('<s v="Gone"/><s v="A " c="Retained caption"/>', '<n v="22"/><m/>');
  const numeric = prepare(f), shared = readNativePivotCache(numeric.cache).fields[1].items;
  expect(shared).toEqual([{ type: 'blank', value: null }, { type: 'number', value: 0 }, { type: 'number', value: 1 }]);
  expect(numeric.cache.xml).toContain('containsBlank="true"'); expect(numeric.cache.xml).toContain('minValue="0"');
});
it('rejects integer members that cannot round-trip as exact numeric shared items', () => {
  const f = fixture({ base: 9007199254740990n }); f.cache.xml = f.cache.xml.replaceAll('[Orders].[Group]', '[Orders].[Net]').replace('[Net].[Group]', '[Net].[Net]').replace('<s v="Gone"/><s v="A " c="Retained caption"/>', '<n v="22"/><m/>');
  expect(() => prepare(f)).toThrow(/precision/);
});
it.each(['slicer', 'tuple', 'calculated', 'dynamic', 'grouped', 'duplicate'])('rejects unresolved %s dependencies atomically', kind => {
  const f = fixture();
  if (kind === 'slicer') f.wb.nativePivots.slicers = [{ cache: f.cache.key }];
  if (kind === 'tuple') f.cache.xml = f.cache.xml.replace('</pivotCacheDefinition>', '<tupleCache/></pivotCacheDefinition>');
  if (kind === 'calculated') f.cache.xml = f.cache.xml.replace('</pivotCacheDefinition>', '<calculatedItems/></pivotCacheDefinition>');
  if (kind === 'dynamic') f.pivot.xml = f.pivot.xml.replace('</pivotTableDefinition>', '<filters/></pivotTableDefinition>');
  if (kind === 'grouped') f.cache.xml = f.cache.xml.replace('</sharedItems>', '</sharedItems><fieldGroup/>');
  if (kind === 'duplicate') f.cache.xml = f.cache.xml.replace('v="Gone"', 'v="A "');
  const before = structuredClone(f.wb.nativePivots);
  expect(() => prepare(f)).toThrow(); expect(f.wb.nativePivots).toEqual(before);
});
it('bounds cumulative member work and validates cache identity', () => {
  const f = fixture();
  expect(() => prepareNativeModelPivotMembers(f.wb.nativePivots, 'missing', f.wb.dataModel)).toThrow(/cache/);
  expect(() => prepareNativeModelPivotMembers(f.wb.nativePivots, f.cache.key, f.wb.dataModel, { maxValues: 5 })).toThrow(/limit/);
});
it('persists the staged cache and regenerated axes through two native XLSX cycles', async () => {
  const f = fixture(), result = prepare(f), plan = planNativePivotReport(result.reports[0].next, result.cache, { dataModel: f.wb.dataModel });
  let wb = f.wb; wb.nativePivots = { ...wb.nativePivots, caches: [result.cache], tables: [plan.pivot] };
  for (let i = 0; i < 2; i++) {
    wb = await nativeRoundTrip(wb);
    const next = planNativePivotReport(wb.nativePivots.tables[0], wb.nativePivots.caches[0], { dataModel: wb.dataModel });
    expect(next.cells).toEqual(plan.cells); expect(wb.nativePivots.caches[0].records).toBe('');
  }
});
it.each([-1, 1048828, 1048829])('preserves unset or sentinel base references %s', index => {
  const f = fixture(); f.pivot.xml = index === -1 ? f.pivot.xml.replace('baseField="1"', 'baseField="-1"') : f.pivot.xml.replace('baseItem="1"', `baseItem="${index}"`);
  const result = prepare(f), measure = readNativePivotLayout(result.reports[0].next, result.cache).measures[0];
  expect(index === -1 ? measure.baseField : measure.baseItem).toBe(index);
});
it('rejects a removed base member in derived calculations but removes ignored normal metadata', () => {
  const f = fixture(); f.pivot.xml = f.pivot.xml.replace('baseItem="1"', 'baseItem="0" showDataAs="difference"');
  expect(() => prepare(f)).toThrow(/removed base member/);
  f.pivot.xml = f.pivot.xml.replace('showDataAs="difference"', 'showDataAs="normal"');
  expect(readNativePivotLayout(prepare(f).reports[0].next, prepare(f).cache).measures[0].baseItem).toBeNull();
});
it('encodes new strings exactly once and preserves supplementary text and XML characters', async () => {
  const f = fixture(), value = 'A & "B"\n_x0041_😀';
  f.wb.dataModel = { ...f.wb.dataModel, archive: encodeDataModelBytes(replaceDataModelArchiveFiles(dataModelBytes(f.wb.dataModel), new Map([['opaque/groups.dictionary', encodeModelStringDictionary([value, 'B'])]]))) };
  const result = prepare(f);
  expect(readNativePivotCache(result.cache).fields[1].items.map(i => i.value)).toEqual([value, 'B']);
  expect(result.cache.xml).toContain('_x005F_x0041_'); expect(result.cache.xml).toContain('&amp;');
  expect(result.cache.xml).toContain('_x000A_');
});
it('preserves unknown shared-list attributes while replacing stale range summaries', () => {
  const f = fixture(); f.cache.xml = f.cache.xml.replace('<sharedItems count="2"', '<sharedItems custom="keep" minDate="2000-01-01" maxValue="999" count="2"');
  const result = prepare(f); expect(result.cache.xml).toContain('custom="keep"');
  expect(result.cache.xml).not.toContain('minDate='); expect(result.cache.xml).not.toContain('maxValue=');
});
it('keeps stable automatic-sort ties in the surviving displayed order', () => {
  const f = fixture({ expression: '1', items: '<s v="Gone"/><s v="A "/>' });
  f.pivot.xml = f.pivot.xml.replace('axis="axisRow"', 'axis="axisRow" sortType="ascending"').replace('</items></pivotField>', '</items><autoSortScope><pivotArea><references><reference field="4294967294"><x v="0"/></reference></references></pivotArea></autoSortScope></pivotField>');
  const result = prepare(f), plan = planNativePivotReport(result.reports[0].next, result.cache, { dataModel: f.wb.dataModel });
  expect(plan.layout.rows.items.filter(i => i.type === 'data').map(i => i.members[0].value)).toEqual(['A ', 'B']);
});
it('does not publish earlier reports if a later connected report cannot be remapped', () => {
  const f = fixture(); f.wb.nativePivots.tables.push({ ...f.pivot, name: 'Other', xml: f.pivot.xml.replace('name="Report"', 'name="Other"').replace('</pivotTableDefinition>', '<filters/></pivotTableDefinition>') });
  const before = f.wb.toJSON(); expect(() => prepare(f)).toThrow(/dynamic filters/); expect(f.wb.toJSON()).toEqual(before);
});
it.each(['<extLst/>', '<foreign xmlns="urn:other"/>'])('refuses report member extensions it cannot remap: %s', xml => {
  const f = fixture(); f.pivot.xml = xml.startsWith('<ext') ? f.pivot.xml.replace('</items>', `</items>${xml}`) : f.pivot.xml.replace('</items>', `${xml}</items>`);
  expect(() => prepare(f)).toThrow(/extended report member/);
});
