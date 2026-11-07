import { nativePivotPaintAt } from '../src/core/native-pivot-paint.js';
import { expect, it } from 'vitest';
import { AUTOMATIC_FORMAT, styleToNumFmt } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { nativePivotPaintDelta } from '../src/core/native-pivot-paint-delta.js';
import { formatNativePivotSelection } from '../src/core/native-pivot-style-selection.js';
import { nativePivotSelectionAreas } from '../src/core/native-pivot-selection-areas.js';
import { nativePivotCellArea } from '../src/core/native-pivot-cell-area.js';
import { applyNativePivotFormats as apply } from '../src/core/native-pivot-format-edit.js';
import { planNativePivotReport } from '../src/core/native-pivot-report.js';
import { writeNativePivotAxes } from '../src/core/native-pivot-axis-xml.js';
import { parseRefText } from '../src/core/refs.js';
import { readNativePivotFormats } from '../src/core/native-pivot-formats.js';
import { nativeRoundTrip } from './helpers/linked-model-workbook.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const xml = (name, body, attrs = '') => `<${name} xmlns="${MAIN}" ${attrs}>${body}</${name}>`;
const area = (item = 0) => xml('pivotArea', `<references count="1"><reference field="0" count="1"><x v="${item}"/></reference></references>`);
function fixture() {
  const wb = new Workbook({ sheets: [{ id: 'a', name: 'First' }, { id: 'b', name: 'Second' }, { name: 'Source', cells: {
    '0,0': { v: 'Region' }, '0,1': { v: 'Amount' }, '1,0': { v: 'East' }, '1,1': { v: 3 }, '2,0': { v: 'West' }, '2,1': { v: 8 },
  } }] });
  const cache = { key: 'c', xml: xml('pivotCacheDefinition', '<cacheSource type="worksheet"><worksheetSource sheet="Source" ref="A1:B3"/></cacheSource><cacheFields count="2"><cacheField name="Region"><sharedItems count="2"><s v="East"/><s v="West"/></sharedItems></cacheField><cacheField name="Amount"/></cacheFields>', 'recordCount="2"'), records: xml('pivotCacheRecords', '<r><x v="0"/><n v="3"/></r><r><x v="1"/><n v="8"/></r>', 'count="2"') };
  wb.nativePivots = { version: 1, caches: [cache], tables: [], dxfs: [], formats: {} };
  const updates = ['a', 'b'].map(owner => {
    const name = `Summary_${owner}`;
    const pivot = { owner, cache: 'c', name, ref: 'D5:E8', xml: xml('pivotTableDefinition', '<location ref="D5:E8" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/><pivotFields count="2"><pivotField axis="axisRow"><items count="2"><item x="0"/><item x="1"/></items></pivotField><pivotField dataField="1"/></pivotFields><rowFields count="1"><field x="0"/></rowFields><dataFields count="1"><dataField fld="1" name="Amount"/></dataFields>', `name="${name}" dataCaption="Values"`) };
    const plan = planNativePivotReport(pivot, cache);
    wb.nativePivots.tables.push(plan.pivot);
    wb.setCells(owner, plan.cells.map(({ r, c, value }) => ({ r, c, cell: { v: value, s: { bg: '#abcdef', bold: true } } })));
    wb.setCells(owner, [{ r: 0, c: 0, cell: { v: 'Unrelated' } }]);
    const patch = { bold: null, italic: true, fmt: 'custom', code: '0.00" units"' };
    const style = nativePivotPaintDelta({ ...wb._lineStyle(wb.sheet(owner), 5, 4), ...wb.patchedCellStyle(owner, 5, 4, patch) }, Object.keys(patch));
    return { pivot: plan.pivot, layout: plan.layout, edits: [{ area: nativePivotCellArea(plan.layout, 5, 4), style }] };
  });
  wb.clearHistory(); return { wb, updates };
}
it('writes several reports and registries in one observable undo/redo transaction', () => {
  const { wb, updates } = fixture(), before = wb.toJSON(), seen = [];
  wb.addEventListener('change', () => seen.push(wb.nativePivots.tables.every(p => readNativePivotFormats(p, wb.nativePivots).length === 1)
    && ['a', 'b'].every(id => wb.getCell(id, 5, 4).s.italic)));
  expect(apply(wb, updates)).toBe(true);
  expect(seen.length).toBeGreaterThan(0); expect(seen.every(Boolean)).toBe(true);
  expect(wb.nativePivots.dxfs).toHaveLength(1); expect(wb.nativePivots.formats).toEqual({ 164: '0.00" units"' });
  for (const id of ['a', 'b']) {
    expect(wb.getCell(id, 5, 4)).toMatchObject({ v: 3, s: { bold: false, italic: true, bg: '#abcdef', code: '0.00" units"' } });
    expect(wb.getCell(id, 6, 4)).toMatchObject({ v: 8, s: { bold: true, bg: '#abcdef' } });
    expect(wb.getValue(id, 0, 0)).toBe('Unrelated');
  }
  expect(wb.undoLabels()).toEqual(['Format pivot reports']);
  const after = wb.toJSON(); updates[0].edits[0].style.code = 'changed';
  wb.undo(); expect(wb.toJSON()).toEqual(before);
  wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it.each(['sheet', 'external', 'range', 'merge', 'stale', 'duplicate', 'layout', 'axes', 'paint', 'selector', 'clone', 'overlap'])('preflights the entire batch before any write for %s', problem => {
  const { wb, updates } = fixture(), last = updates[1], sheet = wb.sheet('b');
  if (problem === 'sheet') sheet.protected = true;
  if (problem === 'external') sheet.externalCache = true;
  if (problem === 'range') sheet.protectedRanges.push({ range: { r1: 5, r2: 5, c1: 4, c2: 4 } });
  if (problem === 'merge') sheet.merges.push({ r1: 5, r2: 5, c1: 4, c2: 5 });
  if (problem === 'stale') last.pivot = { ...last.pivot };
  if (problem === 'duplicate') updates.push(updates[0]);
  if (problem === 'layout') last.layout = { ...last.layout, name: 'Different' };
  if (problem === 'axes') last.layout = { ...last.layout, rows: { ...last.layout.rows, items: [...last.layout.rows.items].reverse() } };
  if (problem === 'paint') last.edits[0].style.rot = 91;
  if (problem === 'selector') last.edits[0].area = area(99);
  if (problem === 'clone') sheet.cells.get('5,4').uncloneable = () => {};
  if (problem === 'overlap') wb.nativePivots.tables.push({ ...last.pivot, name: 'Other' });
  const before = wb.toJSON(), native = wb.nativePivots;
  expect(() => apply(wb, updates)).toThrow(); expect(wb.toJSON()).toEqual(before);
  expect(wb.nativePivots).toBe(native); expect(wb.undoLabels()).toEqual([]);
});
it('bounds total cells and selector/paint work across reports, including overlapping rules', () => {
  const { wb, updates } = fixture(), before = wb.toJSON();
  expect(() => apply(wb, updates, { maxCells: 1 })).toThrow(/cell limit/);
  expect(() => apply(wb, updates, { maxWork: 1 })).toThrow(/work limit/);
  expect(() => apply(wb, updates, { maxXmlLength: 1 })).toThrow(/XML size/);
  expect(wb.toJSON()).toEqual(before);
  updates[0].edits.push({ area: area(), style: { italic: false, underline: true } });
  expect(apply(wb, updates, { maxCells: 2 })).toBe(true);
  expect(wb.getCell('a', 5, 4).s).toMatchObject({ italic: false, underline: true });
});
it('preserves formulas and updates rich-text overrides only for authored font properties', () => {
  const { wb, updates } = fixture();
  wb.sheet('a').cells.set('5,4', { v: null, f: '1+2', array: { rows: 1, cols: 1 }, s: { bg: '#abcdef' } });
  wb.sheet('b').cells.set('5,4', { v: 'AB', richText: [{ text: 'A', s: { bold: true, color: '#123456' } }, { text: 'B', s: { italic: false } }] });
  apply(wb, updates);
  expect(wb.getCell('a', 5, 4)).toMatchObject({ f: '1+2', array: { rows: 1, cols: 1 }, s: { italic: true } });
  expect(wb.getCell('b', 5, 4)).toMatchObject({ v: 'AB', richText: [{ text: 'A', s: { color: '#123456' } }, { text: 'B' }] });
});
it('keeps dormant rules undoable and treats an empty batch as no edit', () => {
  const { wb, updates } = fixture();
  expect(apply(wb, [])).toBe(false);
  expect(apply(wb, updates.map(u => ({ ...u, edits: [] })))).toBe(false);
  const u = updates[0]; u.layout = { ...u.layout, rows: { ...u.layout.rows, items: [u.layout.rows.items[1]] } };
  u.pivot = writeNativePivotAxes(u.pivot, u.layout); u.layout.range = parseRefText(u.pivot.ref);
  wb.nativePivots.tables[0] = u.pivot;
  const before = wb.toJSON();
  expect(apply(wb, [u], { maxCells: 0 })).toBe(true);
  expect(wb.sheet('a').cells.get('5,4').s.italic).toBeUndefined();
  expect(readNativePivotFormats(wb.nativePivots.tables[0], wb.nativePivots)).toHaveLength(1);
  wb.undo(); expect(wb.toJSON()).toEqual(before);
});
it('round-trips authored cells, new format IDs and rules through native XLSX and worksheet extraction', async () => {
  let { wb, updates } = fixture(); apply(wb, updates);
  for (let i = 0; i < 2; i++) {
    wb = await nativeRoundTrip(wb);
    for (const p of wb.nativePivots.tables) {
      expect(readNativePivotFormats(p, wb.nativePivots)).toHaveLength(1);
      expect(wb.getCell(p.owner, 5, 4)).toMatchObject({ v: 3, s: { italic: true, code: '0.00" units"' } });
    }
  }
  const copy = await nativeRoundTrip(wb.sheetToWorkbook(wb.sheetByName('First').id, { sourceWorkbook: '/Reports.xlsx' }));
  expect(copy.nativePivots.tables).toHaveLength(1);
  expect(readNativePivotFormats(copy.nativePivots.tables[0], copy.nativePivots)).toHaveLength(1);
  expect(copy.getCell(copy.sheetByName('First').id, 5, 4).s.code).toBe('0.00" units"');
});
it('applies explicit resets over inherited line styles and paints per-area border geometry', () => {
  const { wb, updates } = fixture(), u = updates[0];
  wb.sheet('a').colStyles.set(4, { bold: true, wrap: true, indent: 3, align: 'right' });
  u.edits = [{ area: xml('pivotArea', '<references count="1"><reference field="0" count="2"><x v="0"/><x v="1"/></reference></references>'),
    style: { bold: false, wrap: false, align: null, indent: 0, bg: 'transparent', fmt: 'custom', code: 'General',
      bt: true, btBorder: { bs: 'double', bc: '#112233' }, bh: true, bhBorder: { bs: 'dashed', bc: '#aabbcc' }, bb: false } }];
  apply(wb, [u]);
  expect(wb.styleAt('a', 5, 4)).toMatchObject({ bold: false, wrap: false, align: null, indent: 0, bg: 'transparent', code: 'General',
    btBorder: { bs: 'double', bc: '#112233' }, bbBorder: { bs: 'dashed', bc: '#aabbcc' } });
  expect(wb.styleAt('a', 6, 4)).toMatchObject({ btBorder: { bs: 'dashed', bc: '#aabbcc' }, bb: false });
});
it('shares work limits across reports instead of resetting the budget for each report', () => {
  const single = fixture(); expect(apply(single.wb, single.updates.slice(0, 1), { maxWork: 60 })).toBe(true);
  const { wb, updates } = fixture(), before = wb.toJSON();
  expect(() => apply(wb, updates, { maxWork: 60 })).toThrow(/work limit/);
  expect(wb.toJSON()).toEqual(before); expect(wb.undoLabels()).toEqual([]);
});

it('does not require layouts for unrelated reports on other sheets', () => {
  const { wb, updates } = fixture();
  wb.nativePivots.tables.push({ owner: 'unrelated', name: 'Unsupported report' });
  expect(apply(wb, updates)).toBe(true);
});

it('commits grouped multi-member areas and retains them through native XLSX', async () => {
  let { wb, updates } = fixture();
  for (const update of updates) {
    const style = update.edits[0].style;
    update.edits = nativePivotSelectionAreas(update.layout, [{ r1: 5, r2: 6, c1: 4, c2: 4 }]).map(area => ({ area, style }));
    expect(update.edits).toHaveLength(1);
  }
  const before = wb.toJSON(); apply(wb, updates); const after = wb.toJSON();
  wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
  wb = await nativeRoundTrip(wb);
  for (const p of wb.nativePivots.tables) {
    expect(readNativePivotFormats(p, wb.nativePivots)).toHaveLength(1);
    for (const r of [5, 6]) expect(wb.getCell(p.owner, r, 4).s).toMatchObject({ italic: true, code: '0.00" units"' });
  }
});
it('formats ordinary cells and native reports in one observable history step', async () => {
  let { wb, updates } = fixture(); const sheet = wb.sheet('a');
  sheet.colStyles.set(0, { bold: true, fmt: 'currency', cur: 'EUR' });
  sheet.cells.set('0,0', { v: 'Text', richText: [{ text: 'Text', s: { bold: true, color: '#123456' } }] });
  const patch = { bold: null, dec: 3 }, ordinaryEdits = new Map([
    ['a', [{ r: 0, c: 0, patch }]], ['b', [{ r: 0, c: 0, patch: { italic: true } }]],
  ]);
  const before = wb.toJSON(), seen = [];
  wb.addEventListener('change', () => seen.push(wb.getCell('a', 5, 4).s.italic && wb.getCell('b', 0, 0).s.italic));
  expect(apply(wb, updates, { ordinaryEdits })).toBe(true);
  expect(seen.length).toBeGreaterThan(0); expect(seen.every(Boolean)).toBe(true);
  expect(wb.styleAt('a', 0, 0)).toMatchObject({ bold: null, fmt: 'currency', cur: 'EUR', dec: 3 });
  expect(wb.getCell('a', 0, 0).richText).toEqual([{ text: 'Text', s: { color: '#123456' } }]);
  const after = wb.toJSON(); patch.dec = 8;
  expect(wb.undoLabels()).toEqual(['Format pivot reports']);
  wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
  wb = await nativeRoundTrip(wb);
  expect(wb.getCell(wb.sheetByName('Second').id, 0, 0)).toMatchObject({ v: 'Unrelated', s: { italic: true } });
  for (const p of wb.nativePivots.tables) expect(readNativePivotFormats(p, wb.nativePivots)).toHaveLength(1);
});
it.each(['sheet', 'range', 'bounds', 'duplicate', 'native', 'otherNative', 'clone', 'patch', 'limit'])('rejects the complete mixed edit before any write for ordinary %s failure', problem => {
  const { wb, updates } = fixture(), entries = [{ r: 0, c: 0, patch: { bold: true } }], sheet = wb.sheets[2];
  const ordinaryEdits = new Map([[sheet.id, entries]]);
  if (problem === 'sheet') sheet.protected = true;
  if (problem === 'range') sheet.protectedRanges.push({ range: { r1: 0, r2: 0, c1: 0, c2: 0 } });
  if (problem === 'bounds') entries[0].r = 1048576;
  if (problem === 'duplicate') entries.push(entries[0]);
  if (problem === 'native' || problem === 'otherNative') {
    ordinaryEdits.clear(); ordinaryEdits.set(problem === 'native' ? 'a' : 'b', [{ r: 5, c: 4, patch: { italic: true } }]);
    if (problem === 'otherNative') updates.pop();
  }
  if (problem === 'clone') entries[0].patch.color = () => {};
  if (problem === 'patch') entries[0].patch = null;
  const before = wb.toJSON(), native = wb.nativePivots;
  expect(() => apply(wb, updates, { ordinaryEdits, ...(problem === 'limit' ? { maxCells: 2 } : {}) })).toThrow();
  expect(wb.toJSON()).toEqual(before); expect(wb.nativePivots).toBe(native); expect(wb.undoLabels()).toEqual([]);
});
it('preserves ordinary formulas and permits a cell-only transaction without changing native metadata', () => {
  const { wb } = fixture(), native = wb.nativePivots;
  wb.sheet('a').cells.set('0,0', { f: '1+2', v: null, array: { rows: 1, cols: 1 } });
  const before = wb.toJSON();
  expect(apply(wb, [], { ordinaryEdits: new Map([['a', [{ r: 0, c: 0, patch: { bold: true } }]]]) })).toBe(true);
  expect(wb.getCell('a', 0, 0)).toMatchObject({ f: '1+2', array: { rows: 1, cols: 1 }, s: { bold: true } });
  expect(wb.nativePivots).toBe(native); wb.undo(); expect(wb.toJSON()).toEqual(before);
  expect(apply(wb, [], { ordinaryEdits: new Map([['a', []]]) })).toBe(false);
});

it('resets an ordinary spill destination format while retaining its calculated value and anchor format', () => {
  const { wb, updates } = fixture();
  wb.sheet('a').cells.set('0,0', { f: 'SEQUENCE(2)', v: null, s: { fmt: 'percent', dec: 2 } });
  expect(wb.getValue('a', 1, 0)).toBe(2);
  apply(wb, updates, { ordinaryEdits: new Map([['a', [{ r: 1, c: 0, patch: AUTOMATIC_FORMAT }]]]) });
  expect(wb.getValue('a', 1, 0)).toBe(2);
  expect(styleToNumFmt(wb.displayStyleAt('a', 1, 0))).toBe('General');
  expect(wb.getCell('a', 0, 0)).toMatchObject({ f: 'SEQUENCE(2)', s: { fmt: 'percent', dec: 2 } });
});

it('prepares complete mixed selections from saved axes and resolves different effective number formats', async () => {
  let { wb } = fixture();
  wb.sheet('a').cells.get('5,4').s = { fmt: 'number', dec: 1, group: false, bg: '#abcdef' };
  wb.sheet('a').cells.get('6,4').s = { fmt: 'percent', dec: 1, group: false, bg: '#abcdef' };
  const ranges = new Map([['a', [{ r1: 5, r2: 6, c1: 4, c2: 5 }]], ['b', [{ r1: 5, r2: 6, c1: 4, c2: 4 }]]]);
  const before = wb.toJSON();
  expect(formatNativePivotSelection(wb, ranges, { dec: 3 }, { locale: 'en-US' })).toBe(true);
  expect(wb.getCell('a', 5, 4).s).toEqual({ fmt: 'number', dec: 3, group: false, bg: '#abcdef' });
  expect(wb.getCell('a', 6, 4).s).toEqual({ fmt: 'percent', dec: 3, group: false, bg: '#abcdef' });
  expect(wb.getCell('a', 5, 5).s).toEqual({ dec: 3 });
  expect(readNativePivotFormats(wb.nativePivots.tables[0], wb.nativePivots)).toHaveLength(2);
  const after = wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
  wb = await nativeRoundTrip(wb);
  const id = wb.sheetByName('First').id;
  expect(styleToNumFmt(wb.styleAt(id, 5, 4))).toBe('0.000');
  expect(styleToNumFmt(wb.styleAt(id, 6, 4))).toBe('0.000%');
});
it('deduplicates overlapping selections and groups uniform native deltas', () => {
  const { wb } = fixture(), range = { r1: 5, r2: 6, c1: 3, c2: 5 };
  expect(formatNativePivotSelection(wb, new Map([['a', [range, range]]]), { italic: true }, { maxCells: 6 })).toBe(true);
  expect(readNativePivotFormats(wb.nativePivots.tables[0], wb.nativePivots)).toHaveLength(2);
  for (let r = 5; r <= 6; r++) for (let c = 3; c <= 5; c++) expect(wb.getCell('a', r, c).s.italic).toBe(true);
});
it.each(['protected', 'grand', 'header', 'bounds', 'scope', 'paint', 'border', 'cells', 'work', 'areas', 'xml'])('refuses whole selection preparation before mutation for %s', problem => {
  const { wb } = fixture(), range = { r1: 5, r2: 6, c1: 4, c2: 5 }, patch = { italic: true }, options = {};
  if (problem === 'protected') wb.sheet('a').protectedRanges.push({ range: { r1: 6, r2: 6, c1: 5, c2: 5 } });
  if (problem === 'grand') range.r2 = 7;
  if (problem === 'header') range.r1 = 4;
  if (problem === 'bounds') range.r2 = 1048576;
  if (problem === 'scope') range.scope = 'columns';
  if (problem === 'paint') patch.rot = 91;
  if (problem === 'border') patch.bh = true;
  if (problem === 'cells') options.maxCells = 1;
  if (problem === 'work') options.maxWork = 1;
  if (problem === 'areas') options.maxFormats = 0;
  if (problem === 'xml') options.maxXmlLength = 1;
  const before = wb.toJSON();
  expect(() => formatNativePivotSelection(wb, new Map([['a', [range]]]), patch, options)).toThrow();
  expect(wb.toJSON()).toEqual(before); expect(wb.undoLabels()).toEqual([]);
});
it('does not refresh or query the cache when formatting saved report cells', () => {
  const { wb } = fixture(); wb.nativePivots.caches[0].records = 'not queryable';
  expect(formatNativePivotSelection(wb, new Map([['a', [{ r1: 5, r2: 5, c1: 4, c2: 4 }]]]), { bold: null })).toBe(true);
  expect(wb.getCell('a', 5, 4).v).toBe(3); expect(!!wb.styleAt('a', 5, 4)?.bold).toBe(false);
});
it('treats empty finite selections and empty patches as no edits', () => {
  const { wb } = fixture();
  expect(formatNativePivotSelection(wb, new Map(), { italic: true })).toBe(false);
  expect(formatNativePivotSelection(wb, new Map([['a', []]]), { italic: true })).toBe(false);
  expect(formatNativePivotSelection(wb, new Map([['a', [{ r1: 5, r2: 6, c1: 4, c2: 4 }]]]), {})).toBe(false);
  expect(wb.undoLabels()).toEqual([]);
});
it.each([true, false])('derives saved outline header semantics without refreshing (top subtotal=%s)', top => {
  const { wb } = fixture(), cache = wb.nativePivots.caches[0], old = wb.nativePivots.tables[0];
  cache.xml = xml('pivotCacheDefinition', '<cacheSource type="worksheet"><worksheetSource sheet="Source" ref="A1:C3"/></cacheSource><cacheFields count="3"><cacheField name="Region"><sharedItems count="1"><s v="A"/></sharedItems></cacheField><cacheField name="City"><sharedItems count="2"><s v="X"/><s v="Y"/></sharedItems></cacheField><cacheField name="Amount"/></cacheFields>', 'recordCount="2"');
  cache.records = xml('pivotCacheRecords', '<r><x v="0"/><x v="0"/><n v="3"/></r><r><x v="0"/><x v="1"/><n v="8"/></r>', 'count="2"');
  const source = wb.sheetByName('Source');
  source.cells.clear();
  [['Region', 'City', 'Amount'], ['A', 'X', 3], ['A', 'Y', 8]].forEach((row, r) => row.forEach((v, c) => source.cells.set(`${r},${c}`, { v })));
  const pivot = { ...old, ref: 'D5:F8', xml: xml('pivotTableDefinition', `<location ref="D5:F8" firstHeaderRow="0" firstDataRow="1" firstDataCol="2"/><pivotFields count="3"><pivotField axis="axisRow" compact="0" subtotalTop="${top ? 1 : 0}"><items count="1"><item x="0"/></items></pivotField><pivotField axis="axisRow" compact="0"><items count="2"><item x="0"/><item x="1"/></items></pivotField><pivotField dataField="1"/></pivotFields><rowFields count="2"><field x="0"/><field x="1"/></rowFields><rowItems count="3"><i><x/></i><i r="1"><x/></i><i r="1"><x v="1"/></i></rowItems><dataFields count="1"><dataField fld="2" name="Amount"/></dataFields>`, `name="${old.name}"`) };
  wb.nativePivots.tables = [pivot];
  wb.sheet('a').cells.set('5,3', { v: 'A' }); wb.sheet('a').cells.set('5,5', { v: top ? 11 : null });
  const selection = c => new Map([['a', [{ r1: 5, r2: 5, c1: c, c2: c }]]]);
  expect(formatNativePivotSelection(wb, selection(3), { italic: true })).toBe(true);
  const rule = readNativePivotFormats(wb.nativePivots.tables[0], wb.nativePivots)[0];
  expect(rule.area.references[0].subtotals).toEqual(top ? ['defaultSubtotal'] : []);
  if (top) expect(formatNativePivotSelection(wb, selection(5), { bold: true })).toBe(true);
  else {
    const before = wb.toJSON(); expect(() => formatNativePivotSelection(wb, selection(5), { bold: true })).toThrow(/nonaggregate header/);
    expect(wb.toJSON()).toEqual(before);
  }
});

it('retains editor number-format intent while native rules carry complete codes', () => {
  const { wb } = fixture(), ranges = new Map([['a', [{ r1: 5, r2: 6, c1: 4, c2: 4 }]]]);
  const patch = { fmt: 'currency', cur: 'EUR', dec: 3, group: false };
  const before = wb.toJSON();
  formatNativePivotSelection(wb, ranges, patch, { locale: 'en-US' });
  for (const r of [5, 6]) expect(wb.getCell('a', r, 4).s).toMatchObject(patch);
  const rules = readNativePivotFormats(wb.nativePivots.tables[0], wb.nativePivots);
  expect(rules[0].dxf).toContain('formatCode='); expect(rules[0].dxf).not.toContain('bgColor');
  const after = wb.toJSON(); patch.dec = 8;
  wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it('keeps sparse inherited resets and rich-text intent for native cells', () => {
  const { wb } = fixture(), sheet = wb.sheet('a');
  sheet.colStyles.set(4, { bold: true, wrap: true, fmt: 'percent' });
  sheet.cells.set('5,4', { v: 'Text', richText: [{ text: 'Text', s: { bold: true, color: '#123456' } }] });
  formatNativePivotSelection(wb, new Map([['a', [{ r1: 5, r2: 5, c1: 4, c2: 4 }]]]), { bold: null, wrap: null, ...AUTOMATIC_FORMAT });
  expect(wb.getCell('a', 5, 4)).toMatchObject({ v: 'Text', s: { bold: null, wrap: null, fmt: null }, richText: [{ text: 'Text', s: { color: '#123456' } }] });
  expect(styleToNumFmt(wb.styleAt('a', 5, 4))).toBe('General');
});
it.each(['mismatch', 'extraProperty', 'missing', 'duplicate', 'outside', 'clone', 'late'])('refuses incompatible native editor patches atomically (%s)', problem => {
  const { wb, updates } = fixture();
  const patch = { bold: null, italic: true, fmt: 'custom', code: '0.00" units"' };
  const a = { r: 5, c: 4, patch }, b = { r: 5, c: 4, patch: { ...patch } };
  const nativeCellEdits = new Map([['a', [a]], ['b', [b]]]);
  if (problem === 'mismatch') a.patch.italic = null;
  if (problem === 'extraProperty') a.patch.bg = '#123456';
  if (problem === 'missing') nativeCellEdits.delete('b');
  if (problem === 'duplicate') nativeCellEdits.get('b').push(b);
  if (problem === 'outside') b.c = 0;
  if (problem === 'clone') b.patch.bad = () => {};
  if (problem === 'late') b.patch.code = '0.0';
  const before = wb.toJSON(), native = wb.nativePivots;
  expect(() => apply(wb, updates, { nativeCellEdits })).toThrow();
  expect(wb.toJSON()).toEqual(before); expect(wb.nativePivots).toBe(native); expect(wb.undoLabels()).toEqual([]);
});
it('verifies font defaults and palette references without changing their editor representation', () => {
  const { wb } = fixture();
  const color = { theme: 0, base: '#ffffff', rgb: '#ffffff' };
  const patch = { color, font: null, size: null };
  formatNativePivotSelection(wb, new Map([['a', [{ r1: 5, r2: 5, c1: 4, c2: 4 }]]]), patch, { defaultFont: 'arial', defaultSize: 13 });
  const cell = wb.getCell('a', 5, 4); expect(cell.s.color).toMatchObject(color);
  expect(cell.s.font).toBeUndefined(); expect(cell.s.size).toBeUndefined();
  const xml = readNativePivotFormats(wb.nativePivots.tables[0], wb.nativePivots)[0].dxf;
  expect(xml).toContain('name val="Arial"'); expect(xml).toContain('sz val="9.75"');
});

it('preserves rotation changes and resets in native rules and cells through export', async () => {
  let { wb } = fixture();
  const ranges = new Map([['a', [{ r1: 5, r2: 6, c1: 3, c2: 4 }]]]);
  const before = wb.toJSON();
  formatNativePivotSelection(wb, ranges, { rot: -45 });
  const tilted = wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(tilted);
  formatNativePivotSelection(wb, new Map([['a', [{ r1: 6, r2: 6, c1: 3, c2: 4 }]]]), { rot: null });
  for (let i = 0; i < 2; i++) {
    wb = await nativeRoundTrip(wb);
    const owner = wb.sheetByName('First').id;
    const pivot = wb.nativePivots.tables.find(p => p.owner === owner);
    const plan = planNativePivotReport(pivot, wb.nativePivots.caches[0], { nativePivots: wb.nativePivots, paintContext: { numberFormats: wb.nativePivots.formats } });
    for (const c of [3, 4]) {
      expect(wb.styleAt(owner, 5, c).rot).toBe(-45);
      expect(wb.styleAt(owner, 6, c).rot || 0).toBe(0);
      expect(nativePivotPaintAt(plan.formatPaintLayers, 5, c).rot).toBe(-45);
      expect(nativePivotPaintAt(plan.formatPaintLayers, 6, c).rot).toBe(0);
    }
  }
});

it('resolves per-cell formatting once over overlapping mixed selections against the unchanged workbook', () => {
  const { wb } = fixture(), a = wb.sheet('a');
  a.cells.get('5,4').s = { fmt: 'number', dec: 1, group: false };
  a.cells.get('6,4').s = { fmt: 'percent', dec: 3 };
  a.cells.set('5,5', { v: 2, s: { fmt: 'currency', dec: 0, cur: 'JPY' } });
  const g = { r1: 5, r2: 6, c1: 4, c2: 5 }, before = wb.toJSON(), calls = [];
  const shared = {};
  expect(formatNativePivotSelection(wb, new Map([['a', [g, g]], ['b', [{ r1: 5, r2: 5, c1: 4, c2: 4 }]]]), (owner, r, c) => {
    expect(wb.toJSON()).toEqual(before);
    calls.push([owner, r, c]);
    if (!wb.getValue(owner, r, c)) return null;
    const s = wb.styleAt(owner, r, c);
    shared.dec = (s.dec ?? 2) + 1;
    return shared;
  })).toBe(true);
  expect(calls).toHaveLength(5);
  expect(wb.styleAt('a', 5, 4)).toMatchObject({ fmt: 'number', dec: 2 });
  expect(wb.styleAt('a', 6, 4)).toMatchObject({ fmt: 'percent', dec: 4 });
  expect(wb.styleAt('a', 5, 5)).toMatchObject({ fmt: 'currency', dec: 1, cur: 'JPY' });
  expect(wb.getCell('a', 6, 5)).toBeUndefined();
  expect(wb.styleAt('b', 5, 4).dec).toBe(3);
  expect(readNativePivotFormats(wb.nativePivots.tables[0], wb.nativePivots)).toHaveLength(2);
  expect(wb.undoLabels()).toEqual(['Format pivot reports']);
  const after = wb.toJSON(); shared.dec = 9;
  wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it('skips unsupported report selectors only when the resolver requests no edit there', () => {
  const { wb } = fixture(), selections = new Map([['a', [{ r1: 4, r2: 7, c1: 4, c2: 4 }]]]);
  expect(formatNativePivotSelection(wb, selections, (owner, r) => r === 5 ? { size: 22 } : {})).toBe(true);
  expect(wb.styleAt('a', 5, 4).size).toBe(22);
  expect(wb.styleAt('a', 6, 4).size).toBeUndefined();
  expect(readNativePivotFormats(wb.nativePivots.tables[0], wb.nativePivots)).toHaveLength(1);
});
it.each(['throw', 'promise', 'primitive', 'array', 'clone', 'border', 'paint', 'selector'])('rejects a late per-cell resolution failure before any writes (%s)', problem => {
  const { wb } = fixture(), before = wb.toJSON(), native = wb.nativePivots;
  const selections = new Map([['a', [{ r1: 5, r2: 5, c1: 4, c2: 5 }]], ['b', [{ r1: 5, r2: 7, c1: 4, c2: 4 }]]]);
  expect(() => formatNativePivotSelection(wb, selections, (owner, r) => {
    if (owner === 'a') return { size: 18 };
    if (problem === 'throw') throw new Error('resolution failed');
    if (problem === 'promise') return Promise.resolve({ size: 20 });
    if (problem === 'primitive') return true;
    if (problem === 'array') return [];
    if (problem === 'clone') return { bad: () => {} };
    if (problem === 'border') return { bh: true };
    if (problem === 'paint') return { rot: 100 };
    return r === 7 ? { size: 20 } : null;
  })).toThrow();
  expect(wb.toJSON()).toEqual(before); expect(wb.nativePivots).toBe(native); expect(wb.undoLabels()).toEqual([]);
});
it('does not allocate rules or history when every resolved patch is empty', () => {
  const { wb } = fixture(), before = wb.toJSON(), native = wb.nativePivots;
  const selections = new Map([['a', [{ r1: 4, r2: 7, c1: 4, c2: 5 }]]]);
  expect(formatNativePivotSelection(wb, selections, (owner, r) => r % 2 ? null : {})).toBe(false);
  expect(wb.toJSON()).toEqual(before); expect(wb.nativePivots).toBe(native); expect(wb.undoLabels()).toEqual([]);
});
it('bounds selected work even when a resolver skips every cell', () => {
  const { wb } = fixture(), before = wb.toJSON(); let calls = 0;
  const selections = new Map([['a', [{ r1: 5, r2: 6, c1: 4, c2: 5 }]]]);
  expect(() => formatNativePivotSelection(wb, selections, () => { calls++; return null; }, { maxCells: 2 })).toThrow(/cell limit/);
  expect(calls).toBe(2); expect(wb.toJSON()).toEqual(before);
  calls = 0;
  expect(() => formatNativePivotSelection(wb, selections, () => { calls++; return null; }, { maxWork: 1 })).toThrow(/work limit/);
  expect(calls).toBe(0); expect(wb.toJSON()).toEqual(before);
});
