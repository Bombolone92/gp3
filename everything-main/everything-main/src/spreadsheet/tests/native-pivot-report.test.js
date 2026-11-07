import { expect, it } from 'vitest';
import { planNativePivotReport } from '../src/core/native-pivot-report.js';
import { readNativePivotLayout } from '../src/core/native-pivot-layout.js';
import { Workbook } from '../src/core/workbook.js';
import { nativeRoundTrip } from './helpers/linked-model-workbook.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function fixture() {
  const cache = { key: 'cache', xml: `<pivotCacheDefinition xmlns="${MAIN}" recordCount="3"><cacheSource type="worksheet"><worksheetSource sheet="Source" ref="A1:C4"/></cacheSource><cacheFields count="3"><cacheField name="Region"><sharedItems count="2"><s v="East"/><s v="West"/></sharedItems></cacheField><cacheField name="Revenue"/><cacheField name="Units"/></cacheFields></pivotCacheDefinition>`,
    records: `<pivotCacheRecords xmlns="${MAIN}" count="3"><r><x v="0"/><n v="2"/><n v="10"/></r><r><x v="0"/><n v="4"/><n v="20"/></r><r><x v="1"/><n v="6"/><n v="30"/></r></pivotCacheRecords>` };
  const pivot = { name: 'Report', owner: 'sheet', cache: 'cache', ref: 'E3:G6', xml: `<pivotTableDefinition xmlns="${MAIN}" name="Report" dataCaption="Values" rowHeaderCaption="Area"><location ref="E3:G6" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/><pivotFields count="3"><pivotField axis="axisRow" showAll="0"><items count="2"><item x="0"/><item x="1"/></items></pivotField><pivotField dataField="1"/><pivotField dataField="1"/></pivotFields><rowFields count="1"><field x="0"/></rowFields><colFields count="1"><field x="-2"/></colFields><dataFields count="2"><dataField fld="1" name="Income"/><dataField fld="2" name="Average units" subtotal="average"/></dataFields></pivotTableDefinition>` };
  return { pivot, cache };
}
it('plans labels, headers, values and native axes together without workbook mutations', () => {
  const f = fixture(), before = structuredClone(f), result = planNativePivotReport(f.pivot, f.cache);
  expect(result.cells.map(c => [c.r, c.c, c.value])).toEqual([
    [2, 4, 'Area'], [2, 5, 'Income'], [2, 6, 'Average units'], [3, 4, 'East'], [4, 4, 'West'], [5, 4, 'Grand Total'],
    [3, 5, 6], [3, 6, 15], [4, 5, 6], [4, 6, 30], [5, 5, 12], [5, 6, 20],
  ]);
  expect(result.pivot.ref).toBe('E3:G6');
  expect(readNativePivotLayout(result.pivot, f.cache).rows).toEqual(result.layout.rows);
  expect(f).toEqual(before);
});
it('resizes a filtered report and restores omitted members when the selection is cleared', () => {
  const f = fixture(), filtered = planNativePivotReport(f.pivot, f.cache, { filters: [{ field: 0, items: [1] }] });
  expect(filtered.pivot.ref).toBe('E3:G5');
  expect(filtered.cells.filter(c => c.role === 'member').map(c => c.value)).toEqual(['West']);
  expect(filtered.cells.filter(c => c.role === 'value').map(c => c.value)).toEqual([6, 30, 6, 30]);
  const restored = planNativePivotReport(filtered.pivot, f.cache);
  expect(restored.pivot.ref).toBe('E3:G6');
  expect(restored.cells).toEqual(planNativePivotReport(f.pivot, f.cache).cells);
});
it('honors column grand-total visibility for the bottom row, including an empty selection', () => {
  const f = fixture(); f.pivot.xml = f.pivot.xml.replace('name="Report" dataCaption', 'name="Report" colGrandTotals="0" dataCaption');
  const result = planNativePivotReport(f.pivot, f.cache);
  expect(result.layout.rows.items.some(i => i.type === 'grand')).toBe(false); expect(result.pivot.ref).toBe('E3:G5');
  const empty = planNativePivotReport(f.pivot, f.cache, { filters: [{ field: 0, items: [] }] });
  expect(empty.pivot.ref).toBe('E3:G3'); expect(empty.cells).toHaveLength(3);
});
it('bounds the combined cell plan and rejects wrong cache identities or external sources', () => {
  const f = fixture(); expect(() => planNativePivotReport(f.pivot, f.cache, { maxCells: 11 })).toThrow(/limit/);
  expect(planNativePivotReport(f.pivot, f.cache, { maxCells: 12 }).cells).toHaveLength(12);
  expect(() => planNativePivotReport(f.pivot, { ...f.cache, key: 'other' })).toThrow(/Mismatched/);
  f.cache.xml = f.cache.xml.replace('type="worksheet"', 'type="external"'); expect(() => planNativePivotReport(f.pivot, f.cache)).toThrow(/external/);
});

