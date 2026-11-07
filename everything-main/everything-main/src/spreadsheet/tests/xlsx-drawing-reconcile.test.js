import { expect, it, vi } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { drawingBaseline, reconcileDrawings, identifyDrawing } from '../src/core/xlsx-drawing-reconcile.js';
import { shapeXlsx } from './helpers/xlsx-shape-fixture.js';

const decode = bytes => new TextDecoder().decode(bytes);
const encode = xml => new TextEncoder().encode(xml);
async function exported(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const get = path => decode(X.CFB.find(zip, path).content);
  const set = (path, xml) => X.CFB.utils.cfb_add(zip, path, encode(xml));
  const open = () => workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'edited.xlsx');
  return { zip, get, set, open };
}
const drawing = '/xl/drawings/drawing1.xml';
const svg = obj => Buffer.from(obj.src.split(',')[1], 'base64').toString();

it('preserves an unchanged rich model and sub-EMU precision through repeated exports', async () => {
  let wb = await workbookFromFile(shapeXlsx({ text: '$& 😺 résumé', width: 147, height: 83 }), 'source.xlsx');
  wb.updateChart(wb.activeSheetId, wb.activeSheet.charts[0].id, { dx: 0.123456789, w: 199.87654321 });
  const expected = structuredClone(wb.activeSheet.charts);
  for (let n = 0; n < 3; n++) { wb = await (await exported(wb)).open(); expect(wb.activeSheet.charts).toEqual(expected); }
});

it.each([{ dx: 19.25, w: 321, text: 'Revised α', color: '28AB7F' }, { dx: -12.5, w: 74, text: 'Different β', color: '651BCD' }])('honors native movement, resizing and text/paint edits: %j', async edit => {
  const wb = await workbookFromFile(shapeXlsx({ text: 'Original', width: 147, height: 83 }), 'source.xlsx');
  const original = wb.activeSheet.charts[0], file = await exported(wb);
  file.set(drawing, file.get(drawing).replace(/<xdr:colOff>[^<]*<\/xdr:colOff>/, `<xdr:colOff>${edit.dx * 9525}</xdr:colOff>`)
    .replace(/<xdr:ext cx="[^"]*"/, `<xdr:ext cx="${edit.w * 9525}"`)
    .replace(/Original/g, edit.text).replace(/FFF254/gi, edit.color));
  let back = await file.open(), obj = back.activeSheet.charts[0];
  expect(obj).toMatchObject({ id: original.id, dx: edit.dx, w: edit.w });
  expect(svg(obj)).toContain(edit.text); expect(svg(obj).toLowerCase()).toContain(edit.color.toLowerCase());
  back = await (await exported(back)).open();
  expect(back.activeSheet.charts[0]).toEqual(obj);
});

it('uses creation IDs across renaming, renumbering, reordering, insertion and deletion', async () => {
  const wb = await workbookFromFile(shapeXlsx(), 'source.xlsx');
  const a = wb.activeSheet.charts[0]; wb.duplicateChart(wb.activeSheetId, a.id);
  const b = wb.activeSheet.charts[1], file = await exported(wb), xml = file.get(drawing);
  const anchors = xml.match(/<xdr:oneCellAnchor>[\s\S]*?<\/xdr:oneCellAnchor>/g);
  const changed = anchors[1].replace(/<xdr:cNvPr id="\d+" name="[^"]*"/, '<xdr:cNvPr id="41" name="Renamed"')
    .replace(/<xdr:colOff>[^<]*<\/xdr:colOff>/, '<xdr:colOff>95250</xdr:colOff>');
  const inserted = anchors[0].replace(/<a16:creationId\b[^>]*\/>/, '').replace(/<xdr:cNvPr id="\d+"/, '<xdr:cNvPr id="73"');
  file.set(drawing, xml.replace(anchors.join(''), changed + inserted));
  const back = await file.open();
  expect(back.activeSheet.charts).toHaveLength(2);
  expect(back.activeSheet.charts[0]).toMatchObject({ id: b.id, dx: 10 });
  expect(back.activeSheet.charts.map(c => c.id)).not.toContain(a.id);
  expect(back.activeSheet.charts[1].id).not.toBe(b.id);
  file.set(drawing, xml.replace(anchors.join(''), ''));
  expect((await file.open()).activeSheet.charts).toEqual([]);
});

