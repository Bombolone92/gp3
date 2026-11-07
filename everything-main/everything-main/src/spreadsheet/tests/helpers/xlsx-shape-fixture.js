import * as X from '../../src/vendor/xlsx.mjs';
import { otherProgramsXlsx } from './xlsx-fixture.js';

/** Minimal DrawingML fixture. */
export function shapeXlsx({ preset = 'flowChartDocument', text = 'LOGO', geometry = '', run = '', width = 100, height = 150, rotate = 0, opacity = 100000, stroke = false } = {}) {
  const bytes = otherProgramsXlsx({ sheetNames: ['Invoice'], sheetXml: { Invoice: {
    rows: '<row r="1"><c r="A1" t="str"><v>Invoice</v></c><c r="B1"><v>5</v></c></row><row r="2"><c r="B2"><f>B1*2</f><v>10</v></c></row>',
    tail: '<drawing r:id="drawing"/>',
  } }, patch: { '/xl/theme/theme1.xml': xml => xml.replace(/(<a:majorFont>\s*<a:latin) typeface="[^"]*"/, '$1 typeface="Georgia"') } });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const add = (path, xml) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(xml));
  const types = X.CFB.find(zip, '/[Content_Types].xml');
  types.content = new TextEncoder().encode(new TextDecoder().decode(types.content).replace('</Types>',
    '<Override PartName="/xl/drawings/shapes.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>'));
  types.size = types.content.length;
  add('xl/worksheets/_rels/sheet1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="drawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/shapes.xml"/></Relationships>');
  const escape = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
  add('xl/drawings/shapes.xml', `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:colOff>9525</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>19050</xdr:rowOff></xdr:from><xdr:ext cx="${width * 9525}" cy="${height * 9525}"/><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="2" name="Invoice logo"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm rot="${rotate * 60000}"><a:off x="0" y="0"/><a:ext cx="${width * 9525}" cy="${height * 9525}"/></a:xfrm>${geometry || `<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>`}<a:solidFill><a:srgbClr val="FFF254"/></a:solidFill><a:ln><a:noFill/></a:ln></xdr:spPr><xdr:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/>${run || `<a:r><a:rPr sz="1200" b="1"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:latin typeface="+mj-lt"/></a:rPr><a:t>${escape(text)}</a:t></a:r>`}</a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`);
  if (opacity !== 100000 || stroke) {
    const entry = X.CFB.find(zip, '/xl/drawings/shapes.xml');
    let xml = new TextDecoder().decode(entry.content).replace('<a:srgbClr val="FFF254"/>', `<a:srgbClr val="FFF254"><a:alpha val="${opacity}"/></a:srgbClr>`);
    if (stroke) xml = xml.replace('<a:ln><a:noFill/></a:ln>', '<a:ln w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>');
    entry.content = new TextEncoder().encode(xml);
    entry.size = entry.content.length;
  }
  return X.CFB.write(zip, { type: 'array', fileType: 'zip', compression: true });
}
