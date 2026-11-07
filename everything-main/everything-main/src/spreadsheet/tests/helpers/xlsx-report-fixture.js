import * as X from '../../src/vendor/xlsx.mjs';
import { otherProgramsXlsx } from './xlsx-fixture.js';

// A small report workbook laid out as a quality sampling sheet:
// Normal Arial 11, a merged Rockwell title, wrapped headers, and a custom table style.
export function reportXlsx() {
  const text = (addr, style, value) => `<c r="${addr}" s="${style}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const number = (addr, style, value) => `<c r="${addr}" s="${style}"><v>${value}</v></c>`;
  const body = [];
  for (let r = 1; r <= 14; r++) {
    const cells = r === 3 ? text('C3', 1, 'Weekly quality samples') + text('H3', 3, 'Plant name:')
      : r === 11 ? text('D11', 5, '# of imperfections') + '<c r="H11" s="6"/>'
      : r === 12 ? text('C12', 2, 'Date') + text('D12', 2, 'Sample 1') + text('J12', 2, 'Sample mean (average of all means)')
      : r >= 13 ? number(`C${r}`, 4, r - 12) + number(`D${r}`, 7, 3) + number(`J${r}`, 4, 2.5) : '';
    body.push(`<row r="${r}" ht="${r >= 3 && r <= 9 ? 18 : r === 12 ? 58.15 : 30}" customHeight="1">${cells}</row>`);
  }
  const fill = rgb => `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/></patternFill></fill>`;
  const xf = (font, fill, border, align) => `<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0">${align}</xf>`;
  const centered = '<alignment horizontal="center" vertical="center"/>';
  const bytes = otherProgramsXlsx({
    sheetXml: { Data: {
      head: '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><cols><col min="1" max="2" width="5" customWidth="1"/><col min="3" max="10" width="15.75" customWidth="1"/></cols>',
      rows: body.join(''),
      tail: '<mergeCells><mergeCell ref="C3:G9"/><mergeCell ref="H3:I3"/><mergeCell ref="D11:H11"/></mergeCells><tableParts count="1"><tablePart r:id="rId1"/></tableParts>',
    } },
    styles: {
      fonts: [
        '<font><sz val="48"/><color rgb="FF135679"/><name val="Rockwell"/></font>',
        '<font><b/><sz val="12"/><color rgb="FFFFEED7"/><name val="Rockwell"/></font>',
        '<font><sz val="12"/><color rgb="FF135679"/><name val="Arial"/></font>',
      ],
      fills: [fill('FFEED7'), fill('135679'), fill('FFDDAF')],
      borders: [
        '<border><left style="thin"><color rgb="FF135679"/></left><top style="thin"><color rgb="FF135679"/></top></border>',
        '<border><right style="thin"><color rgb="FF135679"/></right><top style="thin"><color rgb="FF135679"/></top></border>',
        '<border><right style="thin"><color rgb="FFFFEED7"/></right></border>',
      ],
      cellXfs: [
        xf(1, 2, 0, '<alignment horizontal="left" vertical="center" wrapText="1" indent="1"/>'),
        xf(2, 3, 0, '<alignment horizontal="center" vertical="center" wrapText="1"/>'),
        xf(3, 2, 0, '<alignment horizontal="right" vertical="center"/>'),
        xf(3, 0, 0, centered), xf(3, 2, 1, centered), xf(3, 2, 2, centered), xf(3, 4, 3, centered),
      ],
    },
    patch: { '/xl/styles.xml': xml => xml.replace(/<font>[\s\S]*?<\/font>/, '<font><sz val="11"/><name val="Arial"/></font>')
      .replace(/<dxfs\b[^>]*(?:\/>|>[\s\S]*?<\/dxfs>)/, '')
      .replace(/<tableStyles\b[^>]*(?:\/>|>[\s\S]*?<\/tableStyles>)/, '')
      .replace('</styleSheet>', '<dxfs count="3">'
        + '<dxf><fill><patternFill><bgColor rgb="FFFFEED7"/></patternFill></fill><border><left style="thin"><color rgb="FF135679"/></left><right style="thin"><color rgb="FF135679"/></right><top style="thin"><color rgb="FF135679"/></top><bottom style="thin"><color rgb="FF135679"/></bottom><horizontal style="thin"><color rgb="FF135679"/></horizontal></border></dxf>'
        + '<dxf><fill><patternFill><bgColor rgb="FFFEE8C1"/></patternFill></fill></dxf>'
        + '<dxf><font><color rgb="FFFFFFFF"/></font><fill><patternFill><bgColor rgb="FF135679"/></patternFill></fill></dxf>'
        + '</dxfs><tableStyles count="1"><tableStyle name="Report"><tableStyleElement type="wholeTable" dxfId="0"/><tableStyleElement type="headerRow" dxfId="2"/><tableStyleElement type="secondRowStripe" dxfId="1"/></tableStyle></tableStyles></styleSheet>') },
  });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const add = (path, xml) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(xml));
  add('xl/worksheets/_rels/sheet1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>');
  add('xl/tables/table1.xml', '<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="Report" displayName="Report" ref="C12:J14"><autoFilter ref="C12:J14">'
    + Array.from({ length: 8 }, (_, i) => `<filterColumn colId="${i}" hiddenButton="1"/>`).join('')
    + '</autoFilter><tableStyleInfo name="Report" showRowStripes="1"/></table>');
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
