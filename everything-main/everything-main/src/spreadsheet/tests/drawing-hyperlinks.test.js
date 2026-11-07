import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { shapeXlsx } from './helpers/xlsx-shape-fixture.js';
import { xmlTag } from '../src/core/xlsx-export-styles.js';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const edit = (zip, path, fn) => { const p = X.CFB.find(zip, path); p.content = new TextEncoder().encode(fn(new TextDecoder().decode(p.content))); p.size = p.content.length; };
const bytes = zip => X.CFB.write(zip, { type: 'array', fileType: 'zip' });
async function native(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  edit(zip, '/xl/workbook.xml', xml => xml.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return workbookFromFile(bytes(zip));
}
function shapeLink(url, mode = 'External') {
  const zip = X.CFB.read(new Uint8Array(shapeXlsx({ preset: 'roundRect', text: 'Navigate' })), { type: 'array' });
  edit(zip, '/xl/drawings/shapes.xml', xml => xml.replace(/<xdr:cNvPr\b([^>]*?)\/>/, (_, attrs) => `<xdr:cNvPr${attrs}>${xmlTag('a:hlinkClick', { 'r:id': 'jump', tooltip: 'Open destination' })}</xdr:cNvPr>`));
  X.CFB.utils.cfb_add(zip, '/xl/drawings/_rels/shapes.xml.rels', new TextEncoder().encode(xmlTag('Relationships', { xmlns: 'http://schemas.openxmlformats.org/package/2006/relationships' }, xmlTag('Relationship', { Id: 'jump', Type: `${R}hyperlink`, Target: url, TargetMode: mode }))));
  return bytes(zip);
}
it.each(["#'Destination Sheet'!C7", 'https://example.com/path?a=1&b=2', 'mailto:person@example.com'])('keeps shape hyperlink %s independently of its anchor cell', async url => {
  let wb = await workbookFromFile(shapeLink(url));
  for (let i = 0; i < 3; i++) {
    const ch = wb.activeSheet.charts[0];
    expect(ch).toMatchObject({ type: 'image', drawingShape: true, hyperlink: url, hyperlinkTooltip: 'Open destination' });
    wb.setInput(wb.activeSheetId, ch.anchor.r, ch.anchor.c, '=HYPERLINK("https://different.example/","Other")');
    wb.updateChart(wb.activeSheetId, ch.id, { anchor: { r: 7 + i, c: 5 }, dx: 21, dy: 11 });
    wb = await native(wb);
  }
});
it('retains targets for pictures, text boxes and charts through native-only export', async () => {
  const wb = new Workbook(), sid = wb.activeSheetId;
  wb.setInput(sid, 0, 0, '5');
  const common = { anchor: { r: 2, c: 3 }, w: 200, h: 100, hyperlink: '#A1', hyperlinkTooltip: 'Go <back> & inspect' };
  wb.addChart(sid, { ...common, type: 'image', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7xkAAAAASUVORK5CYII=' });
  wb.addChart(sid, { ...common, type: 'text', text: 'Back' });
  wb.addChart(sid, { ...common, type: 'column', range: { r1: 0, c1: 0, r2: 0, c2: 0 } });
  const restored = await native(wb);
  expect(restored.activeSheet.charts).toHaveLength(3);
  for (const ch of restored.activeSheet.charts) expect(ch).toMatchObject({ hyperlink: '#A1', hyperlinkTooltip: common.hyperlinkTooltip });
});
it('renames linked sheets with escaped names and restores links through undo/redo', async () => {
  const wb = await workbookFromFile(shapeLink("#'DESTINATION SHEET'!C7"));
  const source = wb.activeSheetId, target = wb.addSheet('Destination Sheet');
  wb.renameSheet(target.id, "Owner's sheet");
  expect(wb.sheet(source).charts[0].hyperlink).toBe("#'Owner''s sheet'!C7");
  wb.undo(); expect(wb.sheet(source).charts[0].hyperlink).toBe("#'DESTINATION SHEET'!C7");
  wb.redo(); expect((await native(wb)).sheetByName(wb.sheet(source).name).charts[0].hyperlink).toBe("#'Owner''s sheet'!C7");
});
it('retains named destinations through sheet copy and name edits', async () => {
  const wb = await workbookFromFile(shapeLink('#Landing'));
  wb.defineName('Landing', 'Invoice!$B$2');
  const original = wb.activeSheetId;
  expect(wb.renameName('Landing', null, 'Destination', 'Invoice!$B$2')).toBeNull();
  expect(wb.sheet(original).charts[0].hyperlink).toBe('#Destination');
  const copy = wb.sheetToWorkbook(original);
  expect(copy.activeSheet.charts[0].hyperlink).toBe('#Destination');
  expect(copy.names.some(n => n.name === 'Destination')).toBe(true);
});

it('keeps self-links pointing at a duplicated sheet and restores named-link renames', async () => {
  const wb = await workbookFromFile(shapeLink('#Invoice!B2'));
  const duplicate = wb.duplicateSheet(wb.activeSheetId);
  expect(wb.resolveLink(duplicate.charts[0].hyperlink, duplicate.id).sheetId).toBe(duplicate.id);
  wb.defineName('Landing', 'Invoice!$B$2');
  wb.updateChart(duplicate.id, duplicate.charts[0].id, { hyperlink: '#Landing' });
  wb.renameName('Landing', null, 'NewLanding', 'Invoice!$B$2');
  expect(wb.sheet(duplicate.id).charts[0].hyperlink).toBe('#NewLanding');
  wb.undo(); expect(wb.sheet(duplicate.id).charts[0].hyperlink).toBe('#Landing');
  wb.redo(); expect(wb.sheet(duplicate.id).charts[0].hyperlink).toBe('#NewLanding');
});
it('ignores unresolved hyperlink relationship IDs', async () => {
  const zip = X.CFB.read(new Uint8Array(shapeLink('#Invoice!A1')), { type: 'array' });
  edit(zip, '/xl/drawings/_rels/shapes.xml.rels', xml => xml.replace('Id="jump"', 'Id="different"'));
  expect((await workbookFromFile(bytes(zip))).activeSheet.charts[0].hyperlink).toBeUndefined();
});
