import { expect, it } from 'vitest';
import { fixture as stored } from './helpers/stored-model-workbook.js';
import { nativeRoundTrip } from './helpers/linked-model-workbook.js';
import { planNativePivotReport } from '../src/core/native-pivot-report.js';
import { NativeModelPivotQuery } from '../src/core/native-pivot-model-query.js';
import { readNativePivotLayout } from '../src/core/native-pivot-layout.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', X15 = 'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main';
function fixture({ measure = 'Total', ...options } = {}) {
  const wb = stored({ base: -3n, ...options });
  const connections = `<connections xmlns="${MAIN}" xmlns:x="${X15}"><connection id="7" name="Model" type="5"><extLst><ext><x:connection model="1"/></ext></extLst></connection></connections>`;
  wb.dataModel = { ...wb.dataModel, connectionsXml: connections };
  const cache = { key: 'model', xml: `<pivotCacheDefinition xmlns="${MAIN}"><cacheSource type="external" connectionId="7"/><cacheFields count="2"><cacheField name="[Measures].[${measure}]" hierarchy="0" level="32767"/><cacheField name="[Orders].[Group].[Group]" hierarchy="1" level="1"><sharedItems count="2"><s v="B"/><s v="A " c="Displayed A"/></sharedItems></cacheField></cacheFields><cacheHierarchies count="2"><cacheHierarchy uniqueName="[Measures].[${measure}]" measure="1" measureGroup="Orders"/><cacheHierarchy uniqueName="[Orders].[Group]" dimensionUniqueName="[Orders]" attribute="1"><fieldsUsage count="2"><fieldUsage x="-1"/><fieldUsage x="1"/></fieldsUsage></cacheHierarchy></cacheHierarchies></pivotCacheDefinition>`, records: '' };
  const pivot = { name: 'Report', owner: wb.sheets[0].id, cache: 'model', ref: 'D5:E8', xml: `<pivotTableDefinition xmlns="${MAIN}" name="Report" dataCaption="Values"><location ref="D5:E8" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/><pivotFields count="2"><pivotField dataField="1" showAll="0"/><pivotField axis="axisRow" showAll="0"><items count="2"><item x="1"/><item x="0"/></items></pivotField></pivotFields><rowFields count="1"><field x="1"/></rowFields><dataFields count="1"><dataField fld="0" name="Reported value"/></dataFields><pivotHierarchies count="2"><pivotHierarchy/><pivotHierarchy/></pivotHierarchies></pivotTableDefinition>` };
  wb.nativePivots = { version: 1, tables: [pivot], caches: [cache], connections };
  return { wb, pivot, cache };
}
const plan = f => planNativePivotReport(f.pivot, f.cache, { dataModel: f.wb.dataModel });
const values = p => p.cells.filter(c => c.role === 'value').map(c => c.value);
it('plans a model report from declared measures and canonical stored values without worksheet records', () => {
  const f = fixture(), before = f.wb.toJSON(), p = plan(f);
  expect(values(p)).toEqual([1, 1]);
  expect(p.cells.filter(c => c.role === 'member').map(c => c.value)).toEqual(['Displayed A']);
  expect(p.layout.rows.items[0].members[0]).toMatchObject({ field: 1, index: 1, value: 'A ' });
  expect(p.pivot.ref).toBe('D5:E7');
  expect(f.wb.toJSON()).toEqual(before);
});
it.each([{ expression: 'AVERAGE(Orders[Net])' }, { measure: 'Half' }])('evaluates the real DAX expression instead of summing a caption-selected column: %j', options => {
  expect(values(plan(fixture(options)))).toEqual([0.5, 0.5]);
});
it('treats numeric zero and constant measures as nonempty even for blank source values', () => {
  const f = fixture({ expression: 'DIVIDE(0,1)' });
  expect(values(plan(f))).toEqual([0, 0, 0]);
  expect(plan(f).cells.filter(c => c.role === 'member').map(c => c.value)).toEqual(['Displayed A', 'B']);
  const query = new NativeModelPivotQuery(readNativePivotLayout(f.pivot, f.cache), f.wb.dataModel);
  expect(query.aggregateRows(0, 'sum', [], { withPresence: true })).toEqual({ value: 0, records: 0, nonEmpty: 1 });
  expect(() => query.aggregateRows(0, 'sum', [-1])).toThrow(/record selection/);
});
it('uses OLAP empty-row display independently of the worksheet showAll flag', () => {
  const f = fixture(); f.pivot.xml = f.pivot.xml.replace('name="Report" dataCaption', 'name="Report" showEmptyRow="1" missingCaption="Nothing" dataCaption');
  expect(values(plan(f))).toEqual([1, 'Nothing', 1]);
  expect(plan(f).cells.filter(c => c.role === 'member').map(c => c.value)).toEqual(['Displayed A', 'B']);
});
it('applies persisted OLAP selection, computes the filtered total, and restores cleared members', () => {
  const f = fixture();
  const filtered = planNativePivotReport(f.pivot, f.cache, { dataModel: f.wb.dataModel, selections: [{ field: 1, items: [0] }] });
  expect(values(filtered)).toEqual([null]);
  expect(filtered.cells.filter(c => c.role === 'member')).toEqual([]);
  const restored = planNativePivotReport(filtered.pivot, f.cache, { dataModel: f.wb.dataModel, selections: [{ field: 1, items: null }] });
  expect(restored.cells).toEqual(plan(f).cells);
});
it('preserves exact whole-number results above the JavaScript safe integer range', () => {
  expect(values(plan(fixture({ base: 9007199254740990n })))).toEqual([18014398509481987n, 18014398509481987n]);
});
it('fails unmatched canonical members instead of applying worksheet text folding or trimming', () => {
  for (const text of ['a ', 'A']) {
    const f = fixture(); f.cache.xml = f.cache.xml.replace('v="A "', `v="${text}"`);
    expect(() => plan(f)).toThrow(/exact shared member/);
  }
  const f = fixture(); f.cache.xml = f.cache.xml.replace('sharedItems count="2"', 'sharedItems count="3"').replace('<s v="B"/>', '<s v="B"/><s v="Expired"/>');
  expect(() => plan(f)).toThrow(/member domain/);
});
it('bounds model work independently of report cell count', () => {
  const f = fixture();
  expect(() => planNativePivotReport(f.pivot, f.cache, { dataModel: f.wb.dataModel, maxValues: 2 })).toThrow(/limit/);
  expect(() => planNativePivotReport(f.pivot, f.cache, { dataModel: f.wb.dataModel, maxCells: 1 })).toThrow(/limit/);
});
it('keeps unsupported total and default-member semantics explicit', () => {
  const f = fixture(); f.pivot.xml = f.pivot.xml.replace('dataCaption="Values"', 'dataCaption="Values" visualTotals="0"');
  expect(() => plan(f)).toThrow(/Nonvisual/);
  const g = fixture(); g.cache.xml = g.cache.xml.replace('attribute="1"', 'attribute="1" defaultMemberUniqueName="[Orders].[Group].&amp;[B]"');
  expect(() => plan(g)).toThrow(/default members/);
});
it('replans after native-only XLSX cycles without creating worksheet cache records', async () => {
  let { wb } = fixture({ expression: 'AVERAGE(Orders[Net])' });
  for (let i = 0; i < 2; i++) {
    wb = await nativeRoundTrip(wb);
    expect(values(plan({ wb, pivot: wb.nativePivots.tables[0], cache: wb.nativePivots.caches[0] }))).toEqual([0.5, 0.5]);
    expect(wb.nativePivots.caches[0].records || '').toBe('');
    expect(wb.nativePivots.caches[0].xml).toContain('type="external"');
  }
});