it('does not attach one saved model to duplicate native creation IDs', async () => {
  const wb = await workbookFromFile(shapeXlsx(), 'source.xlsx'), file = await exported(wb);
  const xml = file.get(drawing), anchor = xml.match(/<xdr:oneCellAnchor>[\s\S]*?<\/xdr:oneCellAnchor>/)[0];
  file.set(drawing, xml.replace(anchor, anchor + anchor));
  const back = await file.open();
  expect(back.activeSheet.charts).toHaveLength(2);
  expect(new Set(back.activeSheet.charts.map(c => c.id)).size).toBe(2);
});

it('reconciles recursive native changes without erasing unprojected model properties', async () => {
  const key = '{11111111-2222-4333-8444-555555555555}';
  const native = { type: 'line', title: 'Old', appearance: { axis: { color: '#000000', visible: true } }, anchor: { r: 3, c: 4 } };
  const model = { ...native, id: 'chart-id', appearance: { ...native.appearance, labelPolicy: 'rich', xTimeUnit: 'years' }, dx: 0.123456789 };
  const saved = { charts: [model], nativeDrawings: [{ id: model.id, key, baseline: await drawingBaseline(native) }] };
  const result = await reconcileDrawings(saved, [{ ...native, title: 'New', appearance: { axis: { color: '#FF0000' }, xTimeUnit: undefined }, xlsxDrawingIdentity: { key } }]);
  expect(result[0]).toMatchObject({ id: model.id, title: 'New', dx: model.dx, appearance: { axis: { color: '#FF0000' }, labelPolicy: 'rich', xTimeUnit: 'years' } });
  expect(result[0].appearance.axis.visible).toBeUndefined();
  expect(await reconcileDrawings(saved, [], [{ key }])).toEqual([model]);
  expect(await reconcileDrawings(saved, [], [])).toEqual([]);
});

it('reads legacy drawing movement from unambiguous names without relying on numeric IDs', async () => {
  const wb = await workbookFromFile(shapeXlsx(), 'source.xlsx'), file = await exported(wb);
  const raw = X.read(X.CFB.write(file.zip, { type: 'array', fileType: 'zip' }), { type: 'array' });
  const meta = JSON.parse(Object.entries(raw.Sheets._puter_meta).filter(([k]) => /^A\d+$/.test(k)).map(([, c]) => c.v).join(''));
  delete meta.sheets[wb.activeSheet.name].nativeDrawings;
  const part = '/xl/worksheets/sheet2.xml';
  const escaped = JSON.stringify(meta).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  file.set(part, file.get(part).replace(/<sheetData>[\s\S]*?<\/sheetData>/, () => `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${escaped}</t></is></c></row></sheetData>`));
  file.set(drawing, file.get(drawing).replace(/<xdr:colOff>[^<]*<\/xdr:colOff>/, '<xdr:colOff>38100</xdr:colOff>').replace(/<xdr:cNvPr id="\d+"/, '<xdr:cNvPr id="88"'));
  expect((await file.open()).activeSheet.charts[0]).toMatchObject({ id: wb.activeSheet.charts[0].id, dx: 4 });
});

it('does not resurrect metadata-only drawings when no native drawing remains', async () => {
  const wb = new Workbook(); wb.addChart(wb.activeSheetId, { type: 'text', text: 'Note', anchor: { r: 1, c: 2 } });
  const file = await exported(wb), part = '/xl/worksheets/sheet1.xml';
  file.set(part, file.get(part).replace(/<drawing\b[^>]*\/>/, ''));
  expect((await file.open()).activeSheet.charts).toEqual([]);
});

it('keeps native text edits when the saved model used a simpler text representation', async () => {
  const wb = new Workbook(); wb.addChart(wb.activeSheetId, { type: 'text', text: 'Old text', anchor: { r: 2, c: 1 } });
  const file = await exported(wb);
  file.set(drawing, file.get(drawing).replace('Old text', 'Edited in Excel'));
  const obj = (await file.open()).activeSheet.charts[0];
  expect(svg(obj)).toContain('Edited in Excel');
  expect(obj.nativeDrawing).toBeTruthy();
});

