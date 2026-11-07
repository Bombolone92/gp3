import * as X from '../../src/vendor/xlsx.mjs';
import { otherProgramsXlsx } from './xlsx-fixture.js';

// A small external dashboard with a native table, a legacy scalar formula and
// a native chart reading a hidden helper sheet. No application metadata/caches.
export function pieXlsx({ type = 'doughnutChart', arrayColumn = false, arrayCell = false, editChart = s => s } = {}) {
  const ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const formula = 'IF(Ledger[[#This Row],[Amount]]>0,ROUND(IF(Ledger[[#This Row],[Frequency]]="Monthly",Ledger[Amount],IF(Ledger[[#This Row],[Frequency]]="Weekly",Ledger[[#This Row],[Amount]]*4,Ledger[[#This Row],[Amount]]/12)),0),"")';
  const escaped = formula.replaceAll('>', '&gt;');
  const records = [['Rent', 900, 'Monthly'], ['Transit', 60, 'Weekly'], ['Music', 120, 'Yearly']];
  const bytes = otherProgramsXlsx({ sheetNames: ['Dashboard', 'Helper'], sheetXml: {
    Dashboard: { head: '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>',
      rows: '<row r="2" ht="150" customHeight="1"><c r="B2"><v>2000</v></c><c r="G2"><f>B2-SUM(Ledger[Monthly])</f><v>999</v></c></row><row r="3" ht="150" customHeight="1"/><row r="4" ht="150" customHeight="1"/>'
        + `<row r="6">${['Expense', 'Amount', 'Frequency', 'Monthly', 'Share'].map((v, i) => `<c r="${String.fromCharCode(66 + i)}6" t="str"><v>${v}</v></c>`).join('')}</row>`
        + records.map(([name, amount, freq], i) => `<row r="${i + 7}"><c r="B${i + 7}" t="str"><v>${name}</v></c><c r="C${i + 7}"><v>${amount}</v></c><c r="D${i + 7}" t="str"><v>${freq}</v></c><c r="E${i + 7}"><f${arrayCell ? ` t="array" ref="E${i + 7}:E${i + 7}"` : ''}>${escaped}</f><v>999</v></c><c r="F${i + 7}"><f>Ledger[[#This Row],[Monthly]]/SUM(Ledger[Monthly])</f><v>999</v></c></row>`).join(''),
      tail: '<drawing r:id="drawingRef"/><tableParts count="1"><tablePart r:id="tableRef"/></tableParts>' },
    Helper: { rows: ['Rent', 'Transit', 'Music', 'Savings'].map((name, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="str"><v>${name}</v></c><c r="B${i + 1}"><f>Dashboard!${i === 3 ? 'G2' : `E${i + 7}`}</f><v>999</v></c></row>`).join('') },
  }, patch: {
    '/xl/workbook.xml': xml => xml.replace('name="Helper"', 'name="Helper" state="hidden"'),
    '/xl/styles.xml': xml => xml.replace('<name val="Calibri"/>', '<name val="Segoe UI"/>'),
    '/xl/theme/theme1.xml': xml => xml.replace(/(<a:minorFont>\s*<a:latin) typeface="[^"]*"/, '$1 typeface="Segoe UI"'),
  } });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const add = (part, xml) => X.CFB.utils.cfb_add(zip, part, new TextEncoder().encode(xml));
  const rel = (id, type, target) => `<Relationship Id="${id}" Type="${ns}/${type}" Target="${target}"/>`;
  const rels = body => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  add('xl/worksheets/_rels/sheet1.xml.rels', rels(rel('drawingRef', 'drawing', '../drawings/wheel.xml') + rel('tableRef', 'table', '../tables/ledger.xml')));
  add('xl/tables/ledger.xml', `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Ledger" displayName="Ledger" ref="B6:F9" totalsRowCount="0"><autoFilter ref="B6:F9"/><tableColumns count="5"><tableColumn id="1" name="Expense"/><tableColumn id="2" name="Amount"/><tableColumn id="3" name="Frequency"/><tableColumn id="4" name="Monthly"><calculatedColumnFormula${arrayColumn ? ' array="1"' : ''}>${escaped}</calculatedColumnFormula></tableColumn><tableColumn id="5" name="Share"><calculatedColumnFormula>Ledger[[#This Row],[Monthly]]/SUM(Ledger[Monthly])</calculatedColumnFormula></tableColumn></tableColumns><tableStyleInfo name="TableStyleMedium2" showRowStripes="1"/></table>`);
  add('xl/drawings/_rels/wheel.xml.rels', rels(rel('chartRef', 'chart', '../charts/wheel.xml')));
  add('xl/drawings/wheel.xml', `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:r="${ns}" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>9525</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>19050</xdr:rowOff></xdr:from><xdr:to><xdr:col>7</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>4</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame><c:chart r:id="chartRef"/></xdr:graphicFrame></xdr:twoCellAnchor></xdr:wsDr>`);
  const fill = color => `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
  const style = color => `<c:txPr><a:p><a:pPr><a:defRPr sz="1000">${fill(color)}<a:latin typeface="+mn-lt"/></a:defRPr></a:pPr></a:p></c:txPr>`;
  const layout = (x, y, w, h) => `<c:layout><c:manualLayout><c:x val="${x}"/><c:y val="${y}"/>${w != null ? `<c:w val="${w}"/><c:h val="${h}"/>` : ''}</c:manualLayout></c:layout>`;
  const ref = col => `<c:numRef><c:f>Helper!$${col}$1:$${col}$4</c:f><c:numCache><c:formatCode>"$"#,##0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>999</c:v></c:pt></c:numCache></c:numRef>`;
  const series = `<c:ser><c:idx val="0"/>${['213269', '4060CA', '9CACE0', 'D9DFF4'].map((color, i) => `<c:dPt><c:idx val="${i}"/><c:spPr>${i ? fill(color) : '<a:solidFill><a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr></a:solidFill>'}<a:ln w="19050">${fill('FFFFFF')}</a:ln></c:spPr></c:dPt>`).join('')}
    <c:dLbls>${style('FFFFFF')}<c:showCatName val="1"/><c:showVal val="1"/><c:showPercent val="0"/><c:separator>&#10;</c:separator><c:showLeaderLines val="1"/>
      <c:dLbl><c:idx val="1"/>${layout(.02, -.03)}<c:dLblPos val="inEnd"/></c:dLbl>
      <c:dLbl><c:idx val="3"/>${style('262626')}<c:tx><c:rich><a:p><a:fld type="CATEGORYNAME"><a:t>[]</a:t></a:fld><a:br/><a:fld type="VALUE"><a:t>[]</a:t></a:fld></a:p></c:rich></c:tx></c:dLbl>
    </c:dLbls><c:cat><c:strRef><c:f>Helper!$A$1:$A$4</c:f></c:strRef></c:cat><c:val>${ref('B')}</c:val></c:ser>`;
  add('xl/charts/wheel.xml', editChart(`<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:rPr sz="1400"/><a:t>Spending plan</a:t></a:r></a:p></c:rich></c:tx>${layout(.02, .01)}</c:title><c:plotArea>${layout(.15, .06, .7, .8)}<c:${type}><c:varyColors val="1"/>${series}<c:dLbls><c:showVal val="0"/><c:showCatName val="0"/></c:dLbls><c:firstSliceAng val="45"/><c:holeSize val="25"/></c:${type}></c:plotArea><c:legend><c:legendPos val="b"/>${layout(.06, .9, .88, .06)}${style('404040')}</c:legend><c:plotVisOnly val="1"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:chartSpace>`));
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
