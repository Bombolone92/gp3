import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { normalizeChart } from '../src/core/charts.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
import { normalizeCellAnchor, drawingAxisOffset } from '../src/core/drawing-cell-anchor.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const markers = { from: { r: 2, c: 2, dx: 3, dy: 4 }, to: { r: 5, c: 5, dx: 13, dy: 14 } };
function fixture(type = 'column', box) {
  return new Workbook({ sheets: [{ name: 'Data', defaultColWidth: 70, defaultRowHeight: 25,
    colWidths: { 3: 95 }, rowHeights: { 3: 35 },
    cells: { '0,0': { v: 'Name' }, '0,1': { v: 'Value' }, '1,0': { v: 'First' }, '1,1': { v: 7 } },
    charts: [{ type, src: png, text: '', style: { bg: '#abcdef', border: false }, range: { r1: 0, c1: 0, r2: 1, c2: 1 },
      anchor: { r: 2, c: 2 }, dx: 3, dy: 4, w: 245, h: 95, cellAnchor: { ...markers, ...(box ? { box } : {}) } }],
  }] });
}
const chart = wb => wb.activeSheet.charts[0];
async function cycle(wb, metadata = false) {
  const zip = X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const get = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
  const xml = get('/xl/drawings/drawing1.xml');
  if (!metadata) X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(get('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  return { xml, wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' })) };
}

it.each(['column', 'image', 'text'])('resizes a %s with cell dimensions and preserves both markers through native exchange', async type => {
  let wb = fixture(type), id = wb.activeSheetId;
  expect(chart(wb)).toMatchObject({ w: 245, h: 95, cellAnchor: markers });
  wb.setColWidth(id, 3, 135); wb.setRowHeight(id, 4, 65);
  expect(chart(wb)).toMatchObject({ w: 285, h: 135 });
  wb.undo(); expect(chart(wb).h).toBe(95); wb.redo();
  for (let i = 0; i < 2; i++) {
    const result = await cycle(wb); wb = result.wb;
    expect(result.xml).toContain('<xdr:twoCellAnchor>');
    expect(chart(wb)).toMatchObject({ w: 285, h: 135, cellAnchor: markers });
  }
});

it('follows insertion and deletion at both ends, with snapshot undo and redo', () => {
  const wb = fixture(), id = wb.activeSheetId;
  wb.insertCols(id, 3, 2); wb.insertRows(id, 4, 2);
  expect(chart(wb)).toMatchObject({ w: 385, h: 145, cellAnchor: { from: markers.from, to: { ...markers.to, r: 7, c: 7 } } });
  wb.insertCols(id, 0, 1); wb.insertRows(id, 0, 1);
  expect(chart(wb)).toMatchObject({ w: 385, h: 145, anchor: { r: 3, c: 3 } });
  wb.deleteCols(id, 4, 2); wb.deleteRows(id, 5, 2);
  expect(chart(wb)).toMatchObject({ w: 245, h: 95 });
  wb.undo(); expect(chart(wb).h).toBe(145); wb.redo(); expect(chart(wb).h).toBe(95);
});

it('collapses and restores hidden cell spans without an interactive minimum size', () => {
  const wb = fixture(), id = wb.activeSheetId;
  wb.setHidden(id, 'col', [2, 3, 4], true); wb.setHidden(id, 'row', [2, 3, 4], true);
  expect(chart(wb)).toMatchObject({ w: 10, h: 10 });
  wb.setHidden(id, 'col', [2, 3, 4], false); wb.setHidden(id, 'row', [2, 3, 4], false);
  expect(chart(wb)).toMatchObject({ w: 245, h: 95 });
});

it('reanchors moved and resized objects, preserving resize behavior and undo', async () => {
  const wb = fixture(), id = wb.activeSheetId, obj = chart(wb);
  wb.updateChart(id, obj.id, { anchor: { r: 7, c: 6 }, dx: 11, dy: 8, w: 160, h: 150 });
  expect(chart(wb)).toMatchObject({ w: 160, h: 150, cellAnchor: { from: { r: 7, c: 6, dx: 11, dy: 8 }, to: { r: 13, c: 8, dx: 31, dy: 8 } } });
  wb.undo(); expect(chart(wb).cellAnchor).toEqual(markers); wb.redo();
  wb.setColWidth(id, 7, 120); expect(chart(wb).w).toBe(210);
  expect(chart((await cycle(wb, true)).wb)).toMatchObject({ w: 210, h: 150 });
});