it('preserves long Unicode metadata and validation helper lists on the same hidden sheet', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const note = '$& <tag> 😀 日本語 _x0041_ '.repeat(150).trimEnd();
  for (let r = 0; r < 20; r++) wb.setNote(id, r, 0, note);
  for (let i = 0; i < 12; i++) wb.addChart(id, { type: 'text', text: `${i} ${note} 😺`, anchor: { r: i, c: 3 } });
  wb.addValidation(id, { type: 'list', source: ['One, two', 'Three, four'], range: { r1: 1, c1: 2, r2: 9, c2: 2 } });
  const file = await exported(wb), back = await file.open();
  expect(back.activeSheet.charts).toEqual(wb.activeSheet.charts);
  for (let r = 0; r < 20; r++) expect(back.getNote(back.activeSheetId, r, 0)).toBe(wb.getNote(id, r, 0));
  expect(back.activeSheet.validations).toEqual(wb.activeSheet.validations);
  const raw = X.read(X.CFB.write(file.zip, { type: 'array', fileType: 'zip' }), { type: 'array' });
  expect(Object.keys(raw.Sheets._puter_meta).filter(k => /^A\d+$/.test(k)).length).toBeGreaterThan(1);
  const helpers = Object.entries(raw.Sheets._puter_meta).filter(([k]) => /^[B-Z]+\d+$/.test(k)).map(([, c]) => c.v);
  expect(helpers).toContain('One, two'); expect(helpers).toContain('Three, four');
});

it('escapes ST_Xstring markers and XML-disallowed characters in rewritten metadata', async () => {
  const wb = new Workbook();
  wb.addChart(wb.activeSheetId, { type: 'text', text: '_x0041_ _x005F_ \uFFFF \uFFFE', anchor: { r: 1, c: 1 } });
  expect((await (await exported(wb)).open()).activeSheet.charts).toEqual(wb.activeSheet.charts);
});

it('retains editable preview models for placement and label changes, but accepts replacement artwork', async () => {
  const key = '{11111111-2222-4333-8444-555555555555}';
  const preview = { type: 'image', src: 'original', title: 'Caption', anchor: { r: 0, c: 0 }, dx: 0 };
  const model = { type: 'histogram', title: 'Caption', anchor: preview.anchor, id: 'chart', binWidth: 7 };
  const saved = { charts: [model], nativeDrawings: [{ key, id: model.id, baseline: await drawingBaseline(preview) }] };
  const moved = { ...preview, dx: 16, title: 'New caption', xlsxDrawingIdentity: { key, description: 'New caption' } };
  expect((await reconcileDrawings(saved, [moved]))[0]).toMatchObject({ type: 'histogram', dx: 16, title: 'Caption', description: 'New caption', binWidth: 7 });
  expect((await reconcileDrawings(saved, [{ ...moved, src: 'replacement' }]))[0]).toMatchObject({ type: 'image', src: 'replacement' });
});

it('uses split group children without resurrecting the former parent drawing', async () => {
  const key = '{11111111-2222-4333-8444-555555555555}';
  const old = { type: 'image', id: 'group', anchor: { r: 0, c: 0 } };
  const saved = { charts: [old], nativeDrawings: [{ key, id: old.id, baseline: await drawingBaseline(old) }] };
  const children = [{ type: 'line', xlsxDrawingIdentity: { parentKey: key } }, { type: 'image', xlsxDrawingIdentity: { parentKey: key } }];
  expect(await reconcileDrawings(saved, children, [{ key }])).toEqual(children);
});

it('retains legacy metadata-only and unreadable drawings without inventing deletions', async () => {
  const old = { type: 'image', id: 'old', title: 'Unreadable', anchor: { r: 0, c: 0 } };
  expect(await reconcileDrawings({ charts: [old] }, [], [])).toEqual([old]);
  expect(await reconcileDrawings({ charts: [old] }, [], [{ name: old.title }])).toEqual([old]);
  const added = { type: 'image', xlsxDrawingIdentity: { name: 'New' } };
  expect(await reconcileDrawings({ charts: [old] }, [added], [{ name: 'Unreadable' }, { name: 'New' }])).toEqual([added, old]);
  expect(await reconcileDrawings({ charts: [null, false, old] }, [], [])).toEqual([old]);
});

