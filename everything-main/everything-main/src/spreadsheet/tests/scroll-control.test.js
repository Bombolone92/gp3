import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { normalizeChart } from '../src/core/charts.js';
import { scrollControlValue, setScrollControlValue } from '../src/core/scroll-control.js';
import { createScrollControl, scrollControlClipboard, readScrollControlClipboard } from '../src/ui/scroll-control.js';

const control = extra => ({ type: 'scroll', anchor: { r: 2, c: 1 }, dx: 7, dy: 3, w: 230, h: 17,
  scrollWidth: 16, min: 2, max: 19, step: 2, page: 5, value: 4, horizontal: true, print: false, linkRef: "'Linked data'!$B$3", ...extra });
const make = extra => new Workbook({ sheets: [{ name: 'UI', charts: [control(extra)] }, { name: 'Linked data', cells: { '2,1': { v: 6 }, '3,1': { f: 'B3*2' } } }] });
const roundtrip = async (wb, native = true, edit) => {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  if (native) {
    const p = X.CFB.find(zip, '/xl/workbook.xml');
    p.content = new TextEncoder().encode(new TextDecoder().decode(p.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); p.size = p.content.length;
  }
  edit?.(zip);
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'controls.xlsx');
};
it('normalizes malformed bounds, preserves zero increments and small native sizes', () => {
  expect(normalizeChart(control({ min: 20, max: -2, step: 0, page: 0, value: 40000, w: 5 })))
    .toMatchObject({ min: 20, max: 20, step: 0, page: 0, value: 20, w: 5 });
});
it('reads the linked cell, changes formulas and undoes the entire interaction', () => {
  const wb = make(), sheet = wb.activeSheet, ch = sheet.charts[0], target = wb.sheetByName('Linked data');
  expect(scrollControlValue(wb, sheet.id, ch)).toBe(6);
  expect(setScrollControlValue(wb, sheet.id, ch.id, 11)).toBe(true);
  expect(wb.getValue(target.id, 3, 1)).toBe(22);
  wb.undo(); expect(wb.getValue(target.id, 2, 1)).toBe(6); expect(wb.chartById(sheet.id, ch.id).value).toBe(4);
  wb.setInput(target.id, 2, 1, '999'); expect(scrollControlValue(wb, sheet.id, ch)).toBe(19);
  expect(wb.getValue(target.id, 2, 1)).toBe(999); // Rendering never mutates linked cells.
});
it('does not write invalid links, supports unlinked controls and duplicate/undo', () => {
  const wb = make({ linkRef: '#REF!' }), sheet = wb.activeSheet, ch = sheet.charts[0];
  expect(setScrollControlValue(wb, sheet.id, ch.id, 9)).toBe(false);
  wb.updateChart(sheet.id, ch.id, { linkRef: '' }); setScrollControlValue(wb, sheet.id, ch.id, 10);
  const id = wb.duplicateChart(sheet.id, ch.id); expect(wb.chartById(sheet.id, id)).toMatchObject({ type: 'scroll', value: 10, w: 230, h: 17 });
  wb.undo(); expect(wb.chartById(sheet.id, id)).toBeNull();
});
it.each([true, false])('round trips native properties, position, print flag and linked edits (native=%s)', async native => {
  let wb = make();
  for (let n = 0; n < 2; n++) {
    wb = await roundtrip(wb, native);
    const sheet = wb.activeSheet, ch = sheet.charts[0];
    expect(sheet.charts).toHaveLength(1);
    // A file anchors the control by whole-EMU offsets into its rows (9525 to a pixel); a 19.5 px
    // default row ends between two EMUs, so an edge inside the next row can move by under one EMU.
    const emu = value => expect.toSatisfy(v => Math.abs(v - value) <= 1 / 9525);
    const expected = control({ value: 6 });
    expect(ch).toMatchObject({ ...expected, dx: emu(expected.dx), dy: emu(expected.dy), w: emu(expected.w), h: emu(expected.h) });
    setScrollControlValue(wb, sheet.id, ch.id, 8);
    expect(wb.getValue(wb.sheetByName('Linked data').id, 3, 1)).toBe(16);
    wb.undo();
  }
});
it('supports vertical keyboard increments, page steps, bounds, and focus-preserving updates', () => {
  const dom = new JSDOM('<body/>'), changes = [], c = createScrollControl(dom.window.document, v => changes.push(v));
  const model = normalizeChart(control({ horizontal: false })); c.update(model, 6); dom.window.document.body.append(c.node);
  const track = c.node.querySelector('[role=scrollbar]'); track.focus();
  for (const key of ['ArrowDown', 'PageDown', 'End', 'ArrowDown', 'Home']) track.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
  expect(changes).toEqual([8, 13, 19, 19, 2]);
  c.update(model, 11); expect(dom.window.document.activeElement).toBe(track);
  expect(track.getAttribute('aria-orientation')).toBe('vertical'); expect(track.getAttribute('aria-valuenow')).toBe('11');
});
it('copies editable control semantics through HTML and offers the selected value as plain text', () => {
  const dom = new JSDOM(), raw = normalizeChart(control({ title: 'A < B & "C"' }));
  const clip = scrollControlClipboard(dom.window.document, raw, 8);
  expect(clip.text).toBe('8');
  expect(readScrollControlClipboard(dom.window.document, clip.html)).toEqual({ ...raw, value: 8, id: undefined });
  expect(readScrollControlClipboard(dom.window.document, '<div data-sheet-scroll="invalid">')).toBeNull();
});
it('refuses protected controls and protected linked cells without partially changing state', () => {
  for (const index of [0, 1]) {
    const wb = make(), sheet = wb.activeSheet, ch = sheet.charts[0]; wb.sheets[index].protected = true;
    expect(setScrollControlValue(wb, sheet.id, ch.id, 9)).toBe(false);
    expect(wb.getValue(wb.sheets[1].id, 2, 1)).toBe(6); expect(ch.value).toBe(4);
  }
});
it('shares VML with cell comments and preserves vertical absolute controls', async () => {
  const wb = make({ horizontal: false, anchorMode: 'absolute', anchor: { r: 0, c: 0 }, dx: 230, dy: 95, h: 140, w: 14 });
  wb.setNote(wb.activeSheetId, 0, 0, 'A comment beside a control');
  const restored = await roundtrip(wb);
  expect(restored.activeSheet.notes.get('0,0')).toBe('A comment beside a control');
  expect(restored.activeSheet.charts[0]).toMatchObject({ type: 'scroll', horizontal: false, anchorMode: 'absolute', dx: 230, dy: 95, w: 14, h: 140 });
});
it('loads legacy-only VML and honors native external changes instead of stale metadata', async () => {
  const changed = await roundtrip(make(), false, zip => {
    const p = X.CFB.find(zip, '/xl/ctrlProps/control1_1.xml');
    p.content = new TextEncoder().encode(new TextDecoder().decode(p.content).replace('max="19"', 'max="12"')); p.size = p.content.length;
  });
  expect(changed.activeSheet.charts[0].max).toBe(12);
  const legacy = await roundtrip(make(), true, zip => {
    const p = X.CFB.find(zip, '/xl/worksheets/sheet1.xml');
    p.content = new TextEncoder().encode(new TextDecoder().decode(p.content).replace(/<controls>[\s\S]*?<\/controls>/, '')); p.size = p.content.length;
  });
  expect(legacy.activeSheet.charts).toHaveLength(1);
  expect(legacy.activeSheet.charts[0]).toMatchObject({ type: 'scroll', horizontal: true, min: 2, max: 19, step: 2, page: 5, value: 6, print: false });
});
it('follows linked sheet renames and row insertion, and preserves disabled controls', async () => {
  const wb = make({ disabled: true }), sheet = wb.activeSheet, ch = sheet.charts[0], target = wb.sheets[1];
  expect(setScrollControlValue(wb, sheet.id, ch.id, 10)).toBe(false);
  wb.renameSheet(target.id, 'New data'); wb.insertRows(target.id, 1, 2);
  expect(scrollControlValue(wb, sheet.id, wb.chartById(sheet.id, ch.id))).toBe(6);
  expect(wb.chartById(sheet.id, ch.id).linkRef).toBe("'New data'!$B$5");
  const restored = await roundtrip(wb);
  expect(restored.activeSheet.charts[0]).toMatchObject({ disabled: true, linkRef: "'New data'!$B$5" });
});
it('exports matching modern DrawingML, control-property and VML identities', async () => {
  const wb = make(); wb.setInput(wb.activeSheetId, 0, 0, '3'); wb.setInput(wb.activeSheetId, 1, 0, '6');
  wb.addChart(wb.activeSheetId, { type: 'bar', range: { r1: 0, c1: 0, r2: 1, c2: 0 }, anchor: { r: 1, c: 1 } });
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const xml = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
  const sheet = xml('/xl/worksheets/sheet1.xml'), id = /<control\b[^>]*shapeId="(\d+)"/.exec(sheet)[1];
  expect(xml('/xl/drawings/drawing1.xml')).toContain(`id="${id}" name="Scroll bar 1" hidden="1"`);
  expect(xml('/xl/drawings/drawing1.xml')).toContain(`spid="_x0000_s${id}"`);
  expect(xml('/xl/drawings/controls1.vml')).toContain(`id="_x0000_s${id}"`);
  expect(xml('/xl/ctrlProps/control1_1.xml')).toContain('dx="16"');
  expect(sheet).toContain('Requires="x14"');
  const restored = await roundtrip(wb);
  expect(restored.activeSheet.charts.map(c => c.type).sort()).toEqual(['bar', 'scroll']);
});
it('keeps fractional control geometry instead of snapping export markers to pixels', async () => {
  const wb = make({ dx: 7.2, dy: 3.4, w: 230.4, h: 17.6 });
  wb.activeSheet.colWidths.set(2, 43); wb.activeSheet.rowHeights.set(2, 15.2);
  const out = await roundtrip(wb), actual = out.activeSheet.charts[0], expected = wb.activeSheet.charts[0];
  // These offsets have exact integer-EMU representations.
  for (const field of ['dx', 'dy', 'w', 'h']) expect(actual[field]).toBeCloseTo(expected[field], 8);
});
