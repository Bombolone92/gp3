import * as X from '../../src/vendor/xlsx.mjs';
import { otherProgramsXlsx } from './xlsx-fixture.js';

export function bubbleXlsx({ referenced = false, externalAnnotation = false, editChart = s => s } = {}) {
  const ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const series = [
    { name: 'Launch', x: [2, 4], y: [6, 8], sizes: [9, 36] },
    { name: 'Improve', x: [3, 6], y: [4, 9], sizes: [16, 25] },
    { name: 'Transfer', x: [7, 9, 5], y: [10, 8, 15], sizes: [49, 25, 36] },
  ];
  const bytes = otherProgramsXlsx({ sheetNames: ['Chart', 'Values'], sheetXml: {
    Chart: { head: '<sheetFormatPr defaultRowHeight="15"/>', rows: '<row r="1"><c r="A1" t="str"><v>Portfolio</v></c></row>', tail: '<drawing r:id="drawingRef"/>' },
    Values: { rows: series.map((s, i) => `<row r="${i + 1}">${[s.x, s.y, s.sizes].map((values, col) => values.map((v, j) => `<c r="${String.fromCharCode(65 + col * 3 + j)}${i + 1}"><v>${v}</v></c>`).join('')).join('')}</row>`).join('') },
  }, patch: {
    '/xl/styles.xml': s => s.replace('<sz val="12"/>', '<sz val="11"/>'),
    '/xl/workbook.xml': s => s.replace('name="Values"', 'name="Values" state="hidden"'),
  } });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const add = (p, xml) => X.CFB.utils.cfb_add(zip, p, new TextEncoder().encode(xml));
  const rel = (id, type, target, extra = '') => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${id}" Type="${ns}/${type}" Target="${target}" ${extra}/></Relationships>`;
  add('xl/worksheets/_rels/sheet1.xml.rels', rel('drawingRef', 'drawing', '../drawings/portfolio.xml'));
  add('xl/drawings/_rels/portfolio.xml.rels', rel('chartRef', 'chart', '../charts/portfolio.xml'));
  add('xl/drawings/portfolio.xml', `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:r="${ns}" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>38100</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>57150</xdr:rowOff></xdr:from><xdr:to><xdr:col>10</xdr:col><xdr:colOff>190500</xdr:colOff><xdr:row>23</xdr:row><xdr:rowOff>95250</xdr:rowOff></xdr:to><xdr:graphicFrame><c:chart r:id="chartRef"/></xdr:graphicFrame></xdr:twoCellAnchor></xdr:wsDr>`);
  const fill = hex => `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
  const style = `<c:txPr><a:p><a:pPr><a:defRPr sz="900">${fill('44546A')}<a:latin typeface="Lato"/></a:defRPr></a:pPr></a:p></c:txPr>`;
  const layout = (x, y, w, h) => `<c:layout><c:manualLayout><c:x val="${x}"/><c:y val="${y}"/><c:w val="${w}"/><c:h val="${h}"/></c:manualLayout></c:layout>`;
  const literal = values => `<c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).reverse().join('')}</c:numLit>`;
  const data = (values, col, row) => referenced ? `<c:numRef><c:f>Values!$${String.fromCharCode(65 + col)}$${row}:$${String.fromCharCode(64 + col + values.length)}$${row}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>999</c:v></c:pt></c:numCache></c:numRef>` : literal(values);
  const error = axis => `<c:errBars><c:errDir val="${axis}"/><c:errBarType val="both"/><c:errValType val="stdErr"/><c:noEndCap val="0"/><c:spPr><a:ln w="9525">${fill('334455')}</a:ln></c:spPr></c:errBars>`;
  const all = series.map((s, i) => `<c:ser><c:idx val="${i}"/><c:tx><c:v>${s.name}</c:v></c:tx><c:spPr><a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="accent${i + 1}"><a:satMod val="103000"/><a:lumMod val="102000"/><a:tint val="94000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="accent${i + 1}"><a:shade val="78000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill><a:ln><a:noFill/></a:ln></c:spPr><c:dLbls>${style}<c:dLblPos val="ctr"/><c:showVal val="1"/></c:dLbls>${error('x')}${error('y')}<c:xVal>${data(s.x, 0, i + 1)}</c:xVal><c:yVal>${data(s.y, 3, i + 1)}</c:yVal><c:bubbleSize>${data(s.sizes, 6, i + 1)}</c:bubbleSize></c:ser>`).join('');
  const axis = (id, pos, max) => `<c:valAx><c:axId val="${id}"/><c:axPos val="${pos}"/><c:scaling><c:min val="0"/><c:max val="${max}"/></c:scaling><c:majorGridlines><c:spPr><a:ln>${fill('DDEEFF')}</a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="General"/>${style.replace('<c:txPr>', '<c:txPr><a:bodyPr rot="-60000000"/>')}</c:valAx>`;
  add('xl/charts/portfolio.xml', editChart(`<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${ns}"><c:chart><c:plotArea>${layout(.06, .04, .8, .85)}<c:bubbleChart>${all}<c:bubbleScale val="100"/><c:sizeRepresents val="area"/><c:showNegBubbles val="0"/><c:axId val="1"/><c:axId val="2"/></c:bubbleChart>${axis(1, 'b', 12)}${axis(2, 'l', 20)}</c:plotArea><c:legend><c:legendPos val="r"/>${layout(.88, .3, .12, .4)}${style}</c:legend><c:plotVisOnly val="1"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:userShapes r:id="noteRef"/></c:chartSpace>`));
  add('xl/charts/_rels/portfolio.xml.rels', rel('noteRef', 'chartUserShapes', '../drawings/notes.xml', externalAnnotation ? 'TargetMode="External"' : ''));
  add('xl/drawings/notes.xml', `<c:userShapes xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:cdr="http://schemas.openxmlformats.org/drawingml/2006/chartDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><cdr:relSizeAnchor><cdr:from><cdr:x>.2</cdr:x><cdr:y>.12</cdr:y></cdr:from><cdr:to><cdr:x>.6</cdr:x><cdr:y>.25</cdr:y></cdr:to><cdr:sp><cdr:spPr><a:noFill/><a:ln><a:noFill/></a:ln></cdr:spPr><cdr:txBody><a:p><a:r><a:rPr sz="1050"><a:latin typeface="Lato Light"/></a:rPr><a:t>Standard error &amp; uncertainty</a:t></a:r></a:p></cdr:txBody></cdr:sp></cdr:relSizeAnchor></c:userShapes>`);
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
