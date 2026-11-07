import { expect, it } from 'vitest';
import { nativePivotBodyStyleLayers } from '../src/core/native-pivot-style.js';
import { nativePivotPaintLayers, nativePivotPaintAt } from '../src/core/native-pivot-paint.js';
import { planNativePivotReport } from '../src/core/native-pivot-report.js';
import { materializeNativePivotReport } from '../src/core/native-pivot-materialize.js';
import { commitNativePivotReports } from '../src/core/native-pivot-commit.js';
import { Workbook } from '../src/core/workbook.js';
import { nativeRoundTrip } from './helpers/linked-model-workbook.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const dxf = color => `<dxf xmlns="${MAIN}"><fill><patternFill patternType="solid"><bgColor rgb="FF${color}"/></patternFill></fill></dxf>`;
const prefixes = ['first', 'second', 'third'];
const style = parts => ({ options: { showRowHeaders: true, showColHeaders: true }, elements: parts.map((type, i) => ({ type, size: 1, dxf: dxf(['FF0000', '00FF00', '0000FF'][i % 3]) })) });
const members = depth => Array.from({ length: depth + 1 }, (_, field) => ({ field, item: 0, index: 0, type: 'string', value: `Member ${field}` }));
function layout(items, { columns = false, origin = [3, 7] } = {}) {
  const fields = Array.from({ length: 6 }, () => ({ outline: true, compact: true }));
  const axis = { fields: fields.map((_, i) => i), items };
  return { fields, firstDataRow: 1, firstDataCol: 1,
    range: { r1: origin[0], c1: origin[1], r2: origin[0] + (columns ? 2 : items.length), c2: origin[1] + (columns ? items.length : 2) },
    rows: columns ? { fields: [], items: [{ type: 'data', members: [] }] } : axis,
    columns: columns ? axis : { fields: [], items: [{ type: 'data', members: [] }] } };
}
const project = layers => layers.map(({ type, range }) => [type, range]);

it.each([false, true])('places nested subtotal bands on the %s column axis with outer/even/odd level styles', columns => {
  const items = Array.from({ length: 5 }, (_, depth) => ({ type: depth % 2 ? 'sum' : 'default', members: members(depth), subtotalField: depth }));
  const report = layout(items, { columns }), suffix = columns ? 'SubtotalColumn' : 'SubtotalRow';
  const layers = nativePivotBodyStyleLayers(report, style(prefixes.map(p => p + suffix)));
  expect(layers.map(l => l.type)).toEqual(['first' + suffix, 'second' + suffix, 'second' + suffix, 'third' + suffix, 'third' + suffix]);
  for (const [i, level] of ['first', 'second', 'third', 'second', 'third'].entries()) {
    expect(project(layers)).toContainEqual([level + suffix, columns
      ? { ...report.range, c1: report.range.c1 + 1 + i, c2: report.range.c1 + 1 + i }
      : { ...report.range, r1: report.range.r1 + 1 + i, r2: report.range.r1 + 1 + i }]);
  }
});

it('styles above-group totals and collapsed outer groups as subheadings while leaving leaf rows alone', () => {
  const items = Array.from({ length: 6 }, (_, depth) => ({ type: 'data', members: members(depth), ...(depth < 4 ? { header: true, aggregate: true } : {}) }));
  const report = layout(items), s = style([...prefixes.map(p => p + 'RowSubheading'), ...prefixes.map(p => p + 'SubtotalRow')]);
  const layers = nativePivotBodyStyleLayers(report, s);
  expect(layers).toHaveLength(5);
  expect(layers.every(l => l.type.endsWith('RowSubheading'))).toBe(true);
  const paint = nativePivotPaintLayers(layers);
  expect(nativePivotPaintAt(paint, 4, 8).bg).toBe('#ff0000');
  expect(nativePivotPaintAt(paint, 7, 8).bg).toBe('#00ff00');
  expect(nativePivotPaintAt(paint, 9, 8)).toEqual({});
});

it('uses the actual report origin and bounded full-row regions in separate-column outline layouts', () => {
  const report = layout([{ type: 'data', members: members(1), header: true }], { origin: [20, 4] });
  report.fields.forEach(f => { f.compact = false; });
  report.firstDataCol = 6; report.range.c2 = 12;
  expect(project(nativePivotBodyStyleLayers(report, style(['secondRowSubheading'])))).toEqual([
    ['secondRowSubheading', { r1: 21, c1: 4, r2: 21, c2: 12 }],
  ]);
});