it('rejects calculated-item and hidden-page-subtotal semantics before returning a report plan', () => {
  const f = fixture(); f.cache.xml = f.cache.xml.replace('</pivotCacheDefinition>', '<calculatedItems count="1"><calculatedItem field="0" formula="1"/></calculatedItems></pivotCacheDefinition>');
  expect(() => planNativePivotReport(f.pivot, f.cache)).toThrow(/Calculated items/);
  const other = fixture(); other.pivot.xml = other.pivot.xml.replace('name="Report" dataCaption', 'name="Report" subtotalHiddenItems="1" dataCaption');
  expect(() => planNativePivotReport(other.pivot, other.cache)).toThrow(/hidden-item/);
});

it('compiles optional paint only with style provenance and refuses unresolved area formats', () => {
  const { pivot, cache } = fixture();
  expect(() => planNativePivotReport(pivot, cache, { paintContext: {} })).toThrow(/styles are required/);
  expect(planNativePivotReport(pivot, cache, { nativePivots: {}, paintContext: {} }).paintLayers).toEqual([]);
  pivot.xml = pivot.xml.replace('</pivotTableDefinition>', '<formats count="1"><format dxfId="0"><pivotArea/></format></formats></pivotTableDefinition>');
  expect(() => planNativePivotReport(pivot, cache, { nativePivots: {}, paintContext: {} })).toThrow(/missing differential format/);
});

it('carries each measure number format through filtered refresh and restore', () => {
  const { pivot, cache } = fixture();
  pivot.xml = pivot.xml.replace('name="Income"', 'name="Income" numFmtId="180"').replace('name="Average units"', 'name="Average units" numFmtId="0"');
  const options = { nativePivots: {}, paintContext: { numberFormats: { 180: '0.00" units"' } } };
  const original = planNativePivotReport(pivot, cache, options);
  const filtered = planNativePivotReport(pivot, cache, { ...options, filters: [{ field: 0, items: [1] }] });
  for (const result of [original, filtered]) {
    for (const cell of result.cells) {
      if (cell.role === 'value') expect(cell.numberFormat).toEqual({ fmt: 'custom', code: cell.measure === 0 ? '0.00" units"' : 'General' });
      else expect(cell).not.toHaveProperty('numberFormat');
    }
  }
  expect(planNativePivotReport(filtered.pivot, cache, options).cells).toEqual(original.cells);
  expect(() => planNativePivotReport(pivot, cache, { nativePivots: {}, paintContext: {} })).toThrow(/unresolved number format/);
  expect(planNativePivotReport(pivot, cache).cells.every(c => !c.numberFormat)).toBe(true);
});
it('assigns numeric member formats without changing member values', () => {
  const { pivot, cache } = fixture();
  cache.xml = cache.xml.replace('<s v="East"/><s v="West"/>', '<n v="7"/><n v="12"/>');
  pivot.xml = pivot.xml.replace('axis="axisRow"', 'axis="axisRow" numFmtId="181"');
  const result = planNativePivotReport(pivot, cache, { nativePivots: {}, paintContext: { numberFormats: { 181: '0000' } } });
  expect(result.cells.filter(c => c.role === 'member').map(c => [c.value, c.type, c.numberFormat.code])).toEqual([[7, 'number', '0000'], [12, 'number', '0000']]);
});

