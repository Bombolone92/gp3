import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartXlsx } from './helpers/xlsx-chart-fixture.js';
import { vectorEmf } from './helpers/emf-fixture.js';

function fixture({ grouped = false } = {}) {
  const zip = X.CFB.read(chartXlsx({ embedded: true }), { type: 'array' });
  const write = (part, xml) => { const p = X.CFB.find(zip, part); p.content = new TextEncoder().encode(xml); p.size = p.content.length; };
  write('/xl/drawings/run.xml', '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>95250</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>47625</xdr:rowOff></xdr:from><xdr:ext cx="1924050" cy="1162050"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Vector artwork"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="picture"/></xdr:blipFill><xdr:spPr><a:xfrm flipH="1" rot="5400000"/></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>');
  write('/xl/drawings/_rels/run.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="picture" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/vector.emf"/></Relationships>');
  if (grouped) {
    const part = X.CFB.find(zip, '/xl/drawings/run.xml');
    const group = (id, off, ext, childExt) => `<xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="${id}" name="Group ${id}"/></xdr:nvGrpSpPr><xdr:grpSpPr><a:xfrm><a:off x="${off}" y="${off}"/><a:ext cx="${ext}" cy="${ext}"/><a:chOff x="0" y="0"/><a:chExt cx="${childExt}" cy="${childExt}"/></a:xfrm></xdr:grpSpPr>`;
    write('/xl/drawings/run.xml', new TextDecoder().decode(part.content).replace('<xdr:pic>', group(2, 0, 200, 200) + group(3, 10, 160, 80) + '<xdr:pic>')
      .replace('</xdr:pic>', '</xdr:pic></xdr:grpSp></xdr:grpSp>')
      .replace('<a:xfrm flipH="1" rot="5400000"/>', '<a:xfrm flipH="1"><a:off x="0" y="0"/><a:ext cx="80" cy="40"/></a:xfrm>')
      .replace('<a:blip r:embed="picture"/>', '<a:blip r:embed="picture"/><a:srcRect l="25000" r="25000"/><a:stretch><a:fillRect t="10000" r="-12500"/></a:stretch>'));
  }
  X.CFB.utils.cfb_add(zip, 'xl/media/vector.emf', vectorEmf());
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

it('displays native EMF artwork and exports its original vectors without private metadata', async () => {
  let wb = await workbookFromFile(fixture(), 'vector.xlsx');
  const expected = wb.sheets[0].charts[0].src;
  for (let pass = 0; pass < 2; pass++) {
    expect(wb.sheets[0].charts).toHaveLength(1);
    expect(wb.sheets[0].charts[0]).toMatchObject({ type: 'image', title: 'Vector artwork', src: expected,
      anchor: { r: 2, c: 1 }, dx: 10, dy: 5, w: 202, h: 122, rotation: 90, flipH: true });
    expect(expected).toMatch(/^data:image\/svg\+xml;base64,/);
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const image = zip.FullPaths.find(p => p.endsWith('.emf'));
    expect(new Uint8Array(X.CFB.find(zip, image).content)).toEqual(vectorEmf());
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  }
});

it('renders pictures inside nested groups with their crop and transform intact', async () => {
  let wb = await workbookFromFile(fixture({ grouped: true }), 'group.xlsx');
  expect(wb.sheets[0].charts).toHaveLength(1);
  const image = wb.sheets[0].charts[0];
  expect(image).toMatchObject({ type: 'image', drawingShape: true, title: 'Group 2' });
  const svg = atob(image.src.split(',')[1]);
  expect(svg).toContain('scale(2 2)');
  expect(svg).toContain('scale(-1 1)');
  expect(svg).toContain('viewBox="0.25 0 0.5 1"');
  expect(svg).toContain('<svg x="0" y="0.1" width="1.125" height="0.9"');
  expect(svg).toContain('<image href="data:image/svg+xml;base64,');
  wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  expect(wb.sheets[0].charts[0].src).toBe(image.src);
});

it('retains original artwork through duplication and resizing, and discards it on replacement with undo', async () => {
  const wb = await workbookFromFile(fixture(), 'vector.xlsx'), id = wb.activeSheetId, image = wb.sheets[0].charts[0];
  const copy = wb.duplicateChart(id, image.id);
  expect(wb.chartById(id, copy).nativeSrc).toBe(image.nativeSrc);
  wb.updateChart(id, copy, { w: 404, h: 244, rotation: 180 });
  expect(wb.chartById(id, copy).nativeSrc).toBe(image.nativeSrc);
  const src = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
  wb.updateChart(id, copy, { src });
  expect(wb.chartById(id, copy).nativeSrc).toBeUndefined();
  wb.undo();
  expect(wb.chartById(id, copy).nativeSrc).toBe(image.nativeSrc);
});
