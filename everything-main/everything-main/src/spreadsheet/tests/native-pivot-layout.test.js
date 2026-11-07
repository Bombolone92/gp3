import { expect, it } from 'vitest';
import { readNativePivotLayout, nativePivotValueContexts, nativePivotModelContext, pivotUniqueName } from '../src/core/native-pivot-layout.js';
import { Workbook } from '../src/core/workbook.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function fixture() {
  const cache = { key: 'c', xml: `<pivotCacheDefinition xmlns="${MAIN}"><cacheSource type="external" connectionId="9"/><cacheFields count="4">
    <cacheField name="unrelated caption" hierarchy="0"><sharedItems count="2"><s v="East"/><s v="West"/></sharedItems></cacheField>
    <cacheField name="details" hierarchy="1"><sharedItems count="2"><s v="A"/><s v="B"/></sharedItems></cacheField>
    <cacheField name="measure one" hierarchy="2"/><cacheField name="measure two" hierarchy="3"/></cacheFields>
    <cacheHierarchies count="4"><cacheHierarchy uniqueName="[Sales].[Region]" dimensionUniqueName="[Sales]" attribute="1"/>
    <cacheHierarchy uniqueName="[Sales].[Item]" dimensionUniqueName="[Sales]" attribute="1"/>
    <cacheHierarchy uniqueName="[Measures].[Revenue]" measure="1" measureGroup="Sales"/>
    <cacheHierarchy uniqueName="[Measures].[Units]" measure="1" measureGroup="Sales"/></cacheHierarchies></pivotCacheDefinition>` };
  const pivot = { name: 'Report', owner: 'report', cache: 'c', ref: 'D8:F12', xml: `<pivotTableDefinition xmlns="${MAIN}"><location ref="A1:C5" firstDataRow="1" firstDataCol="1"/>
    <pivotFields count="4"><pivotField><items count="3"><item x="1"/><item x="0"/><item t="default"/></items></pivotField>
    <pivotField><items count="2"><item x="1"/><item x="0"/></items></pivotField><pivotField/><pivotField/></pivotFields>
    <rowFields count="2"><field x="0"/><field x="1"/></rowFields><rowItems count="4"><i><x/></i><i r="1"><x v="1"/></i><i><x v="1"/></i><i t="grand"><x/></i></rowItems>
    <colFields count="1"><field x="-2"/></colFields><colItems count="2"><i i="1"><x v="1"/></i><i><x/></i></colItems>
    <dataFields count="2"><dataField fld="2" name="Caption is not identity"/><dataField fld="3" name="Other caption"/></dataFields></pivotTableDefinition>` };
  return { pivot, cache };
}
const schema = { bindings: { connections: [{ id: '9', model: true }] }, tables: [{ id: 'Sales', name: 'Sales', columns: [{ id: 'Region', name: 'Region' }, { id: 'Item', name: 'Item' }] }],
  scripts: [{ commands: [{ measures: [{ table: 'Sales', name: 'Revenue', expression: 'SUM(Sales[Net])' }, { table: 'Sales', name: 'Units', expression: 'COUNTROWS(Sales)' }] }] }] };
