import * as X from '../../src/vendor/xlsx.mjs';
import { otherProgramsXlsx } from './xlsx-fixture.js';

// Invoice artwork uses small, borderless rectangles; a blank text run is still decoration.
export function invoiceXlsx({ rectangleText = ' ' } = {}) {
  const bytes = otherProgramsXlsx({
    sheetNames: ['Invoice'],
    sheetXml: { Invoice: {
      head: '<sheetFormatPr defaultRowHeight="20"/><cols><col min="1" max="7" width="17.625" customWidth="1"/></cols>',
      rows: '<row r="1" ht="30" customHeight="1"><c r="B1" s="1"/><c r="C1" s="1"/></row>'
        + '<row r="2" ht="20" customHeight="1"><c r="B2" s="1"/><c r="C2" s="1"/></row>'
        + '<row r="3" ht="30" customHeight="1"><c r="B3" s="1"/><c r="C3" s="1"/></row>'
        + '<row r="4" ht="20" customHeight="1"><c r="B4" s="1"/><c r="C4" s="1"/></row>'
        + '<row r="5"><c r="B5" s="2" t="inlineStr"><is><t>Invoice #:</t></is></c></row>',
      tail: '<drawing r:id="artwork"/>',
    } },
    styles: {
      fonts: ['<font><sz val="12"/><color theme="1"/><name val="Cambria"/></font>'],
      fills: ['<fill><patternFill patternType="solid"><fgColor theme="6" tint="-0.249977111117893"/></patternFill></fill>'],
      cellXfs: [
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0"/>',
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>',
      ],
    },
    patch: {
      '/xl/styles.xml': xml => xml.replace(/<font>[\s\S]*?<\/font>/, '<font><sz val="11"/><name val="Cambria"/><color theme="1"/></font>'),
      '/xl/theme/theme1.xml': xml => xml.replace(/<a:accent3>[\s\S]*?<\/a:accent3>/, '<a:accent3><a:srgbClr val="A7EA52"/></a:accent3>'),
    },
  });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const add = (part, xml) => X.CFB.utils.cfb_add(zip, part, new TextEncoder().encode(xml));
  add('xl/worksheets/_rels/sheet1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="artwork" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/invoice.xml"/></Relationships>');
  const marker = ([col, row, dx, dy]) => `<xdr:col>${col}</xdr:col><xdr:colOff>${dx}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${dy}</xdr:rowOff>`;
  const rect = (from, to, light, text = '') => `<xdr:twoCellAnchor><xdr:from>${marker(from)}</xdr:from><xdr:to>${marker(to)}</xdr:to>
    <xdr:sp><xdr:spPr><a:prstGeom prst="rect"/><a:solidFill><a:schemeClr val="accent3"><a:lumMod val="${100000 - light}"/><a:lumOff val="${light}"/></a:schemeClr></a:solidFill><a:ln><a:noFill/></a:ln></xdr:spPr>
    <xdr:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></xdr:txBody></xdr:sp></xdr:twoCellAnchor>`;
  add('xl/drawings/invoice.xml', `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
    ${rect([1, 0, 3026, 0], [1, 2, 360046, 8573], 80000)}
    ${rect([1, 2, 359352, 8573], [1, 3, 711972, 1], 40000)}
    ${rect([1, 3, 165589, 309], [1, 3, 360046, 199690], 80000, rectangleText)}
    ${rect([5, 0, 1161903, 372808], [6, 1, 9525, 191189], 80000)}
    ${rect([5, 0, 967739, 0], [6, 0, 9524, 371317], 40000)}
    </xdr:wsDr>`);
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