it('sorts distinct large integer groups by their declared measure without Number rounding', () => {
  const f = fixture({ base: 9007199254740990n, groupIds: [3, 3, 4] });
  f.pivot.xml = f.pivot.xml.replace('axis="axisRow"', 'axis="axisRow" sortType="descending"').replace('</items></pivotField>', '</items><autoSortScope><pivotArea><references count="1"><reference field="4294967294" count="1"><x v="0"/></reference></references></pivotArea></autoSortScope></pivotField>');
  const p = plan(f);
  expect(p.cells.filter(c => c.role === 'member').map(c => c.value)).toEqual(['B', 'Displayed A']);
  expect(values(p)).toEqual([9007199254740994n, 9007199254740993n, 18014398509481987n]);
});
it('matches typed integer and blank attribute keys without equating zero with blank', () => {
  const f = fixture();
  f.cache.xml = f.cache.xml.replaceAll('[Orders].[Group]', '[Orders].[Net]').replace('[Net].[Group]', '[Net].[Net]')
    .replace('<sharedItems count="2"><s v="B"/><s v="A " c="Displayed A"/></sharedItems>', '<sharedItems count="3"><m/><n v="1"/><n v="0"/></sharedItems>');
  f.pivot.xml = f.pivot.xml.replace('<items count="2"><item x="1"/><item x="0"/></items>', '<items count="3"><item x="2"/><item x="0"/><item x="1"/></items>');
  const p = plan(f);
  expect(p.cells.filter(c => c.role === 'member').map(c => [c.value, c.type])).toEqual([[0, 'number'], [1, 'number']]);
  expect(values(p)).toEqual([0, 1, 1]);
  f.cache.xml = f.cache.xml.replace('<n v="1"/>', '<n v="9007199254740993"/>');
  expect(() => plan(f)).toThrow(/integer precision/);
});
it('keeps a member when any displayed measure is nonblank and computes each total independently', () => {
  const f = fixture({ secondary: 'COUNTROWS(Orders)' });
  f.cache.xml = f.cache.xml.replace('cacheFields count="2"', 'cacheFields count="3"')
    .replace('</cacheFields>', '<cacheField name="[Measures].[Half]" hierarchy="2" level="32767"/></cacheFields>')
    .replace('cacheHierarchies count="2"', 'cacheHierarchies count="3"')
    .replace('</cacheHierarchies>', '<cacheHierarchy uniqueName="[Measures].[Half]" measure="1" measureGroup="Orders"/></cacheHierarchies>');
  f.pivot.ref = 'D5:F8';
  f.pivot.xml = f.pivot.xml.replaceAll('D5:E8', 'D5:F8').replace('pivotFields count="2"', 'pivotFields count="3"')
    .replace('</pivotFields>', '<pivotField dataField="1" showAll="0"/></pivotFields>')
    .replace('<dataFields count="1">', '<colFields count="1"><field x="-2"/></colFields><dataFields count="2">')
    .replace('</dataFields>', '<dataField fld="2" name="Rows"/></dataFields>')
    .replace('pivotHierarchies count="2"', 'pivotHierarchies count="3"').replace('</pivotHierarchies>', '<pivotHierarchy/></pivotHierarchies>');
  expect(values(plan(f))).toEqual([1, 2, null, 1, 1, 3]);
});
it('preserves native model queries through report sheet extraction', () => {
  const f = fixture(); f.wb.dataModel = { ...f.wb.dataModel, modelXml: `<x:dataModel xmlns:x="${X15}"/>` };
  const copy = f.wb.sheetToWorkbook(f.wb.sheets[0].id, { sourceWorkbook: '/Model.xlsx' });
  expect(values(plan({ wb: copy, pivot: copy.nativePivots.tables[0], cache: copy.nativePivots.caches[0] }))).toEqual([1, 1]);
});

