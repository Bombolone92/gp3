import { expect, it } from 'vitest';
import { appendNativePivotFormats } from '../src/core/native-pivot-format-write.js';
import { parseModelXml } from '../src/core/data-model-metadata.js';
import { readNativePivotArea, nativePivotAreaDataRanges } from '../src/core/native-pivot-area.js';
import { readNativePivotFormats, nativePivotFormatLayers } from '../src/core/native-pivot-formats.js';
import { planNativePivotReport } from '../src/core/native-pivot-report.js';
import { materializeNativePivotReport } from '../src/core/native-pivot-materialize.js';
import { commitNativePivotReports } from '../src/core/native-pivot-commit.js';
import { Workbook } from '../src/core/workbook.js';
import { nativeRoundTrip } from './helpers/linked-model-workbook.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const xml = (tag, body = '', attrs = '') => `<${tag} xmlns="${MAIN}" ${attrs}>${body}</${tag}>`;
const reference = (field, items, attrs = '') => `<reference field="${field}" count="${items.length}" ${attrs}>${items.map(i => `<x v="${i}"/>`).join('')}</reference>`;
const area = (refs = '', attrs = '') => readNativePivotArea(parseModelXml(xml('pivotArea', refs ? `<references>${refs}</references>` : '', attrs)));
const member = (field, index) => ({ field, index, item: 1 - index, type: 'string', value: `Item ${index}` });
function layout() {
  return { range: { r1: 4, c1: 3, r2: 7, c2: 6 }, firstDataRow: 1, firstDataCol: 1,
    fields: [0, 1].map(() => ({ items: [{ type: 'data', index: 1 }, { type: 'data', index: 0 }] })),
    cacheFields: [0, 1].map(() => ({ items: [{ type: 'string', value: 'Same caption' }, { type: 'string', value: 'Same caption' }] })),
    measures: [{ field: 2 }],
    rows: { fields: [0], items: [0, 1].map(i => ({ type: 'data', members: [member(0, i)] })).concat({ type: 'grand', members: [] }) },
    columns: { fields: [1], items: [0, 1].map(i => ({ type: 'data', members: [member(1, i)] })).concat({ type: 'grand', members: [] }) } };
}
const ranges = (a, l = layout(), options) => nativePivotAreaDataRanges(l, a, options);

it('intersects member identities across both axes, independent of captions, cache indexes and display order', () => {
  expect(ranges(area(reference(0, [0]) + reference(1, [1])))).toEqual([{ r1: 6, r2: 6, c1: 4, c2: 4 }]);
  expect(ranges(area(reference(0, [1]) + reference(1, [0]), 'cacheIndex="1"'))).toEqual([{ r1: 6, r2: 6, c1: 4, c2: 4 }]);
  const l = layout(); [l.rows.items[0], l.rows.items[1]] = [l.rows.items[1], l.rows.items[0]];
  expect(ranges(area(reference(0, [0])), l)).toEqual([{ r1: 5, r2: 5, c1: 4, c2: 5 }]);
});

it('includes row and column grand totals only when requested and still intersects member restrictions', () => {
  expect(ranges(area())).toEqual([{ r1: 5, r2: 6, c1: 4, c2: 5 }]);
  expect(ranges(area('', 'field="-01"'))).toEqual(ranges(area()));
  expect(ranges(area('', 'grandRow="1" grandCol="1"'))).toEqual([{ r1: 5, r2: 7, c1: 4, c2: 6 }]);
  expect(ranges(area(reference(0, [1]), 'grandRow="1" grandCol="1"'))).toEqual([{ r1: 5, r2: 5, c1: 4, c2: 6 }]);
});

it('uses data-field indexes for measure selections and selected=false is not a complement', () => {
  const l = layout(); l.measures = [{ field: 9 }, { field: 7 }];
  l.columns = { fields: [-2], items: [1, 0, 1].map(measure => ({ type: 'data', measure, members: [] })) };
  expect(ranges(area(reference(4294967294, [1], 'selected="0"')), l)).toEqual([
    { r1: 5, r2: 6, c1: 4, c2: 4 }, { r1: 5, r2: 6, c1: 6, c2: 6 },
  ]);
  l.rows = l.columns; l.columns = { fields: [], items: [{ type: 'data', members: [] }] };
  expect(ranges(area(reference(4294967294, [0])), l)).toEqual([{ r1: 6, r2: 6, c1: 4, c2: 4 }]);
});