it('uses identical fingerprints with and without Web Crypto across browser contexts', async () => {
  const value = { src: 'Unicode 😺 '.repeat(500), anchor: { r: 7, c: 2 }, appearance: { values: [1, 3, 8] } };
  const secure = await drawingBaseline(value), original = globalThis.crypto;
  try {
    vi.stubGlobal('crypto', { getRandomValues: original.getRandomValues.bind(original) });
    expect(await drawingBaseline(value)).toEqual(secure);
    const wb = new Workbook(); wb.addChart(wb.activeSheetId, { type: 'text', text: 'Portable', anchor: { r: 2, c: 3 } });
    const file = await exported(wb);
    vi.stubGlobal('crypto', original);
    expect((await file.open()).activeSheet.charts).toEqual(wb.activeSheet.charts);
  } finally { vi.unstubAllGlobals(); }
});

it.each([undefined, null])('preserves an absent appearance object instead of inventing native defaults, saved=%s', async appearance => {
  const key = '{00000000-0000-4000-8000-000000000001}';
  const native = { type: 'column', appearance: { plot: { x: .1, y: .2 }, axis: { color: '#123456' } }, xlsxDrawingIdentity: { key } };
  const saved = { charts: [{ id: 'model', type: 'column', ...(appearance === null ? { appearance } : {}) }],
    nativeDrawings: [{ id: 'model', key, baseline: await drawingBaseline(native) }] };
  const result = await reconcileDrawings(saved, [structuredClone(native)]);
  expect(result[0].appearance).toBe(appearance);
});
it.each(['change', 'add', 'delete'])('adopts the complete native object after a native %s to an object absent from metadata', async edit => {
  const key = '{00000000-0000-4000-8000-000000000001}';
  const native = { type: 'column', appearance: { plot: { x: .1, y: .2 }, axis: { color: '#123456' } }, xlsxDrawingIdentity: { key } };
  const saved = { charts: [{ id: 'model', type: 'column' }], nativeDrawings: [{ id: 'model', key, baseline: await drawingBaseline(native) }] };
  const current = structuredClone(native);
  if (edit === 'change') current.appearance.plot.x = .3;
  if (edit === 'add') current.appearance.extra = { visible: true };
  if (edit === 'delete') delete current.appearance.axis;
  const result = await reconcileDrawings(saved, [current]);
  expect(result[0].appearance).toEqual(current.appearance);
  expect(result[0].appearance.plot.y).toBe(.2);
});
it.each(['column', 'bar', 'line'])('retains authored %s rendering mode through metadata cycles and adopts external native appearance edits', async type => {
  let wb = new Workbook({ sheets: [{ name: 'Report', charts: [{ type, anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 1, c2: 1 },
    sourceRefs: [{ name: 'Values', literal: { categories: ['A', 'B'], values: [3, 7] } }] }] }] });
  for (let cycle = 0; cycle < 2; cycle++) {
    wb = await (await exported(wb)).open();
    expect(wb.activeSheet.charts[0].appearance).toBeUndefined();
  }
  const file = await exported(wb), path = '/xl/charts/chart1_1.xml';
  file.set(path, file.get(path).replace('<c:orientation val="minMax"/>', '<c:orientation val="maxMin"/>'));
  const edited = await file.open();
  expect(edited.activeSheet.charts[0].appearance).toBeTruthy();
  expect(edited.activeSheet.charts[0].appearance.axisStyles).toBeTruthy();
});

it('assigns identity to a self-closing outer property before a child with paired properties', () => {
  const { xml, key } = identifyDrawing('<xdr:grpSp><xdr:cNvPr id="1"/><xdr:sp><xdr:cNvPr id="2"></xdr:cNvPr></xdr:sp></xdr:grpSp>');
  expect(xml).toContain(`<xdr:cNvPr id="1"><a:extLst>`);
  expect(xml).toContain(`id="${key}"`);
  expect(xml).toContain('<xdr:cNvPr id="2"></xdr:cNvPr>');
});