it('expands repeated prefixes through field items before looking up shared values', () => {
  const { pivot, cache } = fixture(), layout = readNativePivotLayout(pivot, cache);
  expect(layout.rows.items.map(i => i.members.map(m => m.value))).toEqual([['West'], ['West', 'A'], ['East'], []]);
  const contexts = [...nativePivotValueContexts(layout)];
  expect(contexts).toHaveLength(8);
  expect(contexts.map(c => [c.r, c.c])).toEqual([[8, 4], [8, 5], [9, 4], [9, 5], [10, 4], [10, 5], [11, 4], [11, 5]]);
  expect(contexts.map(c => c.measure.field)).toEqual([3, 2, 3, 2, 3, 2, 3, 2]);
  expect(nativePivotModelContext(layout, contexts[2], schema)).toMatchObject({ table: 'Sales', measure: 'Units', expression: 'COUNTROWS(Sales)', filters: [
    { table: 'Sales', column: 'Region', type: 'string', value: 'West' }, { table: 'Sales', column: 'Item', type: 'string', value: 'A' },
  ] });
  expect(nativePivotModelContext(layout, contexts[6], schema).filters).toEqual([]);
});
it('supports a measures-on-rows axis and a fieldless single column', () => {
  const f = fixture(); f.pivot.ref = 'B2:C4';
  f.pivot.xml = f.pivot.xml.replace(/<rowFields[\s\S]*?<\/colItems>/, '<rowFields count="1"><field x="-2"/></rowFields><rowItems count="2"><i i="1"><x v="1"/></i><i><x/></i></rowItems>');
  const contexts = [...nativePivotValueContexts(readNativePivotLayout(f.pivot, f.cache))];
  expect(contexts.map(c => [c.r, c.c, c.measure.field])).toEqual([[2, 2, 3], [3, 2, 2]]);
});
it('retains blank rows and subtotal markers without confusing them with a blank source member', () => {
  const f = fixture(); f.pivot.xml = f.pivot.xml.replace('<i r="1"><x v="1"/></i>', '<i t="blank"><x/></i>').replace('<i><x v="1"/></i>', '<i t="default"><x v="2"/></i>');
  const layout = readNativePivotLayout(f.pivot, f.cache), contexts = [...nativePivotValueContexts(layout)];
  expect(contexts).toHaveLength(6); expect(contexts[2].r).toBe(10);
  expect(contexts[2].members[0]).toEqual({ field: 0, type: 'subtotal', aggregation: 'default' });
  expect(nativePivotModelContext(layout, contexts[2], schema).filters).toEqual([]);
  f.cache.xml = f.cache.xml.replace('<s v="West"/>', '<m/>');
  expect(readNativePivotLayout(f.pivot, f.cache).rows.items[0].members[0]).toMatchObject({ type: 'blank', value: null });
});
it.each([['<n v="3.5"/>', 'number', 3.5], ['<b v="false"/>', 'boolean', false], ['<d v="2024-02-29T12:00:00"/>', 'date', '2024-02-29T12:00:00'], ['<e v="#N/A"/>', 'error', '#N/A']])('preserves typed shared items: %s', (xml, type, value) => {
  const f = fixture(); f.cache.xml = f.cache.xml.replace('<s v="West"/>', xml);
  expect(readNativePivotLayout(f.pivot, f.cache).rows.items[0].members[0]).toMatchObject({ type, value });
});
it('decodes bracket escapes without splitting names on embedded dots', () => {
  expect(pivotUniqueName('[Sales.EU].[A]]B]')).toEqual(['Sales.EU', 'A]B']);
  for (const input of ['', 'Sales', '[Sales].', '[Sales', '[]', '[Sales]junk']) expect(() => pivotUniqueName(input)).toThrow();
});
it.each([
  ['count', xml => xml.replace('<rowItems count="4">', '<rowItems count="5">')],
  ['prefix', xml => xml.replace('<i r="1">', '<i r="3">')],
  ['field index', xml => xml.replace('<field x="0"/>', '<field x="8"/>')],
  ['item index', xml => xml.replace('<i><x/></i>', '<i><x v="99"/></i>')],
  ['shared item index', xml => xml.replace('<item x="1"/>', '<item x="99"/>')],
])('rejects malformed %s metadata', (_name, update) => {
  const f = fixture(); f.pivot.xml = update(f.pivot.xml);
  expect(() => readNativePivotLayout(f.pivot, f.cache)).toThrow();
});
it('bounds context expansion, report dimensions and model identity resolution', () => {
  const f = fixture(), layout = readNativePivotLayout(f.pivot, f.cache);
  expect(() => [...nativePivotValueContexts(layout, { maxCells: 7 })]).toThrow(/limit/);
  expect(() => [...nativePivotValueContexts({ ...layout, firstDataRow: 99 })]).toThrow(/location/);
  const context = [...nativePivotValueContexts(layout)][0];
  expect(() => nativePivotModelContext(layout, context, { ...schema, bindings: { connections: [{ id: '9', model: false }] } })).toThrow(/Data Model/);
  expect(() => nativePivotModelContext(layout, context, { ...schema, scripts: [] })).toThrow(/declaration/);
});
it('reads the current range from workbook state and rejects ambiguous report names', async () => {
  const { pivot, cache } = fixture(), wb = new Workbook({ sheets: [{ id: 'report', name: 'Report' }], nativePivots: { version: 1, caches: [cache], tables: [pivot] } });
  expect((await wb.inspectPivotLayout('report')).range).toMatchObject({ r1: 7, c1: 3, r2: 11, c2: 5 });
  wb.insertRows('report', 0, 2);
  expect((await wb.inspectPivotLayout('Report')).range.r1).toBe(9);
  wb.nativePivots.tables.push({ ...pivot });
  await expect(wb.inspectPivotLayout('Report')).rejects.toThrow(/ambiguous/);
});
it('decodes native cache field names and member strings once for report contexts', () => {
  const f = fixture();
  f.cache.xml = f.cache.xml.replace('name="unrelated caption"', 'name="Field_x000A_name"').replace('v="West"', 'v="_x005F_x000A_ &amp; _x0009_"');
  const layout = readNativePivotLayout(f.pivot, f.cache);
  expect(layout.cacheFields[0].name).toBe('Field\nname');
  expect(layout.rows.items[0].members[0].value).toBe('_x000A_ & \t');
});

