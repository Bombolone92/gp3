import * as X from '../../src/vendor/xlsx.mjs';
import { otherProgramsXlsx } from './xlsx-fixture.js';

// A cost comparison with horizontal series, a theme font, and an invisible
// line whose deleted source and legend entry must not spoil the stacked bars.
export function stackedChartXlsx({ grouping = 'stacked', line = 'broken', negative = false } = {}) {
  const ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const labels = ['Purchase cost', 'Car usage costs', 'Fuel costs', 'Fare cost', 'Cost of time'];
  const ids = [7, 2, 9, 4, 11]; // Excel series IDs need not follow drawing order.
  const text = (address, value, style = 0) => `<c r="${address}" s="${style}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const bytes = otherProgramsXlsx({
    sheetNames: ['Summary', 'Inputs'],
    sheetXml: {
      Summary: { head: '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><cols><col min="1" max="1" width="2.5"/><col min="2" max="2" width="1.5"/><col min="3" max="3" width="32.75"/><col min="4" max="5" width="30.75"/><col min="6" max="14" width="10.75"/></cols>',
        rows: `<row r="1" ht="100.15">${text('A1', 'Buy a car vs. rideshare', 1)}</row><row r="2" ht="30" hidden="1"/><row r="3" ht="46.15">${text('D3', 'Buy a car')}${text('E3', 'Rideshare')}</row>`
          + labels.map((label, i) => `<row r="${i + 4}" ht="30">${text(`C${i + 4}`, label)}<c r="D${i + 4}" s="2"><f>Inputs!A${i + 1}</f><v>999</v></c><c r="E${i + 4}" s="2"><f>Inputs!B${i + 1}</f><v>999</v></c></row>`).join(''),
        tail: '<mergeCells count="1"><mergeCell ref="A1:N1"/></mergeCells><drawing r:id="draw"/>' },
      Inputs: { rows: [[100, null], [negative ? -20 : 20, null], [5, null], [null, 80], [30, 10]].map((values, i) => `<row r="${i + 1}">${values.map((v, c) => v == null ? text(`${c ? 'B' : 'A'}${i + 1}`, '-') : `<c r="${c ? 'B' : 'A'}${i + 1}"><v>${v}</v></c>`).join('')}</row>`).join('') },
    },
    styles: { fonts: ['<font><b/><sz val="36"/><name val="Tahoma (Headings)"/></font>'],
      numFmts: ['<numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0"/>'],
      cellXfs: ['<xf fontId="1"/>', '<xf numFmtId="164" fontId="0"/>'] },
    patch: {
      '/xl/styles.xml': xml => xml.replace(/<font>[\s\S]*?<\/font>/, '<font><sz val="11"/><name val="Tahoma"/></font>'),
      '/xl/theme/theme1.xml': xml => xml.replace(/(<a:(?:majorFont|minorFont)>\s*<a:latin) typeface="[^"]*"/g, '$1 typeface="Tahoma"'),
    },
  });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const add = (part, xml) => X.CFB.utils.cfb_add(zip, part, new TextEncoder().encode(xml));
  const rel = (id, kind, target) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${id}" Type="${ns}/${kind}" Target="${target}"/></Relationships>`;
  add('xl/worksheets/_rels/sheet1.xml.rels', rel('draw', 'drawing', '../drawings/cost.xml'));
  add('xl/drawings/_rels/cost.xml.rels', rel('chart', 'chart', '../charts/cost.xml'));
  const point = (name, col, row, x, y) => `<xdr:${name}><xdr:col>${col}</xdr:col><xdr:colOff>${x * 9525}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${y * 9525}</xdr:rowOff></xdr:${name}>`;
  add('xl/drawings/cost.xml', `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${ns}"><xdr:twoCellAnchor>${point('from', 5, 2, 28, 0)}${point('to', 13, 8, 78, 0)}<xdr:graphicFrame><c:chart r:id="chart"/></xdr:graphicFrame></xdr:twoCellAnchor></xdr:wsDr>`);
  const fill = color => `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
  const ref = (kind, formula, format = '') => `<c:${kind}Ref><c:f>${formula}</c:f><c:${kind}Cache>${format ? `<c:formatCode>${format}</c:formatCode>` : ''}<c:ptCount val="1"/><c:pt idx="0"><c:v>999</c:v></c:pt></c:${kind}Cache></c:${kind}Ref>`;
  const cat = `<c:cat>${ref('str', 'Summary!$D$3:$E$3')}</c:cat>`;
  const series = labels.map((_, i) => `<c:ser><c:idx val="${ids[i]}"/><c:order val="${i}"/><c:tx>${ref('str', `Summary!$C$${i + 4}`)}</c:tx><c:spPr>${fill(['7CB9B2', '51978F', '86BDBD', 'AED3D3', 'D7E9E9'][i])}<a:ln><a:noFill/></a:ln></c:spPr>${cat}<c:val>${ref('num', `Summary!$D$${i + 4}:$E$${i + 4}`, '&quot;$&quot;#,##0')}</c:val></c:ser>`).join('');
  const lineXml = `<c:lineChart><c:ser><c:idx val="5"/><c:order val="5"/><c:tx><c:v>Hidden helper</c:v></c:tx><c:spPr><a:ln>${line === 'visible' ? fill('123456') : '<a:noFill/>'}</a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>${cat}<c:val>${ref('num', line === 'broken' ? 'Summary!#REF!' : 'Summary!$D$8:$E$8')}</c:val></c:ser><c:axId val="1"/><c:axId val="${line === 'visible' ? 3 : 2}"/></c:lineChart>`;
  const tx = `<c:txPr><a:p><a:pPr><a:defRPr sz="1100">${fill('2C4C4D')}<a:latin typeface="+mn-lt"/></a:defRPr></a:pPr></a:p></c:txPr>`;
  const layout = (x, y, w, h) => `<c:layout><c:manualLayout><c:x val="${x}"/><c:y val="${y}"/><c:w val="${w}"/><c:h val="${h}"/></c:manualLayout></c:layout>`;
  add('xl/charts/cost.xml', `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:rPr sz="1600" b="1"><a:latin typeface="+mj-lt"/></a:rPr><a:t>Annual costs comparison</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea>${layout(.16, .2, .8, .65)}<c:barChart><c:barDir val="col"/><c:grouping val="${grouping}"/>${series}<c:gapWidth val="20"/><c:overlap val="100"/><c:axId val="1"/><c:axId val="2"/></c:barChart>${line === 'none' ? '' : lineXml}<c:catAx><c:axId val="1"/>${tx}</c:catAx><c:valAx><c:axId val="2"/><c:numFmt formatCode="&quot;$&quot;#,##0"/>${tx}</c:valAx><c:valAx><c:axId val="3"/><c:scaling><c:max val="40"/></c:scaling>${tx}</c:valAx></c:plotArea><c:legend><c:legendPos val="t"/><c:legendEntry><c:idx val="5"/><c:delete val="1"/></c:legendEntry>${layout(.02, .1, .94, .05)}${tx}</c:legend><c:plotVisOnly val="1"/></c:chart><c:spPr>${fill('FFFFFF')}<a:ln><a:noFill/></a:ln></c:spPr>${tx}</c:chartSpace>`);
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
