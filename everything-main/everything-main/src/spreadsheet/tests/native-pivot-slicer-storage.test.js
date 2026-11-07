import { afterAll, beforeAll, expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import { readXlsxSlicers } from '../src/core/xlsx-slicers.js';
import { readNativePivotSlicerState, writeNativePivotSlicerSelection } from '../src/core/native-pivot-slicer-state.js';
import { normalizeNativePivots, moveNativePivotRanges } from '../src/core/native-pivots.js';
import { planNativePivotSlicerSelection } from '../src/core/native-pivot-slicer-report.js';
import { materializeNativePivotReport } from '../src/core/native-pivot-materialize.js';
import { commitNativePivotReports } from '../src/core/native-pivot-commit.js';
import { slicerTableReference, slicerItems, setSlicerSelection, normalizeSlicer } from '../src/core/slicer.js';
import { slicerClipboard, readSlicerClipboard } from '../src/ui/slicer.js';
import { JSDOM } from 'jsdom';
import { chartData } from '../src/core/charts.js';
import { parseModelXml } from '../src/core/data-model-metadata.js';
import { setNativePivotSlicerSelection } from '../src/core/native-pivot-slicer-edit.js';
import { nativePivotSlicerParts } from '../src/core/xlsx-export-slicers.js';

// These tests cover the PivotTable slicer part writer, which is switched off by default until Excel accepts its parts.
beforeAll(() => { nativePivotSlicerParts.enabled = true; });
afterAll(() => { nativePivotSlicerParts.enabled = false; });

const M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const S = 'http://schemas.microsoft.com/office/2007/relationships';
const slicerXml = `<x:slicerCacheDefinition xmlns:x="${X14}" name="Regions" sourceName="Region"><x:pivotTables><x:pivotTable tabId="2" name="First"/><x:pivotTable tabId="3" name="Second"/></x:pivotTables><x:data><x:tabular pivotCacheId="27" showMissing="0"><x:items count="3"><x:i x="1" s="1"/><x:i x="2" s="1" nd="1"/><x:i x="0" s="1"/></x:items></x:tabular></x:data><x:extLst><extra xmlns="urn:extension" keep="yes"/></x:extLst></x:slicerCacheDefinition>`;
function fixture() {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 'Region' }, '0,1': { v: 'Amount' }, '1,0': { v: 'East' }, '1,1': { v: 4 }, '2,0': { v: 'West' }, '2,1': { v: 9 } } }, { name: 'Report A' }, { name: 'Report B' }] });
  for (const sheet of wb.sheets.slice(1)) wb.setCells(sheet.id, [['Region', 'Total'], ['West', 9], ['East', 4], ['Grand Total', 13]].flatMap((row, r) => row.map((v, c) => ({ r: r + 2, c: c + 1, cell: { v } }))));
  const cache = { key: 'source', scope: 'main', sourceSheetId: wb.sheets[0].id, sourceRef: 'A1:B3', xml: `<pivotCacheDefinition xmlns="${M}" recordCount="2"><cacheSource type="worksheet"><worksheetSource sheet="Data" ref="A1:B3"/></cacheSource><cacheFields count="2"><cacheField name="Region"><sharedItems count="3"><s v="East"/><s v="West"/><s v="Unused" u="1"/></sharedItems></cacheField><cacheField name="Amount"/></cacheFields><extLst><ext uri="{725AE2AE-9491-48be-B2B4-4EB974FC3084}"><x:pivotCacheDefinition xmlns:x="${X14}" pivotCacheId="27"/></ext></extLst></pivotCacheDefinition>`, records: `<pivotCacheRecords xmlns="${M}" count="2"><r><x v="0"/><n v="4"/></r><r><x v="1"/><n v="9"/></r></pivotCacheRecords>` };
  const report = (name, owner) => ({ name, owner, cache: cache.key, ref: 'B3:C6', xml: `<pivotTableDefinition xmlns="${M}" name="${name}" cacheId="0" createdVersion="6" preserveFormatting="0"><location ref="B3:C6" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/><pivotFields count="2"><pivotField axis="axisRow" showAll="0"><items count="3"><item x="1"/><item x="0"/><item x="2"/></items></pivotField><pivotField dataField="1"/></pivotFields><rowFields count="1"><field x="0"/></rowFields><dataFields count="1"><dataField fld="1" name="Total"/></dataFields></pivotTableDefinition>` });
  wb.nativePivots = { version: 1, caches: [cache], tables: [report('First', wb.sheets[1].id), report('Second', wb.sheets[2].id)], dxfs: [], styles: [], formats: {}, connections: '' };
  return wb;
}
const get = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path)?.content || new Uint8Array());
function set(zip, path, text) { X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(text)); }
async function archive(wb) { return X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' }); }
function nativeBytes(zip) {
  set(zip, '/xl/workbook.xml', get(zip, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
async function original() {
  const zip = await archive(fixture());
  set(zip, '/xl/workbook.xml', get(zip, '/xl/workbook.xml').replace('</extLst>', `<ext uri="{BBE1A952-AA13-448E-AADC-164F8A28A991}"><x:slicerCaches xmlns:x="${X14}" xmlns:r="${R}"><x:slicerCache r:id="nativeSlicer"/></x:slicerCaches></ext></extLst>`));
  set(zip, '/xl/_rels/workbook.xml.rels', get(zip, '/xl/_rels/workbook.xml.rels').replace('</Relationships>', `<Relationship Id="nativeSlicer" Type="${S}/slicerCache" Target="slicerCaches/regions.xml"/></Relationships>`));
  set(zip, '/xl/slicerCaches/regions.xml', slicerXml);
  set(zip, '/[Content_Types].xml', get(zip, '/[Content_Types].xml').replace('</Types>', '<Override PartName="/xl/slicerCaches/regions.xml" ContentType="application/vnd.ms-excel.slicerCache+xml"/></Types>'));
  return nativeBytes(zip);
}
async function imported() { return workbookFromFile(await original()); }
const state = wb => readNativePivotSlicerState(wb.nativePivots.slicers[0]);
it('retains a referenced pivot slicer cache without views through native-only import and export', async () => {
  let wb = await imported();
  expect(wb.sheets.every(s => !s.charts.length)).toBe(true);
  expect(wb.nativePivots.slicers).toHaveLength(1);
  for (let pass = 0; pass < 2; pass++) {
    expect(state(wb).items).toEqual([{ index: 1, selected: true, noData: false }, { index: 2, selected: true, noData: true }, { index: 0, selected: true, noData: false }]);
    expect(state(wb).showMissing).toBe(false); expect(state(wb).xml).toContain('keep="yes"');
    const zip = await archive(wb), bytes = nativeBytes(zip), native = readXlsxSlicers(X.read(bytes, { type: 'array', bookFiles: true }));
    expect(native.caches[0].pivotCacheId).toBe(27); // distinct from the rebased core cacheId=0
    expect(native.caches[0].pivot.reports.map(p => p.sheet)).toEqual(['Report A', 'Report B']);
    expect(get(zip, '/xl/workbook.xml')).toContain('BBE1A952-AA13-448E-AADC-164F8A28A991');
    expect(get(zip, '/xl/workbook.xml')).toMatch(/<definedName name="Regions">#N\/A<\/definedName>/);
    wb = await workbookFromFile(bytes);
  }
});
it('keeps stable model connections across JSON, sheet rename/reorder, and native sheetId rebasing', async () => {
  let wb = await imported(); wb = new Workbook(wb.toJSON());
  const id = wb.sheetByName('Report B').id;
  wb.renameSheet(id, 'Renamed'); wb.moveSheet(id, 0);
  const plan = planNativePivotSlicerSelection(wb.nativePivots.slicers[0], wb.nativePivots, wb.sheets, [0]);
  expect(plan.reports.map(r => r.pivot.owner)).toEqual([wb.sheetByName('Report A').id, id]);
  const bytes = nativeBytes(await archive(wb)), native = readXlsxSlicers(X.read(bytes, { type: 'array', bookFiles: true }));
  expect(native.caches[0].pivotTables.map(r => r.tabId)).toEqual([3, 1]);
  expect(native.caches[0].pivot.reports.map(r => r.sheet)).toEqual(['Report A', 'Renamed']);
  wb = await workbookFromFile(bytes);
  expect(wb.nativePivots.slicers[0].connections.map(r => r.owner)).toEqual([wb.sheetByName('Report A').id, wb.sheetByName('Renamed').id]);
});
it('preserves a cache with no saved item list without inventing a selected list', async () => {
  let wb = await imported();
  wb.nativePivots.slicers[0].xml = wb.nativePivots.slicers[0].xml.replace(/<x:items\b.*?<\/x:items>/, '');
  for (let pass = 0; pass < 2; pass++) {
    wb = await workbookFromFile(nativeBytes(await archive(wb)));
    expect(readNativePivotSlicerState(wb.nativePivots.slicers[0], { requireItems: false }).items).toBeNull();
    expect(() => state(wb)).toThrow(/items are unavailable/);
  }
});
it('honors external deletion of the native cache list even with a private sidecar present', async () => {
  const wb = await imported(), zip = await archive(wb);
  set(zip, '/xl/workbook.xml', get(zip, '/xl/workbook.xml').replace(/<x14:slicerCaches\b.*?<\/x14:slicerCaches>/, ''));
  const loaded = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
  expect(loaded.nativePivots.slicers).toBeUndefined();
});
it('removes deleted report connections and restores them through structural undo', async () => {
  const wb = await imported(), before = wb.toJSON();
  wb.deleteSheet(wb.sheetByName('Report B').id);
  expect(wb.nativePivots.slicers[0].connections.map(r => r.name)).toEqual(['First']);
  const reloaded = await workbookFromFile(nativeBytes(await archive(wb)));
  expect(reloaded.nativePivots.slicers[0].connections.map(r => r.name)).toEqual(['First']);
  wb.undo(); expect(wb.toJSON()).toEqual(before);
});
it('follows a complete report moved between worksheets without joining other reports', async () => {
  const wb = await imported(), source = wb.sheetByName('Report A').id, target = wb.sheets[0].id;
  wb.nativePivots = moveNativePivotRanges(wb.nativePivots, source, { r1: 2, c1: 1, r2: 5, c2: 2 }, target, { r1: 7, c1: 4, r2: 10, c2: 5 });
  expect(wb.nativePivots.slicers[0].connections[0]).toEqual({ owner: target, name: 'First' });
  const next = await workbookFromFile(nativeBytes(await archive(wb)));
  expect(next.nativePivots.slicers[0].connections[0].owner).toBe(next.sheetByName('Data').id);
});
it.each(['cache', 'connection', 'duplicate', 'xml'])('rejects invalid stored bindings instead of dropping their native content: %s', problem => {
  const wb = fixture();
  wb.nativePivots.slicers = [{ kind: 'pivot', xml: slicerXml, cache: 'source', connections: wb.nativePivots.tables.map(p => ({ owner: p.owner, name: p.name })) }];
  if (problem === 'cache') wb.nativePivots.slicers[0].cache = 'missing';
  if (problem === 'connection') wb.nativePivots.slicers[0].connections[0].name = 'missing';
  if (problem === 'duplicate') wb.nativePivots.slicers.push(wb.nativePivots.slicers[0]);
  if (problem === 'xml') wb.nativePivots.slicers[0].xml = '<foreign/>';
  expect(normalizeNativePivots(wb.nativePivots)).toBeNull();
});
function selectionPlan(wb, items) {
  const slicer = wb.nativePivots.slicers[0];
  const result = planNativePivotSlicerSelection(slicer, wb.nativePivots, wb.sheets, items, {
    slicerCaches: wb.nativePivots.slicers,
    reportOptions: new Map(wb.nativePivots.tables.map(p => [p, { paintContext: { numberFormats: wb.nativePivots.formats } }])),
  });
  const updates = result.reports.map(({ pivot, cache, plan }) => ({ pivot, cache, next: plan.pivot, cells: materializeNativePivotReport(wb, pivot, plan) }));
  return { updates, slicerUpdates: new Map([[slicer, result.slicer]]) };
}
it('commits shared selected flags and all connected reports atomically through native export and undo/redo', async () => {
  let wb = await imported();
  const before = wb.toJSON(), prepared = selectionPlan(wb, [0]);
  expect(commitNativePivotReports(wb, prepared.updates, prepared)).toBe(true);
  const after = wb.toJSON();
  const supplied = prepared.slicerUpdates.values().next().value;
  supplied.connections[0].name = 'Mutated input'; supplied.xml = '<foreign/>';
  expect(wb.toJSON()).toEqual(after);
  expect(wb.undoLabels()).toEqual(['Refresh pivot reports']);
  for (const sheet of wb.sheets.slice(1)) expect(wb.getValue(sheet.id, 4, 2)).toBe(4);
  wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
  wb = await workbookFromFile(nativeBytes(await archive(wb)));
  expect(state(wb).items.filter(i => i.selected).map(i => i.index)).toEqual([0]);
  expect(state(wb).items.map(i => i.index)).toEqual([1, 2, 0]);
  expect(state(wb).xml).toContain('keep="yes"');
  expect(planNativePivotSlicerSelection(wb.nativePivots.slicers[0], wb.nativePivots, wb.sheets, [0]).reports.every(r => r.plan.cells.find(c => c.r === 4 && c.c === 2).value === 4)).toBe(true);
});
it.each(['missing report', 'stale cache', 'identity', 'member', 'protected report'])('rejects a shared cache/report batch before any writes: %s', async problem => {
  const wb = await imported(), prepared = selectionPlan(wb, [0]);
  if (problem === 'missing report') prepared.updates.pop();
  if (problem === 'stale cache') prepared.slicerUpdates = new Map([[{ ...wb.nativePivots.slicers[0] }, prepared.slicerUpdates.values().next().value]]);
  if (problem === 'identity') prepared.slicerUpdates.values().next().value.xml = prepared.slicerUpdates.values().next().value.xml.replace('name="Regions"', 'name="Other"');
  if (problem === 'member') prepared.slicerUpdates.values().next().value.xml = prepared.slicerUpdates.values().next().value.xml.replace('x="0"', 'x="99"');
  if (problem === 'protected report') wb.sheets[2].protected = true;
  const before = wb.toJSON();
  expect(() => commitNativePivotReports(wb, prepared.updates, prepared)).toThrow();
  expect(wb.toJSON()).toEqual(before); expect(wb.undoLabels()).toEqual([]);
});
it('allows an unconnected cache selection to change without inventing report cells', async () => {
  const wb = await imported();
  wb.deleteSheet(wb.sheetByName('Report B').id); wb.deleteSheet(wb.sheetByName('Report A').id); wb.clearHistory();
  const cache = wb.nativePivots.slicers[0], before = wb.toJSON();
  expect(commitNativePivotReports(wb, [], { slicerUpdates: new Map([[cache, writeNativePivotSlicerSelection(cache, [1])]]) })).toBe(true);
  expect(state(wb).items.filter(i => i.selected).map(i => i.index)).toEqual([1]);
  wb.undo(); expect(wb.toJSON()).toEqual(before);
});
it('exports native pivot caches alongside table slicers with separate identities and extension lists', async () => {
  const wb = await imported(), source = wb.sheets[0], owner = wb.sheets[1];
  const uid = '{01234567-89AB-CDEF-0123-456789ABCDEF}', ns = 'http://schemas.microsoft.com/office/spreadsheetml/2016/revision10';
  wb.nativePivots.slicers[0].xml = wb.nativePivots.slicers[0].xml.replace('name="Regions"', `xmlns:rev="${ns}" rev:uid="${uid}" name="Regions"`);
  const tableId = wb.addTable(source.id, { r1: 0, c1: 0, r2: 2, c2: 1 });
  const table = source.tables.find(t => t.id === tableId);
  wb.addChart(owner.id, { type: 'slicer', anchor: { r: 10, c: 4 }, tableRef: slicerTableReference(table.name, 'Region'),
    nativeCacheName: 'Regions', paint: { frame: { wholeTable: { bg: '#ddeeff' } }, items: {} } });
  const zip = await archive(wb), bytes = nativeBytes(zip), native = readXlsxSlicers(X.read(bytes, { type: 'array', bookFiles: true }));
  expect(native.caches.map(c => c.kind)).toEqual(['table', 'pivot']);
  expect(new Set(native.caches.map(c => c.name)).size).toBe(2);
  const uids = native.caches.map(c => parseModelXml(c.xml).getAttributeNS(ns, 'uid'));
  expect(uids.every(Boolean)).toBe(true); expect(new Set(uids).size).toBe(2); expect(uids[1]).toBe(uid);
  expect(parseModelXml(native.caches[1].xml).getAttributeNodeNS(ns, 'uid').name).toBe('rev:uid');
  expect(native.caches[0].xml).toContain('mc:Ignorable="xr10"');
  expect(get(zip, '/xl/workbook.xml')).toContain('46BE6895-7355-4a93-B00E-2C351335B9C9');
  expect(get(zip, '/xl/workbook.xml')).toContain('BBE1A952-AA13-448E-AADC-164F8A28A991');
  const loaded = await workbookFromFile(bytes);
  expect(loaded.nativePivots.slicers).toHaveLength(1);
  expect(loaded.sheets.flatMap(s => s.charts).filter(c => c.type === 'slicer')).toHaveLength(1);
});
it('retains non-worksheet report connections independently of worksheet tabIds', async () => {
  const wb = await imported(), first = wb.nativePivots.tables[0];
  wb.nativePivots.tables.push({ ...first, name: 'Standalone', owner: null, xml: first.xml.replace('name="First"', 'name="Standalone"') });
  wb.nativePivots.slicers[0].connections.push({ owner: null, name: 'Standalone' });
  const next = await workbookFromFile(nativeBytes(await archive(wb)));
  expect(next.nativePivots.slicers[0].connections.at(-1)).toEqual({ owner: null, name: 'Standalone' });
  expect(readNativePivotSlicerState(next.nativePivots.slicers[0]).pivotTables.at(-1)).toEqual({ tabId: 0, name: 'Standalone' });
});
it('allocates a UID for another native cache and keeps its new namespace ignorable', async () => {
  const wb = await imported(), cache = wb.nativePivots.slicers[0];
  const ns = 'http://schemas.microsoft.com/office/spreadsheetml/2016/revision10';
  const uid = '{01234567-89AB-CDEF-0123-456789ABCDEF}';
  const other = { ...cache, name: 'OtherRegions', xml: cache.xml.replace('name="Regions"', 'name="OtherRegions"') };
  cache.xml = cache.xml.replace('name="Regions"', `xmlns:rev="${ns}" rev:uid="${uid}" name="Regions"`);
  wb.nativePivots.slicers.push(other);
  const loaded = await workbookFromFile(nativeBytes(await archive(wb)));
  const roots = loaded.nativePivots.slicers.map(c => parseModelXml(c.xml));
  expect(roots[0].getAttributeNS(ns, 'uid')).toBe(uid);
  expect(roots[1].getAttributeNS(ns, 'uid')).toBeTruthy();
  expect(roots[1].getAttributeNS(ns, 'uid')).not.toBe(uid);
  expect(roots[1].getAttributeNS('http://schemas.openxmlformats.org/markup-compatibility/2006', 'Ignorable')).toContain('xr10');
});
it('refuses duplicate native UIDs without modifying the workbook', async () => {
  const wb = await imported(), cache = wb.nativePivots.slicers[0];
  cache.xml = cache.xml.replace('name="Regions"', 'xmlns:rev="http://schemas.microsoft.com/office/spreadsheetml/2016/revision10" rev:uid="{01234567-89AB-CDEF-0123-456789ABCDEF}" name="Regions"');
  wb.nativePivots.slicers.push({ ...cache, name: 'OtherRegions', xml: cache.xml.replace('name="Regions"', 'name="OtherRegions"') });
  const before = wb.toJSON(); await expect(archive(wb)).rejects.toThrow(/duplicate slicer cache UID/);
  expect(wb.toJSON()).toEqual(before);
});

function withConditionalRules(wb) {
  for (const [index, pivot] of wb.nativePivots.tables.entries()) {
    const token = `pivot-rule-${index}`, sheet = wb.sheet(pivot.owner);
    pivot.conditionalRules = [{ priority: 7, id: token }];
    pivot.xml = pivot.xml.replace('</pivotTableDefinition>', '<conditionalFormats count="1"><conditionalFormat scope="data" priority="7"><pivotAreas count="1"><pivotArea type="data"/></pivotAreas></conditionalFormat></conditionalFormats></pivotTableDefinition>');
    const base = { type: 'gt', value: 0, range: { r1: 3, c1: 2, r2: 5, c2: 2 }, style: { color: '#ff0000' } };
    sheet.rules = [{ ...base, id: 'before', range: { r1: 0, c1: 9, r2: 5, c2: 9 } },
      { ...base, id: 'managed', pivot: true, pivotRuleIds: [token] },
      { ...base, id: 'after', range: { r1: 0, c1: 10, r2: 5, c2: 10 } }];
  }
  return wb;
}
it('coordinates live worksheet rules and all shared reports without replacing unrelated rules', async () => {
  let wb = withConditionalRules(await imported());
  const before = wb.toJSON();
  expect(setNativePivotSlicerSelection(wb, wb.nativePivots.slicers[0], [0])).toBe(true);
  for (const pivot of wb.nativePivots.tables) {
    const sheet = wb.sheet(pivot.owner), previous = before.sheets.find(s => s.id === pivot.owner);
    expect(sheet.rules.map(r => r.id)).toEqual(['before', 'managed', 'after']);
    expect(sheet.rules[0]).toEqual(previous.rules[0]); expect(sheet.rules[2]).toEqual(previous.rules[2]);
    expect(sheet.rules[1].range).toEqual({ r1: 3, c1: 2, r2: 4, c2: 2 });
    expect(wb.getValue(sheet.id, 4, 2)).toBe(4);
  }
  const selected = wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(selected);
  wb = await workbookFromFile(nativeBytes(await archive(wb)));
  expect(setNativePivotSlicerSelection(wb, wb.nativePivots.slicers[0], null)).toBe(true);
  for (const pivot of wb.nativePivots.tables) {
    const sheet = wb.sheet(pivot.owner);
    expect(sheet.rules.filter(r => r.pivotRuleIds?.length)[0].range).toEqual({ r1: 3, c1: 2, r2: 5, c2: 2 });
    expect(sheet.rules).toHaveLength(3); expect(wb.getValue(sheet.id, 5, 2)).toBe(13);
  }
});
it('uses current edited conditional rules and respects their explicit deletion', async () => {
  const wb = withConditionalRules(await imported());
  const first = wb.sheet(wb.nativePivots.tables[0].owner), second = wb.sheet(wb.nativePivots.tables[1].owner);
  first.rules[1].style = { color: '#123456' }; second.rules.splice(1, 1);
  setNativePivotSlicerSelection(wb, wb.nativePivots.slicers[0], [1]);
  expect(first.rules[1].style).toEqual({ color: '#123456' }); expect(second.rules.map(r => r.id)).toEqual(['before', 'after']);
});
it('restores a stale saved no-data flag instead of refusing the choice', async () => {
  const wb = withConditionalRules(await imported());
  const slicer = wb.nativePivots.slicers[0];
  slicer.xml = slicer.xml.replace(' nd="1"', '');
  expect(setNativePivotSlicerSelection(wb, slicer, [0])).toBe(true);
  expect(wb.nativePivots.slicers[0].xml).toContain(' nd="1"');
});
it.each(['protected', 'overlap', 'preserved', 'budget', 'shared-rule', 'stale'])('refuses an incomplete coordinated edit before any mutation: %s', async problem => {
  const wb = withConditionalRules(await imported());
  let slicer = wb.nativePivots.slicers[0];
  const last = wb.nativePivots.tables[1];
  if (problem === 'protected') wb.sheet(last.owner).protected = true;
  if (problem === 'overlap') wb.setCells(last.owner, [{ r: 6, c: 2, cell: { v: 'occupied' } }]);
  if (problem === 'preserved') last.xml = last.xml.replace('preserveFormatting="0"', 'preserveFormatting="1"');
  if (problem === 'availability') slicer.xml = slicer.xml.replace(' nd="1"', '');
  if (problem === 'shared-rule') wb.sheet(last.owner).rules[1].pivotRuleIds.push('another-report');
  if (problem === 'stale') slicer = structuredClone(slicer);
  // Selecting the unused member with showAll enabled grows the report past its saved body.
  if (problem === 'overlap') for (const p of wb.nativePivots.tables) p.xml = p.xml.replace('showAll="0"', 'showAll="1"');
  const before = wb.toJSON(), version = wb.version;
  const error = { protected: /protect/, overlap: /occupied|overlap/, preserved: /preserved-format/, budget: /limit/, availability: /availability update/, 'shared-rule': /shared with another/, stale: /stale shared cache/ }[problem];
  expect(() => setNativePivotSlicerSelection(wb, slicer, problem === 'overlap' ? null : [0], problem === 'budget' ? { maxCells: 1 } : {})).toThrow(error);
  expect(wb.toJSON()).toEqual(before); expect(wb.version).toBe(version);
});
it('ignores unrelated unsupported caches while coordinating the affected connections', async () => {
  const wb = await imported();
  wb.nativePivots.slicers.push({ ...wb.nativePivots.slicers[0], name: 'Unconnected', connections: [], xml: slicerXml.replace('name="Regions"', 'name="Unconnected"').replace(/<x:items.*?<\/x:items>/, '') });
  const other = structuredClone(wb.nativePivots.slicers[1]);
  setNativePivotSlicerSelection(wb, wb.nativePivots.slicers[0], [0]);
  expect(wb.nativePivots.slicers[1]).toEqual(other);
});
it('merges two connected report rule plans on one sheet in their existing priority order', async () => {
  const wb = withConditionalRules(await imported());
  const [first, second] = wb.nativePivots.tables, sheet = wb.sheet(first.owner);
  const copied = { ...wb.sheet(second.owner).rules[1], id: 'second', range: { r1: 3, c1: 6, r2: 5, c2: 6 } };
  sheet.rules.splice(1, 0, copied);
  wb.nativePivots = moveNativePivotRanges(wb.nativePivots, second.owner, { r1: 2, c1: 1, r2: 5, c2: 2 }, first.owner, { r1: 2, c1: 5, r2: 5, c2: 6 });
  const before = wb.toJSON();
  setNativePivotSlicerSelection(wb, wb.nativePivots.slicers[0], [1]);
  expect(sheet.rules.map(r => r.id)).toEqual(['before', 'second', 'managed', 'after']);
  expect(sheet.rules[1].range).toEqual({ r1: 3, c1: 6, r2: 4, c2: 6 });
  expect(sheet.rules[2].range).toEqual({ r1: 3, c1: 2, r2: 4, c2: 2 });
  expect(wb.getValue(sheet.id, 4, 6)).toBe(9); expect(wb.getValue(sheet.id, 4, 2)).toBe(9);
  wb.undo(); expect(wb.toJSON()).toEqual(before);
});
it('budgets vacated cells across the whole batch as well as newly materialized bodies', async () => {
  const wb = await imported(), before = wb.toJSON();
  // Two 3x2 filtered bodies fit in twelve cells, but clearing both old last rows does not.
  expect(() => setNativePivotSlicerSelection(wb, wb.nativePivots.slicers[0], [0], { maxCells: 12 })).toThrow(/cell limit/);
  expect(wb.toJSON()).toEqual(before);
  expect(() => setNativePivotSlicerSelection(wb, wb.nativePivots.slicers[0], [0], { maxAvailabilityWork: 0 })).toThrow(/availability work limit/);
  expect(wb.toJSON()).toEqual(before);
});
it('retains effective built-in pivot formats across JSON persistence and unrelated format-table changes', async () => {
  const zip = X.CFB.read(await original(), { type: 'array' });
  for (const path of zip.FullPaths.filter(path => /\/pivotTables\/pivotTable\d+\.xml$/.test(path))) {
    set(zip, path, get(zip, path).replace('<dataField fld="1"', '<dataField numFmtId="2" fld="1"'));
  }
  let wb = await workbookFromFile(nativeBytes(zip));
  expect(wb.nativePivots.formats[2]).toBe('0.00');
  wb = new Workbook(wb.toJSON());
  const old = X.SSF.get_table()[2];
  try {
    X.SSF.load('"unrelated workbook"', 2);
    setNativePivotSlicerSelection(wb, wb.nativePivots.slicers[0], [1]);
    for (const pivot of wb.nativePivots.tables) expect(wb.getCell(pivot.owner, 3, 2).s).toMatchObject({ fmt: 'custom', code: '0.00' });
  } finally { X.SSF.load(old, 2); }
});

const viewPaint = { frame: { wholeTable: { bg: '#ddeeff' }, headerRow: { bold: true } }, items: { selectedItemWithData: { bg: '#bbdddd' } } };
function addPivotView(wb, owner = wb.sheets[1].id) {
  const id = wb.addChart(owner, { type: 'slicer', pivotCache: wb.nativePivots.slicers[0].name, anchor: { r: 9, c: 3 }, title: 'Regions',
    w: 240, h: 190, columnCount: 2, rowHeight: 200000, paint: viewPaint });
  return wb.chartById(owner, id);
}
it('imports and exports live native views with shared member identities, controls and undo', async () => {
  let wb = await imported();
  const first = addPivotView(wb), second = addPivotView(wb, wb.sheets[2].id);
  expect(slicerItems(wb, first).map(i => [i.key, i.value, i.hidden])).toEqual([[1, 'West', false], [2, 'Unused', true], [0, 'East', false]]);
  const before = wb.toJSON();
  setSlicerSelection(wb, wb.sheets[1].id, first.id, [0]);
  expect(slicerItems(wb, second).filter(i => i.selected).map(i => i.key)).toEqual([0]);
  wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo();
  for (let pass = 0; pass < 2; pass++) {
    const zip = await archive(wb), native = readXlsxSlicers(X.read(nativeBytes(zip), { type: 'array', bookFiles: true }));
    expect(native.views).toHaveLength(2); expect(native.views.every(v => v.drawing)).toBe(true);
    expect(get(zip, '/xl/worksheets/sheet2.xml')).toContain('A8765BA9-456A-4dab-B4F3-ACF838C121DE');
    expect(get(zip, '/xl/drawings/drawing2.xml')).toContain('Requires="a14"');
    wb = await workbookFromFile(nativeBytes(zip));
    const controls = wb.sheets.flatMap(s => s.charts.filter(c => c.type === 'slicer'));
    expect(controls).toHaveLength(2);
    for (const control of controls) {
      expect(control).toMatchObject({ pivotCache: 'Regions', paint: viewPaint, columnCount: 2, rowHeight: 200000 });
      expect(slicerItems(wb, control).filter(i => i.selected).map(i => i.key)).toEqual([0]);
    }
  }
  const owner = wb.sheets[1], control = owner.charts.find(c => c.type === 'slicer');
  setSlicerSelection(wb, owner.id, control.id, null);
  expect(wb.getValue(owner.id, 5, 2)).toBe(13);
});
it('keeps table and pivot views in their respective worksheet extension parts', async () => {
  const wb = await imported(), owner = wb.sheets[0]; addPivotView(wb, owner.id);
  wb.addTable(owner.id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'Orders' });
  wb.addChart(owner.id, { type: 'slicer', tableRef: 'Orders[Region]', anchor: { r: 8, c: 7 }, nativeCacheName: 'Regions', paint: viewPaint });
  const zip = await archive(wb), xml = get(zip, '/xl/worksheets/sheet1.xml');
  expect(xml).toContain('A8765BA9-456A-4dab-B4F3-ACF838C121DE'); expect(xml).toContain('3A4CF648-6AED-40f4-86FF-DC5316D8AED3');
  const reloaded = await workbookFromFile(nativeBytes(zip));
  expect(reloaded.sheets[0].charts.filter(c => c.type === 'slicer')).toHaveLength(2);
  const pivot = reloaded.sheets[0].charts.find(c => c.pivotCache);
  expect(slicerItems(reloaded, pivot).map(i => i.key)).toEqual([1, 2, 0]);
});
it('distinguishes native member keys from duplicate captions and formats numeric zero', async () => {
  let wb = await imported();
  wb.nativePivots.caches[0].xml = wb.nativePivots.caches[0].xml.replace('<cacheField name="Region">', '<cacheField name="Region" numFmtId="2">').replace('<s v="East"/>', '<n v="0"/>').replace('<s v="West"/>', '<n v="2"/>');
  wb.nativePivots.formats[2] = '0.00';
  const control = addPivotView(wb);
  expect(slicerItems(wb, control).map(i => i.value)).toEqual(['2.00', 'Unused', '0.00']);
  const json = wb.toJSON(); json.nativePivots.caches[0].xml = json.nativePivots.caches[0].xml.replace('<n v="0"/>', '<n v="0" c="Same"/>').replace('<n v="2"/>', '<n v="2" c="Same"/>');
  wb = new Workbook(json);
  expect(slicerItems(wb, control).map(i => [i.key, i.value])).toEqual([[1, 'Same'], [2, 'Unused'], [0, 'Same']]);
  setSlicerSelection(wb, wb.sheets[1].id, control.id, [0]);
  expect(wb.getValue(wb.sheets[1].id, 4, 2)).toBe(4);
});
it('shares duplicated and pasted views inside one workbook without binding foreign cache names', async () => {
  const wb = await imported(), owner = wb.sheets[1], control = addPivotView(wb), doc = new JSDOM('<body/>').window.document;
  const copy = wb.duplicateChart(owner.id, control.id);
  const clipboard = slicerClipboard(doc, control, slicerItems(wb, control), wb);
  const pasted = readSlicerClipboard(doc, clipboard.html, wb);
  expect(pasted.pivotCache).toBe(control.pivotCache); expect(clipboard.text).toBe('West\nUnused\nEast');
  const id = wb.addChart(owner.id, pasted); expect(id).toBeTruthy();
  setSlicerSelection(wb, owner.id, copy, [1]);
  expect(slicerItems(wb, wb.chartById(owner.id, id)).filter(i => i.selected).map(i => i.key)).toEqual([1]);
  const other = await imported();
  expect(readSlicerClipboard(doc, clipboard.html, other)).toBeNull();
  expect(readSlicerClipboard(doc, clipboard.html)).toBeNull();
  expect(normalizeSlicer({ ...control, tableRef: 'Orders[Region]' })).toBeNull();
});
it('derives hide-no-data independently when native cross-filter paint is disabled', async () => {
  const wb = await imported(), cache = wb.nativePivots.slicers[0];
  cache.xml = cache.xml.replace('showMissing="0"', 'showMissing="1" crossFilter="none"').replace(' nd="1"', '').replace('<x:extLst>', '<x:extLst><m:ext xmlns:m="http://schemas.openxmlformats.org/spreadsheetml/2006/main" uri="{470722E0-AACD-4C17-9CDC-17EF765DBC7E}"><y:slicerCacheHideItemsWithNoData xmlns:y="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"/></m:ext>');
  const control = addPivotView(wb), items = slicerItems(wb, control);
  expect(items.every(i => i.available)).toBe(true); expect(items.find(i => i.key === 2).hidden).toBe(true);
  setSlicerSelection(wb, wb.sheets[1].id, control.id, [0]);
  expect(slicerItems(wb, control).find(i => i.key === 2).hidden).toBe(true);
});
it('keeps a known built-in-range code through export and a later native slicer refresh', async () => {
  let wb = await imported();
  wb.nativePivots.formats[6] = '"units "0.00';
  for (const pivot of wb.nativePivots.tables) pivot.xml = pivot.xml.replace('<dataField fld="1"', '<dataField numFmtId="6" fld="1"');
  addPivotView(wb);
  wb = await workbookFromFile(nativeBytes(await archive(wb)));
  const owner = wb.sheets[1], view = owner.charts.find(c => c.type === 'slicer');
  setSlicerSelection(wb, owner.id, view.id, [1]);
  expect(wb.getCell(owner.id, 3, 2).s.code).toBe('"units "0.00');
});
it('uses the same normalized native cache identity in controls and export', async () => {
  const wb = await imported(), cache = wb.nativePivots.slicers[0];
  cache.name = 'Régions'; cache.xml = cache.xml.replace('name="Regions"', 'name="Régions"');
  const control = addPivotView(wb); wb.updateChart(wb.sheets[1].id, control.id, { pivotCache: 'RE\u0301GIONS' });
  const edited = wb.chartById(wb.sheets[1].id, control.id);
  expect(slicerItems(wb, edited)).toHaveLength(3);
  const reloaded = await workbookFromFile(nativeBytes(await archive(wb)));
  expect(slicerItems(reloaded, reloaded.sheets[1].charts[0])).toHaveLength(3);
});

it.each([true, false])('retains connected reports when duplicating a sheet, with local views: %s', async localView => {
  let wb = await imported();
  const source = wb.sheets[1], control = addPivotView(wb, localView ? source.id : wb.sheets[0].id);
  const before = wb.toJSON(), previous = wb.nativePivots;
  const copy = wb.duplicateSheet(source.id);
  expect(previous.slicers[0].connections).toHaveLength(2);
  expect(wb.nativePivots.slicers[0].connections).toHaveLength(3);
  expect(wb.nativePivots.caches).toHaveLength(1);
  const copied = wb.toJSON();
  wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(copied);
  const owner = localView ? wb.sheet(copy.id) : wb.sheets[0];
  const view = owner.charts.find(c => c.type === 'slicer');
  expect(view.pivotCache).toBe(control.pivotCache);
  setSlicerSelection(wb, owner.id, view.id, [0]);
  for (const report of wb.nativePivots.tables) {
    expect(report.ref).toBe('B3:C5');
    expect(wb.getValue(report.owner, 4, 2)).toBe(4);
  }
  const selected = wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(copied); wb.redo(); expect(wb.toJSON()).toEqual(selected);
  for (let pass = 0; pass < 2; pass++) {
    wb = await workbookFromFile(nativeBytes(await archive(wb)));
    expect(wb.nativePivots.slicers[0].connections).toHaveLength(3);
    expect(new Set(wb.nativePivots.slicers[0].connections.map(c => c.name)).size).toBe(3);
  }
  setNativePivotSlicerSelection(wb, wb.nativePivots.slicers[0], null);
  for (const report of wb.nativePivots.tables) expect(wb.getValue(report.owner, 5, 2)).toBe(13);
});
it('does not connect duplicated reports merely because they share the source cache', async () => {
  const wb = await imported();
  wb.nativePivots.slicers[0].connections = wb.nativePivots.slicers[0].connections.slice(0, 1);
  const source = wb.sheets[2], view = addPivotView(wb, source.id);
  const copy = wb.duplicateSheet(source.id);
  expect(wb.nativePivots.slicers[0].connections).toHaveLength(1);
  setSlicerSelection(wb, copy.id, copy.charts.find(c => c.type === 'slicer').id, [0]);
  expect(wb.getValue(wb.sheets[1].id, 4, 2)).toBe(4);
  expect(wb.getValue(source.id, 5, 2)).toBe(13);
  expect(wb.getValue(copy.id, 5, 2)).toBe(13);
  expect(slicerItems(wb, view).filter(i => i.selected).map(i => i.key)).toEqual([0]);
});

it('imports complete native pivot graphs without joining colliding destination identities', async () => {
  const source = await imported(), destination = await imported();
  addPivotView(source); addPivotView(destination);
  const sourceBefore = source.toJSON(), before = destination.toJSON();
  const added = destination.importSheets(source), copied = destination.toJSON();
  expect(destination.nativePivots.caches).toHaveLength(2);
  expect(new Set(destination.nativePivots.caches.map(c => c.key)).size).toBe(2);
  expect(destination.nativePivots.slicers.map(s => s.name)).toEqual(['Regions', 'Regions_2']);
  const owner = added[1], view = owner.charts.find(c => c.type === 'slicer');
  expect(view.pivotCache).toBe('Regions_2');
  setSlicerSelection(destination, owner.id, view.id, [0]);
  for (const sheet of added.slice(1)) expect(destination.getValue(sheet.id, 4, 2)).toBe(4);
  for (const sheet of destination.sheets.slice(1, 3)) expect(destination.getValue(sheet.id, 5, 2)).toBe(13);
  destination.undo(); expect(destination.toJSON()).toEqual(copied);
  destination.undo(); expect(destination.toJSON()).toEqual(before); destination.redo(); expect(destination.toJSON()).toEqual(copied);
  expect(source.toJSON()).toEqual(sourceBefore);
  let reopened = destination;
  for (let i = 0; i < 2; i++) reopened = await workbookFromFile(nativeBytes(await archive(reopened)));
  expect(reopened.nativePivots.caches).toHaveLength(2);
  const controlSheet = reopened.sheetByName(owner.name);
  setSlicerSelection(reopened, controlSheet.id, controlSheet.charts.find(c => c.type === 'slicer').id, [1]);
  expect(reopened.getValue(controlSheet.id, 4, 2)).toBe(9);
  expect(reopened.getValue(reopened.sheetByName('Report A').id, 5, 2)).toBe(13);
});
it('rewrites imported table source names after destination table-name allocation', async () => {
  const source = await imported(), destination = new Workbook();
  source.addTable(source.sheets[0].id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'Orders' });
  destination.setInput(destination.activeSheetId, 0, 0, 'Existing');
  destination.addTable(destination.activeSheetId, { r1: 0, c1: 0, r2: 1, c2: 0 }, { name: 'Orders' });
  source.nativePivots.caches[0].xml = source.nativePivots.caches[0].xml.replace(/<worksheetSource[^>]*\/>/, '<worksheetSource name="Orders"/>');
  source.nativePivots.caches[0].sourceSheetId = null; source.nativePivots.caches[0].sourceRef = '';
  const added = destination.importSheets(source);
  expect(destination.nativePivots.caches[0].xml).toContain('name="Orders2"');
  expect(added[0].tables[0].name).toBe('Orders2');
  const reopened = await workbookFromFile(nativeBytes(await archive(destination)));
  expect(reopened.nativePivots.caches[0].xml).toContain('name="Orders2"');
});
it('rebases pivot formats and custom style colors against a different destination', async () => {
  const source = await imported(), destination = await imported();
  source.nativePivots.formats = { 190: '0.000" source"' };
  destination.nativePivots.formats = { 190: '0.0" destination"' };
  source.nativePivots.tables.forEach(p => { p.xml = p.xml.replace('<dataField ', '<dataField numFmtId="190" ').replace('</pivotTableDefinition>', '<pivotTableStyleInfo name="Custom"/></pivotTableDefinition>'); });
  source.nativePivots.dxfs = [`<dxf xmlns="${M}"><font><color theme="4"/></font></dxf>`];
  source.nativePivots.styles = [{ name: 'Custom', xml: `<tableStyle xmlns="${M}" name="Custom" count="1"><tableStyleElement type="wholeTable" dxfId="0"/></tableStyle>` }];
  destination.nativePivots.dxfs = [`<dxf xmlns="${M}"><font><color rgb="FFabcdef"/></font></dxf>`];
  destination.nativePivots.styles = [...source.nativePivots.styles];
  source.colorPalette = { theme: ['#ffffff', '#000000', '#ffffff', '#000000', '#123456'] };
  addPivotView(source);
  const added = destination.importSheets(source), p = destination.nativePivots.tables.find(p => p.owner === added[1].id);
  const id = Number(parseModelXml(p.xml).getElementsByTagNameNS(M, 'dataField')[0].getAttribute('numFmtId'));
  expect(destination.nativePivots.formats[id]).toBe('0.000" source"'); expect(id).not.toBe(190);
  expect(destination.nativePivots.styles.map(s => s.name)).toEqual(['Custom', 'Custom_2']);
  expect(destination.nativePivots.dxfs[1]).toContain('rgb="FF123456"');
  setSlicerSelection(destination, added[1].id, added[1].charts.find(c => c.type === 'slicer').id, [0]);
  expect(destination.getCell(added[1].id, 4, 2).s).toMatchObject({ code: '0.000" source"', color: '#123456' });
});
it('rejects unresolved graph dependencies before importing any sheets', async () => {
  const source = await imported(), destination = await imported(), before = destination.toJSON();
  source.nativePivots.connections = `<connections xmlns="${M}"><connection id="1" name="Outside"/></connections>`;
  expect(() => destination.importSheets(source)).toThrow(/external connection transfer/);
  expect(destination.toJSON()).toEqual(before);
});

it('gives imported conditional-rule bindings independent identities and keeps their current styles', async () => {
  const source = withConditionalRules(await imported()); addPivotView(source);
  const destination = new Workbook(source.toJSON()), before = destination.toJSON();
  const oldIds = new Set(destination.nativePivots.tables.flatMap(p => p.conditionalRules.map(r => r.id)));
  const added = destination.importSheets(source);
  for (const report of destination.nativePivots.tables.filter(p => added.some(s => s.id === p.owner))) {
    expect(report.conditionalRules.every(rule => !oldIds.has(rule.id))).toBe(true);
    expect(destination.sheet(report.owner).rules[1].pivotRuleIds).toEqual(report.conditionalRules.map(r => r.id));
  }
  setSlicerSelection(destination, added[1].id, added[1].charts.find(c => c.type === 'slicer').id, [0]);
  expect(destination.sheet(added[1].id).rules[1].range).toEqual({ r1: 3, c1: 2, r2: 4, c2: 2 });
  expect(destination.toJSON().sheets.slice(0, 3)).toEqual(before.sheets);
  const reopened = await workbookFromFile(nativeBytes(await archive(destination)));
  const sheet = reopened.sheetByName(added[1].name); setSlicerSelection(reopened, sheet.id, sheet.charts.find(c => c.type === 'slicer').id, null);
  expect(sheet.rules.find(r => r.pivotRuleIds?.length).range.r2).toBe(5);
});
it('retargets worksheet PivotCharts to imported report names after collisions', async () => {
  const source = await imported(), destination = new Workbook(source.toJSON());
  source.sheets[1].charts.push({ id: 'chart', type: 'column', range: { r1: 2, c1: 1, r2: 5, c2: 2 }, anchor: { r: 10, c: 1 },
    w: 400, h: 250, pivotSource: { name: "'[Old.xlsx]Report A'!First", formatId: 0 } });
  const added = destination.importSheets(source), chart = added[1].charts[0];
  expect(chart.pivotSource.name).toBe("'[Old.xlsx]Report A (2)'!First_2");
  const reloaded = await workbookFromFile(nativeBytes(await archive(destination)));
  expect(reloaded.sheetByName(added[1].name).charts[0].pivotSource.name).toBe(chart.pivotSource.name);
});
it.each(['<name val="Arial"/>', ''])('resolves source theme faces before importing a different font scheme (%s)', async name => {
  const source = await imported(), destination = new Workbook();
  source.fontTheme = { name: 'Other', major: { latin: { typeface: 'Courier New' }, ea: { typeface: '' }, cs: { typeface: '' }, fonts: [] }, minor: { latin: { typeface: 'Arial' }, ea: { typeface: '' }, cs: { typeface: '' }, fonts: [] } };
  source.nativePivots.dxfs = [`<dxf xmlns="${M}"><font>${name}<scheme val="major"/></font></dxf>`];
  source.nativePivots.tables[0].xml = source.nativePivots.tables[0].xml.replace('</pivotTableDefinition>', '<formats count="1"><format dxfId="0"><pivotArea/></format></formats></pivotTableDefinition>');
  destination.importSheets(source);
  expect(destination.nativePivots.dxfs[0]).toContain('<name val="Courier New"/>');
  expect(destination.nativePivots.dxfs[0]).toContain('<scheme val="none"/>');
  expect(source.nativePivots.dxfs[0]).toContain('<scheme val="major"/>');
});

it('does not bind imported cache sources to unrelated destination names or sheets', async () => {
  for (const xml of ['<worksheetSource name="Other"/>', '<worksheetSource sheet="OnlyDestination" ref="A1:B3"/>', `<worksheetSource xmlns:r="${R}" name="Other" r:id="externalBook"/>`]) {
    const source = await imported(), destination = new Workbook({ sheets: [{ name: 'OnlyDestination' }] });
    destination.addTable(destination.activeSheetId, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'Other' });
    const before = destination.toJSON();
    source.nativePivots.caches[0].sourceSheetId = null;
    source.nativePivots.caches[0].xml = source.nativePivots.caches[0].xml.replace(/<worksheetSource[^>]*\/>/, xml);
    expect(() => destination.importSheets(source)).toThrow(/missing.*source|external worksheet/);
    expect(destination.toJSON()).toEqual(before);
  }
});
it('refuses conflicting defined source names even if their unrebased formulas match', async () => {
  const source = await imported(), destination = new Workbook(source.toJSON());
  source.names = [{ name: 'SourceData', ref: 'Data!$A$1:$B$3' }]; destination.names = structuredClone(source.names);
  source.nativePivots.caches[0].sourceSheetId = null; source.nativePivots.caches[0].sourceRef = '';
  source.nativePivots.caches[0].xml = source.nativePivots.caches[0].xml.replace(/<worksheetSource[^>]*\/>/, '<worksheetSource name="SourceData"/>');
  const before = destination.toJSON();
  expect(() => destination.importSheets(source)).toThrow(/conflicting named pivot source/);
  expect(destination.toJSON()).toEqual(before);
});

it('retains standalone PivotChart reports with independently allocated identities', async () => {
  const source = await imported(), original = source.nativePivots.tables[0];
  source.nativePivots.tables.push({ ...original, owner: null, name: 'ChartOnly', xml: original.xml.replace('name="First"', 'name="ChartOnly"') });
  source.sheets[1].charts.push({ id: 'standalone', type: 'column', range: { r1: 2, c1: 1, r2: 5, c2: 2 }, anchor: { r: 10, c: 1 }, w: 400, h: 250,
    pivotSource: { name: '[Original.xlsx]ChartOnly', standalone: true, formatId: 0 } });
  const destination = new Workbook(source.toJSON()), added = destination.importSheets(source);
  expect(added[1].charts[0].pivotSource.name).toBe('[Original.xlsx]ChartOnly_2');
  expect(destination.nativePivots.tables.filter(p => p.owner == null).map(p => p.name)).toEqual(['ChartOnly', 'ChartOnly_2']);
  const reopened = await workbookFromFile(nativeBytes(await archive(destination)));
  expect(reopened.nativePivots.tables.filter(p => p.owner == null)).toHaveLength(2);
});
it('keeps implicit General separate from a destination override of format zero', async () => {
  const source = await imported(), destination = await imported();
  destination.nativePivots.formats[0] = '0.000" destination"';
  source.nativePivots.tables[0].xml = source.nativePivots.tables[0].xml.replace('<dataField ', '<dataField numFmtId="0" ');
  delete source.nativePivots.formats[0];
  const added = destination.importSheets(source), report = destination.nativePivots.tables.find(p => p.owner === added[1].id);
  const id = Number(parseModelXml(report.xml).getElementsByTagNameNS(M, 'dataField')[0].getAttribute('numFmtId'));
  expect(destination.nativePivots.formats[id]).toBe('General'); expect(id).not.toBe(0);
});

it('preserves nonconflicting defined sources and refuses indirect namespace capture', async () => {
  const source = await imported(), destination = new Workbook({ sheets: [{ name: 'Data' }] });
  source.names = [{ name: 'RootData', ref: 'Data!$A$1:$B$3' }, { name: 'CacheData', ref: 'RootData' }];
  source.nativePivots.caches[0].sourceSheetId = null; source.nativePivots.caches[0].sourceRef = '';
  source.nativePivots.caches[0].xml = source.nativePivots.caches[0].xml.replace(/<worksheetSource[^>]*\/>/, '<worksheetSource name="CacheData"/>');
  const added = destination.importSheets(source);
  expect(destination.namedEntry('RootData', null).ref).toContain(added[0].name);
  expect(destination.nativePivots.caches[0].xml).toContain('name="CacheData"');
  const conflict = new Workbook({ names: [{ name: 'RootData', ref: 'Sheet1!$A$1:$B$3' }] }), before = conflict.toJSON();
  expect(() => conflict.importSheets(source)).toThrow(/source dependencies/);
  expect(conflict.toJSON()).toEqual(before);
});

it('extracts a single pivot sheet with its cache and pruned slicer connections', async () => {
  const source = withConditionalRules(await imported()); addPivotView(source);
  const sheet = source.sheets[1], before = source.toJSON();
  let copy = source.sheetToWorkbook(sheet.id, { sourceWorkbook: '../Original.xlsx' });
  expect(copy.sheets).toHaveLength(1); expect(copy.nativePivots.tables).toHaveLength(1); expect(copy.nativePivots.caches).toHaveLength(1);
  expect(copy.nativePivots.slicers[0].connections).toEqual([{ owner: sheet.id, name: 'First' }]);
  expect(copy.nativePivots.caches[0]).toMatchObject({ sourceWorkbook: '../Original.xlsx', sourceSheetId: null });
  expect(copy.nativePivots.caches[0].xml).toContain('sheet="Data"');
  setSlicerSelection(copy, sheet.id, copy.sheets[0].charts.find(c => c.type === 'slicer').id, [0]);
  expect(copy.getValue(sheet.id, 4, 2)).toBe(4);
  for (let i = 0; i < 2; i++) copy = await workbookFromFile(nativeBytes(await archive(copy)));
  const owner = copy.sheets[0]; setSlicerSelection(copy, owner.id, owner.charts.find(c => c.type === 'slicer').id, null);
  expect(copy.getValue(owner.id, 5, 2)).toBe(13); expect(source.toJSON()).toEqual(before);
});
it('keeps a copied pivot source local when its table is on the copied sheet', async () => {
  const source = await imported(), sheet = source.sheets[1]; addPivotView(source);
  source.setCells(sheet.id, [{ r: 10, c: 0, cell: { v: 'Region' } }, { r: 10, c: 1, cell: { v: 'Amount' } }]);
  source.addTable(sheet.id, { r1: 10, c1: 0, r2: 12, c2: 1 }, { name: 'LocalSource' });
  const cache = source.nativePivots.caches[0]; cache.sourceSheetId = null; cache.sourceRef = '';
  cache.xml = cache.xml.replace(/<worksheetSource[^>]*\/>/, '<worksheetSource name="LocalSource"/>');
  const copy = source.sheetToWorkbook(sheet.id);
  expect(copy.nativePivots.caches[0].sourceWorkbook).toBeUndefined();
  const reopened = await workbookFromFile(nativeBytes(await archive(copy)));
  expect(reopened.tableByName('LocalSource')).toBeTruthy(); expect(reopened.nativePivots.caches[0].xml).toContain('name="LocalSource"');
});
it('requires actual source provenance before extracting an off-sheet pivot source', async () => {
  const source = await imported(), before = source.toJSON();
  expect(() => source.sheetToWorkbook(source.sheets[1].id)).toThrow(/Save the source spreadsheet/);
  expect(source.toJSON()).toEqual(before);
  expect(source.sheetToWorkbook(source.sheets[0].id).nativePivots).toBeNull();
});
it('carries a chart-only dependency as a non-worksheet report without copying its original cells', async () => {
  const source = await imported(), sheet = source.sheets[0];
  sheet.charts.push({ id: 'chart', type: 'column', range: { r1: 2, c1: 1, r2: 5, c2: 2 }, anchor: { r: 10, c: 1 }, w: 400, h: 250,
    pivotSource: { name: "'Report A'!First", formatId: 0 } });
  const copy = source.sheetToWorkbook(sheet.id);
  expect(copy.nativePivots.tables).toHaveLength(1); expect(copy.nativePivots.tables[0].owner).toBeNull();
  expect(copy.sheets[0].charts[0].pivotSource).toMatchObject({ name: 'First', standalone: true });
  const reopened = await workbookFromFile(nativeBytes(await archive(copy)));
  expect(reopened.sheets).toHaveLength(1); expect(reopened.nativePivots.tables[0].owner).toBeNull();
});

it('rebases existing external pivot sources when extracting a sheet into a different folder', async () => {
  const source = await imported(), sheet = source.sheets[1];
  const cache = source.nativePivots.caches[0];
  cache.sourceSheetId = null; cache.sourceWorkbook = '../Data/Values.xlsx';
  const before = source.toJSON();
  expect(() => source.sheetToWorkbook(sheet.id)).toThrow(/Save the source spreadsheet/);
  const copy = source.sheetToWorkbook(sheet.id, { sourceWorkbook: '../Reports/Source.xlsx' });
  expect(copy.nativePivots.caches[0].sourceWorkbook).toBe('../Data/Values.xlsx');
  const reopened = await workbookFromFile(nativeBytes(await archive(copy)));
  expect(reopened.nativePivots.caches[0].sourceWorkbook).toBe('../Data/Values.xlsx');
  expect(source.toJSON()).toEqual(before);
});

it('preserves current PivotChart series when its worksheet report becomes standalone on copy', async () => {
  const source = await imported(), dashboard = source.sheets[0], report = source.sheets[1];
  report.cells.set('2,2', { v: 'Current total' });
  report.cells.set('3,1', { v: 'North' }); report.cells.set('4,1', { v: 'South' });
  report.cells.set('3,2', { v: -7, s: { fmt: 'custom', code: '0.00" units"' } });
  report.cells.set('4,2', { v: 23, s: { fmt: 'custom', code: '0.00" units"' } });
  dashboard.charts.push({ id: 'chart', type: 'column', range: { r1: 2, c1: 1, r2: 4, c2: 2 }, anchor: { r: 10, c: 1 }, w: 400, h: 250,
    pivotSource: { name: "'Report A'!First", formatId: 3 }, titleRef: 'Data!A1',
    sourceRefs: [{ name: 'Stale caption', nameRef: "'Report A'!C3", categories: "'Report A'!B4:B5", values: "'Report A'!C4:C5" }] });
  const before = source.toJSON(), expected = chartData(source, dashboard.id, dashboard.charts[0]);
  let copy = source.sheetToWorkbook(dashboard.id);
  const chart = copy.sheets[0].charts[0];
  expect(chart.titleRef).toBe('Data!A1');
  expect(chart.pivotSource).toEqual({ name: 'First', formatId: 3, standalone: true });
  expect(chart.sourceRefs[0]).toMatchObject({ name: 'Current total', valueFormat: '0.00" units"', literal: { categories: ['North', 'South'], values: [-7, 23] } });
  expect(chart.sourceRefs[0].values).toBe('');
  for (let pass = 0; pass < 2; pass++) {
    const data = chartData(copy, copy.sheets[0].id, copy.sheets[0].charts[0]);
    expect(data.categories).toEqual(expected.categories); expect(data.series[0].values).toEqual(expected.series[0].values);
    expect(data.series[0].name).toBe('Current total');
    copy = await workbookFromFile(nativeBytes(await archive(copy)));
    expect(copy.nativePivots.tables[0].owner).toBeNull();
    expect(copy.sheets[0].charts[0].pivotSource.standalone).toBe(true);
  }
  const destination = await imported(), added = destination.importSheets(copy)[0];
  expect(chartData(destination, added.id, added.charts[0]).series[0].values).toEqual([-7, 23]);
  expect(source.toJSON()).toEqual(before);
});
it('keeps a PivotChart live when its worksheet report is copied with it', async () => {
  const source = await imported(), report = source.sheets[1];
  report.cells.set('3,1', { v: 'North' }); report.cells.set('3,2', { v: 23 });
  report.charts.push({ id: 'local-chart', type: 'column', range: { r1: 2, c1: 1, r2: 4, c2: 2 }, anchor: { r: 10, c: 1 }, w: 400, h: 250,
    pivotSource: { name: "'Report A'!First", formatId: 0 },
    sourceRefs: [{ categories: "'Report A'!B4:B4", values: "'Report A'!C4:C4" }] });
  const copy = source.sheetToWorkbook(report.id, { sourceWorkbook: '../Original.xlsx' });
  const chart = copy.sheets[0].charts[0];
  expect(chart.pivotSource.standalone).toBe(false); expect(chart.sourceRefs[0].values).toBe("'Report A'!C4:C4");
  copy.sheets[0].cells.set('3,2', { v: 42 });
  expect(chartData(copy, copy.sheets[0].id, chart).series[0].values).toEqual([42]);
});
it('commits a replacement pivot cache together with its slicer and every connected report', async () => {
  const wb = await imported(), before = wb.toJSON(), prepared = selectionPlan(wb, [0]), cache = wb.nativePivots.caches[0];
  prepared.cacheUpdates = new Map([[cache, { ...cache, xml: cache.xml.replace('<pivotCacheDefinition ', '<pivotCacheDefinition refreshedBy="Refresh test" ') }]]);
  expect(commitNativePivotReports(wb, prepared.updates, prepared)).toBe(true);
  expect(wb.nativePivots.caches[0].xml).toContain('refreshedBy="Refresh test"');
  expect(state(wb).items.filter(i => i.selected).map(i => i.index)).toEqual([0]);
  const after = wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it('requires slicer participation even when the refreshed pivot cache has the same member indexes', async () => {
  const wb = await imported(), prepared = selectionPlan(wb, [0]), cache = wb.nativePivots.caches[0], before = wb.toJSON();
  expect(() => commitNativePivotReports(wb, prepared.updates, { cacheUpdates: new Map([[cache, cache]]) })).toThrow(/connected slicer/);
  expect(wb.toJSON()).toEqual(before);
});