it('uses the field number format in generated subtotal captions and respects explicit caption callbacks', () => {
  const { pivot, cache } = fixture();
  cache.xml = cache.xml.replace('<s v="East"/><s v="West"/>', '<n v="7"/><n v="12"/>').replace('<cacheField name="Revenue"/>', '<cacheField name="Revenue"><sharedItems count="2"><s v="A"/><s v="B"/></sharedItems></cacheField>');
  cache.records = cache.records.replace('<n v="2"/>', '<x v="0"/>').replace('<n v="4"/>', '<x v="1"/>').replace('<n v="6"/>', '<x v="0"/>');
  pivot.xml = pivot.xml.replace('axis="axisRow"', 'axis="axisRow" numFmtId="181" subtotalTop="0"').replace('<pivotField dataField="1"/>', '<pivotField axis="axisRow"><items count="2"><item x="0"/><item x="1"/></items></pivotField>')
    .replace('<rowFields count="1"><field x="0"/></rowFields>', '<rowFields count="2"><field x="0"/><field x="1"/></rowFields>')
    .replace('<dataFields count="2"><dataField fld="1" name="Income"/>', '<dataFields count="1">');
  const options = { nativePivots: {}, paintContext: { numberFormats: { 181: '0000' } } };
  const captions = opts => planNativePivotReport(pivot, cache, opts).cells.filter(c => c.role === 'subtotal').map(c => c.value);
  expect(captions(options)).toEqual(['0007 Total', '0012 Total']);
  expect(captions({ ...options, labels: { formatMember: m => `Group ${m.value}` } })).toEqual(['Group 7 Total', 'Group 12 Total']);
  cache.xml = cache.xml.replace('<n v="7"/>', '<m/>');
  expect(captions(options)).toEqual(['(blank) Total', '0012 Total']);
  expect(captions({ ...options, labels: { blankCaption: '(empty)' } })).toEqual(['(empty) Total', '0012 Total']);
});

it('regenerates a value-sorted report and preserves its sorting declaration for later filter changes', async () => {
  const f = fixture();
  f.pivot.xml = f.pivot.xml.replace('axis="axisRow"', 'axis="axisRow" sortType="descending"').replace('</items></pivotField>', '</items><autoSortScope><pivotArea dataOnly="0" outline="0" fieldPosition="0"><references count="1"><reference field="4294967294" count="1" selected="0"><x v="1"/></reference></references></pivotArea></autoSortScope></pivotField>');
  const result = planNativePivotReport(f.pivot, f.cache);
  expect(result.cells.filter(c => c.role === 'member').map(c => c.value)).toEqual(['West', 'East']);
  expect(result.cells.filter(c => c.role === 'value').map(c => c.value)).toEqual([6, 30, 6, 15, 12, 20]);
  const reloaded = readNativePivotLayout(result.pivot, f.cache);
  expect(reloaded.fields[0]).toMatchObject({ sortType: 'descending', autoSort: true });
  expect(reloaded.fields[0].sortScope).toContain('<x v="1"');
  const filtered = planNativePivotReport(result.pivot, f.cache, { filters: [{ field: 0, items: [0] }] });
  expect(filtered.cells.filter(c => c.role === 'member').map(c => c.value)).toEqual(['East']);
  const restored = planNativePivotReport(filtered.pivot, f.cache);
  expect(restored.cells).toEqual(result.cells);
  let wb = new Workbook({ sheets: [
    { id: 'sheet', name: 'Report', cells: Object.fromEntries(result.cells.map(c => [`${c.r},${c.c}`, { v: c.value }])) },
    { name: 'Source', cells: { '0,0': { v: 'Region' }, '0,1': { v: 'Revenue' }, '0,2': { v: 'Units' },
      '1,0': { v: 'East' }, '1,1': { v: 2 }, '1,2': { v: 10 }, '2,0': { v: 'East' }, '2,1': { v: 4 }, '2,2': { v: 20 },
      '3,0': { v: 'West' }, '3,1': { v: 6 }, '3,2': { v: 30 } } },
  ], nativePivots: { version: 1, tables: [result.pivot], caches: [f.cache] } });
  for (let i = 0; i < 2; i++) {
    wb = await nativeRoundTrip(wb);
    expect(planNativePivotReport(wb.nativePivots.tables[0], wb.nativePivots.caches[0]).cells).toEqual(result.cells);
    expect(wb.getValue(wb.sheetByName('Report').id, 3, 4)).toBe('West');
  }
  const copy = wb.sheetToWorkbook(wb.sheetByName('Report').id, { sourceWorkbook: '/Sorted.xlsx' });
  expect(planNativePivotReport(copy.nativePivots.tables[0], copy.nativePivots.caches[0]).cells).toEqual(result.cells);
});

