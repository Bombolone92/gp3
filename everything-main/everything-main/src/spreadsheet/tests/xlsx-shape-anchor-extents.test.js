import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { shapeXlsx } from './helpers/xlsx-shape-fixture.js';

function fixture(kind, width, height, transform) {
  const zip = X.CFB.read(new Uint8Array(shapeXlsx({ width, height, text: 'Anchor sized', preset: 'roundRect' })), { type: 'array' });
  const p = X.CFB.find(zip, '/xl/drawings/shapes.xml');
  let xml = new TextDecoder().decode(p.content).replace(/<a:xfrm\b[^>]*>[\s\S]*?<\/a:xfrm>/, transform);
  if (kind === 'absolute') xml = xml.replaceAll('xdr:oneCellAnchor', 'xdr:absoluteAnchor').replace(/<xdr:from>[\s\S]*?<\/xdr:from>/, '<xdr:pos x="47625" y="-28575"/>');
  if (kind === 'twoCell') xml = xml.replaceAll('xdr:oneCellAnchor', 'xdr:twoCellAnchor').replace(/<xdr:ext[^>]*\/>/, `<xdr:to><xdr:col>2</xdr:col><xdr:colOff>${(width + 1) * 9525}</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>${(height + 2) * 9525}</xdr:rowOff></xdr:to>`);
  p.content = new TextEncoder().encode(xml); p.size = p.content.length;
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

it.each([
  ['oneCell', 227, 137, '<a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm>'],
  ['absolute', 94, 51, '<a:xfrm/>'],
  ['twoCell', 173, 82, ''],
  ['absolute', 56.4, 24.24, '<a:xfrm flipH="1"><a:off x="12000" y="-3000"/><a:ext cx="537210" cy="0"/></a:xfrm>'],
])('uses %s anchor dimensions for missing local extents (%s × %s)', async (kind, width, height, transform) => {
  let wb = await workbookFromFile(fixture(kind, width, height, transform), 'anchored.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    expect(wb.activeSheet.charts).toHaveLength(1);
    const picture = wb.activeSheet.charts[0];
    expect(picture.w).toBeCloseTo(width, 3);
    expect(picture.h).toBeCloseTo(height, 3);
    expect(picture.nativeDrawing).toBeTruthy();
    expect(Buffer.from(picture.src.split(',')[1], 'base64').toString()).toContain('Anchor sized');
    if (kind === 'absolute') {
      expect(picture.anchorMode).toBe('absolute');
      expect(picture.dx).toBeCloseTo(5, 3);
      expect(picture.dy).toBeCloseTo(-3, 3);
    }
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const p = X.CFB.find(zip, '/xl/workbook.xml');
    p.content = new TextEncoder().encode(new TextDecoder().decode(p.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); p.size = p.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  }
});
