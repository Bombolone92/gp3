import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartXlsx } from './helpers/xlsx-chart-fixture.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function fixture(w, h) {
  const zip = X.CFB.read(chartXlsx({ embedded: true }), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/drawings/run.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content)
    .replace('cx="8534400" cy="5791200"', `cx="${Math.round(w * 9525)}" cy="${Math.round(h * 9525)}"`)
    .replace(/<xdr:graphicFrame>[\s\S]*?<\/xdr:graphicFrame>/, '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Thin artwork"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:embed="picture"/></xdr:blipFill><xdr:spPr/></xdr:pic>'));
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

it.each([[220, 17.28], [4, 120], [1, 1]])('preserves native picture dimensions %s × %s through export, duplication and movement', async (w, h) => {
  let wb = await workbookFromFile(fixture(w, h), 'thin.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const s = wb.activeSheet, image = s.charts[0];
    expect(image.w).toBeCloseTo(w, 5);
    expect(image.h).toBeCloseTo(h, 5);
    const copy = wb.duplicateChart(s.id, image.id);
    wb.updateChart(s.id, copy, { anchor: { r: 5, c: 6 }, dx: 12, dy: 3 });
    expect(wb.chartById(s.id, copy)).toMatchObject({ w: image.w, h: image.h, nativeSize: true });
    wb.updateChart(s.id, copy, { w: 50, h: 50 });
    wb.undo();
    expect(wb.chartById(s.id, copy)).toMatchObject({ w: image.w, h: image.h });
    wb.deleteChart(s.id, copy);
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const book = X.CFB.find(zip, '/xl/workbook.xml');
    book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    book.size = book.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  }
});
