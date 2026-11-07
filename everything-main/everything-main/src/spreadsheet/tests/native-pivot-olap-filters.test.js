import { expect, it } from 'vitest';
import { readNativePivotLayout } from '../src/core/native-pivot-layout.js';
import { nativePivotFilters } from '../src/core/native-pivot-filters.js';
import { writeNativePivotSelections } from '../src/core/native-pivot-selections.js';
import { rebuildNativePivotAxis } from '../src/core/native-pivot-axis.js';
import { NativePivotQuery } from '../src/core/native-pivot-query.js';
import { Workbook } from '../src/core/workbook.js';
import { nativeRoundTrip } from './helpers/linked-model-workbook.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function fixture(exclude = false) {
  const cache = { key: 'c', xml: `<pivotCacheDefinition xmlns="${MAIN}"><cacheSource type="external" connectionId="7"/><cacheFields count="2"><cacheField name="[Orders].[Region].[Region]" hierarchy="0" level="1"><sharedItems count="3"><s v="North"/><s v="South"/><s v="West"/></sharedItems></cacheField><cacheField name="[Measures].[Revenue]" hierarchy="1" level="32767"/></cacheFields><cacheHierarchies count="2"><cacheHierarchy uniqueName="[Orders].[Region]" dimensionUniqueName="[Orders]" attribute="1"><fieldsUsage count="2"><fieldUsage x="-1"/><fieldUsage x="0"/></fieldsUsage></cacheHierarchy><cacheHierarchy uniqueName="[Measures].[Revenue]" measure="1" measureGroup="Orders"><fieldsUsage count="1"><fieldUsage x="1"/></fieldsUsage></cacheHierarchy></cacheHierarchies></pivotCacheDefinition>` };
  const pivot = { name: 'Summary', owner: 'sheet', cache: 'c', ref: 'D5:E9', xml: `<pivotTableDefinition xmlns="${MAIN}" name="Summary" dataCaption="Values"><location ref="D5:E9" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/><pivotFields count="2"><pivotField axis="axisRow" showAll="0"><items count="4"><item x="2" n="Local caption"/><item x="0"/><item x="1" s="1"/><item t="default"/></items></pivotField><pivotField dataField="1"/></pivotFields><rowFields count="1"><field x="0"/></rowFields><dataFields count="1"><dataField fld="1"/></dataFields><pivotHierarchies count="2"><pivotHierarchy includeNewItemsInFilter="${exclude ? 'true' : 'false'}"/><pivotHierarchy/></pivotHierarchies></pivotTableDefinition>` };
  return { pivot, cache };
}
const layout = f => readNativePivotLayout(f.pivot, f.cache);
it.each([false, true])('resolves OLAP item selections by shared identity with exclusion=%s', exclude => {
  const f = fixture(exclude), before = structuredClone(f), l = layout(f);
  expect(l.fields[0].items[2]).toMatchObject({ index: 1, selected: true });
  expect(nativePivotFilters(l)).toEqual([{ field: 0, items: exclude ? [0, 2] : [1] }]);
  // Synthetic query records verify the axis/filter interface, not model DAX evaluation.
  const query = new NativePivotQuery({ fields: l.cacheFields, recordFields: [0], records: [0, 1, 2].map(index => [{ ...l.cacheFields[0].items[index], index }]) });
  expect(rebuildNativePivotAxis(l, query, 'rows').items.filter(i => i.type === 'data').map(i => i.members[0].value)).toEqual(exclude ? ['West', 'North'] : ['South']);
  expect(f).toEqual(before);
});
it.each([false, true])('writes/clears manual selections without changing the future-member policy (%s)', exclude => {
  const f = fixture(exclude), before = structuredClone(f);
  const next = writeNativePivotSelections(f.pivot, f.cache, [{ field: 0, items: [2, 2] }]);
  const l = readNativePivotLayout(next, f.cache);
  expect(nativePivotFilters(l)).toEqual([{ field: 0, items: [2] }]);
  expect(l.olapHierarchies[0].includeNewItems).toBe(exclude);
  expect(l.fields[0].items.map(i => [i.index, i.caption])).toEqual(layout(f).fields[0].items.map(i => [i.index, i.caption]));
  expect(next.xml).not.toMatch(/\sh="/);
  const cleared = writeNativePivotSelections(next, f.cache, [{ field: 0, items: null }]);
  expect(nativePivotFilters(readNativePivotLayout(cleared, f.cache))).toEqual([]);
  expect(readNativePivotLayout(cleared, f.cache).olapHierarchies[0].includeNewItems).toBe(exclude);
  expect(f).toEqual(before);
});
it('supports excluding every current member without turning an empty inclusion into show-all', () => {
  const f = fixture(true), none = writeNativePivotSelections(f.pivot, f.cache, [{ field: 0, items: [] }]);
  expect(nativePivotFilters(readNativePivotLayout(none, f.cache))).toEqual([{ field: 0, items: [] }]);
  const inclusion = fixture(false);
  expect(() => writeNativePivotSelections(inclusion.pivot, inclusion.cache, [{ field: 0, items: [] }])).toThrow(/empty OLAP inclusion/);
});
it('retains all-current-member inclusion as a filter on future members', () => {
  const f = fixture(false), next = writeNativePivotSelections(f.pivot, f.cache, [{ field: 0, items: [0, 1, 2] }]);
  const l = readNativePivotLayout(next, f.cache);
  expect(nativePivotFilters(l)).toEqual([{ field: 0, items: [2, 0, 1] }]);
  expect(l.fields[0].items.filter(i => i.type === 'data').every(i => i.selected)).toBe(true);
});
it('includes members absent from a previous field-item list when resolving exclusion', () => {
  const f = fixture(true); f.pivot.xml = f.pivot.xml.replace('items count="4"', 'items count="3"').replace('<item x="0"/>', '');
  expect(nativePivotFilters(layout(f))).toEqual([{ field: 0, items: [0, 2] }]);
  expect(() => writeNativePivotSelections(f.pivot, f.cache, [{ field: 0, items: [0] }])).toThrow(/axis remapping/);
});
it.each([
  ['hidden flag', f => { f.pivot.xml = f.pivot.xml.replace('s="1"', 'h="1"'); }, /hidden-item/],
  ['member list', f => { f.pivot.xml = f.pivot.xml.replace('<pivotHierarchy/>', '<pivotHierarchy><members level="0" count="0"/></pivotHierarchy>'); }, /unique-name/],
  ['page filter', f => { f.pivot.xml = f.pivot.xml.replace('<dataFields', '<pageFields count="1"><pageField fld="0" name="[Orders].[Region].&amp;[South]"/></pageFields><dataFields'); }, /page/],
  ['non-attribute hierarchy', f => { f.cache.xml = f.cache.xml.replace('attribute="1"', 'attribute="0"'); }, /non-attribute/],
  ['wrong level', f => { f.cache.xml = f.cache.xml.replace('level="1"', 'level="0"'); }, /non-attribute/],
  ['missing pivot hierarchy', f => { f.pivot.xml = f.pivot.xml.replace(/<pivotHierarchies[\s\S]*?<\/pivotHierarchies>/, ''); }, /binding/],
  ['duplicate shared member', f => { f.pivot.xml = f.pivot.xml.replace('<item x="0"/>', '<item x="1"/>'); }, /duplicate/],
  ['selected subtotal', f => { f.pivot.xml = f.pivot.xml.replace('item t="default"', 'item t="default" s="1"'); }, /subtotal/],
])('rejects %s rather than silently dropping its restriction', (_label, mutate, error) => {
  const f = fixture(); mutate(f);
  expect(() => nativePivotFilters(layout(f))).toThrow(error);
  expect(() => writeNativePivotSelections(f.pivot, f.cache, [{ field: 0, items: [0] }])).toThrow(error);
});
it('rejects invalid selection booleans and fieldsUsage counts at the parse boundary', () => {
  const f = fixture(); f.pivot.xml = f.pivot.xml.replace('s="1"', 's="yes"');
  expect(() => layout(f)).toThrow(/Invalid pivot s/);
  const g = fixture(); g.cache.xml = g.cache.xml.replace('fieldsUsage count="2"', 'fieldsUsage count="3"');
  expect(() => layout(g)).toThrow(/count/);
});
it('preserves both policies and shared-item selections through native XLSX cycles', async () => {
  for (const exclude of [false, true]) {
    const f = fixture(exclude);
    f.pivot = writeNativePivotSelections(f.pivot, f.cache, [{ field: 0, items: [2] }]);
    const connections = `<connections xmlns="${MAIN}"><connection id="7" name="Cube" type="5"><dbPr connection="Provider=Example" command="Cube"/></connection></connections>`;
    let wb = new Workbook({ sheets: [{ id: 'sheet', name: 'Report' }], nativePivots: { version: 1, tables: [f.pivot], caches: [f.cache], connections } });
    const verify = w => {
      const l = readNativePivotLayout(w.nativePivots.tables[0], w.nativePivots.caches[0]);
      expect(nativePivotFilters(l)).toEqual([{ field: 0, items: [2] }]);
      expect(l.olapHierarchies[0].includeNewItems).toBe(exclude);
    };
    for (let i = 0; i < 2; i++) { wb = await nativeRoundTrip(wb); verify(wb); }
    // External non-model sources cannot currently be extracted independently;
    // ordinary workbook native cycles still preserve this OLAP report exactly.
  }
});

it('uses inclusion by default and treats false item flags as unfiltered', () => {
  const f = fixture(); f.pivot.xml = f.pivot.xml.replace(' includeNewItemsInFilter="false"', '');
  expect(nativePivotFilters(layout(f))).toEqual([{ field: 0, items: [1] }]);
  f.pivot.xml = f.pivot.xml.replace('s="1"', 's="false"');
  expect(nativePivotFilters(layout(f))).toEqual([]);
  f.pivot.xml = f.pivot.xml.replace('<pivotHierarchy/>', '<pivotHierarchy includeNewItemsInFilter="yes"/>');
  expect(() => layout(f)).toThrow(/includeNewItemsInFilter/);
});
it('can append absent leaf members when no subtotal positions need remapping', () => {
  const f = fixture();
  f.pivot.xml = f.pivot.xml.replace('items count="4"', 'items count="2"').replace('<item x="0"/>', '').replace('<item t="default"/>', '');
  const next = writeNativePivotSelections(f.pivot, f.cache, [{ field: 0, items: [0] }]), l = readNativePivotLayout(next, f.cache);
  expect(nativePivotFilters(l)).toEqual([{ field: 0, items: [0] }]);
  expect(l.fields[0].items.map(i => i.index)).toEqual([2, 1, 0]);
  expect(l.fields[0].items[0].caption).toBe('Local caption');
});

it('retains ordinary hidden-item filtering for external non-OLAP database caches', () => {
  const f = fixture();
  f.cache.xml = f.cache.xml.replace(/<cacheHierarchies[\s\S]*?<\/cacheHierarchies>/, '');
  f.pivot.xml = f.pivot.xml.replace(/<pivotHierarchies[\s\S]*?<\/pivotHierarchies>/, '').replace('s="1"', 'h="1"');
  expect(nativePivotFilters(layout(f))).toEqual([{ field: 0, items: [2, 0] }]);
});
