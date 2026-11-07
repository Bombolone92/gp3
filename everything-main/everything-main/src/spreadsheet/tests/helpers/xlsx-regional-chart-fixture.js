import * as X from '../../src/vendor/xlsx.mjs';
import { otherProgramsXlsx } from './xlsx-fixture.js';

// A line chart with named-formula scatter helpers: the labels follow the latest
// month and an invisible point reserves room to their right. Caches are stale.
export function regionalChartXlsx({ secondary = false } = {}) {
  const ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const text = (a, value) => `<c r="${a}" t="str"><v>${value}</v></c>`;
  const names = { data: "'Regional sales'!$B$4:$E$6", vector: "ROW(OFFSET('Regional sales'!$A$1,,,3))",
    x: 'SUBTOTAL(2,OFFSET(data,vector-1,,1))', y: 'IF(x&gt;0,N(OFFSET(OFFSET(data,,,1,1),vector-1,x-1)),-99^99)', xWindow: '6', yWindow: '0' };
  const bytes = otherProgramsXlsx({
    sheetNames: ['Regional sales'],
    sheetXml: { 'Regional sales': {
      head: '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><cols><col min="1" max="1" width="16.75"/><col min="2" max="13" width="11.75"/></cols>',
      rows: `<row r="1" ht="90">${text('A1', 'REGIONAL SALES')}</row><row r="2" ht="263.25"/><row r="3" ht="30">${['JAN', 'FEB', 'MAR', 'APR'].map((m, i) => text(`${'BCDE'[i]}3`, m)).join('')}</row>`
        + ['North', 'South', ''].map((name, i) => `<row r="${i + 4}" ht="30">${text(`A${i + 4}`, name)}${(i < 2 ? [i ? 14000 : 23000, i ? 18000 : 25000] : []).map((v, j) => `<c r="${'BC'[j]}${i + 4}"><v>${v}</v></c>`).join('')}</row>`).join(''),
      tail: '<mergeCells count="2"><mergeCell ref="A1:M1"/><mergeCell ref="A2:M2"/></mergeCells><drawing r:id="drawing"/>',
    } },
    patch: {
      '/xl/styles.xml': xml => xml.replace('<name val="Calibri"/>', '<name val="Trebuchet MS"/>').replace('<sz val="12"/>', '<sz val="11"/>'),
      '/xl/theme/theme1.xml': xml => xml.replace(/(<a:minorFont>\s*<a:latin) typeface="[^"]*"/, '$1 typeface="Trebuchet MS"'),
      '/xl/workbook.xml': xml => xml.replace('</workbook>', `<definedNames>${Object.entries(names).map(([name, f]) => `<definedName name="${name}">${f}</definedName>`).join('')}</definedNames></workbook>`),
    },
  });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const add = (part, xml) => X.CFB.utils.cfb_add(zip, part, new TextEncoder().encode(xml));
  const rel = (id, kind, target) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${id}" Type="${ns}/${kind}" Target="${target}"/></Relationships>`;
  add('xl/worksheets/_rels/sheet1.xml.rels', rel('drawing', 'drawing', '../drawings/region.xml'));
  add('xl/drawings/_rels/region.xml.rels', rel('chart', 'chart', '../charts/region.xml'));
  const point = (name, col, y) => `<xdr:${name}><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>${y * 9525}</xdr:rowOff></xdr:${name}>`;
  add('xl/drawings/region.xml', `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${ns}"><xdr:twoCellAnchor>${point('from', 0, 13)}${point('to', 12, 326)}<xdr:graphicFrame><c:chart r:id="chart"/></xdr:graphicFrame></xdr:twoCellAnchor></xdr:wsDr>`);
  const ref = f => `<c:numRef><c:f>${f}</c:f><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>999</c:v></c:pt></c:numCache></c:numRef>`;
  const fill = color => `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
  const series = ['F07F70', '7DB2B9', 'CADA54'].map((color, i) => `<c:ser><c:tx><c:strRef><c:f>'Regional sales'!$A$${i + 4}</c:f></c:strRef></c:tx><c:spPr><a:ln w="25400">${fill(color)}</a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker><c:cat>${ref("'Regional sales'!$B$3:$E$3")}</c:cat><c:val>${ref(`'Regional sales'!$B$${i + 4}:$E$${i + 4}`)}</c:val></c:ser>`).join('');
  const scatter = (x, y, labels = '') => `<c:ser><c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker><c:xVal>${ref(`[0]!${x}`)}</c:xVal><c:yVal>${ref(`[0]!${y}`)}</c:yVal>${labels}</c:ser>`;
  const labels = `<c:dLbls><c:dLblPos val="r"/></c:dLbls><c:extLst><c:ext uri="labels"><c15:datalabelsRange><c15:f>'Regional sales'!$A$4:$A$6</c15:f><c15:dlblRangeCache><c:pt idx="0"><c:v>STALE</c:v></c:pt></c15:dlblRangeCache></c15:datalabelsRange></c:ext></c:extLst>`;
  add('xl/charts/region.xml', `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c15="http://schemas.microsoft.com/office/drawing/2012/chart"><c:chart><c:plotArea><c:layout><c:manualLayout><c:x val=".08"/><c:y val=".05"/><c:w val=".9"/><c:h val=".85"/></c:manualLayout></c:layout><c:lineChart><c:grouping val="standard"/>${series}<c:axId val="1"/><c:axId val="2"/></c:lineChart><c:scatterChart>${scatter('x', 'y', labels)}${scatter('xWindow', 'yWindow')}<c:axId val="1"/><c:axId val="${secondary ? 3 : 2}"/></c:scatterChart><c:catAx><c:axId val="1"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:min val="0"/></c:scaling><c:crossBetween val="midCat"/><c:numFmt formatCode="&quot;$&quot;#,##0"/></c:valAx></c:plotArea><c:plotVisOnly val="0"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:chartSpace>`);
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