it('does not apply unused hierarchy elements to single-field leaves or measure-only columns', () => {
  const report = layout([{ type: 'data', members: members(0) }]); report.rows.fields = [0];
  report.columns.fields = [-2];
  expect(nativePivotBodyStyleLayers(report, style(['firstRowSubheading', 'firstSubtotalRow', 'firstColumnSubheading', 'firstSubtotalColumn']))).toEqual([]);
});

it('does not let row-header visibility disable independent subtotal formatting', () => {
  const report = layout([{ type: 'data', members: members(0), header: true }, { type: 'default', members: members(0) }]);
  const s = style(['firstRowSubheading', 'firstSubtotalRow']); s.options.showRowHeaders = false;
  expect(nativePivotBodyStyleLayers(report, s).map(l => l.type)).toEqual(['firstSubtotalRow']);
});

it('uses field identity and excludes the synthetic measure dimension from hierarchy levels', () => {
  const report = layout([{ type: 'sum', members: [{ ...members(0)[0], field: 4 }], subtotalField: 4 }]);
  report.rows.fields = [-2, 4, 2];
  expect(nativePivotBodyStyleLayers(report, style(['firstSubtotalRow']))).toHaveLength(1);
});

it.each([
  ['cached subtotal marker', r => { r.rows.items[0].members[0].type = 'subtotal'; }],
  ['wrong group field', r => { r.rows.items[0].subtotalField = 2; }],
  ['wrong member prefix', r => { r.rows.items[0].members[0].field = 2; }],
  ['missing member', r => { r.rows.items[0].members = []; }],
  ['duplicate field', r => { r.rows.fields[1] = 0; }],
])('rejects ambiguous %s before returning paint', (_name, change) => {
  const report = layout([{ type: 'sum', members: members(0), subtotalField: 0 }]); change(report);
  expect(() => nativePivotBodyStyleLayers(report, style(['firstSubtotalRow']))).toThrow(/Invalid native pivot style/);
});

it('bounds hierarchy regions and does not inspect axis entries for unrelated styles', () => {
  const report = layout([{ type: 'sum', members: members(0) }, { type: 'sum', members: members(0) }]);
  expect(() => nativePivotBodyStyleLayers(report, style(['firstSubtotalRow']), { maxRegions: 1 })).toThrow(/limit/);
  report.rows.items = new Proxy(report.rows.items, { get(target, key) { if (key === 'entries') throw new Error('Unexpected scan'); return Reflect.get(target, key); } });
  expect(nativePivotBodyStyleLayers(report, style(['wholeTable']))).toHaveLength(1);
});

it('continues to reject active shared tabular and column heading geometry', () => {
  const report = layout([{ type: 'data', members: members(0) }]); report.fields[0].outline = false;
  expect(() => nativePivotBodyStyleLayers(report, style(['firstRowSubheading']))).toThrow(/tabular/);
  const columns = layout([{ type: 'data', members: members(0) }], { columns: true });
  expect(() => nativePivotBodyStyleLayers(columns, style(['firstColumnSubheading']))).toThrow(/column subheading/);
});