it('retains cache captions through report rebuilding, identity-based filtering and native copies', async () => {
  const f = fixture();
  f.cache.xml = f.cache.xml.replace('name="Region"', 'name="Region" caption="Area_x000A_name"')
    .replace('<s v="East"/>', '<s v="East" c="Same_x0009_caption"/>').replace('<s v="West"/>', '<s v="West" c="Same_x0009_caption"/>')
    .replace('name="Units"', 'name="Units" caption="Quantity"');
  f.pivot.xml = f.pivot.xml.replace('axis="axisRow"', 'axis="axisRow" compact="0"').replace(' name="Average units"', '');
  const original = structuredClone(f), plan = planNativePivotReport(f.pivot, f.cache);
  const verify = (pivot, cache) => {
    const result = planNativePivotReport(pivot, cache);
    expect(result.cells).toEqual(plan.cells);
    expect(result.cells.filter(c => c.role === 'rowHeader' || c.role === 'measureHeader').map(c => c.value)).toEqual(['Area\nname', 'Income', 'Average of Quantity']);
    expect(result.cells.filter(c => c.role === 'member').map(c => c.value)).toEqual(['Same\tcaption', 'Same\tcaption']);
    const filtered = planNativePivotReport(pivot, cache, { selections: [{ field: 0, items: [1] }] });
    expect(filtered.cells.filter(c => c.role === 'value').map(c => c.value)).toEqual([6, 30, 6, 30]);
    expect(filtered.layout.rows.items[0].members[0]).toMatchObject({ value: 'West', index: 1, caption: 'Same\tcaption' });
    expect(planNativePivotReport(filtered.pivot, cache, { selections: [{ field: 0, items: null }] }).cells).toEqual(plan.cells);
    expect(result.layout.cacheFields[0].name).toBe('Region');
  };
  verify(f.pivot, f.cache); expect(f).toEqual(original);
  let wb = new Workbook({ sheets: [{ id: 'sheet', name: 'Report' }, { name: 'Source' }],
    nativePivots: { version: 1, tables: [plan.pivot], caches: [f.cache] } });
  for (let i = 0; i < 2; i++) {
    wb = await nativeRoundTrip(wb); verify(wb.nativePivots.tables[0], wb.nativePivots.caches[0]);
  }
  const copied = wb.sheetToWorkbook(wb.sheetByName('Report').id, { sourceWorkbook: '/Captions.xlsx' });
  verify(copied.nativePivots.tables[0], copied.nativePivots.caches[0]);
});
