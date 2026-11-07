import { expect, it } from 'vitest';
import { writeNativePivotSelections } from '../src/core/native-pivot-selections.js';
import { readNativePivotLayout } from '../src/core/native-pivot-layout.js';
import { planNativePivotReport } from '../src/core/native-pivot-report.js';
import { nativePivotFilters } from '../src/core/native-pivot-filters.js';
import { parseModelXml } from '../src/core/data-model-metadata.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function fixture() {
  const cache = { key: 'cache', xml: `<pivotCacheDefinition xmlns="${MAIN}" recordCount="3"><cacheSource type="worksheet"><worksheetSource sheet="Source" ref="A1:B4"/></cacheSource><cacheFields count="2"><cacheField name="Category"><sharedItems count="4"><s v="A"/><s v="B"/><s v="C"/><s v="Unused"/></sharedItems></cacheField><cacheField name="Amount"/></cacheFields></pivotCacheDefinition>`, records: `<pivotCacheRecords xmlns="${MAIN}" count="3"><r><x v="0"/><n v="1"/></r><r><x v="1"/><n v="2"/></r><r><x v="2"/><n v="3"/></r></pivotCacheRecords>` };
  const pivot = { name: 'Summary', cache: 'cache', owner: 'sheet', ref: 'D5:E9', xml: `<p:pivotTableDefinition xmlns:p="${MAIN}" name="Summary" dataCaption="Values"><p:location ref="D5:E9" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/><p:pivotFields count="2"><p:pivotField axis="axisRow" showAll="0" includeNewItemsInFilter="1"><p:items count="4"><p:item x="2" n="C custom" sd="0"/><p:item x="0"/><p:item x="1"/><p:item t="default"/></p:items><p:extLst><p:ext uri="urn:test"><extra xmlns="urn:extra"/></p:ext></p:extLst></p:pivotField><p:pivotField dataField="1"/></p:pivotFields><p:rowFields count="1"><p:field x="0"/></p:rowFields><p:dataFields count="1"><p:dataField fld="1"/></p:dataFields></p:pivotTableDefinition>` };
  return { pivot, cache };
}
const layout = (pivot, cache) => readNativePivotLayout(pivot, cache);
it('writes cache-member choices without changing existing item positions, captions or drill state', () => {
  const { pivot, cache } = fixture(), before = structuredClone({ pivot, cache });
  const next = writeNativePivotSelections(pivot, cache, [{ field: 0, items: [0, 2] }]);
  const items = layout(next, cache).fields[0].items;
  expect(items.map(i => [i.type, i.index, i.hidden])).toEqual([['data', 2, false], ['data', 0, false], ['data', 1, true], ['default', null, false], ['data', 3, true]]);
  expect(items[0]).toMatchObject({ caption: 'C custom', details: false });
  expect(next.xml).toContain('includeNewItemsInFilter="1"'); expect(next.xml).toContain('xmlns="urn:extra"');
  expect({ pivot, cache }).toEqual(before);
});
it('replaces a previous choice and clears saved visibility when all members are requested', () => {
  const { pivot, cache } = fixture();
  const first = writeNativePivotSelections(pivot, cache, [{ field: 0, items: [0] }]);
  const second = writeNativePivotSelections(first, cache, [{ field: 0, items: [1, 1] }]);
  expect(nativePivotFilters(layout(second, cache))).toEqual([{ field: 0, items: [1] }]);
  const cleared = writeNativePivotSelections(second, cache, [{ field: 0, items: null }]);
  expect(nativePivotFilters(layout(cleared, cache))).toEqual([]);
});
it('retains a persisted empty choice and keeps selections in different fields independent', () => {
  const { pivot, cache } = fixture();
  const empty = writeNativePivotSelections(pivot, cache, [{ field: 0, items: [] }]);
  expect(nativePivotFilters(layout(empty, cache))).toEqual([{ field: 0, items: [] }]);
  const next = writeNativePivotSelections(empty, cache, [{ field: 1, items: null }]);
  expect(nativePivotFilters(layout(next, cache))).toEqual([{ field: 0, items: [] }]);
});
it('stores page-field positions in pivot-item order and uses multi-selection flags consistently', () => {
  const { pivot, cache } = fixture();
  pivot.xml = pivot.xml.replace('<p:rowFields count="1"><p:field x="0"/></p:rowFields>', '<p:pageFields count="1"><p:pageField fld="0" item="0"/></p:pageFields>').replace('axis="axisRow"', 'axis="axisPage"');
  let next = writeNativePivotSelections(pivot, cache, [{ field: 0, items: [0] }]);
  expect(layout(next, cache).pageFields[0].item).toBe(1);
  expect(layout(next, cache).fields[0].multipleItemSelectionAllowed).toBe(false);
  next = writeNativePivotSelections(next, cache, [{ field: 0, items: [0, 1] }]);
  expect(layout(next, cache).pageFields[0].item).toBeNull();
  expect(layout(next, cache).fields[0].multipleItemSelectionAllowed).toBe(true);
  next = writeNativePivotSelections(next, cache, [{ field: 0, items: null }]);
  expect(nativePivotFilters(layout(next, cache))).toEqual([]);
});
it('inserts a missing item collection before existing field extensions', () => {
  const { pivot, cache } = fixture(); pivot.xml = pivot.xml.replace(/<p:items.*?<\/p:items>/, '');
  const next = writeNativePivotSelections(pivot, cache, [{ field: 0, items: [3] }]);
  const field = parseModelXml(next.xml).getElementsByTagNameNS(MAIN, 'pivotField')[0];
  expect(Array.from(field.childNodes).filter(n => n.nodeType === 1).map(n => n.localName)).toEqual(['items', 'extLst']);
  expect(nativePivotFilters(layout(next, cache))).toEqual([{ field: 0, items: [3] }]);
});
it('refuses an empty choice on an inline-only field instead of saving it as show-all', () => {
  const { pivot, cache } = fixture(), before = structuredClone(pivot);
  expect(() => writeNativePivotSelections(pivot, cache, [{ field: 1, items: [] }])).toThrow(/no shared members/);
  expect(pivot).toEqual(before);
});
it('rebuilds a persistent report choice, replaces it, and clears it without transient filter arguments', () => {
  const { pivot, cache } = fixture();
  const first = planNativePivotReport(pivot, cache, { selections: [{ field: 0, items: [0] }] });
  expect(first.cells.filter(c => c.role === 'value').map(c => c.value)).toEqual([1, 1]);
  expect(planNativePivotReport(first.pivot, cache).cells).toEqual(first.cells);
  const second = planNativePivotReport(first.pivot, cache, { selections: [{ field: 0, items: [1] }] });
  expect(second.cells.filter(c => c.role === 'value').map(c => c.value)).toEqual([2, 2]);
  const cleared = planNativePivotReport(second.pivot, cache, { selections: [{ field: 0, items: null }] });
  expect(cleared.cells).toEqual(planNativePivotReport(pivot, cache).cells);
});
it.each([[{ field: 9, items: [] }], [{ field: 0, items: [4] }], [{ field: 0, items: [-1] }], [{ field: 0, items: 'A' }], [{ field: 0, items: null }, { field: 0, items: [] }]])('rejects invalid choices without mutating native metadata: %j', selections => {
  const { pivot, cache } = fixture(), before = structuredClone(pivot);
  expect(() => writeNativePivotSelections(pivot, cache, selections)).toThrow(/selections/); expect(pivot).toEqual(before);
});
it('rejects mismatched/external caches, non-database fields, duplicate stored members and oversized materialization', () => {
  const { pivot, cache } = fixture(), choices = [{ field: 0, items: [0] }];
  expect(() => writeNativePivotSelections(pivot, { ...cache, key: 'other' }, choices)).toThrow(/mismatched/);
  expect(() => writeNativePivotSelections(pivot, { ...cache, xml: cache.xml.replace('type="worksheet"', 'type="external"') }, choices)).toThrow(/external/);
  expect(() => writeNativePivotSelections(pivot, { ...cache, xml: cache.xml.replace('name="Category"', 'name="Category" databaseField="0"') }, choices)).toThrow(/calculated/);
  expect(() => writeNativePivotSelections({ ...pivot, xml: pivot.xml.replace('x="1"', 'x="0"') }, cache, choices)).toThrow(/duplicate stored/);
  expect(() => writeNativePivotSelections(pivot, cache, choices, { maxItems: 4 })).toThrow(/limit/);
});
