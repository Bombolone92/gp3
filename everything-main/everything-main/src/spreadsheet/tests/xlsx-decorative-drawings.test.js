import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { Workbook } from '../src/core/workbook.js';
import { shapeXlsx } from './helpers/xlsx-shape-fixture.js';

const URI = '{C183D7F6-B498-43B3-948B-1728B52AA6E4}';
const extension = (value, uri = URI) => `<a:extLst><a:ext uri="${uri}"><d:decorative xmlns:d="http://schemas.microsoft.com/office/drawing/2017/decorative" val="${value}"/></a:ext></a:extLst>`;
function edit(zip, name, fn) {
  const part = X.CFB.find(zip, name);
  part.content = new TextEncoder().encode(fn(new TextDecoder().decode(part.content))); part.size = part.content.length;
}
const bytes = zip => X.CFB.write(zip, { type: 'array', fileType: 'zip' });
function fixture(value, { group = false, uri, rectangle = false } = {}) {
  const zip = X.CFB.read(new Uint8Array(shapeXlsx({ preset: rectangle ? 'rect' : 'ellipse', text: rectangle ? '' : 'Caption' })), { type: 'array' });
  edit(zip, '/xl/drawings/shapes.xml', xml => {
    xml = xml.replace('<xdr:cNvPr id="2" name="Invoice logo"/>', `<xdr:cNvPr id="2" name="Artwork">${extension(value, uri)}</xdr:cNvPr>`);
    if (group) xml = xml.replace('<xdr:sp>', '<xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="3" name="Group"/><xdr:cNvGrpSpPr/></xdr:nvGrpSpPr><xdr:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="1428750"/><a:chOff x="0" y="0"/><a:chExt cx="952500" cy="1428750"/></a:xfrm></xdr:grpSpPr><xdr:sp>')
      .replace('</xdr:sp>', '</xdr:sp></xdr:grpSp>');
    return xml;
  });
  return bytes(zip);
}
async function external(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  edit(zip, '/xl/workbook.xml', xml => xml.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/drawings/drawing1.xml').content);
  return { back: await workbookFromFile(bytes(zip)), xml };
}

it.each(['1', 'true', ' true ', '0', 'false', '', 'yes'])('reads the DrawingML boolean %j without treating strings as truthy', async value => {
  const wb = await workbookFromFile(fixture(value));
  expect(!!wb.activeSheet.charts[0].decorative).toBe(['1', 'true'].includes(value.trim()));
});
it('ignores unrelated extension payloads with the same local name', async () => {
  const wb = await workbookFromFile(fixture('1', { uri: 'unrelated' }));
  expect(wb.activeSheet.charts[0].decorative).toBeUndefined();
});
it.each([false, true])('retains the flag through native export, duplication and removal (rectangle=%j)', async rectangle => {
  let wb = await workbookFromFile(fixture('true', { rectangle }));
  for (let i = 0; i < 2; i++) {
    const result = await external(wb); wb = result.back;
    expect(result.xml).toContain('adec:decorative');
    expect(wb.activeSheet.charts[0].decorative).toBe(true);
  }
  const sheet = wb.activeSheet, first = sheet.charts[0];
  const id = wb.duplicateChart(sheet.id, first.id);
  expect(wb.chartById(sheet.id, id).decorative).toBe(true);
  wb.updateChart(sheet.id, first.id, { decorative: false });
  const result = await external(wb);
  expect(result.back.activeSheet.charts.map(c => !!c.decorative)).toEqual([false, true]);
  wb.undo(); expect(wb.chartById(sheet.id, first.id).decorative).toBe(true);
});
it('retains a decorative child without marking its entire group decorative', async () => {
  const wb = await workbookFromFile(fixture('1', { group: true }));
  expect(wb.activeSheet.charts[0].decorative).toBeUndefined();
  const { back, xml } = await external(wb);
  expect(back.activeSheet.charts[0].decorative).toBeUndefined();
  expect(back.activeSheet.charts[0].nativeDrawing.node.children.find(n => n.name === 'sp').decorative).toBe(true);
  expect(xml.match(/<adec:decorative/g)).toHaveLength(1);
});
it.each(['image', 'text', 'column'])('round trips a decorative %s independently of source shape import', async type => {
  const wb = new Workbook(), sheet = wb.activeSheet;
  wb.setInput(sheet.id, 0, 0, '4'); wb.setInput(sheet.id, 1, 0, '8');
  wb.addChart(sheet.id, { type, anchor: { r: 3, c: 2 }, range: { r1: 0, c1: 0, r2: 1, c2: 0 }, title: 'Retain this description', text: 'Caption',
    src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', decorative: true });
  const { back, xml } = await external(wb);
  expect(back.activeSheet.charts[0].decorative).toBe(true);
  expect(xml).toContain('adec:decorative');
  if (type === 'image') expect(back.activeSheet.charts[0].title).toBe('Retain this description');
});

it('carries intermediate group decoration into split linked-text objects', async () => {
  const zip = X.CFB.read(new Uint8Array(fixture('0', { group: true })), { type: 'array' });
  edit(zip, '/xl/drawings/shapes.xml', xml => {
    const groupProps = '<xdr:nvGrpSpPr><xdr:cNvPr id="4" name="Outer"/><xdr:cNvGrpSpPr/></xdr:nvGrpSpPr><xdr:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="1428750"/><a:chOff x="0" y="0"/><a:chExt cx="952500" cy="1428750"/></a:xfrm></xdr:grpSpPr>';
    return xml.replace('<xdr:cNvPr id="3" name="Group"/>', `<xdr:cNvPr id="3" name="Group">${extension('1')}</xdr:cNvPr>`)
      .replace('<xdr:grpSp>', `<xdr:grpSp>${groupProps}<xdr:grpSp>`).replace('</xdr:grpSp>', '</xdr:grpSp></xdr:grpSp>')
      .replace('<xdr:sp>', '<xdr:sp textlink="Invoice!A1">')
      .replace('<a:solidFill><a:srgbClr val="FFF254"/></a:solidFill>', '<a:noFill/>')
      .replace('<a:r>', '<a:fld type="TxLink">').replace('</a:r>', '</a:fld>');
  });
  const wb = await workbookFromFile(bytes(zip));
  expect(wb.activeSheet.charts[0]).toMatchObject({ type: 'text', decorative: true, textRef: 'Invoice!A1' });
  expect((await external(wb)).back.activeSheet.charts[0].decorative).toBe(true);
});

it.each(['shape', 'image'])('does not export a conflicting accessible description for a decorative %s', async kind => {
  const wb = await workbookFromFile(fixture('1'));
  const sheet = wb.activeSheet, drawing = sheet.charts[0];
  if (kind === 'image') wb.updateChart(sheet.id, drawing.id, {
    src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' });
  wb.updateChart(sheet.id, drawing.id, { title: 'Blue & gold ornament' });
  const decorative = await external(wb);
  const properties = decorative.xml.match(/<xdr:cNvPr\b[^>]*>/)[0];
  expect(properties).not.toContain('descr=');
  expect(decorative.xml).toContain('<adec:decorative');
  expect(wb.chartById(sheet.id, drawing.id).title).toBe('Blue & gold ornament');
  // Object names retain the label even when private metadata is removed.
  expect(decorative.back.activeSheet.charts[0].title).toBe('Blue & gold ornament');
  wb.updateChart(sheet.id, drawing.id, { decorative: false });
  const informative = await external(wb);
  expect(informative.xml.match(/<xdr:cNvPr\b[^>]*>/)[0]).toContain('descr="Blue &amp; gold ornament"');
  expect(informative.xml).not.toContain('<adec:decorative');
  wb.undo();
  expect((await external(wb)).xml.match(/<xdr:cNvPr\b[^>]*>/)[0]).not.toContain('descr=');
});
