import * as X from '../../src/vendor/xlsx.mjs';
import { otherProgramsXlsx } from './xlsx-fixture.js';

// An ordinary external XLSX: worksheet formulas, a native chart sheet and DrawingML,
// with deliberately stale chart caches and non-default part names/relationship IDs.
export function chartXlsx({ external = false, embedded = false } = {}) {
  const ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rels = body => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  const rel = (id, type, target, mode = '') => `<Relationship Id="${id}" Type="${ns}/${type}" Target="${target}" ${mode}/>`;
  const bytes = otherProgramsXlsx({
    sheetNames: ['Data', 'Run chart'],
    sheetXml: { Data: { rows: [46251, 46252, 46254].map((date, i) => `<row r="${i + 1}"><c r="A${i + 1}" s="1"><v>${date}</v></c><c r="B${i + 1}"><v>${[2.8, 4.2, 2][i]}</v></c><c r="C${i + 1}" s="2"><f>AVERAGE(B1:B3)</f><v>3</v></c></row>`).join(''),
      ...(embedded ? { tail: '<drawing r:id="drawingRef"/>' } : {}) } },
    styles: { numFmts: ['<numFmt numFmtId="164" formatCode="m/d/yyyy"/>'], cellXfs: ['<xf numFmtId="164" fontId="0" fillId="0" borderId="0"/>', '<xf numFmtId="2" fontId="0" fillId="0" borderId="0"/>'] },
    patch: {
      '/xl/_rels/workbook.xml.rels': xml => embedded ? xml : xml.replace('relationships/worksheet" Target="worksheets/sheet2.xml"', 'relationships/chartsheet" Target="chartsheets/run.xml"'),
      '/[Content_Types].xml': xml => embedded ? xml : xml.replace('PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"', 'PartName="/xl/chartsheets/run.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml"'),
      '/xl/theme/theme1.xml': xml => xml.replace(/<a:dk2>[\s\S]*?<\/a:dk2>/, '<a:dk2><a:srgbClr val="135679"/></a:dk2>')
        .replace(/<a:accent2>[\s\S]*?<\/a:accent2>/, '<a:accent2><a:srgbClr val="FF723A"/></a:accent2>')
        .replace(/<a:accent3>[\s\S]*?<\/a:accent3>/, '<a:accent3><a:srgbClr val="FFAB37"/></a:accent3>')
        .replace(/(<a:majorFont>\s*<a:latin) typeface="[^"]*"/, '$1 typeface="Rockwell"')
        .replace(/(<a:minorFont>\s*<a:latin) typeface="[^"]*"/, '$1 typeface="Arial"'),
    },
  });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const add = (part, xml) => X.CFB.utils.cfb_add(zip, part, new TextEncoder().encode(xml));
  add('xl/chartsheets/run.xml', `<chartsheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${ns}"><sheetPr><tabColor rgb="FFFFDDAF"/></sheetPr><drawing r:id="drawingRef"/></chartsheet>`);
  add(embedded ? 'xl/worksheets/_rels/sheet1.xml.rels' : 'xl/chartsheets/_rels/run.xml.rels', rels(rel('drawingRef', 'drawing', '../drawings/run.xml')));
  const anchor = embedded ? '<xdr:oneCellAnchor><xdr:from><xdr:col>4</xdr:col><xdr:colOff>95250</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>47625</xdr:rowOff></xdr:from>' : '<xdr:absoluteAnchor><xdr:pos x="0" y="0"/>';
  add('xl/drawings/run.xml', `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:r="${ns}" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">${anchor}<xdr:ext cx="8534400" cy="5791200"/><xdr:graphicFrame><c:chart r:id="chartRef"/></xdr:graphicFrame></xdr:${embedded ? 'oneCellAnchor' : 'absoluteAnchor'}></xdr:wsDr>`);
  add('xl/drawings/_rels/run.xml.rels', rels(rel('chartRef', 'chart', external ? 'https://example.com/chart.xml' : '../charts/run.xml', external ? 'TargetMode="External"' : '')));
  const fill = color => `<a:solidFill><a:schemeClr val="${color}"/></a:solidFill>`;
  const tx = (size, font) => `<c:txPr><a:p><a:pPr><a:defRPr sz="${size}">${fill('tx2')}<a:latin typeface="${font}"/></a:defRPr></a:pPr></a:p></c:txPr>`;
  const layout = (x, y, w, h) => `<c:layout><c:manualLayout><c:x val="${x}"/><c:y val="${y}"/>${w ? `<c:w val="${w}"/><c:h val="${h}"/>` : ''}</c:manualLayout></c:layout>`;
  const ref = (col, end, format) => `<c:numRef><c:f>Data!$${col}$1:$${col}$${end}</c:f><c:numCache><c:formatCode>${format}</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>99</c:v></c:pt></c:numCache></c:numRef>`;
  const series = (i, title, col, color) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${title}</c:v></c:tx><c:spPr><a:ln w="38100">${fill(color)}</a:ln></c:spPr><c:marker><c:symbol val="${i ? 'none' : 'circle'}"/><c:size val="6"/><c:spPr>${fill('bg1')}<a:ln>${fill(color)}</a:ln></c:spPr></c:marker><c:cat>${ref('A', 80, 'm/d/yyyy')}</c:cat><c:val>${ref(col, i ? 22 : 80, '0.0')}</c:val></c:ser>`;
  add('xl/charts/run.xml', `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:rPr sz="2400">${fill('tx2')}<a:latin typeface="+mj-lt"/></a:rPr><a:t>Daily average &amp; sample mean</a:t></a:r></a:p></c:rich></c:tx>${layout(.12, .04)}</c:title><c:plotArea>${layout(.08, .23, .87, .69)}<c:lineChart>${series(0, 'Daily average', 'B', 'tx2')}${series(1, 'Sample mean', 'C', 'accent2')}</c:lineChart><c:dateAx><c:numFmt formatCode="m/d/yyyy"/><c:majorUnit val="1"/>${tx(1200, '+mn-lt')}</c:dateAx><c:valAx><c:numFmt formatCode="0.0"/>${tx(1200, '+mn-lt')}<c:majorGridlines><c:spPr><a:ln><a:noFill/></a:ln></c:spPr></c:majorGridlines></c:valAx></c:plotArea><c:legend><c:legendPos val="r"/>${layout(.025, .125, .95, .06)}${tx(1200, '+mj-lt')}</c:legend><c:plotVisOnly val="1"/></c:chart><c:spPr><a:solidFill><a:schemeClr val="accent3"><a:lumMod val="20000"/><a:lumOff val="80000"/></a:schemeClr></a:solidFill></c:spPr></c:chartSpace>`);
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