it('materializes and commits supported model plans with native metadata, undo and redo', async () => {
  const { materializeNativePivotReport } = await import('../src/core/native-pivot-materialize.js');
  const { commitNativePivotReports } = await import('../src/core/native-pivot-commit.js');
  const f = fixture(); f.pivot.xml = f.pivot.xml.replace('dataCaption="Values"', 'dataCaption="Values" preserveFormatting="0"');
  const before = f.wb.toJSON();
  const p = planNativePivotReport(f.pivot, f.cache, { dataModel: f.wb.dataModel, nativePivots: f.wb.nativePivots, paintContext: { numberFormats: {} } });
  const cells = materializeNativePivotReport(f.wb, f.pivot, p);
  expect(commitNativePivotReports(f.wb, [{ pivot: f.pivot, cache: f.cache, next: p.pivot, cells }])).toBe(true);
  expect(f.wb.getValue(f.wb.sheets[0].id, 5, 4)).toBe(1);
  expect(f.wb.getValue(f.wb.sheets[0].id, 6, 4)).toBe(1);
  const after = f.wb.toJSON(); f.wb.undo(); expect(f.wb.toJSON()).toEqual(before);
  f.wb.redo(); expect(f.wb.toJSON()).toEqual(after);
  const reloaded = await nativeRoundTrip(f.wb);
  expect(reloaded.getValue(reloaded.sheets[0].id, 5, 4)).toBe(1);
  expect(values(plan({ wb: reloaded, pivot: reloaded.nativePivots.tables[0], cache: reloaded.nativePivots.caches[0] }))).toEqual([1, 1]);
});
