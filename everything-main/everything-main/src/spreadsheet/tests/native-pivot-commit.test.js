import { expect, it } from 'vitest';
import { fixture as storedModel } from './helpers/stored-model-workbook.js';
import { nativeRoundTrip } from './helpers/linked-model-workbook.js';
import { createDataModelEvaluation } from '../src/core/data-model-evaluate.js';
import { Workbook } from '../src/core/workbook.js';
import { commitNativePivotReports } from '../src/core/native-pivot-commit.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const definition = (ref, name = 'Report') => `<pivotTableDefinition xmlns="${MAIN}" name="${name}"><location ref="${ref}"/></pivotTableDefinition>`;
function fixture() {
  const wb = new Workbook({ sheets: [{ name: 'First', cells: { '1,1': { v: 'Old' }, '2,1': { v: 10, s: { bold: true } }, '6,6': { v: 'Unrelated' } } }, { name: 'Second', cells: { '1,1': { v: 'Other' }, '2,1': { v: 20 } } }] });
  const cache = { key: 'cache', xml: `<pivotCacheDefinition xmlns="${MAIN}"/>`, records: '' };
  wb.nativePivots = { version: 1, caches: [cache], tables: wb.sheets.map(s => ({ owner: s.id, name: 'Report', cache: 'cache', ref: 'B2:B3', xml: definition('B2:B3') })) };
  const updates = wb.nativePivots.tables.map(pivot => ({ pivot, cache, next: { ...pivot, ref: 'B2:B2', xml: definition('B2:B2') }, cells: [{ r: 1, c: 1, cell: { v: 42, s: { fmt: 'custom', code: '0.00' } } }, { r: 2, c: 1, cell: null }] }));
  wb.clearHistory(); return { wb, updates };
}
it('commits multiple reports and rules as one undo step without touching unrelated cells', () => {
  const { wb, updates } = fixture(), before = wb.toJSON();
  const rules = new Map([[wb.sheets[0].id, [{ id: 'rule', range: { r1: 1, c1: 1, r2: 1, c2: 1 }, formula: 'B2>0', style: { bold: true } }]]]);
  const observed = []; wb.addEventListener('change', () => observed.push(wb.sheets.map(s => wb.getValue(s.id, 1, 1))));
  expect(commitNativePivotReports(wb, updates, { rules })).toBe(true);
  const after = wb.toJSON();
  expect(wb.undoLabels()).toEqual(['Refresh pivot reports']);
  expect(wb.sheets.map(s => wb.getValue(s.id, 1, 1))).toEqual([42, 42]);
  expect(wb.getCell(wb.sheets[0].id, 2, 1)).toBeUndefined();
  expect(wb.getValue(wb.sheets[0].id, 6, 6)).toBe('Unrelated');
  expect(observed.every(values => values[0] === 42 && values[1] === 42)).toBe(true);
  updates[0].cells[0].cell.s.code = '0%'; rules.values().next().value[0].style.bold = false;
  wb.undo(); expect(wb.toJSON()).toEqual(before);
  wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it('retains explicitly planned formatting on vacated cells', () => {
  const { wb, updates } = fixture(); updates[0].cells[1].cell = { v: null, s: { bg: '#abcdef' } };
  commitNativePivotReports(wb, updates);
  expect(wb.getCell(wb.sheets[0].id, 2, 1).s.bg).toBe('#abcdef');
});
it.each(['sheet', 'range', 'merge', 'table', 'array', 'occupied', 'stale', 'duplicate', 'incomplete', 'vacated', 'bounds', 'identity', 'xml', 'xmlname', 'clone'])('refuses the complete batch before any write for %s', problem => {
  const { wb, updates } = fixture(), last = updates[1], sheet = wb.sheets[1];
  if (problem === 'sheet') sheet.protected = true;
  if (problem === 'range') sheet.protectedRanges.push({ range: { r1: 2, c1: 1, r2: 2, c2: 1 } });
  if (problem === 'merge') sheet.merges.push({ r1: 2, c1: 1, r2: 2, c2: 2 });
  if (problem === 'table') sheet.tables.push({ id: 'table', range: { r1: 2, c1: 1, r2: 4, c2: 2 } });
  if (problem === 'array') sheet.cells.set('2,1', { f: 'SEQUENCE(2)', array: { rows: 2, cols: 1 } });
  if (problem === 'occupied') {
    last.next.ref = 'B2:C2'; last.next.xml = definition(last.next.ref); last.cells.push({ r: 1, c: 2, cell: null }); sheet.cells.set('1,2', { v: 0 });
  }
  if (problem === 'stale') last.pivot = { ...last.pivot };
  if (problem === 'duplicate') updates.push(updates[0]);
  if (problem === 'incomplete') last.cells = [{ r: 2, c: 1, cell: null }];
  if (problem === 'vacated') last.cells.pop();
  if (problem === 'bounds') last.next.ref = 'B2:XFE2';
  if (problem === 'identity') last.next.name = 'Other';
  if (problem === 'xml') last.next.xml = definition('B2:C2');
  if (problem === 'xmlname') last.next.xml = definition('B2:B2', 'Different');
  if (problem === 'clone') last.cells[0].cell.s = { invalid: () => {} };
  const before = wb.toJSON(), labels = wb.undoLabels();
  expect(() => commitNativePivotReports(wb, updates)).toThrow();
  expect(wb.toJSON()).toEqual(before); expect(wb.undoLabels()).toEqual(labels);
});
it('refuses budget excess and duplicate cell positions before mutation', () => {
  const { wb, updates } = fixture(), before = wb.toJSON();
  expect(() => commitNativePivotReports(wb, updates, { maxCells: 3 })).toThrow(/oversized/);
  updates[1].cells[1] = updates[1].cells[0];
  expect(() => commitNativePivotReports(wb, updates)).toThrow(/duplicate cell/);
  expect(wb.toJSON()).toEqual(before);
});
it('requires a final rule list when the native report owns conditional formats', () => {
  const { wb, updates } = fixture();
  updates[0].pivot.xml = updates[0].pivot.xml.replace('</pivotTableDefinition>', '<conditionalFormats/></pivotTableDefinition>');
  expect(() => commitNativePivotReports(wb, updates)).toThrow(/conditional rule/);
  expect(commitNativePivotReports(wb, updates, { rules: new Map([[wb.sheets[0].id, []]]) })).toBe(true);
});

it('refuses another report even when its worksheet cells are blank', () => {
  const { wb, updates } = fixture(), other = { ...updates[1].pivot, name: 'Hidden occupancy', owner: wb.sheets[0].id, ref: 'B2:B2' };
  wb.nativePivots.tables.push(other);
  expect(() => commitNativePivotReports(wb, updates)).toThrow(/another pivot/);
});
it('refuses an expanding report that would block a spill anchored outside it', () => {
  const { wb, updates } = fixture(), id = wb.sheets[1].id;
  wb.sheets[1].cells.set('0,2', { f: 'SEQUENCE(4)', v: null });
  updates[1].next.ref = 'B2:C2'; updates[1].next.xml = definition('B2:C2');
  updates[1].cells.push({ r: 1, c: 2, cell: null });
  const before = wb.toJSON();
  expect(() => commitNativePivotReports(wb, updates)).toThrow(/spill formula/);
  expect(wb.getValue(id, 1, 2)).toBe(2); expect(wb.toJSON()).toEqual(before);
});
it('requires no dense traversal of a huge previous report rectangle', () => {
  const { wb, updates } = fixture();
  updates[0].pivot.ref = 'B2:XFD1048576'; updates[0].pivot.xml = definition(updates[0].pivot.ref);
  updates[0].cells.push({ r: 6, c: 6, cell: null });
  expect(commitNativePivotReports(wb, updates, { maxCells: 5 })).toBe(true);
});
it.each([{ v: Infinity }, { v: 'x'.repeat(32768) }, { v: new Date() }, { v: 1, f: '1' }, { v: 1, s: { fmt: 'custom', code: '0'.repeat(256) } }])('rejects materialization loss before writing %j', cell => {
  const { wb, updates } = fixture(), before = wb.toJSON(); updates[1].cells[0].cell = cell;
  expect(() => commitNativePivotReports(wb, updates)).toThrow(); expect(wb.toJSON()).toEqual(before);
});

it('indexes many reports while discovering spills only once per affected sheet', () => {
  const { wb } = fixture(), sheet = wb.sheets[0]; sheet.cells.clear();
  const cache = wb.nativePivots.caches[0];
  wb.nativePivots.tables = Array.from({ length: 200 }, (_, i) => ({ name: `Report ${i}`, cache: cache.key, owner: sheet.id, ref: `A${i * 2 + 1}`, xml: definition(`A${i * 2 + 1}`, `Report ${i}`) }));
  const updates = wb.nativePivots.tables.map((pivot, i) => ({ pivot, cache, next: { ...pivot }, cells: [{ r: i * 2, c: 0, cell: { v: i } }] }));
  let discoveries = 0; const original = wb._ensureSpills.bind(wb);
  wb._ensureSpills = sheet => { discoveries++; return original(sheet); };
  expect(commitNativePivotReports(wb, updates)).toBe(true);
  expect(discoveries).toBe(1); expect(wb.undoLabels()).toHaveLength(1);
  expect(wb.getValue(sheet.id, 398, 0)).toBe(199);
});

function refreshFixture({ model = false } = {}) {
  const f = fixture(), cache = f.updates[0].cache;
  cache.xml = `<pivotCacheDefinition xmlns="${MAIN}"><cacheSource type="${model ? 'external' : 'worksheet'}"${model ? ' connectionId="7"' : ''}/><cacheFields count="0"/></pivotCacheDefinition>`;
  const replacement = { ...cache, xml: `<pivotCacheDefinition xmlns="${MAIN}"><cacheSource type="${model ? 'external' : 'worksheet'}"${model ? ' connectionId="7"' : ''}/><cacheFields count="1"><cacheField name="New"><sharedItems count="1"><s v="New"/></sharedItems></cacheField></cacheFields></pivotCacheDefinition>` };
  for (const update of f.updates) update.next.xml = update.next.xml.replace('</pivotTableDefinition>', '<pivotFields count="1"><pivotField/></pivotFields></pivotTableDefinition>');
  const options = { cacheUpdates: new Map([[cache, replacement]]) };
  if (model) {
    const connectionsXml = `<connections xmlns="${MAIN}" xmlns:x="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><connection id="7" name="Model" type="5"><extLst><ext><x:connection model="1"/></ext></extLst></connection></connections>`;
    f.wb.dataModel = { ...storedModel({ base: 10n }).dataModel, connectionsXml };
    options.dataModelUpdate = { previous: f.wb.dataModel, next: { ...storedModel({ base: 20n }).dataModel, connectionsXml } };
  }
  return { ...f, cache, replacement, options };
}
it('publishes model, caches and all connected report cells as one observable undoable change', () => {
  const { wb, updates, options, replacement } = refreshFixture({ model: true }), before = wb.toJSON(), events = [];
  const state = () => [String(createDataModelEvaluation(wb, { source: 'stored' }).evaluate('Orders', 'Total')), wb.nativePivots.caches[0].xml, wb.sheets.map(s => wb.getValue(s.id, 1, 1))];
  const oldState = state(); wb.addEventListener('change', () => events.push(state()));
  expect(commitNativePivotReports(wb, updates, options)).toBe(true);
  const after = wb.toJSON(), newState = state(); expect(newState[0]).toBe('47');
  expect(events.length).toBeGreaterThan(0); expect(events.every(s => JSON.stringify(s) === JSON.stringify(newState))).toBe(true);
  expect(wb.undoLabels()).toEqual(['Refresh pivot reports']);
  replacement.xml = '<broken/>'; options.dataModelUpdate.next.archive = 'AAAA';
  events.length = 0; wb.undo(); expect(wb.toJSON()).toEqual(before); expect(events.every(s => JSON.stringify(s) === JSON.stringify(oldState))).toBe(true);
  events.length = 0; wb.redo(); expect(wb.toJSON()).toEqual(after); expect(events.every(s => JSON.stringify(s) === JSON.stringify(newState))).toBe(true);
});
it.each(['missing-report', 'missing-slicer', 'stale-cache', 'cache-key', 'cache-source', 'cache-records', 'cache-field-index', 'cache-limit', 'later-cells'])('rejects an invalid cache refresh batch before writes: %s', issue => {
  const { wb, updates, options, cache, replacement } = refreshFixture();
  if (issue === 'missing-report') updates.pop();
  if (issue === 'missing-slicer') wb.nativePivots.slicers = [{ cache: cache.key }];
  if (issue === 'stale-cache') options.cacheUpdates = new Map([[{ ...cache }, replacement]]);
  if (issue === 'cache-key') replacement.key = 'Different';
  if (issue === 'cache-source') replacement.xml = replacement.xml.replace('type="worksheet"', 'type="external"');
  if (issue === 'cache-records') replacement.records = `<pivotCacheRecords xmlns="${MAIN}" count="1"><r><x v="9"/></r></pivotCacheRecords>`;
  if (issue === 'cache-field-index') updates[1].next.xml = updates[1].next.xml.replace('<pivotField/>', '<pivotField><items count="1"><item x="9"/></items></pivotField>').replace('</pivotTableDefinition>', '<rowFields count="1"><field x="0"/></rowFields><rowItems count="1"><i><x/></i></rowItems></pivotTableDefinition>');
  if (issue === 'cache-limit') options.maxCacheCells = 1;
  if (issue === 'later-cells') updates[1].cells = [];
  const before = wb.toJSON(), history = wb.undoLabels();
  expect(() => commitNativePivotReports(wb, updates, options)).toThrow(); expect(wb.toJSON()).toEqual(before); expect(wb.undoLabels()).toEqual(history);
});
it.each(['stale', 'bindings', 'archive', 'missing-cache', 'missing-report', 'ambiguous-connection'])('rejects an invalid model refresh before writes: %s', issue => {
  const { wb, updates, options } = refreshFixture({ model: true });
  if (issue === 'stale') options.dataModelUpdate.previous = { ...wb.dataModel };
  if (issue === 'bindings') options.dataModelUpdate.next.modelXml = '<dataModel/>';
  if (issue === 'archive') options.dataModelUpdate.next.archive = 'AAAA';
  if (issue === 'missing-cache') options.cacheUpdates.clear();
  if (issue === 'missing-report') updates.pop();
  if (issue === 'ambiguous-connection') {
    const xml = wb.dataModel.connectionsXml.replace('</connections>', '<connection id="+7"/></connections>');
    wb.dataModel.connectionsXml = xml; options.dataModelUpdate.next.connectionsXml = xml;
  }
  const before = wb.toJSON(); expect(() => commitNativePivotReports(wb, updates, options)).toThrow(); expect(wb.toJSON()).toEqual(before);
});
it('requires all model caches even when the caller provides no report updates', () => {
  const { wb, options } = refreshFixture({ model: true }); options.cacheUpdates.clear();
  const before = wb.toJSON(); expect(() => commitNativePivotReports(wb, [], options)).toThrow(/model cache update/); expect(wb.toJSON()).toEqual(before);
});
it('bounds cached members cumulatively across several replaced caches', () => {
  const { wb, updates, options, cache, replacement } = refreshFixture();
  const other = { ...cache, key: 'second' }; wb.nativePivots.caches.push(other);
  const otherReplacement = { ...replacement, key: other.key }; options.cacheUpdates.set(other, otherReplacement); options.maxCacheCells = 3;
  const before = wb.toJSON(); expect(() => commitNativePivotReports(wb, updates, options)).toThrow(/limit/); expect(wb.toJSON()).toEqual(before);
});
it('retains unrelated worksheet caches during a model refresh', () => {
  const { wb, updates, options } = refreshFixture({ model: true });
  const extra = { key: 'other', xml: `<pivotCacheDefinition xmlns="${MAIN}"><cacheSource type="worksheet"/></pivotCacheDefinition>`, records: '' };
  wb.nativePivots.caches.push(extra); commitNativePivotReports(wb, updates, options); expect(wb.nativePivots.caches[1]).toBe(extra);
});
it('can refresh an unused cache without creating a report or changing cells', () => {
  const { wb, options } = refreshFixture(); wb.nativePivots.tables = [];
  const before = wb.toJSON(); expect(commitNativePivotReports(wb, [], options)).toBe(true);
  expect(wb.toJSON().sheets).toEqual(before.sheets); wb.undo(); expect(wb.toJSON()).toEqual(before);
});
it('preserves the committed model, cache and cells through a native XLSX round trip', async () => {
  const { wb, updates, options } = refreshFixture({ model: true }); commitNativePivotReports(wb, updates, options);
  const copy = await nativeRoundTrip(wb);
  expect(copy.dataModel.archive).toBe(wb.dataModel.archive);
  expect(copy.nativePivots.caches[0].xml).toContain('v="New"');
  expect(copy.sheets.map(s => copy.getValue(s.id, 1, 1))).toEqual([42, 42]);
  expect(String(createDataModelEvaluation(copy, { source: 'stored' }).evaluate('Orders', 'Total'))).toBe('47');
});
it('requires model caches bound through numerically equivalent connection IDs', () => {
  const { wb, updates, options } = refreshFixture({ model: true });
  wb.dataModel.connectionsXml = wb.dataModel.connectionsXml.replace('id="7"', 'id="+007"');
  options.dataModelUpdate.next.connectionsXml = wb.dataModel.connectionsXml; options.cacheUpdates.clear();
  const before = wb.toJSON(); expect(() => commitNativePivotReports(wb, updates, options)).toThrow(/model cache/); expect(wb.toJSON()).toEqual(before);
});
it('supports a model and cache update with no report consumers', () => {
  const { wb, options } = refreshFixture({ model: true }); wb.nativePivots.tables = [];
  const before = wb.toJSON(); expect(commitNativePivotReports(wb, [], options)).toBe(true);
  expect(String(createDataModelEvaluation(wb, { source: 'stored' }).evaluate('Orders', 'Total'))).toBe('47');
  wb.undo(); expect(wb.toJSON()).toEqual(before);
});
it('keeps lexical namespace differences out of cache source identity', () => {
  const { wb, updates, options, replacement } = refreshFixture();
  replacement.xml = replacement.xml.replace('<cacheSource type="worksheet"/>', `<s:cacheSource xmlns:s="${MAIN}" type="worksheet"/>`);
  expect(commitNativePivotReports(wb, updates, options)).toBe(true);
});
it('rejects changed source bindings outside the cache XML', () => {
  const { wb, updates, options, replacement } = refreshFixture(); replacement.sourceWorkbook = '/Other.xlsx';
  expect(() => commitNativePivotReports(wb, updates, options)).toThrow(/cache source/);
});
