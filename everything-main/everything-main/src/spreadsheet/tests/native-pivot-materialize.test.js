import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { planNativePivotReport } from '../src/core/native-pivot-report.js';
import { materializeNativePivotReport } from '../src/core/native-pivot-materialize.js';
import { commitNativePivotReports } from '../src/core/native-pivot-commit.js';
const M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function fixture(flag = '0') {
  const wb = new Workbook({ sheets: [{ id: 'report', name: 'Report', colStyles: { 3: { size: 18, bg: '#ddeeff' } },
    cells: { '2,2': { v: 'Old heading', s: { bg: '#ff0000', bold: false, indent: 8 } }, '3,3': { v: 123, s: { bg: '#ff0000', fmt: 'percent', italic: true } },
      '5,3': { v: 456, s: { bg: '#ff0000' } }, '9,7': { v: 'Unrelated', s: { bold: true } } } }] });
  const cache = { key: 'data', xml: `<pivotCacheDefinition xmlns="${M}" recordCount="2"><cacheSource type="worksheet"><worksheetSource sheet="Data" ref="A1:B3"/></cacheSource><cacheFields count="2"><cacheField name="Region"><sharedItems count="2"><s v="East"/><s v="West"/></sharedItems></cacheField><cacheField name="Amount"/></cacheFields></pivotCacheDefinition>`, records: `<pivotCacheRecords xmlns="${M}" count="2"><r><x v="0"/><n v="4"/></r><r><x v="1"/><n v="9"/></r></pivotCacheRecords>` };
  const pivot = { name: 'Report', owner: 'report', cache: 'data', ref: 'C3:D6', xml: `<pivotTableDefinition xmlns="${M}" name="Report" ${flag == null ? '' : `preserveFormatting="${flag}"`}><location ref="C3:D6" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/><pivotFields count="2"><pivotField axis="axisRow" showAll="0"><items count="2"><item x="0"/><item x="1"/></items></pivotField><pivotField dataField="1"/></pivotFields><rowFields count="1"><field x="0"/></rowFields><dataFields count="1"><dataField fld="1" numFmtId="180"/></dataFields><pivotTableStyleInfo name="Custom" showColHeaders="1"/></pivotTableDefinition>` };
  wb.nativePivots = { version: 1, caches: [cache], tables: [pivot], formats: { 180: '0.00" units"' },
    dxfs: [`<dxf xmlns="${M}"><font><i val="0"/></font><border><horizontal style="thin"/></border></dxf>`, `<dxf xmlns="${M}"><font><b/></font></dxf>`],
    styles: [{ name: 'Custom', xml: `<tableStyle xmlns="${M}" name="Custom" pivot="1" count="2"><tableStyleElement type="wholeTable" dxfId="0"/><tableStyleElement type="headerRow" dxfId="1"/></tableStyle>` }] };
  const plan = planNativePivotReport(pivot, cache, { nativePivots: wb.nativePivots, paintContext: { numberFormats: wb.nativePivots.formats }, selections: [{ field: 0, items: [1] }] });
  return { wb, pivot, cache, plan };
}
it.each(['0', 'false'])('discards report cell formatting on refresh for preserveFormatting=%s', flag => {
  const { wb, pivot, cache, plan } = fixture(flag), before = wb.toJSON();
  const cells = materializeNativePivotReport(wb, pivot, plan);
  expect(wb.toJSON()).toEqual(before);
  expect(cells).toHaveLength(7); // six new positions and one stored vacated position
  expect(cells.find(c => c.r === 5 && c.c === 3).cell).toBeNull();
  expect(cells.find(c => c.r === 2 && c.c === 2).cell.s).toMatchObject({ bold: true, italic: false });
  expect(cells.every(c => !c.cell?.s?.bg && !c.cell?.s?.size)).toBe(true);
  commitNativePivotReports(wb, [{ pivot, cache, next: plan.pivot, cells }]);
  expect(wb.getValue('report', 3, 2)).toBe('West');
  expect(wb.getValue('report', 4, 3)).toBe(9);
  expect(wb.styleAt('report', 3, 3)).toMatchObject({ size: 18, bg: '#ddeeff', fmt: 'custom', code: '0.00" units"', italic: false });
  expect(wb.getCell('report', 5, 3)).toBeUndefined();
  expect(wb.styleAt('report', 5, 3)).toEqual({ size: 18, bg: '#ddeeff' });
  expect(wb.getCell('report', 9, 7)).toEqual(before.sheets[0].cells['9,7']);
  const after = wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it('paints unlabeled positions and keeps worksheet formats inherited', () => {
  const { wb, pivot, plan } = fixture();
  plan.cells = plan.cells.filter(cell => cell.r !== 3 || cell.c !== 3);
  const cells = materializeNativePivotReport(wb, pivot, plan);
  const blank = cells.find(c => c.r === 3 && c.c === 3).cell;
  expect(blank.v).toBeNull(); expect(blank.s).toMatchObject({ italic: false, bt: true, bb: true });
  expect(blank.s).not.toHaveProperty('bg'); expect(blank.s).not.toHaveProperty('size');
});
it('lets an explicit pivot fill reset override inherited fill while vacated cells inherit again', () => {
  const { wb, pivot, cache } = fixture();
  wb.nativePivots.dxfs[0] = `<dxf xmlns="${M}"><fill><patternFill patternType="none"/></fill></dxf>`;
  const plan = planNativePivotReport(pivot, cache, { nativePivots: wb.nativePivots, paintContext: { numberFormats: wb.nativePivots.formats }, selections: [{ field: 0, items: [1] }] });
  commitNativePivotReports(wb, [{ pivot, cache, next: plan.pivot, cells: materializeNativePivotReport(wb, pivot, plan) }]);
  expect(wb.styleAt('report', 3, 3).bg).toBe('transparent');
  expect(wb.styleAt('report', 5, 3).bg).toBe('#ddeeff');
});
it.each(['1', 'true', null])('does not silently discard formatting when preservation is %s', flag => {
  const { wb, pivot, plan } = fixture(flag), before = wb.toJSON();
  expect(plan.layout.preserveFormatting).toBe(true);
  expect(() => materializeNativePivotReport(wb, pivot, plan)).toThrow(/preserved-format/);
  expect(wb.toJSON()).toEqual(before);
});
it('rejects malformed preservation flags', () => { expect(() => fixture('yes')).toThrow(/preserveFormatting/); });
it('bounds the full materialization including stored vacated cells', () => {
  const { wb, pivot, plan } = fixture();
  expect(() => materializeNativePivotReport(wb, pivot, plan, { maxCells: 5 })).toThrow(/limit/);
  expect(() => materializeNativePivotReport(wb, pivot, plan, { maxCells: 6 })).toThrow(/limit/);
  expect(materializeNativePivotReport(wb, pivot, plan, { maxCells: 7 })).toHaveLength(7);
});
it.each(['stale', 'paint', 'range', 'duplicate', 'date', 'indent'])('rejects an incomplete or inconsistent plan: %s', problem => {
  const f = fixture(), before = f.wb.toJSON();
  if (problem === 'stale') f.pivot = { ...f.pivot };
  if (problem === 'paint') delete f.plan.paintLayers;
  if (problem === 'range') f.plan.layout.range.r2++;
  if (problem === 'duplicate') f.plan.cells[1] = f.plan.cells[0];
  if (problem === 'date') f.plan.cells[1] = { ...f.plan.cells[1], type: 'date', value: '2025-04-12T00:00:00' };
  if (problem === 'indent') f.plan.cells[1] = { ...f.plan.cells[1], indent: 251 };
  expect(() => materializeNativePivotReport(f.wb, f.pivot, f.plan)).toThrow();
  expect(f.wb.toJSON()).toEqual(before);
});
it('does not expand a huge sparse old report while clearing vacated cells', () => {
  const { wb, pivot, plan } = fixture();
  pivot.ref = 'C3:XFD1048576'; plan.previousRange = { r1: 2, c1: 2, r2: 1048575, c2: 16383 };
  const cells = materializeNativePivotReport(wb, pivot, plan, { maxCells: 8 });
  expect(cells).toHaveLength(8); // the formerly unrelated cell is inside this larger old report
});

function preservedFixture(flag = '1') {
  const f = fixture('0');
  const initial = planNativePivotReport(f.pivot, f.cache, { nativePivots: f.wb.nativePivots, paintContext: { numberFormats: f.wb.nativePivots.formats } });
  const pivot = { ...initial.pivot, xml: initial.pivot.xml.replace('preserveFormatting="0"', flag == null ? '' : `preserveFormatting="${flag}"`) };
  f.wb.nativePivots.tables = [pivot];
  const plan = planNativePivotReport(pivot, f.cache, { nativePivots: f.wb.nativePivots, paintContext: { numberFormats: f.wb.nativePivots.formats } });
  return { ...f, pivot, plan };
}
it.each(['1', 'true', null])('preserves direct formats for unchanged semantic layouts with flag %s', flag => {
  const { wb, pivot, cache, plan } = preservedFixture(flag), before = wb.toJSON();
  const cells = materializeNativePivotReport(wb, pivot, plan);
  expect(wb.toJSON()).toEqual(before);
  expect(cells.find(c => c.r === 3 && c.c === 3).cell).toEqual({ v: 4, f: null, s: { bg: '#ff0000', fmt: 'percent', italic: true } });
  expect(cells.find(c => c.r === 4 && c.c === 3).cell).toEqual({ v: 9 });
  commitNativePivotReports(wb, [{ pivot, cache, next: plan.pivot, cells }]);
  expect(wb.styleAt('report', 3, 3)).toMatchObject({ size: 18, bg: '#ff0000', fmt: 'percent', italic: true });
  expect(wb.styleAt('report', 4, 3)).toEqual({ size: 18, bg: '#ddeeff' });
  expect(wb.getValue('report', 5, 3)).toBe(13);
  const after = wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it('preserves explicit resets and nested border pens without aliasing the workbook', () => {
  const { wb, pivot, plan } = preservedFixture();
  wb.setCells('report', [{ r: 3, c: 3, cell: { v: 10, s: { bold: null, bg: 'transparent', bb: true, bbBorder: { bs: 'double', bc: '#123456' } }, note: 'Keep this note' } }]);
  const old = structuredClone(wb.getCell('report', 3, 3));
  const cells = materializeNativePivotReport(wb, pivot, plan), next = cells.find(c => c.r === 3 && c.c === 3).cell;
  expect(next).toEqual({ ...old, v: 4 });
  next.s.bbBorder.bc = '#abcdef'; expect(wb.getCell('report', 3, 3)).toEqual(old);
});
it.each(['reorder', 'measure', 'header', 'field-format', 'native-format', 'style', 'missing-cache'])('refuses preserved-format identity or policy changes: %s', change => {
  const { wb, pivot, plan } = preservedFixture(), before = wb.toJSON();
  if (change === 'reorder') plan.layout.rows.items.reverse();
  if (change === 'measure') plan.layout.measures[0].subtotal = 'count';
  if (change === 'header') plan.layout.showHeaders = false;
  if (change === 'field-format') plan.layout.fields[0].numFmtId = 14;
  if (change === 'native-format') plan.pivot.xml = plan.pivot.xml.replace('</pivotTableDefinition>', '<formats count="0"/></pivotTableDefinition>');
  if (change === 'style') plan.pivot.xml = plan.pivot.xml.replace('name="Custom"', 'name="Different"');
  if (change === 'missing-cache') wb.nativePivots.caches = [];
  const input = wb.toJSON();
  expect(() => materializeNativePivotReport(wb, pivot, plan)).toThrow(/preserved-format|cache/);
  expect(wb.toJSON()).toEqual(input);
  if (change !== 'missing-cache') expect(wb.toJSON()).toEqual(before);
});
it.each(['richText', 'hyperlink', 'f', 'array'])('does not erase unhandled preserved cell metadata: %s', key => {
  const { wb, pivot, plan } = preservedFixture();
  wb.getCell('report', 3, 3)[key] = key === 'f' ? '1+1' : {};
  const before = wb.toJSON();
  expect(() => materializeNativePivotReport(wb, pivot, plan)).toThrow(/preserved-format cell content/);
  expect(wb.toJSON()).toEqual(before);
});
it('recalculates changed source values without replacing user formats', async () => {
  const { wb, pivot, cache } = preservedFixture();
  cache.records = cache.records.replace('v="4"', 'v="40"');
  const plan = planNativePivotReport(pivot, cache, { nativePivots: wb.nativePivots, paintContext: { numberFormats: wb.nativePivots.formats } });
  commitNativePivotReports(wb, [{ pivot, cache, next: plan.pivot, cells: materializeNativePivotReport(wb, pivot, plan) }]);
  expect(wb.getValue('report', 3, 3)).toBe(40);
  expect(wb.getValue('report', 5, 3)).toBe(49);
  const { nativeRoundTrip } = await import('./helpers/linked-model-workbook.js');
  let reopened = wb;
  for (let i = 0; i < 2; i++) {
    reopened = await nativeRoundTrip(reopened);
    const report = reopened.sheetByName('Report');
    expect(reopened.getValue(report.id, 3, 3)).toBe(40);
    expect(reopened.styleAt(report.id, 3, 3)).toMatchObject({ bg: '#ff0000', fmt: 'percent', italic: true, size: 18 });
    const saved = reopened.nativePivots.tables[0], savedCache = reopened.nativePivots.caches.find(c => c.key === saved.cache);
    const next = planNativePivotReport(saved, savedCache, { nativePivots: reopened.nativePivots, paintContext: { numberFormats: reopened.nativePivots.formats } });
    expect(() => materializeNativePivotReport(reopened, saved, next)).not.toThrow();
  }
});
it('does not ignore namespace rebinding in extension settings', () => {
  const { wb, pivot, cache } = preservedFixture();
  pivot.xml = pivot.xml.replace('</pivotTableDefinition>', '<extLst><ext uri="urn:custom"><setting xmlns="urn:settings" xmlns:cfg="urn:first" mode="cfg:One"/></ext></extLst></pivotTableDefinition>');
  const plan = planNativePivotReport(pivot, cache, { nativePivots: wb.nativePivots, paintContext: { numberFormats: wb.nativePivots.formats } });
  plan.pivot.xml = plan.pivot.xml.replace('xmlns:cfg="urn:first"', 'xmlns:cfg="urn:second"');
  expect(() => materializeNativePivotReport(wb, pivot, plan)).toThrow(/preserved-format/);
});

const replanned = (f, pivot = f.pivot, cache = f.cache, options = {}) => planNativePivotReport(pivot, cache, {
  nativePivots: f.wb.nativePivots, paintContext: { numberFormats: f.wb.nativePivots.formats }, ...options,
});
it('moves surviving member and total formatting by identity when a flat report is filtered', () => {
  const f = preservedFixture(), before = f.wb.toJSON(), plan = replanned(f, f.pivot, f.cache, { selections: [{ field: 0, items: [1] }] });
  const cells = materializeNativePivotReport(f.wb, f.pivot, plan);
  expect(cells.find(c => c.r === 3 && c.c === 3).cell.s).toEqual({ fmt: 'custom', code: '0.00" units"' });
  expect(cells.find(c => c.r === 4 && c.c === 3).cell.s).toMatchObject({ bg: '#ff0000', fmt: 'custom' });
  expect(cells.find(c => c.r === 5 && c.c === 3).cell).toBeNull();
  expect(f.wb.toJSON()).toEqual(before);
  commitNativePivotReports(f.wb, [{ pivot: f.pivot, cache: f.cache, next: plan.pivot, cells }]);
  expect(f.wb.styleAt('report', 3, 3)).toMatchObject({ bg: '#ddeeff', size: 18 });
  const after = f.wb.toJSON(); f.wb.undo(); expect(f.wb.toJSON()).toEqual(before); f.wb.redo(); expect(f.wb.toJSON()).toEqual(after);
});
it('keeps formatting with typed members rather than duplicate captions or worksheet positions', () => {
  const f = preservedFixture();
  f.cache.xml = f.cache.xml.replace('v="East"', 'v="East" c="Same"').replace('v="West"', 'v="West" c="Same"');
  const next = { ...f.pivot, xml: f.pivot.xml.replace('<item x="0"/><item x="1"/>', '<item x="1"/><item x="0"/>') }, plan = replanned(f, next);
  const cells = materializeNativePivotReport(f.wb, f.pivot, plan);
  expect(cells.find(c => c.r === 3 && c.c === 2).cell.v).toBe('Same');
  expect(cells.find(c => c.r === 4 && c.c === 2).cell.v).toBe('Same');
  expect(cells.find(c => c.r === 3 && c.c === 3).cell.s).not.toHaveProperty('italic');
  expect(cells.find(c => c.r === 4 && c.c === 3).cell.s).toMatchObject({ bg: '#ff0000', italic: true, fmt: 'custom', code: '0.00" units"' });
  expect(cells.find(c => c.r === 4 && c.c === 3).cell.s).not.toHaveProperty('cur');
});
it('uses declared paint for a new member without borrowing a deleted member override', () => {
  const f = preservedFixture(); f.wb.setCells('report', [{ r: 4, c: 3, cell: { v: 9, s: { bg: '#123456', bold: true } } }]);
  const cache = { ...f.cache, xml: f.cache.xml.replace('v="West"', 'v="North"') }, plan = replanned(f, f.pivot, cache);
  const cells = materializeNativePivotReport(f.wb, f.pivot, plan, { nextCache: cache });
  const north = cells.find(c => c.r === 4 && c.c === 3).cell;
  expect(north.s).toMatchObject({ italic: false, fmt: 'custom' }); expect(north.s).not.toHaveProperty('bg'); expect(north.s).not.toHaveProperty('bold');
  expect(cells.find(c => c.r === 3 && c.c === 3).cell.s).toMatchObject({ bg: '#ff0000', italic: true });
  expect(() => materializeNativePivotReport(f.wb, f.pivot, plan)).toThrow(/preserved-format/);
});
it('preserves number overrides when cache indexes change without changing the displayed layout', () => {
  const f = preservedFixture();
  const cache = { ...f.cache, xml: f.cache.xml.replace('<s v="East"/><s v="West"/>', '<s v="West"/><s v="East"/>'), records: f.cache.records.replaceAll('v="0"', 'v="tmp"').replaceAll('v="1"', 'v="0"').replaceAll('v="tmp"', 'v="1"') };
  const next = { ...f.pivot, xml: f.pivot.xml.replace('<item x="0"/><item x="1"/>', '<item x="1"/><item x="0"/>') }, plan = replanned(f, next, cache);
  const cells = materializeNativePivotReport(f.wb, f.pivot, plan, { nextCache: cache });
  expect(cells.find(c => c.r === 3 && c.c === 3).cell.s).toMatchObject({ fmt: 'percent', bg: '#ff0000', italic: true });
});
it('grows a flat report while preserving the grand-total formatting independently of its row', () => {
  const f = preservedFixture();
  const cache = { ...f.cache, xml: f.cache.xml.replace('recordCount="2"', 'recordCount="3"').replace('sharedItems count="2"', 'sharedItems count="3"').replace('</sharedItems>', '<s v="North"/></sharedItems>'), records: f.cache.records.replace('count="2"', 'count="3"').replace('</pivotCacheRecords>', '<r><x v="2"/><n v="7"/></r></pivotCacheRecords>') };
  const next = { ...f.pivot, xml: f.pivot.xml.replace('<items count="2">', '<items count="3">').replace('</items>', '<item x="2"/></items>') }, plan = replanned(f, next, cache);
  const cells = materializeNativePivotReport(f.wb, f.pivot, plan, { nextCache: cache });
  expect(cells.find(c => c.r === 5 && c.c === 3).cell.s).not.toHaveProperty('bg');
  expect(cells.find(c => c.r === 6 && c.c === 3).cell).toMatchObject({ v: 20, s: { bg: '#ff0000' } });
  expect(cells.find(c => c.r === 2 && c.c === 2).cell.s).toEqual(f.wb.getCell('report', 2, 2).s);
});
it.each(['richText', 'hyperlink', 'f', 'array'])('refuses unhandled content even when its member disappears: %s', key => {
  const f = preservedFixture(); f.wb.getCell('report', 3, 3)[key] = key === 'f' ? '1+1' : {};
  const plan = replanned(f, f.pivot, f.cache, { selections: [{ field: 0, items: [1] }] });
  expect(() => materializeNativePivotReport(f.wb, f.pivot, plan)).toThrow(/preserved-format cell content/);
});
it('bounds cached axis preparation independently of the shrunken output', () => {
  const f = preservedFixture(), plan = replanned(f, f.pivot, f.cache, { selections: [{ field: 0, items: [1] }] });
  expect(() => materializeNativePivotReport(f.wb, f.pivot, plan, { maxCells: 1 })).toThrow(/limit/);
});
it('round-trips preserved member formatting after a reorder without private metadata', async () => {
  const f = preservedFixture(), next = { ...f.pivot, xml: f.pivot.xml.replace('<item x="0"/><item x="1"/>', '<item x="1"/><item x="0"/>') }, plan = replanned(f, next);
  commitNativePivotReports(f.wb, [{ pivot: f.pivot, cache: f.cache, next: plan.pivot, cells: materializeNativePivotReport(f.wb, f.pivot, plan) }]);
  const { nativeRoundTrip } = await import('./helpers/linked-model-workbook.js');
  const copy = await nativeRoundTrip(f.wb), id = copy.sheetByName('Report').id;
  expect(copy.getValue(id, 4, 2)).toBe('East'); expect(copy.styleAt(id, 4, 3)).toMatchObject({ bg: '#ff0000', italic: true });
});
