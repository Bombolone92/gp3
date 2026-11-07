import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { textBoxText, textBoxStyle } from '../src/core/charts.js';
import { shapeXlsx } from './helpers/xlsx-shape-fixture.js';

function edit(zip, name, fn) {
  const part = X.CFB.find(zip, name);
  part.content = new TextEncoder().encode(fn(new TextDecoder().decode(part.content)));
  part.size = part.content.length;
}
const bytes = zip => X.CFB.write(zip, { type: 'array', fileType: 'zip' });
function fixture(options = {}, transform = xml => xml) {
  const zip = X.CFB.read(new Uint8Array(shapeXlsx({ preset: 'rect', text: 'STALE', width: 173, height: 87, ...options })), { type: 'array' });
  edit(zip, '/xl/drawings/shapes.xml', xml => transform(xml
    .replace('<xdr:sp>', '<xdr:sp textlink="Invoice!B2">')
    .replace('<a:r>', '<a:fld type="TxLink">').replace('</a:r>', '</a:fld>')));
  return bytes(zip);
}
async function native(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  edit(zip, '/xl/workbook.xml', xml => xml.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return { wb: await workbookFromFile(bytes(zip)), xml: new TextDecoder().decode(X.CFB.find(zip, '/xl/drawings/drawing1.xml').content) };
}

it.each([[100000, '#fff254'], [50000, '#fff25480']])('keeps solid linked rectangles live with opacity %i through native cycles', async (opacity, bg) => {
  let wb = await workbookFromFile(fixture({ opacity }));
  for (let pass = 0; pass < 3; pass++) {
    const sheet = wb.activeSheet, label = sheet.charts[0];
    expect(label).toMatchObject({ type: 'text', textRef: 'Invoice!B2', w: 173, h: 87, style: { bg, border: false } });
    expect(textBoxStyle(label).backgroundColor).toBe(bg);
    expect(textBoxText(wb, sheet.id, label)).toBe('10');
    wb.setInput(sheet.id, 0, 1, '19');
    expect(textBoxText(wb, sheet.id, label)).toBe('38');
    wb.undo(); expect(textBoxText(wb, sheet.id, label)).toBe('10');
    wb.redo(); expect(textBoxText(wb, sheet.id, label)).toBe('38');
    const copy = wb.sheetToWorkbook(sheet.id);
    expect(textBoxText(copy, copy.activeSheetId, copy.activeSheet.charts[0])).toBe('38');
    expect(copy.activeSheet.charts[0].style.bg).toBe(bg);
    const saved = await native(wb);
    expect(saved.xml).toContain('textlink="Invoice!B2"');
    expect(saved.xml).toContain('type="TxLink"');
    expect(saved.xml).toContain('<a:t>38</a:t>');
    expect(textBoxText(saved.wb, saved.wb.activeSheetId, saved.wb.activeSheet.charts[0])).toBe('38');
    wb = saved.wb; wb.setInput(wb.activeSheetId, 0, 1, '5');
  }
});

it('resolves transformed theme fills and keeps prefix/suffix text around the linked field', async () => {
  const wb = await workbookFromFile(fixture({}, xml => xml
    .replace('<a:srgbClr val="FFF254"/>', '<a:schemeClr val="accent2"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>')
    .replace('<a:fld', '<a:r><a:t>Total: </a:t></a:r><a:fld')
    .replace('</a:fld>', '</a:fld><a:r><a:t> units</a:t></a:r>')));
  const label = wb.activeSheet.charts[0];
  expect(label.type).toBe('text');
  expect(label.style.bg).toMatch(/^#[a-f0-9]{6}$/);
  expect(textBoxText(wb, wb.activeSheetId, label)).toBe('Total: 10 units');
  wb.renameSheet(wb.activeSheetId, 'New Sheet');
  const back = (await native(wb)).wb;
  expect(back.activeSheet.charts[0].style.bg).toBe(label.style.bg);
  expect(textBoxText(back, back.activeSheetId, back.activeSheet.charts[0])).toBe('Total: 10 units');
});

it.each([{ preset: 'ellipse' }, { rotate: 30 }, { stroke: true }])('does not flatten unsupported shape artwork into a rectangle: %j', async options => {
  const wb = await workbookFromFile(fixture(options));
  expect(wb.activeSheet.charts[0].type).toBe('image');
});

it('keeps fully transparent solid rectangles linked without an opaque background', async () => {
  const wb = await workbookFromFile(fixture({ opacity: 0 }));
  const label = wb.activeSheet.charts[0];
  expect(label.type).toBe('text');
  expect(label.style.bg).toBeNull();
  expect(textBoxText(wb, wb.activeSheetId, label)).toBe('10');
});

it.each([
  '<a:effectLst><a:outerShdw blurRad="38100" dist="25400" dir="2700000"><a:srgbClr val="000000"/></a:outerShdw></a:effectLst>',
  '<a:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="balanced" dir="t"/></a:scene3d>',
])('retains the complete drawing for effects unsupported by text boxes', async effect => {
  const wb = await workbookFromFile(fixture({}, xml => xml.replace('</xdr:spPr>', `${effect}</xdr:spPr>`)));
  expect(wb.activeSheet.charts[0].type).toBe('image');
});

it('accepts an explicitly empty effect list', async () => {
  const wb = await workbookFromFile(fixture({}, xml => xml.replace('</xdr:spPr>', '<a:effectLst/></xdr:spPr>')));
  expect(wb.activeSheet.charts[0].type).toBe('text');
});

it('does not discard inherited theme effects or unresolved style references', async () => {
  const wb = await workbookFromFile(fixture({}, xml => xml.replace('</xdr:spPr>', '</xdr:spPr><xdr:style><a:effectRef idx="2"><a:srgbClr val="000000"/></a:effectRef></xdr:style>')));
  expect(wb.activeSheet.charts[0].type).toBe('image');
});