it('retains affine child bounds through resizing and grouped native chart export', async () => {
  let wb = fixture('column', [.2, .1, .5, .7]);
  expect(chart(wb)).toMatchObject({ dx: 52, dy: 13.5, w: 122.5, h: 66.5 });
  wb.setColWidth(wb.activeSheetId, 3, 195);
  expect(chart(wb)).toMatchObject({ dx: 72, w: 172.5 });
  for (let i = 0; i < 2; i++) {
    const result = await cycle(wb); wb = result.wb;
    expect(result.xml).toContain('<xdr:grpSp>');
    expect(chart(wb).dx).toBeCloseTo(72, 3); expect(chart(wb).w).toBeCloseTo(172.5, 3);
    expect(chart(wb).cellAnchor.box[0]).toBeCloseTo(.2, 5);
  }
  wb.setColWidth(wb.activeSheetId, 3, 95);
  expect(chart(wb).w).toBeCloseTo(122.5, 3);
});

it('duplicates and extracts resizable objects without sharing marker objects', async () => {
  const wb = fixture(), id = wb.activeSheetId, obj = chart(wb);
  const copied = wb.duplicateChart(id, obj.id), duplicate = wb.chartById(id, copied);
  expect(duplicate.cellAnchor).toBeDefined(); expect(duplicate.cellAnchor).not.toBe(obj.cellAnchor);
  expect(duplicate.w).toBe(obj.w);
  const other = wb.sheetToWorkbook(id), saved = (await cycle(other)).wb;
  expect(saved.activeSheet.charts).toHaveLength(2);
  expect(chart(saved).cellAnchor).toEqual(markers);
});

it('handles distant markers with sparse dimensions and validates untrusted metadata', () => {
  const wb = fixture(), s = wb.activeSheet;
  expect(drawingAxisOffset(s, 'row', 1000000)).toBe(25000010);
  for (const bad of [null, {}, { from: markers.from }, { ...markers, to: { ...markers.to, r: 1048576 } }, { ...markers, box: [0, 0, Infinity, 1] }]) expect(normalizeCellAnchor(bad)).toBeNull();
  const obj = chart(wb);
  expect(normalizeChart({ ...obj, anchorMode: 'absolute' }).cellAnchor).toBeUndefined();
  expect(normalizeChart({ ...obj, cellAnchor: { ...markers, to: { ...markers.to, dx: NaN } } }).cellAnchor).toBeUndefined();
});

it('preserves a small imported chart when duplicating or editing its title', () => {
  const wb = fixture('column', [.2, .1, .5, .7]), id = wb.activeSheetId, before = { ...chart(wb) };
  wb.updateChart(id, before.id, { title: 'Changed' });
  expect(chart(wb)).toMatchObject({ w: before.w, h: before.h });
  const copy = wb.chartById(id, wb.duplicateChart(id, before.id));
  expect(copy).toMatchObject({ w: before.w, h: before.h });
});

it('maps both endpoints during partial shifts and line reordering', () => {
  const wb = fixture(), id = wb.activeSheetId;
  wb.insertCells(id, { r1: 3, c1: 0, r2: 3, c2: 8 }, 'down');
  expect(chart(wb).cellAnchor).toMatchObject({ from: { r: 2 }, to: { r: 6 } });
  wb.deleteCells(id, { r1: 3, c1: 0, r2: 3, c2: 8 }, 'up');
  expect(chart(wb).cellAnchor).toEqual(markers);
  wb.moveRows(id, 1, 5, 9);
  expect(chart(wb).cellAnchor).toMatchObject({ from: { r: 5 }, to: { r: 8 } });
  wb.undo(); expect(chart(wb).cellAnchor).toEqual(markers);
});

