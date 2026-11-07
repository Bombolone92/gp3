import * as X from '../../src/vendor/xlsx.mjs';
import { otherProgramsXlsx } from './xlsx-fixture.js';

// A small external Excel dashboard: areas form the funnel, scatter series
// supply the outlines and value-from-cells labels on a hidden helper sheet.
export function funnelXlsx({ grouping = 'standard', secondary = false } = {}) {
  const ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const bytes = otherProgramsXlsx({
    sheetNames: ['Campaign', 'Helper'],
    sheetXml: {
      Campaign: { head: '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><cols><col min="1" max="2" width="2.75" customWidth="1"/><col min="3" max="6" width="40.75" customWidth="1"/><col min="7" max="8" width="2.75" customWidth="1"/></cols>',
        rows: '<row r="1" ht="18" customHeight="1"/><row r="2" ht="90" customHeight="1"><c r="C2" s="1" t="str"><v>CAMPAIGN</v></c></row><row r="3" ht="40.15" customHeight="1"/><row r="4" ht="400.15" customHeight="1"/><row r="5" ht="30" customHeight="1"/><row r="7"><c r="C7" t="str"><v>Identified</v></c><c r="D7"><v>250</v></c></row><row r="8"><c r="C8" t="str"><v>Won</v></c><c r="D8"><v>100</v></c></row>',
        tail: '<drawing r:id="drawingRef"/>' },
      Helper: { rows: Array.from({ length: 4 }, (_, i) => {
        const row = i + 1;
        const nums = { A: [1, 2, 3, 4], B: [null, 308, 233, null], C: [316, 308, 233, 190], D: [50, 58, 133, 176],
          E: [2.45, 3.45], F: [183, 183], G: [1, .4] };
        return `<row r="${row}">${Object.entries(nums).map(([col, values]) => {
          if (values[i] == null) return '';
          const formula = col === 'G' && i === 1 ? 'Campaign!D8/Campaign!D7' : ['B', 'C'].includes(col) && i === 2 ? 'Campaign!D8+133' : '';
          return `<c r="${col}${row}"${col === 'G' ? ' s="2"' : ''}>${formula ? `<f>${formula}</f>` : ''}<v>${values[i]}</v></c>`;
        }).join('')}${i < 2 ? `<c r="H${row}" t="str"><f>UPPER(Campaign!C${i + 7})&amp;" "&amp;Campaign!D${i + 7}</f><v>STALE LABEL</v></c>` : ''}</row>`;
      }).join('') },
    },
    styles: { fonts: ['<font><sz val="48"/><name val="Century Gothic"/></font>'], cellXfs: ['<xf numFmtId="0" fontId="1" fillId="0" borderId="0"/>', '<xf numFmtId="9" fontId="0" fillId="0" borderId="0"/>'] },
    patch: {
      '/xl/styles.xml': xml => xml.replace('<name val="Calibri"/>', '<name val="Century Gothic"/>').replace('<sz val="12"/>', '<sz val="11"/>'),
      '/xl/workbook.xml': xml => xml.replace('name="Helper"', 'name="Helper" state="hidden"'),
      '/xl/theme/theme1.xml': xml => xml.replace(/(<a:minorFont>\s*<a:latin) typeface="[^"]*"/, '$1 typeface="Century Gothic"'),
    },
  });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const add = (part, xml) => X.CFB.utils.cfb_add(zip, part, new TextEncoder().encode(xml));
  const rel = (id, type, target) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${id}" Type="${ns}/${type}" Target="${target}"/></Relationships>`;
  add('xl/worksheets/_rels/sheet1.xml.rels', rel('drawingRef', 'drawing', '../drawings/funnel.xml'));
  add('xl/drawings/_rels/funnel.xml.rels', rel('chartRef', 'chart', '../charts/funnel.xml'));
  add('xl/drawings/funnel.xml', `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:r="${ns}" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>203201</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>31750</xdr:rowOff></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:colOff>31751</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame><c:chart r:id="chartRef"/></xdr:graphicFrame></xdr:twoCellAnchor></xdr:wsDr>`);
  const ref = (col, end = 4) => `<c:numRef><c:f>Helper!$${col}$1:$${col}$${end}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>999</c:v></c:pt></c:numCache></c:numRef>`;
  const fill = color => `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
  const area = (col, color) => `<c:ser><c:spPr>${fill(color)}<a:ln><a:noFill/></a:ln></c:spPr><c:val>${ref(col)}</c:val></c:ser>`;
  const labels = col => `<c:dLbls><c:dLbl><c:idx val="1"/><c:dLblPos val="r"/><c:layout><c:manualLayout><c:x val="-0.01"/><c:y val="-0.02"/></c:manualLayout></c:layout></c:dLbl><c:txPr><a:p><a:pPr><a:defRPr sz="1000" b="1">${fill('FFFFFF')}</a:defRPr></a:pPr></a:p></c:txPr><c:dLblPos val="ctr"/></c:dLbls><c:extLst><c:ext uri="labels"><c15:datalabelsRange><c15:f>Helper!$${col}$1:$${col}$2</c15:f><c15:dlblRangeCache><c:ptCount val="1"/><c:pt idx="0"><c:v>STALE</c:v></c:pt></c15:dlblRangeCache></c15:datalabelsRange></c:ext></c:extLst>`;
  const scatter = (x, y, labelCol) => `<c:ser><c:spPr><a:ln w="38100">${labelCol ? '<a:noFill/>' : fill('012C38')}</a:ln></c:spPr><c:marker><c:symbol val="${labelCol ? 'circle' : 'none'}"/><c:size val="62"/><c:spPr>${fill('D5E3D5')}<a:ln><a:noFill/></a:ln></c:spPr></c:marker><c:xVal>${ref(x, labelCol ? 2 : 4)}</c:xVal><c:yVal>${ref(y, labelCol ? 2 : 4)}</c:yVal>${labelCol ? labels(labelCol) : ''}</c:ser>`;
  add('xl/charts/funnel.xml', `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c15="http://schemas.microsoft.com/office/drawing/2012/chart"><c:chart><c:plotArea><c:layout><c:manualLayout><c:x val="0"/><c:y val="0"/><c:w val="1"/><c:h val=".99"/></c:manualLayout></c:layout><c:areaChart><c:grouping val="${grouping}"/>${area('C', '207779')}${area('B', '715FF0')}${area('D', 'D5E3D5')}<c:axId val="1"/><c:axId val="2"/></c:areaChart><c:scatterChart><c:scatterStyle val="lineMarker"/>${scatter('A', 'C')}${scatter('A', 'D')}${scatter('E', 'F', 'G')}${scatter('E', 'F', 'H')}<c:axId val="1"/><c:axId val="${secondary ? 3 : 2}"/></c:scatterChart><c:catAx><c:axId val="1"/><c:delete val="1"/></c:catAx><c:valAx><c:axId val="2"/><c:delete val="1"/><c:crossBetween val="midCat"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:chartSpace>`);
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