it('resolves subtotal aggregation flags for their own field and leaves separator/header blanks unselected', () => {
  const l = layout(); l.rows.items = [
    { type: 'data', members: [member(0, 0)], header: true, aggregate: false },
    { type: 'data', members: [member(0, 0)], header: true, aggregate: true },
    { type: 'sum', subtotalField: 0, members: [member(0, 0)] }, { type: 'blank', members: [] },
    { type: 'data', members: [member(0, 0)] },
  ]; l.range.r2 = 9;
  expect(ranges(area(reference(0, [1], 'defaultSubtotal="1"')), l)).toEqual([{ r1: 6, r2: 6, c1: 4, c2: 5 }]);
  expect(ranges(area(reference(0, [1], 'sumSubtotal="1"')), l)).toEqual([{ r1: 7, r2: 7, c1: 4, c2: 5 }]);
  expect(ranges(area(reference(0, [1])), l)).toEqual([{ r1: 9, r2: 9, c1: 4, c2: 5 }]);
});

it('keeps a filtered-out member rule dormant and reactivates it when its axis member returns', () => {
  const l = layout(), a = area(reference(0, [0]));
  l.rows.items = [l.rows.items[0]];
  expect(ranges(a, l)).toEqual([]);
  l.rows.items.push({ type: 'data', members: [member(0, 1)] });
  expect(ranges(a, l)).toEqual([{ r1: 6, r2: 6, c1: 4, c2: 5 }]);
});

it.each([
  ['label selection', '', 'dataOnly="0" labelOnly="1"'],
  ['mixed labels and values', '', 'dataOnly="0"'],
  ['relative member', reference(0, [0], 'relative="1"'), ''],
  ['position member', reference(0, [0], 'byPosition="1"'), ''],
  ['offset', '', 'offset="A1"'],
  ['field button', '', 'type="button" field="0"'],
  ['collapsed subtotal', '', 'collapsedLevelsAreSubtotals="1"'],
])('refuses unsupported %s instead of selecting extra cells', (_name, refs, attrs) => {
  expect(() => ranges(area(refs, attrs))).toThrow(/not implemented/);
});

it.each([
  ['missing member index', reference(0, [8])], ['missing measure', reference(4294967294, [8])],
  ['duplicate reference', reference(0, []) + reference(0, [])], ['unused field', reference(7, [])],
  ['conflicting subtotals', reference(0, [], 'defaultSubtotal="1" sumSubtotal="1"')],
])('rejects %s', (_name, refs) => { expect(() => ranges(area(refs))).toThrow(); });

it('bounds the shared work and rectangle budgets, including empty selections and cross products', () => {
  const a = area(reference(0, [0]));
  expect(() => ranges(a, layout(), { maxWork: 2 })).toThrow(/work limit/);
  expect(() => ranges(a, layout(), { maxRanges: 0 })).toThrow(/range limit/);
  const formats = [{ area: a, dxf: xml('dxf') }];
  const one = nativePivotFormatLayers(layout(), formats, { maxWork: 20 }); expect(one).toHaveLength(1);
  expect(() => nativePivotFormatLayers(layout(), [...formats, ...formats], { maxWork: 20 })).toThrow(/work limit/);
  const l = layout(); l.rows.items = [];
  expect(() => nativePivotFormatLayers(l, Array(30).fill(formats[0]), { maxWork: 20 })).toThrow(/work limit/);
});

it.each([['rows', 0], ['columns', 1]])('allows dormant %s rules with no remaining output ranges', (axis, field) => {
  const l = layout(), dormant = area(reference(field, [0]));
  l[axis].items = [l[axis].items[0]];
  expect(ranges(dormant, l, { maxRanges: 0 })).toEqual([]);
  const active = { area: area(), dxf: xml('dxf') };
  expect(nativePivotFormatLayers(l, [active, { area: dormant, dxf: xml('dxf') }], { maxRanges: 1 }))
    .toEqual(nativePivotFormatLayers(l, [active], { maxRanges: 1 }));
});

it('coalesces large selected bodies without visiting their data-cell cross product', () => {
  const l = layout(), entry = { type: 'data', members: [] };
  l.range = { r1: 0, c1: 0, r2: 10000, c2: 1000 };
  l.rows = { fields: [], items: Array(10000).fill(entry) }; l.columns = { fields: [], items: Array(1000).fill(entry) };
  expect(ranges(area(), l, { maxWork: 11002 })).toEqual([{ r1: 1, c1: 1, r2: 10000, c2: 1000 }]);
});

it('rejects malformed axis metadata before producing a formatting plan', () => {
  const l = layout(); l.rows.items[0].type = 'mystery';
  expect(() => ranges(area(), l)).toThrow(/item type/);
  l.rows.fields = [0, 0]; expect(() => ranges(area(), l)).toThrow(/axis fields/);
  expect(() => ranges(area(), layout(), { maxWork: 0, workBudget: { remaining: 100 } })).toThrow(/work limit/);
});