it('updates filtered and automatically fitted row extents', () => {
  const wb = fixture(), id = wb.activeSheetId, s = wb.activeSheet;
  s.rowHeightModes.set(3, 'auto');
  wb.cacheAutoRowHeights(id, [[3, 55]]);
  expect(chart(wb).h).toBe(115);
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 5, c2: 1 });
  wb.setFilterCriteria(id, 0, { values: ['First'] });
  expect(chart(wb).h).toBe(10);
  wb.undo(); expect(chart(wb).h).toBe(115);
});

it('keeps affine chart geometry and identity with private metadata', async () => {
  const wb = fixture('column', [.2, .1, .5, .7]);
  const obj = chart(wb), result = (await cycle(wb, true)).wb;
  expect(chart(result)).toMatchObject({ id: obj.id, cellAnchor: obj.cellAnchor, dx: obj.dx, dy: obj.dy, w: obj.w, h: obj.h });
  result.setColWidth(result.activeSheetId, 3, 135);
  expect(chart(result).w).toBe(142.5);
});

it.each(['row', 'col'])('resets the offset when a %s containing an endpoint is deleted', axis => {
  const wb = fixture(), id = wb.activeSheetId, key = axis === 'row' ? 'r' : 'c', offset = axis === 'row' ? 'dy' : 'dx';
  if (axis === 'row') wb.deleteRows(id, 2, 1); else wb.deleteCols(id, 2, 1);
  expect(chart(wb).cellAnchor.from[key]).toBe(2);
  expect(chart(wb).cellAnchor.from[offset]).toBe(0);
  expect(chart(wb).cellAnchor.to[key]).toBe(4);
  expect(chart(wb).cellAnchor.to[offset]).toBe(markers.to[offset]);
  wb.undo();
  if (axis === 'row') wb.deleteRows(id, 5, 1); else wb.deleteCols(id, 5, 1);
  expect(chart(wb).cellAnchor.to[key]).toBe(5);
  expect(chart(wb).cellAnchor.to[offset]).toBe(0);
});

it('serializes independent marker records and preserves geometry after JSON reload', () => {
  const wb = fixture('column', [.2, .1, .5, .7]), json = wb.toJSON();
  json.sheets[0].charts[0].cellAnchor.from.dx = 99;
  json.sheets[0].charts[0].cellAnchor.box[0] = 3;
  expect(chart(wb).cellAnchor.from.dx).toBe(3);
  expect(chart(wb).cellAnchor.box[0]).toBe(.2);
  expect(chart(new Workbook(wb.toJSON()))).toMatchObject({ cellAnchor: chart(wb).cellAnchor, w: chart(wb).w });
});

it('keeps a grouped chart when its whole frame is hidden during native export', async () => {
  const wb = fixture('column', [.2, .1, .5, .7]), id = wb.activeSheetId;
  wb.updateChart(id, chart(wb).id, { cellAnchor: { ...markers, to: { ...markers.to, dx: 3, dy: 4 }, box: [.2, .1, .5, .7] } });
  wb.setHidden(id, 'col', [2, 3, 4], true); wb.setHidden(id, 'row', [2, 3, 4], true);
  expect(chart(wb)).toMatchObject({ w: 0, h: 0 });
  const result = (await cycle(wb)).wb, other = result.activeSheetId;
  expect(result.activeSheet.charts).toHaveLength(1);
  result.setHidden(other, 'col', [2, 3, 4], false); result.setHidden(other, 'row', [2, 3, 4], false);
  expect(chart(result).w).toBeCloseTo(117.5, 10);
  expect(chart(result).h).toBeCloseTo(59.5, 10);
});

it.each([false, true])('retains accessibility and hyperlinks on grouped picture frames (decorative=%s)', async decorative => {
  const wb = fixture('image', [.2, .1, .5, .7]);
  wb.updateChart(wb.activeSheetId, chart(wb).id, { title: 'Picture alternative', hyperlink: '#Data!A1', decorative });
  for (const metadata of [false, true]) {
    const result = (await cycle(wb, metadata)).wb;
    expect(chart(result)).toMatchObject({ type: 'image', hyperlink: '#Data!A1' });
    expect(!!chart(result).decorative).toBe(decorative);
    if (!decorative) expect(chart(result).title).toBe('Picture alternative');
  }
});
