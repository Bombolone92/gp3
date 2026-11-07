import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { shapeXlsx } from './helpers/xlsx-shape-fixture.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const geometry = { anchorMode: 'absolute', anchor: { r: 0, c: 0 }, dx: 723.25, dy: -7.5, w: 160, h: 90 };
const drawing = type => ({ ...geometry, type, src: png, text: '', style: { bg: '#123456', border: false }, range: { r1: 2, c1: 1, r2: 6, c2: 2 } });
const get = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path).content);
const set = (zip, path, xml) => {
  const part = X.CFB.find(zip, path);
  part.content = new TextEncoder().encode(xml); part.size = part.content.length;
};
async function native(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const xml = get(zip, '/xl/drawings/drawing1.xml');
  set(zip, '/xl/workbook.xml', get(zip, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return { xml, back: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx') };
}

async function twoCellDrawing(type, editAs, anchorName = 'twoCellAnchor') {
  const wb = new Workbook({ sheets: [{ name: 'Data', defaultColWidth: 73, defaultRowHeight: 23,
    colWidths: { 0: 101, 1: 187, 3: 91 }, rowHeights: { 0: 41, 1: 67, 3: 29 }, hiddenCols: [1], hiddenRows: [1],
    charts: [{ ...drawing(type), anchorMode: undefined, anchor: { r: 3, c: 3 }, dx: 7.25, dy: -2.5 }],
    cells: { '2,1': { v: 'Category' }, '2,2': { v: 'Amount' }, '3,1': { v: 'First' }, '3,2': { v: 10 } },
  }] });
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = '/xl/drawings/drawing1.xml';
  let xml = get(zip, part).replace('<xdr:oneCellAnchor>', `<xdr:${anchorName}${editAs == null ? '' : ` editAs="${editAs}"`}>`)
    .replace('</xdr:oneCellAnchor>', `</xdr:${anchorName}>`);
  if (anchorName === 'twoCellAnchor') xml = xml.replace(/<xdr:ext\b[^>]*\/>/, '<xdr:to><xdr:col>5</xdr:col><xdr:colOff>47625</xdr:colOff><xdr:row>6</xdr:row><xdr:rowOff>142875</xdr:rowOff></xdr:to>');
  set(zip, part, xml);
  set(zip, '/xl/workbook.xml', get(zip, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
}

it.each(['image', 'text', 'column'])('honors twoCellAnchor editAs="absolute" for a %s across edits and native round trips', async type => {
  const cell = await twoCellDrawing(type, 'oneCell'), wb = await twoCellDrawing(type, 'absolute');
  const obj = cell.activeSheet.charts[0], id = wb.activeSheetId;
  const fixed = { anchorMode: 'absolute', anchor: { r: 0, c: 0 },
    dx: obj.dx + [0, 1, 2].reduce((sum, c) => sum + cell.colWidth(cell.activeSheetId, c), 0),
    dy: obj.dy + [0, 1, 2].reduce((sum, r) => sum + cell.rowHeight(cell.activeSheetId, r), 0), w: obj.w, h: obj.h };
  expect(wb.activeSheet.charts[0]).toMatchObject(fixed);
  wb.insertRows(id, 0, 2); wb.insertCols(id, 0, 3);
  wb.setColWidth(id, 0, 209); wb.setRowHeight(id, 0, 58);
  wb.setHidden(id, 'col', [1], false); wb.setHidden(id, 'row', [1], false);
  wb.deleteRows(id, 0, 1); wb.deleteCols(id, 0, 2);
  expect(wb.activeSheet.charts[0]).toMatchObject(fixed);
  wb.undo(); expect(wb.activeSheet.charts[0]).toMatchObject(fixed);
  wb.redo(); expect(wb.activeSheet.charts[0]).toMatchObject(fixed);
  const first = await native(wb);
  expect(first.xml).toMatch(/<xdr:(?:absoluteAnchor|twoCellAnchor editAs="absolute")>/);
  expect(first.back.activeSheet.charts[0]).toMatchObject(fixed);
  expect((await native(first.back)).back.activeSheet.charts[0]).toMatchObject(fixed);
});

it.each([undefined, 'oneCell', 'twoCell', 'invalid'])('does not make a two-cell drawing absolute for editAs=%s', async editAs => {
  const wb = await twoCellDrawing('image', editAs), id = wb.activeSheetId;
  expect(wb.activeSheet.charts[0].anchorMode).toBeUndefined();
  wb.insertRows(id, 0, 2); wb.insertCols(id, 0, 1);
  expect(wb.activeSheet.charts[0].anchor).toEqual({ r: 5, c: 4 });
});

it('ignores an editAs attribute on a one-cell anchor', async () => {
  const wb = await twoCellDrawing('image', 'absolute', 'oneCellAnchor');
  expect(wb.activeSheet.charts[0].anchorMode).toBeUndefined();
  expect(wb.activeSheet.charts[0].anchor).toEqual({ r: 3, c: 3 });
});

it.each(['image', 'text', 'column'].flatMap(type => ['oneCell', 'absolute'].map(mode => [type, mode])))
('preserves initial two-cell markers for a fixed-size %s with editAs=%s', async (type, mode) => {
  let wb = await twoCellDrawing(type, mode);
  const first = wb.activeSheet.charts[0], markers = { editAs: mode,
    from: { r: 3, c: 3, dx: Math.round(7.25 * 9525) / 9525, dy: Math.round(-2.5 * 9525) / 9525 }, to: { r: 6, c: 5, dx: 5, dy: 15 } };
  expect(first.cellAnchor).toEqual(markers);
  wb.updateChart(wb.activeSheetId, first.id, { title: 'New alternative or title' });
  // Changes beyond the drawing do not discard native initial geometry.
  wb.setColWidth(wb.activeSheetId, 20, 145);
  expect(wb.activeSheet.charts[0].cellAnchor).toEqual(markers);
  for (let i = 0; i < 2; i++) {
    const result = await native(wb); wb = result.back;
    expect(result.xml).toContain(`<xdr:twoCellAnchor editAs="${mode}">`);
    expect(wb.activeSheet.charts[0].cellAnchor).toEqual(markers);
    expect(wb.activeSheet.charts[0]).toMatchObject({ w: first.w, h: first.h, dx: first.dx, dy: first.dy });
  }
  // Changing a spanned column must not resize these objects. Its old ending
  // marker no longer describes that size, so export uses the fixed extent.
  const id = wb.activeSheetId;
  wb.setColWidth(id, 4, 150);
  const edited = wb.activeSheet.charts[0];
  expect(edited).toMatchObject({ w: first.w, h: first.h });
  const result = await native(wb);
  expect(result.xml).toContain(mode === 'absolute' ? '<xdr:absoluteAnchor>' : '<xdr:oneCellAnchor>');
  expect(result.back.activeSheet.charts[0]).toMatchObject({ w: first.w, h: first.h, dx: first.dx, dy: first.dy });
  wb.undo(); expect((await native(wb)).back.activeSheet.charts[0].cellAnchor).toEqual(markers);
});

it('moves fixed-size cell markers together on insertion before the object', async () => {
  const wb = await twoCellDrawing('image', 'oneCell'), id = wb.activeSheetId, before = wb.activeSheet.charts[0];
  wb.insertRows(id, 0, 2); wb.insertCols(id, 0, 1);
  expect(wb.activeSheet.charts[0]).toMatchObject({ w: before.w, h: before.h,
    cellAnchor: { editAs: 'oneCell', from: { r: 5, c: 4 }, to: { r: 8, c: 6 } } });
  const result = await native(wb);
  expect(result.back.activeSheet.charts[0].cellAnchor).toEqual(wb.activeSheet.charts[0].cellAnchor);
});

it.each(['oneCell', 'absolute'])('exports edited bounds when dragging or duplicating an editAs=%s drawing', async mode => {
  const wb = await twoCellDrawing('image', mode), id = wb.activeSheetId, obj = wb.activeSheet.charts[0];
  const copied = wb.chartById(id, wb.duplicateChart(id, obj.id));
  expect(copied.anchorMode).toBe(obj.anchorMode);
  wb.updateChart(id, obj.id, { dx: obj.dx + 40 });
  const result = await native(wb);
  expect(result.xml).not.toContain('<xdr:twoCellAnchor');
  expect(result.back.activeSheet.charts[0].dx).toBeCloseTo(obj.dx + 40, 3);
  expect(result.back.activeSheet.charts[1]).toMatchObject({ w: copied.w, h: copied.h });
  wb.undo(); expect(wb.chartById(id, obj.id).cellAnchor).toEqual(obj.cellAnchor);
});

it.each(['oneCell', 'absolute'])('retains padded native shape frames with editAs=%s', async mode => {
  const zip = X.CFB.read(shapeXlsx({ preset: 'roundRect', width: 91, height: 57, stroke: true }), { type: 'array' });
  set(zip, '/xl/worksheets/sheet1.xml', get(zip, '/xl/worksheets/sheet1.xml')
    .replace('<sheetData>', '<sheetFormatPr defaultColWidth="12.5" defaultRowHeight="19.5"/><sheetData>'));
  const part = '/xl/drawings/shapes.xml';
  set(zip, part, get(zip, part).replace('<xdr:oneCellAnchor>', `<xdr:twoCellAnchor editAs="${mode}">`)
    .replace('</xdr:oneCellAnchor>', '</xdr:twoCellAnchor>')
    .replace(/<xdr:ext\b[^>]*\/>/, '<xdr:to><xdr:col>4</xdr:col><xdr:colOff>47625</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>142875</xdr:rowOff></xdr:to>'));
  let wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
  const before = wb.activeSheet.charts[0];
  expect(before.cellAnchor.box).toBeDefined();
  for (let i = 0; i < 2; i++) {
    const result = await native(wb); wb = result.back;
    const obj = wb.activeSheet.charts[0];
    expect(result.xml).toContain(`<xdr:twoCellAnchor editAs="${mode}">`);
    expect(obj.cellAnchor.from).toEqual(before.cellAnchor.from);
    expect(obj.cellAnchor.to).toEqual(before.cellAnchor.to);
    for (const key of ['w', 'h', 'dx', 'dy']) expect(obj[key]).toBeCloseTo(before[key], 3);
  }
  // Private metadata and JSON preserve the same source frame as native exchange.
  const copy = new Workbook(wb.toJSON());
  const saved = await workbookFromFile(new Uint8Array(await (await workbookToXlsx(copy)).arrayBuffer()));
  expect(saved.activeSheet.charts[0].cellAnchor).toEqual(copy.activeSheet.charts[0].cellAnchor);
});

it.each([[813.36, -4.24], [-11.52, 987.12], [0, 0]])('imports absolute shape coordinates (%s, %s) without turning them into cell offsets', async (x, y) => {
  const zip = X.CFB.read(shapeXlsx({ preset: 'rect', text: '', width: 80, height: 35 }), { type: 'array' });
  const part = '/xl/drawings/shapes.xml';
  set(zip, part, get(zip, part).replaceAll('oneCellAnchor', 'absoluteAnchor')
    .replace(/<xdr:from>[\s\S]*?<\/xdr:from>/, `<xdr:pos x="${x * 9525}" y="${y * 9525}"/>`));
  const wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'shape.xlsx');
  expect(wb.activeSheet.charts[0]).toMatchObject({ anchorMode: 'absolute', anchor: { r: 0, c: 0 }, dx: x, dy: y });
  const { back, xml } = await native(wb);
  expect(xml).toContain('<xdr:absoluteAnchor>');
  expect(xml).not.toContain('<xdr:from>');
  expect(back.activeSheet.charts[0]).toMatchObject({ anchorMode: 'absolute', dx: x, dy: y });
});

it.each(['image', 'text', 'column'])('keeps an absolute %s fixed through sheet geometry and structural edits', async type => {
  const wb = new Workbook({ sheets: [{ name: 'Data', charts: [drawing(type)], cells: {
    '2,1': { v: 'Category' }, '2,2': { v: 'Amount' }, '3,1': { v: 'First' }, '3,2': { v: 10 }, '4,1': { v: 'Second' }, '4,2': { v: 20 },
  } }] }), id = wb.activeSheetId;
  const original = wb.activeSheet.charts[0];
  wb.insertRows(id, 0, 3); wb.insertCols(id, 0, 2);
  wb.setColWidth(id, 0, 210); wb.setRowHeight(id, 0, 70);
  wb.setHidden(id, 'col', [1], true); wb.setHidden(id, 'row', [1], true);
  wb.deleteRows(id, 0, 2); wb.deleteCols(id, 0, 1);
  const current = wb.activeSheet.charts[0];
  expect(current).toMatchObject({ anchorMode: 'absolute', anchor: geometry.anchor, dx: geometry.dx, dy: geometry.dy, w: original.w, h: original.h });
  // Data references still follow edits even though the object's position is fixed.
  if (type === 'column') expect(current.range).toEqual({ r1: 3, c1: 2, r2: 7, c2: 3 });
  const { back, xml } = await native(wb);
  expect(xml).toContain(`<xdr:pos x="${Math.round(geometry.dx * 9525)}" y="${Math.round(geometry.dy * 9525)}"/>`);
  expect(back.activeSheet.charts[0].dx).toBeCloseTo(geometry.dx, 3);
  expect(back.activeSheet.charts[0].dy).toBeCloseTo(geometry.dy, 3);
});

it('converts a moved absolute image using real visible sheet dimensions and supports undo and duplication', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', defaultColWidth: 75, defaultRowHeight: 23,
    colWidths: { 0: 100, 1: 200 }, rowHeights: { 0: 50, 1: 80 }, hiddenCols: [1], hiddenRows: [1], charts: [drawing('image')] }] });
  const id = wb.activeSheetId, obj = wb.activeSheet.charts[0];
  wb.updateChart(id, obj.id, { anchor: { r: 3, c: 3 }, dx: 4.5, dy: 6.25 }, 'Move image');
  expect(wb.chartById(id, obj.id)).toMatchObject({ anchorMode: 'absolute', anchor: { r: 0, c: 0 }, dx: 179.5, dy: 79.25 });
  wb.undo(); expect(wb.chartById(id, obj.id)).toMatchObject(geometry);
  wb.redo();
  const duplicate = wb.duplicateChart(id, obj.id);
  const copy = wb.chartById(id, duplicate);
  expect(copy.anchorMode).toBe('absolute');
  expect(copy.anchor).toEqual({ r: 0, c: 0 });
  // Duplication places the copy 24px down and right of the original, as for cell-anchored objects.
  const original = wb.chartById(id, obj.id);
  expect(copy.dx).toBeCloseTo(original.dx + 24, 6); expect(copy.dy).toBeCloseTo(original.dy + 24, 6);
  const { back } = await native(wb);
  // The file holds positions in whole EMUs (9525 to a pixel).
  const emu = value => expect.toSatisfy(v => Math.abs(v - value) <= 1 / 9525);
  expect(back.activeSheet.charts[1]).toMatchObject({ anchorMode: 'absolute', dx: emu(copy.dx), dy: emu(copy.dy) });
});

it('keeps ordinary images cell anchored', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.addChart(id, { ...drawing('image'), anchorMode: 'invalid', anchor: { r: 2, c: 3 }, dx: 8, dy: 5 });
  wb.insertRows(id, 0, 2); wb.insertCols(id, 0, 1);
  expect(wb.activeSheet.charts[0].anchor).toEqual({ r: 4, c: 4 });
  const { xml, back } = await native(wb);
  expect(xml).toContain('<xdr:oneCellAnchor>');
  expect(back.activeSheet.charts[0].anchorMode).toBeUndefined();
  expect(back.activeSheet.charts[0].anchor).toEqual({ r: 4, c: 4 });
});

it('keeps absolute drawings fixed through line reordering and partial cell shifts', () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', charts: [drawing('image')] }] }), id = wb.activeSheetId;
  const unchanged = () => expect(wb.activeSheet.charts[0]).toMatchObject(geometry);
  wb.moveRows(id, 0, 2, 6); unchanged();
  wb.moveCols(id, 0, 2, 5); unchanged();
  const block = { r1: 0, c1: 0, r2: 1, c2: 2 };
  wb.insertCells(id, block, 'down'); unchanged();
  wb.deleteCells(id, block, 'left'); unchanged();
});
