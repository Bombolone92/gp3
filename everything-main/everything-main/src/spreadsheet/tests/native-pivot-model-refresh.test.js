import { it, expect } from 'vitest';
import { fixture as stored } from './helpers/stored-model-workbook.js';
import { nativeRoundTrip } from './helpers/linked-model-workbook.js';
import { dataModelBytes, encodeDataModelBytes } from '../src/core/data-model.js';
import { replaceDataModelArchiveFiles } from '../src/core/data-model-archive.js';
import { encodeModelStringDictionary } from '../src/core/data-model-dictionaries.js';
import { planNativePivotReport } from '../src/core/native-pivot-report.js';
import { materializeNativePivotReport } from '../src/core/native-pivot-materialize.js';
import { publishNativeModelRefresh } from '../src/core/native-pivot-model-refresh.js';
import { createDataModelEvaluation } from '../src/core/data-model-evaluate.js';
import { readNativePivotCache } from '../src/core/native-pivot-cache.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const connections = `<connections xmlns="${MAIN}" xmlns:x="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><connection id="7" name="Model" type="5"><extLst><ext><x:connection model="1"/></ext></extLst></connection></connections>`;
function model(base, member = 'A ', groupIds = [3, 4, 3]) {
  const data = stored({ base, groupIds }).dataModel;
  return { ...data, connectionsXml: connections, archive: encodeDataModelBytes(replaceDataModelArchiveFiles(dataModelBytes(data), new Map([
    ['opaque/groups.dictionary', encodeModelStringDictionary([member, 'B'])],
  ]))) };
}
function fixture({ copies = 1, caches = 1 } = {}) {
  const wb = stored({ base: -3n }); wb.dataModel = { ...wb.dataModel, connectionsXml: connections };
  const cache = { key: 'model', xml: `<pivotCacheDefinition xmlns="${MAIN}" recordCount="0"><cacheSource type="external" connectionId="7"/><cacheFields count="2"><cacheField name="[Measures].[Total]" hierarchy="0" level="32767"/><cacheField name="[Orders].[Group].[Group]" hierarchy="1" level="1"><sharedItems count="2"><s v="A "/><s v="B"/></sharedItems></cacheField></cacheFields><cacheHierarchies count="2"><cacheHierarchy uniqueName="[Measures].[Total]" measure="1" measureGroup="Orders"/><cacheHierarchy uniqueName="[Orders].[Group]" dimensionUniqueName="[Orders]" attribute="1"><fieldsUsage count="2"><fieldUsage x="-1"/><fieldUsage x="1"/></fieldsUsage></cacheHierarchy></cacheHierarchies></pivotCacheDefinition>`, records: '' };
  wb.nativePivots = { version: 1, tables: [], caches: Array.from({ length: caches }, (_, i) => ({ ...cache, key: `model${i}` })), connections, formats: {}, dxfs: [], styles: [] };
  for (let i = 0; i < copies; i++) {
    const row = 5 + 6 * i, ref = `D${row}:E${row + 3}`, name = `Report${i}`;
    const pivot = { name, owner: wb.sheets[0].id, cache: `model${i % caches}`, ref, xml: `<pivotTableDefinition xmlns="${MAIN}" name="${name}" dataCaption="Values" showEmptyRow="1" preserveFormatting="0"><location ref="${ref}" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/><pivotFields count="2"><pivotField dataField="1"/><pivotField axis="axisRow"><items count="3"><item x="0"/><item x="1"/><item t="default"/></items></pivotField></pivotFields><rowFields count="1"><field x="1"/></rowFields><dataFields count="1"><dataField fld="0"/></dataFields><pivotHierarchies count="2"><pivotHierarchy/><pivotHierarchy/></pivotHierarchies></pivotTableDefinition>` };
    wb.nativePivots.tables.push(pivot);
    const plan = planNativePivotReport(pivot, wb.nativePivots.caches[i % caches], { dataModel: wb.dataModel, nativePivots: wb.nativePivots, paintContext: { numberFormats: {} } });
    wb.setCells(pivot.owner, materializeNativePivotReport(wb, pivot, plan));
    wb.nativePivots.tables[i] = { ...plan.pivot, xml: plan.pivot.xml.replace('preserveFormatting="0"', 'preserveFormatting="1"') };
  }
  return wb;
}
const publish = (wb, next = model(7n, 'C'), options) => publishNativeModelRefresh(wb, { previous: wb.dataModel, next }, options);
it('publishes changed model members and values in one undoable batch', async () => {
  const wb = fixture(), id = wb.sheets[0].id, before = wb.toJSON();
  expect(publish(wb)).toBe(true);
  expect(readNativePivotCache(wb.nativePivots.caches[0]).fields[1].items.map(i => i.value)).toEqual(['B', 'C']);
  expect([wb.getValue(id, 5, 3), wb.getValue(id, 6, 3), wb.getValue(id, 7, 4)]).toEqual(['B', 'C', 21]);
  expect(await wb.evaluateModelMeasure('Orders', 'Total', { source: 'stored' })).toBe(21);
  const after = wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it.each([{ copies: 2 }, { copies: 2, caches: 2 }])('refreshes every connected report and cache: %j', options => {
  const wb = fixture(options); publish(wb);
  for (let i = 0; i < options.copies; i++) expect(wb.getValue(wb.sheets[0].id, 7 + 6 * i, 4)).toBe(21);
  expect(wb.nativePivots.caches.every(c => readNativePivotCache(c).fields[1].items.some(i => i.value === 'C'))).toBe(true);
});
it('moves surviving direct formats and does not assign them to new members', () => {
  const wb = fixture(), id = wb.sheets[0].id;
  wb.setCells(id, [{ r: 5, c: 4, cell: { v: 1, s: { bg: '#ff0000' } } }, { r: 6, c: 4, cell: { v: null, s: { bg: '#0000ff' } } }]);
  publish(wb);
  expect(wb.styleAt(id, 5, 4).bg).toBe('#0000ff'); expect(wb.styleAt(id, 6, 4)?.bg).not.toBe('#ff0000');
});
it('uses numeric connection identity and leaves unrelated worksheet caches untouched', () => {
  const wb = fixture(); wb.nativePivots.caches[0].xml = wb.nativePivots.caches[0].xml.replace('connectionId="7"', 'connectionId="+007"');
  const unrelated = { key: 'other', xml: `<pivotCacheDefinition xmlns="${MAIN}"><cacheSource type="worksheet"><worksheetSource sheet="Elsewhere" ref="A1"/></cacheSource><cacheFields count="1"><cacheField name="X"/></cacheFields></pivotCacheDefinition>` };
  wb.nativePivots.caches.push(unrelated); publish(wb); expect(wb.nativePivots.caches[1]).toBe(unrelated);
});
it.each(['stale', 'bindings', 'archive', 'slicer', 'unused', 'connection', 'later-report', 'protected-report'])('does not publish a partial model refresh after %s failure', issue => {
  const wb = fixture({ copies: 2, caches: 2 }), next = model(7n, 'C'), previous = wb.dataModel;
  if (issue === 'bindings') next.modelXml = '<changed/>';
  if (issue === 'archive') next.archive = 'AAAA';
  if (issue === 'slicer') wb.nativePivots.slicers = [{ cache: 'model1' }];
  if (issue === 'unused') wb.nativePivots.tables.pop();
  if (issue === 'connection') { next.connectionsXml = connections.replace('</connections>', '<connection id="007" name="Duplicate"/></connections>'); wb.dataModel = { ...previous, connectionsXml: next.connectionsXml }; }
  if (issue === 'later-report') wb.nativePivots.tables[1].xml = '<broken/>';
  if (issue === 'protected-report') wb.sheets[0].protectedRanges.push({ range: { r1: 10, c1: 3, r2: 13, c2: 4 } });
  const before = wb.toJSON();
  expect(() => publishNativeModelRefresh(wb, { previous: issue === 'stale' ? { ...previous } : wb.dataModel, next })).toThrow();
  expect(wb.toJSON()).toEqual(before);
});
it.each([{ maxCells: 15 }, { maxCacheCells: 1 }, { maxValues: 1 }, { maxCells: -1 }, { maxValues: Infinity }])('enforces refresh limits %j before mutation', options => {
  const wb = fixture({ copies: 2 }), before = wb.toJSON();
  expect(() => publish(wb, model(7n), options)).toThrow(/limit/); expect(wb.toJSON()).toEqual(before);
});
it('rejects a stale previously published snapshot', () => {
  const wb = fixture(), previous = wb.dataModel; publish(wb);
  const before = wb.toJSON(); expect(() => publishNativeModelRefresh(wb, { previous, next: model(9n) })).toThrow(/stale/); expect(wb.toJSON()).toEqual(before);
});
it('retains refreshed values, formats and native model metadata across XLSX cycles', async () => {
  let wb = fixture(); publish(wb);
  for (let i = 0; i < 2; i++) {
    wb = await nativeRoundTrip(wb);
    expect(wb.getValue(wb.sheets[0].id, 7, 4)).toBe(21);
    expect(await wb.evaluateModelMeasure('Orders', 'Total', { source: 'stored' })).toBe(21);
    expect(publishNativeModelRefresh(wb, { previous: wb.dataModel, next: wb.dataModel })).toBe(true);
  }
});

function withRules(wb) {
  const sheet = wb.sheets[0], range = { r1: 0, c1: 8, r2: 2, c2: 8 }, base = { type: 'gt', value: 0, style: { color: '#ff0000' } };
  sheet.rules = [{ ...base, id: 'before', range }];
  for (const [i, pivot] of wb.nativePivots.tables.entries()) {
    const token = `rule${i}`;
    pivot.conditionalRules = [{ priority: 7, id: token }];
    pivot.xml = pivot.xml.replace('</pivotTableDefinition>', '<conditionalFormats count="1"><conditionalFormat scope="data" priority="7"><pivotAreas count="1"><pivotArea type="data"/></pivotAreas></conditionalFormat></conditionalFormats></pivotTableDefinition>');
    sheet.rules.push({ ...base, id: `managed${i}`, range: { r1: 5 + 6 * i, c1: 4, r2: 7 + 6 * i, c2: 4 }, pivot: true, pivotRuleIds: [token] });
  }
  sheet.rules.push({ ...base, id: 'after', range: { ...range, c1: 9, c2: 9 } });
  return wb;
}
it('merges changed conditional targets for multiple reports on the same worksheet', async () => {
  let wb = withRules(fixture({ copies: 2 })); const before = wb.toJSON(), sheet = wb.sheets[0];
  publish(wb, model(7n, 'C', [3, 3, 3]));
  expect(sheet.rules.map(r => r.id)).toEqual(['before', 'managed0', 'managed1', 'after']);
  expect(sheet.rules[1].range).toEqual({ r1: 5, c1: 4, r2: 6, c2: 4 });
  expect(sheet.rules[2].range).toEqual({ r1: 11, c1: 4, r2: 12, c2: 4 });
  expect(sheet.rules[0]).toEqual(before.sheets[0].rules[0]); expect(sheet.rules[3]).toEqual(before.sheets[0].rules[3]);
  const after = wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
  wb = await nativeRoundTrip(wb);
  expect(publishNativeModelRefresh(wb, { previous: wb.dataModel, next: wb.dataModel })).toBe(true);
  expect(wb.sheets[0].rules.filter(r => r.pivotRuleIds?.length).map(r => r.range)).toEqual([sheet.rules[1].range, sheet.rules[2].range]);
});
it('retains explicit conditional-rule deletion during refresh', () => {
  const wb = withRules(fixture()); wb.sheets[0].rules.splice(1, 1); publish(wb);
  expect(wb.sheets[0].rules.map(r => r.id)).toEqual(['before', 'after']);
});
it('rejects ambiguous shared conditional rules before any model update', () => {
  const wb = withRules(fixture({ copies: 2 })); wb.sheets[0].rules[1].pivotRuleIds.push('rule1');
  const before = wb.toJSON(); expect(() => publish(wb)).toThrow(/conditional/); expect(wb.toJSON()).toEqual(before);
});
it('exposes the complete published state to listeners and snapshots caller-owned model data', () => {
  const wb = fixture(), next = model(7n, 'C'), events = [];
  const state = () => [createDataModelEvaluation(wb, { source: 'stored' }).evaluate('Orders', 'Total'), wb.getValue(wb.sheets[0].id, 7, 4)];
  wb.addEventListener('change', () => events.push(state())); publish(wb, next);
  expect(events.length).toBeGreaterThan(0); expect(events.every(s => JSON.stringify(s) === '[21,21]')).toBe(true);
  next.archive = 'AAAA'; expect(state()).toEqual([21, 21]);
  events.length = 0; wb.undo(); expect(events.every(s => JSON.stringify(s) === '[1,1]')).toBe(true);
  events.length = 0; wb.redo(); expect(events.every(s => JSON.stringify(s) === '[21,21]')).toBe(true);
});

it('retains direct number overrides when only stored values change', () => {
  const wb = fixture(), id = wb.sheets[0].id;
  wb.setCells(id, [{ r: 5, c: 4, cell: { v: 1, s: { fmt: 'percent', dec: 3, italic: true } } }]);
  publish(wb, model(7n));
  expect(wb.getValue(id, 5, 4)).toBe(21);
  expect(wb.styleAt(id, 5, 4)).toMatchObject({ fmt: 'percent', dec: 3, italic: true });
});