const pivot = (body, attrs = '') => ({ xml: xml('pivotTableDefinition', `<formats ${attrs}>${body}</formats>`) });
it.each([
  ['duplicate area', '<format dxfId="0"><pivotArea/><pivotArea/></format>', ''],
  ['missing DXF', '<format dxfId="1"><pivotArea/></format>', ''],
  ['missing area', '<format dxfId="0"/>', ''],
  ['bad count', '<format dxfId="0"><pivotArea/></format>', 'count="0"'],
  ['extension', '<format dxfId="0"><pivotArea><extLst/></pivotArea></format>', ''],
  ['clear action', '<format action="blank"><pivotArea/></format>', ''],
])('rejects unrepresentable native format %s', (_name, body, attrs) => {
  expect(() => readNativePivotFormats(pivot(body, attrs), { dxfs: [xml('dxf')] })).toThrow();
});

function workbook(scope, qualified = false) {
  const labelsOnly = ['labels', 'reset', 'fieldLabels'].includes(scope);
  const wb = new Workbook({ sheets: [{ id: 'report', name: 'Report' }, { name: 'Source', cells: {
    '0,0': { v: 'Region' }, '0,1': { v: 'Amount' }, '1,0': { v: 'East' }, '1,1': { v: 3 }, '2,0': { v: 'West' }, '2,1': { v: 8 },
  } }] });
  wb.nativePivots = { version: 1, formats: { 180: '0.0' },
    caches: [{ key: 'c', xml: xml('pivotCacheDefinition', '<cacheSource type="worksheet"><worksheetSource sheet="Source" ref="A1:B3"/></cacheSource><cacheFields count="2"><cacheField name="Region"><sharedItems count="2"><s v="East"/><s v="West"/></sharedItems></cacheField><cacheField name="Amount"/></cacheFields>', 'recordCount="2"'), records: xml('pivotCacheRecords', '<r><x v="0"/><n v="3"/></r><r><x v="1"/><n v="8"/></r>', 'count="2"') }],
    tables: [{ owner: 'report', cache: 'c', name: 'Summary', ref: 'D5:E8', xml: xml('pivotTableDefinition', '<location ref="D5:E8" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/><pivotFields count="2"><pivotField axis="axisRow"><items count="2"><item x="1"/><item x="0"/></items></pivotField><pivotField dataField="1"/></pivotFields><rowFields count="1"><field x="0"/></rowFields><dataFields count="1"><dataField fld="1" numFmtId="180" name="Amount"/></dataFields>', 'name="Summary" dataCaption="Values" preserveFormatting="0"') }],
    dxfs: [] };
  // Exercise the authoring path rather than installing prewritten rule XML.
  const p = wb.nativePivots.tables[0];
  const layout = planNativePivotReport(p, wb.nativePivots.caches[0]).layout;
  const attrs = `${scope !== 'data' ? 'dataOnly="0"' : ''}${labelsOnly ? ' labelOnly="1"' : ''}${scope === 'fieldLabels' ? ' axis="axisRow" fieldPosition="0"' : ''}`;
  const memberArea = xml('pivotArea', `<references count="1">${reference(0, [0])}</references>`, `${attrs}${qualified ? ' field="0"' : ''}`);
  wb.nativePivots = appendNativePivotFormats(wb.nativePivots, p, layout, [
    { area: memberArea, style: { bold: true, size: 15, fmt: 'custom', code: '0.000" special"', bg: '#112233', align: 'right', valign: 'top', wrap: true, indent: 4 } },
    { area: memberArea, style: { bold: false, italic: true, wrap: false, ...(scope === 'reset' ? { align: null, indent: 0 } : {}) } },
  ]);
  return wb;
}
it.each(['data', 'labels', 'mixed', 'reset', 'fieldLabels'].flatMap(scope => [false, true].map(qualified => [scope, qualified])))('paints ordered native %s formats (qualified=%s) and retains hidden-member rules through commit/export/copy', async (scope, qualified) => {
  let wb = workbook(scope, qualified);
  const labelsOnly = ['labels', 'reset', 'fieldLabels'].includes(scope);
  if (scope === 'reset') {
    wb.sheet('report').colStyles.set(3, { align: 'center', wrap: true, indent: 2 });
  }
  const typography = { size: 15, valign: 'top', align: scope === 'reset' ? null : 'right', indent: scope === 'reset' ? 0 : 4 };
  const paintedColumn = labelsOnly ? 3 : 4;
  const plan = (w, selections) => planNativePivotReport(w.nativePivots.tables[0], w.nativePivots.caches[0], { nativePivots: w.nativePivots, paintContext: { numberFormats: w.nativePivots.formats }, selections });
  const initial = plan(wb), west = initial.cells.find(c => c.role === 'member' && c.value === 'West');
  const materialized = materializeNativePivotReport(wb, wb.nativePivots.tables[0], initial);
  expect(materialized.find(c => c.r === west.r && c.c === paintedColumn).cell.s).toMatchObject({ bold: false, italic: true, bg: '#112233', code: '0.000" special"', ...typography, wrap: false });
  if (scope !== 'mixed') expect(materialized.find(c => c.r === west.r && c.c === (labelsOnly ? 4 : 3)).cell.s).not.toHaveProperty('bg');
  else expect(materialized.find(c => c.r === west.r && c.c === 3).cell.s.bg).toBe('#112233');
  const filtered = plan(wb, [{ field: 0, items: [0] }]); expect(filtered.formatPaintLayers).toBeUndefined();
  const before = wb.toJSON(), p = wb.nativePivots.tables[0];
  commitNativePivotReports(wb, [{ pivot: p, cache: wb.nativePivots.caches[0], next: filtered.pivot, cells: materializeNativePivotReport(wb, p, filtered) }]);
  const after = wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
  for (let i = 0; i < 2; i++) {
    wb = await nativeRoundTrip(wb);
    expect(plan(wb).formatPaintLayers).toBeUndefined();
    const restored = plan(wb, [{ field: 0, items: null }]);
    expect(restored.formatPaintLayers).toEqual(initial.formatPaintLayers);
  }
  const restored = plan(wb, [{ field: 0, items: null }]), old = wb.nativePivots.tables[0];
  commitNativePivotReports(wb, [{ pivot: old, cache: wb.nativePivots.caches[0], next: restored.pivot, cells: materializeNativePivotReport(wb, old, restored) }]);
  wb = await nativeRoundTrip(wb);
  const report = wb.sheetByName('Report'), memberCell = plan(wb).cells.find(c => c.role === 'member' && c.value === 'West');
  expect(wb.getCell(report.id, memberCell.r, paintedColumn).s).toMatchObject({ bg: '#112233', italic: true, code: '0.000" special"' });
  const finalStyle = wb.styleAt(report.id, memberCell.r, paintedColumn);
  expect(finalStyle).toMatchObject({ size: 15, valign: 'top' });
  expect(finalStyle.indent ?? 0).toBe(typography.indent);
  expect(finalStyle.align ?? null).toBe(typography.align);
  expect(!!finalStyle.wrap).toBe(false);
  const copy = await nativeRoundTrip(wb.sheetToWorkbook(wb.sheetByName('Report').id, { sourceWorkbook: '/Rules.xlsx' }));
  expect(plan(copy, [{ field: 0, items: null }]).formatPaintLayers).toEqual(initial.formatPaintLayers);
});

