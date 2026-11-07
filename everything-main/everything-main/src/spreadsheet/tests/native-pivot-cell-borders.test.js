import { formatNativePivotBorders, formatNativePivotStyleAndBorders } from '../src/core/native-pivot-border-selection.js';
import { borderSnapshot } from '../src/core/border-regions.js';
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { readNativePivotLayout } from '../src/core/native-pivot-layout.js';
import { formatNativePivotSelection, clearNativePivotSelection, pasteNativePivotStyles, pasteNativePivotClipboardStyles } from '../src/core/native-pivot-style-selection.js';
import { nativePivotPaintAt, nativePivotPaintLayers } from '../src/core/native-pivot-paint.js';
import { readNativePivotFormats, nativePivotFormatLayers } from '../src/core/native-pivot-formats.js';
import { nativeRoundTrip } from './helpers/linked-model-workbook.js';
const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const xml = (tag, body, attrs = '') => `<${tag} xmlns="${main}" ${attrs}>${body}</${tag}>`;
const data = { r1: 5, r2: 6, c1: 4, c2: 5 };
const sides = ['bt', 'bb', 'bl', 'br'];
function fixture() {
  const wb = new Workbook({ sheets: [{ id: 'report', name: 'Report' }, { name: 'Source', cells: {
    '0,0': { v: 'Region' }, '0,1': { v: 'Quarter' }, '0,2': { v: 'Amount' },
    '1,0': { v: 'East' }, '1,1': { v: 'Q1' }, '1,2': { v: 3 },
    '2,0': { v: 'East' }, '2,1': { v: 'Q2' }, '2,2': { v: 5 },
    '3,0': { v: 'West' }, '3,1': { v: 'Q1' }, '3,2': { v: 8 },
    '4,0': { v: 'West' }, '4,1': { v: 'Q2' }, '4,2': { v: 13 },
  } }] });
  const cache = { key: 'cache', xml: xml('pivotCacheDefinition', '<cacheSource type="worksheet"><worksheetSource sheet="Source" ref="A1:C5"/></cacheSource><cacheFields count="3"><cacheField name="Region"><sharedItems count="2"><s v="East"/><s v="West"/></sharedItems></cacheField><cacheField name="Quarter"><sharedItems count="2"><s v="Q1"/><s v="Q2"/></sharedItems></cacheField><cacheField name="Amount"/></cacheFields>', 'recordCount="4"'), records: xml('pivotCacheRecords', '<r><x v="0"/><x v="0"/><n v="3"/></r><r><x v="0"/><x v="1"/><n v="5"/></r><r><x v="1"/><x v="0"/><n v="8"/></r><r><x v="1"/><x v="1"/><n v="13"/></r>', 'count="4"') };
  const pivot = { owner: 'report', cache: 'cache', name: 'Matrix', ref: 'D5:F8', xml: xml('pivotTableDefinition', '<location ref="D5:F8" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/><pivotFields count="3"><pivotField axis="axisRow"><items count="2"><item x="0"/><item x="1"/></items></pivotField><pivotField axis="axisCol"><items count="2"><item x="0"/><item x="1"/></items></pivotField><pivotField dataField="1"/></pivotFields><rowFields count="1"><field x="0"/></rowFields><rowItems count="3"><i><x v="0"/></i><i><x v="1"/></i><i t="grand"><x/></i></rowItems><colFields count="1"><field x="1"/></colFields><colItems count="2"><i><x v="0"/></i><i><x v="1"/></i></colItems><dataFields count="1"><dataField fld="2" name="Amount"/></dataFields>', 'name="Matrix" dataCaption="Values" rowGrandTotals="0"') };
  // Formatting uses saved axes and cells; it must not rebuild column headers.
  wb.nativePivots = { version: 1, caches: [cache], tables: [pivot], dxfs: [], formats: {} };
  const values = [['Region', 'Q1', 'Q2'], ['East', 3, 5], ['West', 8, 13], ['Grand Total', 11, 18]];
  wb.setCells('report', values.flatMap((row, r) => row.map((v, c) => ({ r: r + 4, c: c + 3, cell: { v } }))));
  wb.clearHistory(); return wb;
}
function paint(wb, r, c) {
  const p = wb.nativePivots.tables[0];
  const layout = readNativePivotLayout(p, wb.nativePivots.caches[0]);
  const layers = nativePivotFormatLayers(layout, readNativePivotFormats(p, wb.nativePivots));
  const result = nativePivotPaintAt(nativePivotPaintLayers(layers, {}, { numberFormats: wb.nativePivots.formats }), r, c);
  // Shared pen summaries are redundant; each edge descriptor is authoritative.
  delete result.bs; delete result.bc; return result;
}
function expected(patch) {
  const out = {};
  for (const key of sides) if (Object.hasOwn(patch, key)) {
    out[key] = !!patch[key]; out[`${key}Border`] = out[key]
      ? { bs: patch[`${key}Border`]?.bs || patch.bs || 'thin', bc: patch[`${key}Border`]?.bc ?? patch.bc ?? null } : null;
  }
  return out;
}
it('applies independent edge pens and removals to native report rules and ordinary cells together', async () => {
  const wb = fixture(), before = wb.toJSON(), range = { ...data, c2: 6 };
  formatNativePivotStyleAndBorders(wb, new Map([['report', [range]]]), { bold: true }, [
    { kind: 'all', perSide: true, color: '#112233', style: 'dotted' },
    { kind: 'top', perSide: true, color: '#ff0000', style: 'thin' },
    { kind: 'bottom', perSide: true, color: '#0000ff', style: 'double' },
    { kind: 'left', perSide: true, remove: true },
  ]);
  expect(paint(wb, 5, 4)).toMatchObject({ bt: true, btBorder: { bs: 'thin', bc: '#ff0000' }, bl: false,
    bbBorder: { bs: 'dotted', bc: '#112233' } });
  expect(paint(wb, 6, 4)).toMatchObject({ bb: true, bbBorder: { bs: 'double', bc: '#0000ff' }, bl: false });
  expect(borderSnapshot(wb.styleAt('report', 5, 6))).toMatchObject({ btBorder: { bs: 'thin', bc: '#ff0000' }, brBorder: { bs: 'dotted', bc: '#112233' } });
  expect(wb.getValue('report', 5, 4)).toBe(3);
  expect(wb.undoLabels()).toHaveLength(1);
  const restored = await nativeRoundTrip(wb);
  expect(paint(restored, 5, 4)).toMatchObject({ btBorder: { bs: 'thin', bc: '#ff0000' }, bl: false });
  expect(paint(restored, 6, 4)).toMatchObject({ bbBorder: { bs: 'double', bc: '#0000ff' }, bl: false });
  wb.undo(); expect(wb.toJSON()).toEqual(before);
});
it.each([
  [{ bt: true, bb: true, bl: true, br: true, bs: 'double', bc: '#123456' }, 1],
  [{ bt: true }, 1], [{ bb: true }, 1], [{ bl: true }, 1], [{ br: true }, 1],
  [{ bt: true, br: true }, 1],
  [{ bt: true, bb: true, btBorder: { bs: 'thin', bc: '#ff0000' }, bbBorder: { bs: 'double', bc: '#0000ff' } }, 1],
  [{ bl: true, br: true, blBorder: { bs: 'dotted' }, brBorder: { bs: 'thick' } }, 1],
  [{ bt: false, bb: false, bl: false, br: false }, 1],
])('preserves every cell edge when grouping native paint %j', (patch, count) => {
  const wb = fixture(), before = wb.toJSON();
  expect(formatNativePivotSelection(wb, new Map([['report', [data]]]), patch)).toBe(true);
  for (let r = 5; r <= 6; r++) for (let c = 4; c <= 5; c++) expect(paint(wb, r, c)).toEqual(expected(patch));
  expect(paint(wb, 7, 4)).toEqual({}); expect(paint(wb, 5, 3)).toEqual({});
  expect(readNativePivotFormats(wb.nativePivots.tables[0], wb.nativePivots)).toHaveLength(count);
  expect(wb.undoLabels()).toEqual(['Format pivot reports']); const after = wb.toJSON();
  wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it('retains cell-edge geometry through native export cycles and sheet extraction', async () => {
  let wb = fixture();
  const patch = { bt: true, bb: true, bl: true, br: true, bs: 'double', bc: '#123456' };
  formatNativePivotSelection(wb, new Map([['report', [data]]]), patch);
  const reset = { bt: null, bb: null, bl: null, br: null };
  formatNativePivotSelection(wb, new Map([['report', [{ r1: 6, r2: 6, c1: 4, c2: 5 }]]]), reset);
  for (let cycle = 0; cycle < 3; cycle++) {
    wb = await nativeRoundTrip(cycle === 2 ? wb.sheetToWorkbook(wb.sheetByName('Report').id, { sourceWorkbook: '/Source.xlsx' }) : wb);
    for (const c of [4, 5]) { expect(paint(wb, 5, c)).toEqual(expected(patch)); expect(paint(wb, 6, c)).toEqual(expected(reset)); }
    expect(wb.getValue(wb.sheetByName('Report').id, 5, 4)).toBe(3);
  }
});
it('resolves mixed report/ordinary edges once across overlapping selections', () => {
  const wb = fixture(), range = { ...data, c2: 6 }, calls = [];
  formatNativePivotSelection(wb, new Map([['report', [range, range]]]), (sid, r, c) => {
    calls.push([sid, r, c]); return { bt: r === 5, bb: r === 6, bl: c === 4, br: c === 6, bc: '#123456' };
  });
  expect(calls).toHaveLength(6);
  for (let r = 5; r <= 6; r++) for (let c = 4; c <= 5; c++) expect(paint(wb, r, c)).toEqual(expected({ bt: r === 5, bb: r === 6, bl: c === 4, br: false, bc: '#123456' }));
  expect(wb.styleAt('report', 5, 6)).toMatchObject({ bt: true, br: true, bc: '#123456' });
  expect(wb.undoLabels()).toHaveLength(1);
});
it('enforces the area limit before any border writes', () => {
  const wb = fixture(), before = wb.toJSON();
  expect(() => formatNativePivotSelection(wb, new Map([['report', [data]]]), { bt: true, br: true }, { maxFormats: 0 })).toThrow();
  expect(wb.toJSON()).toEqual(before); expect(wb.undoLabels()).toEqual([]);
});

it('keeps unedited inherited edges outside the authored native delta', () => {
  const wb = fixture(); wb.sheet('report').colStyles.set(4, { bb: true, bbBorder: { bs: 'thick', bc: '#0000ff' } });
  const patch = { bt: true, btBorder: { bs: 'thin', bc: '#ff0000' } };
  formatNativePivotSelection(wb, new Map([['report', [data]]]), patch);
  for (const r of [5, 6]) {
    expect(paint(wb, r, 4)).toEqual(expected(patch));
    expect(wb.styleAt('report', r, 4)).toMatchObject({ bb: true, bbBorder: { bs: 'thick', bc: '#0000ff' } });
  }
});
it('restyles existing per-cell edges without losing interior borders', () => {
  const wb = fixture(), selections = new Map([['report', [data]]]);
  const patch = { bt: true, bb: true, bl: true, br: true, bs: 'double', bc: '#123456' };
  formatNativePivotSelection(wb, selections, patch); formatNativePivotSelection(wb, selections, { bs: 'dotted' });
  for (let r = 5; r <= 6; r++) for (let c = 4; c <= 5; c++) expect(paint(wb, r, c)).toEqual(expected({ ...patch, bs: 'dotted' }));
});
it.each([17, [], { unknown: true }, { bs: 7 }, { bc: {} }])('rejects malformed cell-edge descriptors before any writes (%j)', pen => {
  const wb = fixture(), before = wb.toJSON();
  expect(() => formatNativePivotSelection(wb, new Map([['report', [data]]]), { bt: true, btBorder: pen })).toThrow(/border pen/);
  expect(wb.toJSON()).toEqual(before); expect(wb.undoLabels()).toEqual([]);
});

it('repeats asymmetric borders across duplicate saved semantic contexts', () => {
  const wb = fixture(), p = wb.nativePivots.tables[0];
  p.xml = p.xml.replace('<rowItems count="3"><i><x v="0"/></i><i><x v="1"/></i>', '<rowItems count="3"><i><x v="0"/></i><i><x v="0"/></i>');
  const patch = { bb: true, bbBorder: { bs: 'double', bc: '#123456' } };
  formatNativePivotSelection(wb, new Map([['report', [data]]]), patch);
  for (let r = 5; r <= 6; r++) for (let c = 4; c <= 5; c++) expect(paint(wb, r, c)).toEqual(expected(patch));
  expect(readNativePivotFormats(wb.nativePivots.tables[0], wb.nativePivots)).toHaveLength(1);
});
it('does not border holes between disjoint selected cells', () => {
  const wb = fixture(), patch = { bl: true, br: true };
  formatNativePivotSelection(wb, new Map([['report', [{ r1: 5, r2: 5, c1: 4, c2: 4 }, { r1: 6, r2: 6, c1: 5, c2: 5 }]]]), patch);
  expect(paint(wb, 5, 4)).toEqual(expected(patch)); expect(paint(wb, 6, 5)).toEqual(expected(patch));
  expect(paint(wb, 5, 5)).toEqual({}); expect(paint(wb, 6, 4)).toEqual({});
});

it.each(['all', 'outer', 'inner', 'horizontal', 'vertical', 'top', 'bottom', 'left', 'right', 'none', 'restyle'])('prepares the %s gesture with native rules and ordinary cells', kind => {
  const wb = fixture(), range = { ...data, c2: 6 };
  wb.applyStyle('report', range, { bt: true, bs: 'dotted', bc: '#123456' }); wb.clearHistory();
  const before = wb.toJSON(), reference = new Workbook(before), options = { color: '#456789', style: 'double' };
  reference.applyBorders('report', range, kind, options);
  formatNativePivotBorders(wb, new Map([['report', [range]]]), kind, options);
  for (let r = 5; r <= 6; r++) for (let c = 4; c <= 6; c++) expect(borderSnapshot(wb.styleAt('report', r, c))).toEqual(borderSnapshot(reference.styleAt('report', r, c)));
  expect(wb.undoLabels()).toHaveLength(1); const after = wb.toJSON();
  wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it('composes overlapping border geometries against the prepared cell state', () => {
  const wb = fixture(), reference = new Workbook(wb.toJSON());
  const ranges = [{ ...data, c2: 4 }, { ...data, c2: 6 }];
  for (const g of ranges) reference.applyBorders('report', g, 'outer', { style: 'double', color: '#123456' });
  formatNativePivotBorders(wb, new Map([['report', ranges]]), 'outer', { style: 'double', color: '#123456' });
  for (let r = 5; r <= 6; r++) for (let c = 4; c <= 6; c++) expect(borderSnapshot(wb.styleAt('report', r, c))).toEqual(borderSnapshot(reference.styleAt('report', r, c)));
  expect(paint(wb, 5, 4)).toMatchObject({ bl: true, br: true, bt: true });
  expect(paint(wb, 5, 5)).toMatchObject({ bt: true }); expect(paint(wb, 5, 5).br).toBeUndefined();
});
it.each(['scope', 'bounds', 'cells', 'work', 'grand', 'merge', 'protected', 'kind'])('refuses a border gesture atomically for %s', problem => {
  const wb = fixture(), range = { ...data, c2: 6 }, options = {}; let kind = 'all';
  if (problem === 'scope') range.scope = 'columns';
  if (problem === 'bounds') range.r2 = 1048576;
  if (problem === 'cells') options.maxCells = 2;
  if (problem === 'work') options.maxWork = 2;
  if (problem === 'grand') range.r2 = 7;
  if (problem === 'merge') wb.mergeCells('report', { r1: 5, r2: 6, c1: 6, c2: 6 });
  if (problem === 'protected') wb.sheet('report').protectedRanges.push({ range: { r1: 6, r2: 6, c1: 6, c2: 6 } });
  if (problem === 'kind') kind = 'bad';
  wb.clearHistory(); const before = wb.toJSON();
  expect(() => formatNativePivotBorders(wb, new Map([['report', [range]]]), kind, options)).toThrow();
  expect(wb.toJSON()).toEqual(before); expect(wb.undoLabels()).toEqual([]);
});

it.each([5, 6])('composes style and multiple border actions without intermediate writes (last row %s)', last => {
  const wb = fixture(), range = { ...data, r2: last, c2: 6 }, selections = new Map([['report', [range, range]]]);
  const patch = { fmt: 'percent', dec: 3, italic: true, size: 18.5, bc: '#789abc' };
  const borders = [{ kind: 'all', style: 'thin', color: '#aa0000' }, { kind: 'bottom', style: 'double', color: '#0000bb' }];
  const before = wb.toJSON(), reference = new Workbook(before);
  for (const g of [range, range]) { reference.applyStyle('report', g, patch); for (const b of borders) reference.applyBorders('report', g, b.kind, b); }
  formatNativePivotStyleAndBorders(wb, selections, patch, borders);
  for (let r = 5; r <= last; r++) for (let c = 4; c <= 6; c++) {
    expect(wb.styleAt('report', r, c)).toMatchObject({ fmt: 'percent', dec: 3, italic: true, size: 18.5 });
    expect(borderSnapshot(wb.styleAt('report', r, c))).toEqual(borderSnapshot(reference.styleAt('report', r, c)));
    if (c < 6) expect(paint(wb, r, c)).toMatchObject({ fmt: 'custom', code: '#,##0.000%', italic: true, size: 18.5 });
  }
  expect(wb.undoLabels()).toHaveLength(1); const after = wb.toJSON();
  wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it.each(['pen', 'kind', 'paint', 'descriptor', 'work'])('rejects a combined style/border failure before any writes (%s)', problem => {
  const wb = fixture(), patch = { italic: true }, borders = [{ kind: 'outer' }, { kind: 'bottom' }], options = {};
  if (problem === 'pen') borders[1].color = 'bad';
  if (problem === 'kind') borders[1].kind = 'bad';
  if (problem === 'paint') patch.rot = 91;
  if (problem === 'descriptor') patch.blBorder = { unknown: true };
  if (problem === 'work') options.maxWork = 10;
  const before = wb.toJSON(); expect(() => formatNativePivotStyleAndBorders(wb, new Map([['report', [{ ...data, c2: 6 }]]]), patch, borders, options)).toThrow();
  expect(wb.toJSON()).toEqual(before); expect(wb.undoLabels()).toEqual([]);
});
it('can compose from an explicitly empty prepared style without reviving the stored format', () => {
  const wb = fixture(); wb.applyStyle('report', data, { bold: true, bt: true }); const before = wb.toJSON();
  const cleared = wb.patchedCellStyle('report', 5, 4, { bold: null, bt: null }); expect(cleared).toBeUndefined();
  expect(wb.patchedCellStyle('report', 5, 4, { italic: true }, { baseStyle: cleared })).toEqual({ italic: true });
  expect(wb.toJSON()).toEqual(before);
});

function clearFixture() {
  const original = fixture().toJSON();
  original.normalFont = { name: 'Arial', sz: 12, color: '#123456' };
  const wb = new Workbook(original), sheet = wb.sheet('report');
  sheet.colStyles.set(4, { bold: true, bg: '#ffff00', fmt: 'currency' });
  sheet.rowStyles.set(6, { italic: true, indent: 3 });
  return wb;
}
it('clears native rules, rich text and line inheritance with ordinary Clear formats semantics', () => {
  const wb = clearFixture(), range = { ...data, c1: 3, c2: 6 };
  formatNativePivotStyleAndBorders(wb, new Map([['report', [range]]]), { italic: true, bg: '#ffeecc', fmt: 'percent' }, [{ kind: 'all', color: '#abcdef' }]);
  wb.setCells('report', [{ r: 5, c: 6, cell: { v: 'Link', richText: [{ text: 'Link', bold: true }], s: { nolink: true, bold: true } } }]);
  wb.clearHistory(); const before = wb.toJSON(), reference = new Workbook(before);
  reference.clearRange('report', range, { contents: false, styles: true });
  clearNativePivotSelection(wb, new Map([['report', [range, range]]]));
  for (let r = 5; r <= 6; r++) for (let c = 3; c <= 6; c++) {
    expect(wb.getCell('report', r, c)).toEqual(reference.getCell('report', r, c));
    expect(wb.styleAt('report', r, c)).toEqual(reference.styleAt('report', r, c));
    if (c < 6) expect(paint(wb, r, c)).toMatchObject({ font: 'arial', size: 16, color: '#123456', bold: false, italic: false, bg: 'transparent', code: 'General', bt: false, bb: false, bl: false, br: false });
  }
  expect(paint(wb, 7, 4)).toEqual({}); expect(wb.getCell('report', 5, 6).s).toEqual({ nolink: true });
  expect(wb.undoLabels()).toHaveLength(1); const after = wb.toJSON();
  wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
  // Later column formatting replaces inherited exceptions, just as ordinary clear does.
  const column = { r1: 0, r2: wb.sheet('report').rows - 1, c1: 4, c2: 4 };
  wb.applyStyle('report', column, { bold: true }); reference.applyStyle('report', column, { bold: true });
  expect(wb.styleAt('report', 5, 4)).toEqual(reference.styleAt('report', 5, 4));
});
it('retains clear-format native paint through export and sheet extraction', async () => {
  let wb = clearFixture(); formatNativePivotSelection(wb, new Map([['report', [data]]]), { italic: true, bg: '#ffff00' });
  clearNativePivotSelection(wb, new Map([['report', [data]]]));
  for (let cycle = 0; cycle < 3; cycle++) {
    wb = await nativeRoundTrip(cycle === 2 ? wb.sheetToWorkbook(wb.sheetByName('Report').id, { sourceWorkbook: '/Source.xlsx' }) : wb);
    for (let r = 5; r <= 6; r++) for (let c = 4; c <= 5; c++) {
      expect(paint(wb, r, c)).toMatchObject({ font: 'arial', italic: false, bg: 'transparent', code: 'General', bt: false });
      expect(wb.getValue(wb.sheetByName('Report').id, r, c)).toBe([[3, 5], [8, 13]][r - 5][c - 4]);
    }
  }
});
it.each(['grand', 'protected', 'font', 'work', 'merge'])('refuses an unsupported clear batch without changing cells, resets or rules (%s)', issue => {
  const wb = issue === 'font' ? fixture() : clearFixture(), range = { ...data, c2: 6 }, options = {};
  if (issue === 'grand') range.r2 = 7;
  if (issue === 'protected') wb.sheet('report').protectedRanges.push({ range: { r1: 6, r2: 6, c1: 6, c2: 6 } });
  if (issue === 'work') options.maxWork = 2;
  if (issue === 'merge') wb.sheet('report').merges.push({ r1: 5, r2: 5, c1: 4, c2: 5 });
  wb.clearHistory(); const before = wb.toJSON();
  expect(() => clearNativePivotSelection(wb, new Map([['report', [range]]]), options)).toThrow();
  expect(wb.toJSON()).toEqual(before); expect(wb.undoLabels()).toEqual([]);
});

it('clears only the selected native members while retaining dormant and unselected paint', () => {
  const wb = clearFixture();
  formatNativePivotSelection(wb, new Map([['report', [data]]]), { italic: true });
  const previous = wb.nativePivots.tables[0].xml;
  clearNativePivotSelection(wb, new Map([['report', [{ ...data, r2: 5 }]]]));
  expect(paint(wb, 5, 4).italic).toBe(false); expect(paint(wb, 6, 4).italic).toBe(true);
  expect(wb.nativePivots.tables[0].xml).not.toBe(previous);
  expect(readNativePivotFormats(wb.nativePivots.tables[0], wb.nativePivots)).toHaveLength(2);
});
it('accepts explicitly resolved rendered defaults for an otherwise unstyled workbook', () => {
  const wb = fixture(); clearNativePivotSelection(wb, new Map([['report', [data]]]), { defaultFont: 'Arial', defaultSize: 13 });
  expect(paint(wb, 5, 4)).toMatchObject({ font: 'arial', size: 13, bold: false, italic: false });
  expect(wb.getCell('report', 5, 4).s).toBeUndefined();
});

const paintedSource = () => [
  [{ s: { font: 'arial', size: 16, bold: true, bg: '#ffeeaa', bt: true, btBorder: { bs: 'double', bc: '#123456' } } },
   { s: { font: 'arial', size: 16, fmt: 'percent', dec: 2, italic: true, br: true, bc: '#654321' } }],
  [{ s: { font: 'arial', size: 16, color: '#0000ff', align: 'center', nolink: true } },
   { s: { font: 'arial', size: 16, wrap: true, rot: -45 } }],
];
it.each([5, 6, 7])('matches ordinary complete style paste for tiled and non-multiple targets ending at column %s', end => {
  const wb = clearFixture(), target = { ...data, c2: end }, source = paintedSource();
  wb.applyStyle('report', { ...data, c2: 7 }, { underline: true, italic: true, bg: '#ff0000', bl: true });
  wb.setCells('report', [{ r: 5, c: 4, cell: { v: 3, s: { nolink: true }, richText: [{ text: '3', bold: true }] } }]);
  wb.clearHistory(); const before = wb.toJSON(), reference = new Workbook(before);
  reference.pasteStyles('report', source, 5, 4, target);
  pasteNativePivotStyles(wb, 'report', source, 5, 4, target);
  for (let r = 5; r <= 6; r++) for (let c = 4; c <= 7; c++) {
    expect(wb.getCell('report', r, c)).toEqual(reference.getCell('report', r, c));
    expect(wb.styleAt('report', r, c)).toEqual(reference.styleAt('report', r, c));
  }
  expect(paint(wb, 5, 4)).toMatchObject({ bold: true, italic: false, underline: false, bg: '#ffeeaa', bt: true, bl: false });
  expect(paint(wb, 5, 5)).toMatchObject({ italic: true, code: '#,##0.00%', br: true });
  expect(wb.getCell('report', 6, 4).s.nolink).toBeUndefined();
  expect(wb.getCell('report', 5, 4).s.nolink).toBe(true);
  expect(wb.undoLabels()).toHaveLength(1); const after = wb.toJSON();
  wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it('replaces a native cell with a blank source format using resolved app defaults', () => {
  const wb = clearFixture(); wb.applyStyle('report', data, { italic: true, bg: '#ff0000' });
  const reference = new Workbook(wb.toJSON()); reference.pasteStyles('report', [[null]], 5, 4, data);
  pasteNativePivotStyles(wb, 'report', [[null]], 5, 4, data, { defaultFont: 'Arial', defaultSize: 13 });
  for (let r = 5; r <= 6; r++) for (let c = 4; c <= 5; c++) expect(wb.styleAt('report', r, c)).toEqual(reference.styleAt('report', r, c));
  expect(paint(wb, 5, 4)).toMatchObject({ font: 'arial', size: 13, italic: false, bold: false, bg: 'transparent' });
});
it('retains painted replacements through native export cycles and sheet extraction', async () => {
  let wb = clearFixture(); pasteNativePivotStyles(wb, 'report', paintedSource(), 5, 4, data);
  const expected = [paint(wb, 5, 4), paint(wb, 5, 5), paint(wb, 6, 4), paint(wb, 6, 5)];
  for (let cycle = 0; cycle < 3; cycle++) {
    wb = await nativeRoundTrip(cycle === 2 ? wb.sheetToWorkbook(wb.sheetByName('Report').id, { sourceWorkbook: '/Source.xlsx' }) : wb);
    expect([paint(wb, 5, 4), paint(wb, 5, 5), paint(wb, 6, 4), paint(wb, 6, 5)]).toEqual(expected);
  }
});
it.each(['ragged', 'pen', 'clip', 'font', 'grand', 'protected', 'limit'])('refuses an invalid complete style paste before any writes (%s)', issue => {
  const wb = clearFixture(), source = paintedSource(), target = { ...data, c2: 7 }, options = {};
  if (issue === 'ragged') source[1].pop();
  if (issue === 'pen') source[1][1].s.blBorder = { invalid: true };
  if (issue === 'clip') source[1][1].s.clip = true;
  if (issue === 'font') source[1][1] = null;
  if (issue === 'grand') target.r2 = 8;
  if (issue === 'protected') wb.sheet('report').protectedRanges.push({ range: { r1: 6, r2: 6, c1: 7, c2: 7 } });
  if (issue === 'limit') options.maxCells = 3;
  const before = wb.toJSON();
  expect(() => pasteNativePivotStyles(wb, 'report', source, 5, 4, target, options)).toThrow();
  expect(wb.toJSON()).toEqual(before); expect(wb.undoLabels()).toEqual([]);
});

const withoutRuleIds = rules => rules.map(({ id, ...rule }) => rule);
const clipboardSource = () => Array.from({ length: 2 }, () => Array.from({ length: 5 }, () => ({ s: { font: 'arial', size: 16, bold: true, bg: '#ffeecc' } })));
const clipboardRange = { r1: 5, r2: 6, c1: 3, c2: 7 };
const copiedRule = value => [{ range: { r1: 0, r2: 1, c1: 0, c2: 4 }, source: { r: 0, c: 0 },
  rule: { type: 'formula', range: { r1: 0, r2: 1, c1: 0, c2: 4 }, value, style: { color: '#ff0000' } } }];
it('commits native paint, ordinary merge geometry and conditional rules in one clipboard edit', () => {
  const wb = clearFixture(), cells = clipboardSource();
  wb.addRule('report', { range: { r1: 4, r2: 8, c1: 3, c2: 7 }, type: 'formula', value: 'D5>2', style: { italic: true } });
  wb.setCells('report', [{ r: 6, c: 7, cell: { f: '1+2', s: { italic: true } } }]); wb.clearHistory();
  const options = { merges: [{ r1: 0, r2: 1, c1: 3, c2: 4 }], conditionalFormats: copiedRule('A1>1') };
  const before = wb.toJSON(), reference = new Workbook(before);
  reference.pasteStyles('report', cells, 5, 3, clipboardRange, options);
  expect(pasteNativePivotClipboardStyles(wb, 'report', cells, 5, 3, clipboardRange, options)).toBe(true);
  expect(wb.sheet('report').merges).toEqual(reference.sheet('report').merges);
  expect(withoutRuleIds(wb.sheet('report').rules)).toEqual(withoutRuleIds(reference.sheet('report').rules));
  for (let r = 5; r <= 6; r++) for (let c = 3; c <= 7; c++) expect(wb.getCell('report', r, c)).toEqual(reference.getCell('report', r, c));
  expect(wb.getCell('report', 6, 7).f).toBe('1+2'); expect(paint(wb, 5, 4).bold).toBe(true);
  expect(wb.undoLabels()).toHaveLength(1); const after = wb.toJSON();
  wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it('clears copied-empty conditional rules and ordinary merges without clearing native values', () => {
  const wb = clearFixture(), cells = clipboardSource();
  wb.mergeCells('report', { r1: 5, r2: 6, c1: 6, c2: 7 });
  wb.addRule('report', { range: clipboardRange, type: 'formula', value: 'TRUE', style: { italic: true } }); wb.clearHistory();
  pasteNativePivotClipboardStyles(wb, 'report', cells, 5, 3, clipboardRange, { merges: [], conditionalFormats: [] });
  expect(wb.sheet('report').merges).toEqual([]); expect(wb.sheet('report').rules).toEqual([]); expect(wb.getValue('report', 5, 4)).toBe(3);
});
it('reindexes copied conditional references without shifting destination formula links', () => {
  const wb = clearFixture(), cells = clipboardSource();
  const links = (target, value) => ({ version: 1, books: [{ target, sheets: [{ name: 'Data', cells: { '0,0': value } }] }] });
  wb.externalWorkbooks = links('/Existing.xlsx', 9);
  wb.setCells('report', [{ r: 5, c: 6, cell: { f: '[1]Data!A1' } }]); wb.clearHistory(); const before = wb.toJSON();
  pasteNativePivotClipboardStyles(wb, 'report', cells, 5, 3, clipboardRange,
    { merges: [], conditionalFormats: copiedRule('[1]Data!$A$1>0'), externalWorkbooks: links('/Copied.xlsx', 3) });
  expect(wb.externalWorkbooks.books).toHaveLength(2); expect(wb.sheet('report').rules[0].value).toContain('[2]Data');
  expect(wb.getCell('report', 5, 6).f).toBe('[1]Data!A1'); expect(wb.getValue('report', 5, 6)).toBe(9);
  expect(wb.undoLabels()).toHaveLength(1); const after = wb.toJSON();
  wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it.each(['native merge', 'partial merge', 'ordinary protected merge', 'malformed rule', 'array merge'])('refuses clipboard metadata before native cells or rules change (%s)', issue => {
  const wb = clearFixture(), options = { merges: [], conditionalFormats: copiedRule('TRUE') }, cells = clipboardSource();
  if (issue === 'native merge') options.merges = [{ r1: 0, r2: 1, c1: 0, c2: 1 }];
  if (issue === 'partial merge') wb.mergeCells('report', { r1: 6, r2: 7, c1: 6, c2: 7 });
  if (issue === 'ordinary protected merge') { options.merges = [{ r1: 0, r2: 1, c1: 3, c2: 4 }]; wb.protectRange('report', { r1: 6, r2: 6, c1: 7, c2: 7 }); }
  if (issue === 'malformed rule') options.conditionalFormats.push({ rule: { type: 'formula', value: 'TRUE' } });
  if (issue === 'array merge') { options.merges = [{ r1: 0, r2: 1, c1: 3, c2: 4 }]; wb.setCells('report', [{ r: 5, c: 6, cell: { f: '1', array: { rows: 2, cols: 1 } } }]); }
  wb.clearHistory(); const before = wb.toJSON();
  let result = false;
  try { result = pasteNativePivotClipboardStyles(wb, 'report', cells, 5, 3, clipboardRange, options); } catch { /* Unsupported metadata may throw; refusal must still be atomic. */ }
  expect(result).toBe(false);
  expect(wb.toJSON()).toEqual(before); expect(wb.undoLabels()).toEqual([]);
});
it('prepares native formats without writes and protects the plan from changed state and exposed entries', () => {
  const wb = clearFixture(), before = wb.toJSON();
  const plan = pasteNativePivotStyles(wb, 'report', paintedSource(), 5, 4, data, { prepareOnly: true });
  expect(wb.toJSON()).toEqual(before); expect(wb.undoLabels()).toEqual([]);
  plan.entries.get('report')[0].cell.v = 'tampered'; plan.commit();
  expect(wb.getValue('report', 5, 4)).toBe(3); expect(() => plan.commit()).toThrow(/stale/);
  const stale = pasteNativePivotStyles(wb, 'report', paintedSource(), 5, 4, data, { prepareOnly: true });
  wb.setInput('report', 0, 0, 'unrelated edit'); const changed = wb.toJSON();
  expect(() => stale.commit()).toThrow(/stale/); expect(wb.toJSON()).toEqual(changed);
});

it('retains clipboard rules, ordinary merges and native paint through export and sheet extraction', async () => {
  let wb = clearFixture();
  pasteNativePivotClipboardStyles(wb, 'report', clipboardSource(), 5, 3, clipboardRange,
    { merges: [{ r1: 0, r2: 1, c1: 3, c2: 4 }], conditionalFormats: copiedRule('A1>1') });
  for (let cycle = 0; cycle < 3; cycle++) {
    wb = await nativeRoundTrip(cycle === 2 ? wb.sheetToWorkbook(wb.sheetByName('Report').id, { sourceWorkbook: '/Source.xlsx' }) : wb);
    const sheet = wb.sheetByName('Report');
    expect(sheet.merges).toEqual([{ r1: 5, r2: 6, c1: 6, c2: 7 }]);
    expect(sheet.rules.some(rule => rule.type === 'formula' && rule.value === 'D6>1')).toBe(true);
    expect(paint(wb, 5, 4)).toMatchObject({ bold: true, font: 'arial', bg: '#ffeecc' });
    expect(wb.getValue(sheet.id, 5, 4)).toBe(3);
  }
});

it('bounds clipboard metadata expansion before committing a valid native style plan', () => {
  const wb = clearFixture(), cells = clipboardSource(), options = { maxWork: 1000 };
  expect(pasteNativePivotStyles(wb, 'report', cells, 5, 3, clipboardRange, { ...options, prepareOnly: true }).commit).toBeTypeOf('function');
  const before = wb.toJSON();
  expect(() => pasteNativePivotClipboardStyles(wb, 'report', cells, 5, 3, clipboardRange,
    { ...options, conditionalFormats: Array.from({ length: 1001 }, () => copiedRule('TRUE')[0]) })).toThrow(/metadata work limit/);
  expect(wb.toJSON()).toEqual(before); expect(wb.undoLabels()).toEqual([]);
});
