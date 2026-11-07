import * as X from '../../src/vendor/xlsx.mjs';
import { otherProgramsXlsx } from './xlsx-fixture.js';

export function progressChartXlsx({ grouping = 'clustered', reversed = false } = {}) {
  const ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const bytes = otherProgramsXlsx({
    sheetNames: ['Shopping', 'Budget'],
    sheetXml: {
      Shopping: { head: '<sheetFormatPr defaultRowHeight="30"/><cols><col min="1" max="8" width="11.625"/></cols>',
        rows: '<row r="1" ht="60"><c r="A1" s="1" t="str"><v>School planner</v></c></row><row r="2" ht="210.95"><c r="F2"><v>1</v></c></row><row r="3" ht="27.6"><c r="F3"><v>6</v></c></row><row r="4" ht="30"><c r="E4" t="str"><f>"Progress "&amp;F2&amp;" of "&amp;F3</f><v>STALE</v></c></row><row r="5" ht="21.75"><c r="E5" s="2"><f>F2/F3</f><v>0.9</v></c></row><row r="6" ht="21.75"/><row r="9"><c r="G9" t="str"><v>Bought</v></c></row>',
        tail: '<drawing r:id="drawing"/>' },
      Budget: { head: '<sheetFormatPr defaultRowHeight="30"/>',
        rows: '<row r="1"><c r="A1" t="str"><v>Clothes</v></c><c r="B1"><v>280</v></c></row><row r="2"><c r="A2" t="str"><v>Supplies</v></c><c r="B2"><v>30</v></c></row><row r="3"><c r="A3" t="str"><v>Books</v></c><c r="B3"><v>55</v></c></row><row r="4" ht="30"/><row r="5" ht="19.5"/><row r="6" ht="30"/>',
        tail: '<drawing r:id="drawing"/>' },
    },
    styles: { fonts: ['<font><sz val="32"/><name val="Impact"/></font>'], cellXfs: ['<xf fontId="1"/>', '<xf numFmtId="9" fontId="0"/>'] },
    patch: {
      '/xl/styles.xml': xml => xml.replace('<name val="Calibri"/>', '<name val="Corbel"/>').replace('<sz val="12"/>', '<sz val="11"/>'),
      '/xl/theme/theme1.xml': xml => xml.replace(/(<a:minorFont>\s*<a:latin) typeface="[^"]*"/, '$1 typeface="Corbel"'),
    },
  });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const add = (part, xml) => X.CFB.utils.cfb_add(zip, part, new TextEncoder().encode(xml));
  const rel = (id, kind, target) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${id}" Type="${ns}/${kind}" Target="${target}"/></Relationships>`;
  const point = (name, c, r, x, y) => `<xdr:${name}><xdr:col>${c}</xdr:col><xdr:colOff>${Math.round(x * 9525)}</xdr:colOff><xdr:row>${r}</xdr:row><xdr:rowOff>${Math.round(y * 9525)}</xdr:rowOff></xdr:${name}>`;
  const ref = f => `<c:numRef><c:f>${f}</c:f><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>999</c:v></c:pt></c:numCache></c:numRef>`;
  const fill = color => `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
  for (let i = 1; i <= 2; i++) {
    const horizontal = i === 1;
    add(`xl/worksheets/_rels/sheet${i}.xml.rels`, rel('drawing', 'drawing', `../drawings/progress${i}.xml`));
    add(`xl/drawings/_rels/progress${i}.xml.rels`, rel('chart', 'chart', `../charts/progress${i}.xml`));
    const points = horizontal ? point('from', 3, 3, 86, 32.7) + point('to', 7, 6, 55, 11.5)
      : point('from', 4, 3, 3, 6) + point('to', 4, 11, 530, 39);
    add(`xl/drawings/progress${i}.xml`, `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${ns}"><xdr:twoCellAnchor>${points}<xdr:graphicFrame><c:chart r:id="chart"/></xdr:graphicFrame></xdr:twoCellAnchor></xdr:wsDr>`);
    const source = horizontal ? '<c:tx><c:strRef><c:f>Shopping!E4</c:f></c:strRef></c:tx>' : '<c:tx><c:v>Total cost</c:v></c:tx>';
    const series = `${source}<c:spPr>${fill('314159')}</c:spPr>${horizontal ? `<c:dPt><c:idx val="0"/><c:spPr>${fill('C67431')}</c:spPr></c:dPt>` : ''}<c:cat>${ref(horizontal ? 'Shopping!G9' : 'Budget!A1:A3')}</c:cat><c:val>${ref(horizontal ? 'Shopping!E5' : 'Budget!B1:B3')}</c:val>`;
    const scale = horizontal ? '<c:scaling><c:max val="1"/></c:scaling><c:majorUnit val="0.25"/><c:majorTickMark val="out"/>' : '';
    const plotStyle = horizontal ? `<c:spPr><a:noFill/><a:ln w="25400">${fill('000000')}</a:ln></c:spPr>` : '';
    const axisStyle = '<c:txPr><a:p><a:pPr><a:defRPr sz="1100" i="1"><a:latin typeface="+mn-lt"/></a:defRPr></a:pPr></a:p></c:txPr>';
    add(`xl/charts/progress${i}.xml`, `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:plotArea><c:barChart><c:barDir val="${horizontal ? 'bar' : 'col'}"/><c:grouping val="${grouping}"/><c:ser>${series}</c:ser><c:gapWidth val="${horizontal ? 7 : 132}"/><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:delete val="${horizontal ? 1 : 0}"/><c:scaling><c:orientation val="${reversed ? 'maxMin' : 'minMax'}"/></c:scaling></c:catAx><c:valAx><c:axId val="2"/>${scale}<c:numFmt formatCode="${horizontal ? '0%' : '&quot;$&quot;#,##0.00'}"/>${axisStyle}</c:valAx>${plotStyle}</c:plotArea></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:chartSpace>`);
  }
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