it('reads schema defaults and explicit row layout/subtotal settings', () => {
  const f = fixture();
  expect(readNativePivotLayout(f.pivot, f.cache).fields[0]).toMatchObject({ compact: true, outline: true,
    subtotalTop: true, defaultSubtotal: true, showAll: true, insertBlankRow: false, subtotals: [], sortType: 'manual', autoSort: false });
  f.pivot.xml = f.pivot.xml.replace('<pivotField>', '<pivotField compact="0" outline="false" subtotalTop="0" defaultSubtotal="false" showAll="0" insertBlankRow="1" sumSubtotal="1" avgSubtotal="true" sortType="descending">');
  expect(readNativePivotLayout(f.pivot, f.cache).fields[0]).toMatchObject({ compact: false, outline: false,
    subtotalTop: false, defaultSubtotal: false, showAll: false, insertBlankRow: true, subtotals: ['sum', 'avg'], sortType: 'descending' });
});
it.each(['outline', 'compact', 'subtotalTop', 'defaultSubtotal', 'showAll', 'insertBlankRow', 'sumSubtotal'])('rejects malformed %s flags rather than changing layout silently', attribute => {
  const f = fixture(); f.pivot.xml = f.pivot.xml.replace('<pivotField>', `<pivotField ${attribute}="yes">`);
  expect(() => readNativePivotLayout(f.pivot, f.cache)).toThrow(/Invalid pivot/);
});

it('decodes report display captions, measure formats and page item references', () => {
  const f = fixture();
  expect(readNativePivotLayout(f.pivot, f.cache)).toMatchObject({ pageFields: [], showMissing: true, missingCaption: '', showError: false, errorCaption: '', hasAdvancedFilters: false });
  f.pivot.xml = f.pivot.xml.replace('<pivotTableDefinition ', '<pivotTableDefinition showMissing="0" missingCaption="No_x000A_data" showError="1" errorCaption="Oops_x0009_" ')
    .replace('<pivotField>', '<pivotField multipleItemSelectionAllowed="1" autoShow="1">')
    .replace('<dataFields ', '<pageFields count="1"><pageField fld="1" item="0"/></pageFields><dataFields ')
    .replace('name="Other caption"', 'name="Other_x000A_caption" numFmtId="164"');
  const layout = readNativePivotLayout(f.pivot, f.cache);
  expect(layout).toMatchObject({ pageFields: [{ field: 1, item: 0 }], showMissing: false, missingCaption: 'No\ndata', showError: true, errorCaption: 'Oops\t' });
  expect(layout.fields[0]).toMatchObject({ multipleItemSelectionAllowed: true, autoShow: true });
  expect(layout.measures[1]).toMatchObject({ caption: 'Other\ncaption', numFmtId: 164 });
  f.pivot.xml = f.pivot.xml.replace('fld="1" item="0"', 'fld="99" item="0"');
  expect(() => readNativePivotLayout(f.pivot, f.cache)).toThrow(/page field/);
});

it('decodes label overrides and namespace-specific repeat settings without changing cache identities', () => {
  const f = fixture();
  f.pivot.xml = f.pivot.xml.replace('<pivotTableDefinition ', '<pivotTableDefinition indent="0" grandTotalCaption="All_x000A_items" rowHeaderCaption="Group" mergeItem="1" ')
    .replace('<pivotField>', '<pivotField name="Custom_x0009_field" subtotalCaption="Subtotal" numFmtId="14">')
    .replace('<item x="1"/>', '<item x="1" n="Renamed_x000A_item"/>')
    .replace('</pivotField>', '<extLst><ext uri="test"><x14:pivotField xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" fillDownLabels="1"/></ext></extLst></pivotField>');
  const layout = readNativePivotLayout(f.pivot, f.cache);
  expect(layout).toMatchObject({ indent: 0, mergeItem: true, grandTotalCaption: 'All\nitems', rowHeaderCaption: 'Group' });
  expect(layout.fields[0]).toMatchObject({ caption: 'Custom\tfield', subtotalCaption: 'Subtotal', numFmtId: 14, fillDownLabels: true });
  expect(layout.fields[0].items[0]).toMatchObject({ index: 1, caption: 'Renamed\nitem' });
  expect(layout.rows.items[0].members[0]).toMatchObject({ index: 1, value: 'West' });
});

