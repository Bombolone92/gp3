import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartXlsx } from './helpers/xlsx-chart-fixture.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function fixture(w, h, rectangles) {
  const zip = X.CFB.read(chartXlsx({ embedded: true }), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/drawings/run.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content)
    .replace('cx="8534400" cy="5791200"', `cx="${Math.round(w * 9525)}" cy="${Math.round(h * 9525)}"`)
    .replace(/<xdr:graphicFrame>[\s\S]*?<\/xdr:graphicFrame>/, '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Thin artwork"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:embed="picture"/>' + rectangles + '</xdr:blipFill><xdr:spPr/></xdr:pic>'));
  part.size = part.content.length;
  const rel = X.CFB.find(zip, '/xl/drawings/_rels/run.xml.rels');
  rel.content = new TextEncoder().encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="picture" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/line.png"/></Relationships>');
  rel.size = rel.content.length;
  const types = X.CFB.find(zip, '/[Content_Types].xml');
  types.content = new TextEncoder().encode(new TextDecoder().decode(types.content).replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>'));
  types.size = types.content.length;
  X.CFB.utils.cfb_add(zip, 'xl/media/line.png', Uint8Array.from(atob(png), c => c.charCodeAt(0)));
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

it.each([
  ['<a:srcRect l="15000" t="-12500" r="20000"/><a:stretch><a:fillRect l="5000" r="-20000" b="12500"/></a:stretch>', { l: .15, t: -.125, r: .2 }, { l: .05, r: -.2, b: .125 }],
  ['<a:srcRect b="25%"/><a:stretch><a:fillRect t="-15%"/></a:stretch>', { b: .25 }, { t: -.15 }],
])('preserves source and destination rectangles natively through edits: %s', async (xml, srcRect, fillRect) => {
  let wb = await workbookFromFile(fixture(180, 90, xml), 'picture.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const s = wb.activeSheet, image = s.charts[0];
    expect(image).toMatchObject({ srcRect, fillRect });
    const id = wb.duplicateChart(s.id, image.id);
    wb.updateChart(s.id, id, { w: 321, h: 123, flipH: true });
    expect(wb.chartById(s.id, id)).toMatchObject({ srcRect, fillRect, w: 321, h: 123 });
    wb.undo();
    expect(wb.chartById(s.id, id)).toMatchObject({ srcRect, fillRect, w: 180, h: 90 });
    wb.deleteChart(s.id, id);
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const drawing = new TextDecoder().decode(X.CFB.find(zip, '/xl/drawings/drawing1.xml').content);
    expect(drawing).toContain('<a:srcRect');
    expect(drawing).toContain('<a:fillRect');
    const book = X.CFB.find(zip, '/xl/workbook.xml');
    book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    book.size = book.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  }
});