function workbook() {
  const wb = new Workbook({ sheets: [{ id: 'report', name: 'Report' }, { name: 'Source', cells: {
    '0,0': { v: 'Group' }, '0,1': { v: 'Item' }, '0,2': { v: 'Amount' },
    '1,0': { v: 'East' }, '1,1': { v: 'A' }, '1,2': { v: 3 }, '2,0': { v: 'East' }, '2,1': { v: 'B' }, '2,2': { v: 8 },
  } }] });
  wb.nativePivots = { version: 1, caches: [{ key: 'c', xml: `<pivotCacheDefinition xmlns="${MAIN}" recordCount="2"><cacheSource type="worksheet"><worksheetSource sheet="Source" ref="A1:C3"/></cacheSource><cacheFields count="3"><cacheField name="Group"><sharedItems count="1"><s v="East"/></sharedItems></cacheField><cacheField name="Item"><sharedItems count="2"><s v="A"/><s v="B"/></sharedItems></cacheField><cacheField name="Amount"/></cacheFields></pivotCacheDefinition>`, records: `<pivotCacheRecords xmlns="${MAIN}" count="2"><r><x v="0"/><x v="0"/><n v="3"/></r><r><x v="0"/><x v="1"/><n v="8"/></r></pivotCacheRecords>` }],
    tables: [{ owner: 'report', cache: 'c', name: 'Summary', ref: 'D5:E10', xml: `<pivotTableDefinition xmlns="${MAIN}" name="Summary" dataCaption="Values"><location ref="D5:E10" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/><pivotFields count="3"><pivotField axis="axisRow" subtotalTop="0"><items count="1"><item x="0"/></items></pivotField><pivotField axis="axisRow"><items count="2"><item x="0"/><item x="1"/></items></pivotField><pivotField dataField="1"/></pivotFields><rowFields count="2"><field x="0"/><field x="1"/></rowFields><dataFields count="1"><dataField fld="2" name="Amount"/></dataFields><pivotTableStyleInfo name="Custom" showRowHeaders="1" showColHeaders="1"/></pivotTableDefinition>` }],
    styles: [{ name: 'Custom', xml: `<tableStyle xmlns="${MAIN}" name="Custom" count="2"><tableStyleElement type="firstRowSubheading" dxfId="0"/><tableStyleElement type="firstSubtotalRow" dxfId="1"/></tableStyle>` }], dxfs: [dxf('112233'), dxf('445566')] };
  return wb;
}

it('does not put a below-group subtotal border onto a rebuilt top aggregate row', () => {
  const wb = workbook(), pivot = wb.nativePivots.tables[0];
  pivot.xml = pivot.xml.replace('subtotalTop="0"', 'subtotalTop="1"');
  const plan = planNativePivotReport(pivot, wb.nativePivots.caches[0], { nativePivots: wb.nativePivots, paintContext: {} });
  expect(plan.layout.rows.items[0]).toMatchObject({ type: 'data', header: true, aggregate: true });
  expect(plan.styleLayers.map(l => l.type)).toEqual(['firstRowSubheading']);
  expect(plan.cells.find(c => c.r === 5 && c.c === 4).value).toBe(11);
});

it('moves hierarchy formatting with filtered groups and preserves plans through native export and extraction', async () => {
  let wb = workbook();
  wb.nativePivots.tables[0].xml = wb.nativePivots.tables[0].xml.replace('name="Summary" dataCaption', 'name="Summary" preserveFormatting="0" dataCaption');
  const plan = (w, options = {}) => planNativePivotReport(w.nativePivots.tables[0], w.nativePivots.caches[0], { nativePivots: w.nativePivots, paintContext: {}, ...options });
  const initial = plan(wb), filtered = plan(wb, { selections: [{ field: 1, items: [1] }] });
  expect(initial.styleLayers.map(l => [l.type, l.range.r1])).toEqual([['firstSubtotalRow', 8], ['firstRowSubheading', 5]]);
  expect(filtered.styleLayers.map(l => [l.type, l.range.r1])).toEqual([['firstSubtotalRow', 7], ['firstRowSubheading', 5]]);
  const before = wb.toJSON(), pivot = wb.nativePivots.tables[0], cache = wb.nativePivots.caches[0];
  commitNativePivotReports(wb, [{ pivot, cache, next: filtered.pivot, cells: materializeNativePivotReport(wb, pivot, filtered) }]);
  expect(wb.getCell('report', 5, 4).s.bg).toBe('#112233');
  expect(wb.getCell('report', 7, 4).s.bg).toBe('#445566');
  expect(wb.getCell('report', 8, 4).s?.bg).toBeUndefined();
  const after = wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
  for (let i = 0; i < 2; i++) {
    wb = await nativeRoundTrip(wb);
    expect(plan(wb).paintLayers).toEqual(filtered.paintLayers);
    expect(wb.getCell(wb.sheetByName('Report').id, 7, 4).s.bg).toBe('#445566');
    expect(plan(wb, { selections: [{ field: 1, items: null }] }).paintLayers).toEqual(initial.paintLayers);
  }
  const copy = await nativeRoundTrip(wb.sheetToWorkbook(wb.sheetByName('Report').id, { sourceWorkbook: '/Groups.xlsx' }));
  expect(plan(copy).paintLayers).toEqual(filtered.paintLayers);
});