it('reads header and grand-total defaults while preserving absent and empty measure captions', () => {
  const f = fixture();
  expect(readNativePivotLayout(f.pivot, f.cache)).toMatchObject({ showHeaders: true, rowGrandTotals: true, colGrandTotals: true, firstHeaderRow: 0 });
  f.pivot.xml = f.pivot.xml.replace('<pivotTableDefinition ', '<pivotTableDefinition showHeaders="0" rowGrandTotals="false" colGrandTotals="0" ')
    .replace('firstDataRow="1"', 'firstHeaderRow="1" firstDataRow="1"').replace('name="Caption is not identity"', '').replace('name="Other caption"', 'name=""');
  const layout = readNativePivotLayout(f.pivot, f.cache);
  expect(layout).toMatchObject({ showHeaders: false, rowGrandTotals: false, colGrandTotals: false, firstHeaderRow: 1 });
  expect(layout.measures.map(m => m.caption)).toEqual([null, '']);
});

it.each(['0009', '+9', ' \t+0009\r\n'])('matches the numeric model connection identity %j', id => {
  const f = fixture(), layout = readNativePivotLayout(f.pivot, f.cache), context = [...nativePivotValueContexts(layout)][0];
  const expected = nativePivotModelContext(layout, context, schema);
  expect(nativePivotModelContext({ ...layout, connectionId: id }, context, schema)).toEqual(expected);
  expect(nativePivotModelContext(layout, context, { ...schema, bindings: { connections: [{ id, model: true }] } })).toEqual(expected);
});
it('rejects ambiguous numeric connections even when their XML spellings differ', () => {
  const f = fixture(), layout = readNativePivotLayout(f.pivot, f.cache), context = [...nativePivotValueContexts(layout)][0];
  expect(() => nativePivotModelContext(layout, context, { ...schema, bindings: { connections: [{ id: '9', model: true }, { id: '+0009', model: false }] } })).toThrow(/ambiguous pivot connection/);
});
it.each(['', '9.0', '9e0', '-9', '4294967296', '\u00a09', '0x9'])('rejects invalid model connection ID %j rather than matching malformed metadata', id => {
  const f = fixture(), layout = readNativePivotLayout(f.pivot, f.cache), context = [...nativePivotValueContexts(layout)][0];
  expect(() => nativePivotModelContext({ ...layout, connectionId: id }, context, { ...schema, bindings: { connections: [{ id, model: true }] } })).toThrow(/connection/);
});

it('applies the cache connectionId default only when the XML attribute is omitted', () => {
  const f = fixture(), zeroSchema = { ...schema, bindings: { connections: [{ id: '-000', model: true }] } };
  f.cache.xml = f.cache.xml.replace(' connectionId="9"', '');
  const layout = readNativePivotLayout(f.pivot, f.cache), context = [...nativePivotValueContexts(layout)][0];
  expect(layout.connectionId).toBe('0');
  expect(nativePivotModelContext(layout, context, zeroSchema)).toMatchObject({ table: 'Sales', measure: 'Units' });
  for (const id of ['', ' ', 'NaN']) {
    const invalid = readNativePivotLayout(f.pivot, { ...f.cache, xml: f.cache.xml.replace('type="external"', `type="external" connectionId="${id}"`) });
    expect(() => nativePivotModelContext(invalid, context, zeroSchema)).toThrow(/connection/);
  }
});

it('rejects duplicate automatic sorting scopes instead of using an arbitrary one', () => {
  const f = fixture(); f.pivot.xml = f.pivot.xml.replace('</pivotField>', '<autoSortScope/><autoSortScope/></pivotField>');
  expect(() => readNativePivotLayout(f.pivot, f.cache)).toThrow(/Duplicate pivot automatic sorting/);
});

it('retains cache captions separately from field and typed member identities', () => {
  const f = fixture();
  f.cache.xml = f.cache.xml.replace('name="unrelated caption"', 'name="unrelated caption" caption="Area_x000A_label"')
    .replace('<s v="East"/>', '<s v="East" c="_x005F_x0041_"/>').replace('<s v="West"/>', '<s v="West" c=""/>');
  const layout = readNativePivotLayout(f.pivot, f.cache);
  expect(layout.cacheFields[0]).toMatchObject({ name: 'unrelated caption', caption: 'Area\nlabel', items: [
    { type: 'string', value: 'East', caption: '_x0041_' }, { type: 'string', value: 'West', caption: '' },
  ] });
  expect(layout.rows.items.flatMap(i => i.members).find(m => m.value === 'West')).toMatchObject({ caption: '', value: 'West' });
});
