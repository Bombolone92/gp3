import * as X from '../../src/vendor/xlsx.mjs';
import { otherProgramsXlsx } from './xlsx-fixture.js';

// Loan data and DrawingML for the loan-schedule chart tests.
export function loanXlsx({ numericX = false, markerOnly = false } = {}) {
  const ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const cell = (ref, value, style = 0, formula = false) => `<c r="${ref}" s="${style}">${formula ? `<f>${value}</f>` : `<v>${value}</v>`}</c>`;
  // This layout deliberately fixes compact row heights; an absent flag is an auto-fit cache.
  const rows = [
    `<row r="1" ht="30">${cell('B1', 12000)}</row>`,
    `<row r="2" ht="19.5">${cell('B2', .06)}</row>`,
    `<row r="3">${cell('B3', 0, 1)}</row>`,
    `<row r="4">${cell('B4', 0)}</row>`,
    `<row r="5">${cell('B5', '-PMT(B2/12,72,B1)', 0, true)}</row>`,
    '<row r="6" ht="9"/><row r="7" hidden="1"/>',
  ];
  for (let i = 1; i <= 72; i++) {
    const r = i + 8;
    rows.push(`<row r="${r}">${cell(`A${r}`, i * 2)}${cell(`B${r}`, `EDATE(DATE(2024,1,31),${i - 1})`, 2, true)}${cell(`C${r}`, `$B$2+IF(AND($B$4=1,${i}>36),0.01,0)`, 0, true)}${cell(`D${r}`, `MAX(0,-PV($B$2/12,${72 - i},$B$5)-${i}*$B$3)`, 0, true)}</row>`);
  }
  rows.push(`<row r="81">${cell('B81', '&quot;&quot;', 0, true)}${cell('C81', '&quot;&quot;', 0, true)}${cell('D81', '&quot;&quot;', 0, true)}</row>`);
  const palette = Array.from({ length: 64 }, (_, i) => `<rgbColor rgb="FF${({ 8: '003366', 23: '5F5F5F', 43: 'FFF4BB' })[i] || '000000'}"/>`).join('');
  const bytes = otherProgramsXlsx({ sheetNames: ['Loan Model'], sheetXml: { 'Loan Model': {
    head: '<sheetFormatPr defaultRowHeight="12.75"/><cols><col min="4" max="4" hidden="1"/></cols>', rows: rows.join('').replace(/<row\b/g, '<row customHeight="1"'),
    tail: '<conditionalFormatting sqref="B3"><cfRule type="expression" dxfId="0" priority="1"><formula>$B$4=1</formula></cfRule></conditionalFormatting><drawing r:id="drawing"/>',
  } }, styles: {
    fonts: ['<font><name val="Tahoma"/><sz val="10"/><color indexed="8"/></font>'],
    fills: ['<fill><patternFill patternType="solid"><fgColor indexed="43"/></patternFill></fill>'],
    borders: ['<border><bottom style="thin"><color indexed="23"/></bottom></border>'],
    cellXfs: ['<xf fontId="1" fillId="2" borderId="1"/>', '<xf fontId="0" numFmtId="14"/>'],
  }, patch: { '/xl/styles.xml': xml => xml.replace(/<dxfs\b[^>]*\/>|<dxfs\b[^>]*>[\s\S]*?<\/dxfs>/, '')
    .replace('</styleSheet>', `<dxfs count="1"><dxf><font><color auto="1"/></font><fill><patternFill patternType="none"/></fill></dxf></dxfs><colors><indexedColors>${palette}</indexedColors></colors></styleSheet>`) } });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const add = (part, xml) => X.CFB.utils.cfb_add(zip, part, new TextEncoder().encode(xml));
  const rel = (id, kind, target) => `<Relationship Id="${id}" Type="${ns}/${kind}" Target="${target}"/>`;
  const rels = body => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  add('xl/worksheets/_rels/sheet1.xml.rels', rels(rel('drawing', 'drawing', '../drawings/loan.xml')));
  add('xl/drawings/_rels/loan.xml.rels', rels(rel('balance', 'chart', '../charts/balance.xml') + rel('rate', 'chart', '../charts/rate.xml')));
  const point = (tag, row, dx = 0) => `<xdr:${tag}><xdr:col>4</xdr:col><xdr:colOff>${dx * 9525}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${tag}>`;
  add('xl/drawings/loan.xml', `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${ns}">${['balance', 'rate'].map((id, i) => `<xdr:twoCellAnchor>${point('from', 8 + i * 17)}${point('to', 24 + i * 17, 480)}<xdr:graphicFrame><c:chart r:id="${id}"/></xdr:graphicFrame></xdr:twoCellAnchor>`).join('')}</xdr:wsDr>`);
  const ref = (range, kind = 'numRef') => `<c:${kind}><c:f>'Loan Model'!${range}</c:f></c:${kind}>`;
  const title = text => `<c:title><c:tx><c:rich><a:p><a:r><a:t>${text}</a:t></a:r></a:p></c:rich></c:tx></c:title>`;
  const layout = (x, y, w, h) => `<c:layout><c:manualLayout><c:x val="${x}"/><c:y val="${y}"/><c:w val="${w}"/><c:h val="${h}"/></c:manualLayout></c:layout>`;
  const line = '<c:spPr><a:ln w="19050"><a:solidFill><a:srgbClr val="224488"/></a:solidFill></a:ln></c:spPr>';
  const marker = `<c:marker><c:symbol val="${markerOnly ? 'circle' : 'none'}"/></c:marker>`;
  for (const id of ['balance', 'rate']) {
    const scatter = id === 'rate';
    const series = scatter
      ? `<c:scatterChart><c:scatterStyle val="${markerOnly ? 'marker' : 'smoothMarker'}"/><c:ser><c:tx><c:v>Rate</c:v></c:tx>${line}${marker}<c:xVal>${numericX ? ref('$A$9:$A$80') : ref('$A$9:$B$81', 'multiLvlStrRef')}</c:xVal><c:yVal>${ref('$C$9:$C$81')}</c:yVal><c:smooth val="1"/></c:ser><c:axId val="1"/><c:axId val="2"/></c:scatterChart>`
      : `<c:lineChart>${['Remaining loan', 'Scheduled balance'].map(name => `<c:ser><c:tx><c:v>${name}</c:v></c:tx>${line}${marker}<c:cat>${ref('$B$9:$B$81')}</c:cat><c:val>${ref('$D$9:$D$81')}</c:val></c:ser>`).join('')}<c:axId val="1"/><c:axId val="2"/></c:lineChart>`;
    const axis = scatter
      ? `<c:valAx><c:axId val="1"/><c:axPos val="b"/><c:scaling><c:min val="0"/><c:max val="160"/></c:scaling><c:majorUnit val="40"/><c:numFmt formatCode="0"/>${title('Installment')}</c:valAx>`
      : '<c:dateAx><c:axId val="1"/><c:axPos val="b"/><c:majorUnit val="2"/><c:majorTimeUnit val="years"/><c:numFmt formatCode="yyyy"/><c:txPr><a:bodyPr rot="-5400000"/></c:txPr></c:dateAx>';
    add(`xl/charts/${id}.xml`, `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart>${scatter ? title('Rate schedule') : ''}<c:plotArea>${layout(.15, .22, .8, .55)}${series}${axis}<c:valAx><c:axId val="2"/><c:axPos val="l"/><c:scaling><c:min val="0"/></c:scaling><c:numFmt formatCode="${scatter ? '0.00%' : '#,##0'}"/></c:valAx></c:plotArea>${scatter ? '' : `<c:legend><c:legendPos val="r"/>${layout(.5, .025, .46, .16)}</c:legend>`}<c:plotVisOnly val="0"/></c:chart></c:chartSpace>`);
  }
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