it.each(['0', '+00'])('accepts an explicit field %s matching the last member reference', field => {
  const refs = reference(1, [0]) + reference(0, [1]);
  expect(ranges(area(refs, `field="${field}"`))).toEqual(ranges(area(refs)));
  expect(ranges(area(refs, `field="${field}" cacheIndex="1"`))).toEqual(ranges(area(refs, 'cacheIndex="1"')));
});
it('accepts the signed data-field selector when the last reference uses its unsigned identity', () => {
  const refs = reference(0, [0]) + reference(4294967294, [0]);
  expect(ranges(area(refs, 'field="-2"'))).toEqual(ranges(area(refs)));
});
it.each([
  ['0', reference(0, [0]) + reference(1, [1])],
  ['1', reference(0, [0])], ['-2', reference(0, [0])],
  ['-3', reference(0, [0])], ['0', ''], ['-2', ''], ['2147483648', reference(0, [0])],
])('refuses conflicting or invalid field %s without widening its references', (field, refs) => {
  expect(() => ranges(area(refs, `field="${field}"`))).toThrow();
});
it('keeps explicitly qualified rules dormant when their member is absent', () => {
  const l = layout(), rule = area(reference(0, [0]), 'field="0"');
  l.rows.items = [l.rows.items[0]]; expect(ranges(rule, l)).toEqual([]);
  l.rows.items.push({ type: 'data', members: [member(0, 1)] });
  expect(ranges(rule, l)).toEqual([{ r1: 6, r2: 6, c1: 4, c2: 5 }]);
});
