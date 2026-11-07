import * as X from '../../src/vendor/xlsx.mjs';
import { otherProgramsXlsx } from './xlsx-fixture.js';

/** Small generated task list exercising disjoint sources, fonts, bars and vector groups. */
export function taskListXlsx({ malformedShape = false, showValue = false } = {}) {
  const name = "Tasks, O'Brien", quoted = "'Tasks, O''Brien'";
  const str = (r, value, s = 0) => `<c r="${r}" s="${s}" t="str"><v>${value}</v></c>`;
  const formula = (r, value, s = 0) => `<c r="${r}" s="${s}"><f>${value}</f><v>999</v></c>`;
  const count = condition => `COUNTIF(Table_Tasks[DUE DATE],${condition})`;
  const complete = 'COUNTIFS(Table_Tasks[DUE DATE],"&lt;="&amp;TODAY(),Table_Tasks[STATUS],"Completed")';
  const row = (r, content) => `<row r="${r}" ht="30">${content}</row>`;
  const items = [0, 0, 0, 1, 1, 7].map((days, i) => row(i + 6, str(`B${i + 6}`, 'Work') + str(`C${i + 6}`, `Task ${i + 1}`)
    + formula(`D${i + 6}`, `TODAY()+${days}`, 3) + str(`E${i + 6}`, 'Medium') + str(`F${i + 6}`, i ? 'Pending' : 'Completed'))).join('');
  const bytes = otherProgramsXlsx({ sheetNames: [name], sheetXml: { [name]: {
    head: '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="30"/><cols><col min="1" max="2" width="15.85546875"/><col min="3" max="3" width="30.85546875"/><col min="4" max="8" width="15.85546875"/><col min="9" max="12" width="10.85546875"/></cols>',
    rows: row(1, str('A1', 'Task planner', 1)) + row(2, str('N2', 'Next Week') + formula('O2', count('TODAY()+7')))
      + row(3, str('N3', 'Excluded') + '<c r="O3"><v>999</v></c>')
      + row(4, str('N4', 'This Week') + formula('O4', count('"&lt;="&amp;TODAY()+6')))
      + row(5, ['CATEGORY', 'DESCRIPTION', 'DUE DATE', 'PRIORITY', 'STATUS'].map((v, i) => str(`${String.fromCharCode(66 + i)}5`, v)).join('')
        + formula('I5', `${complete}/${count('"&lt;="&amp;TODAY()')}`, 2) + str('N5', 'Tomorrow') + formula('O5', count('TODAY()+1')))
      + items.replace('</row>', str('N6', 'Today') + formula('O6', count('"&lt;="&amp;TODAY()')) + '</row>'),
    tail: '<mergeCells count="1"><mergeCell ref="I5:L5"/></mergeCells>'
      + `<conditionalFormatting sqref="I5:L5"><cfRule type="dataBar" priority="1"><dataBar showValue="${showValue ? 1 : 0}"><cfvo type="num" val="0"/><cfvo type="num" val="1"/><color rgb="FFE8542C"/></dataBar></cfRule></conditionalFormatting>`
      + '<conditionalFormatting sqref="N6:O11 N1:O5 N12:O1048576"><cfRule type="notContainsBlanks" priority="2" dxfId="0"><formula>LEN(TRIM(N1))&gt;0</formula></cfRule></conditionalFormatting>'
      + '<drawing r:id="drawing"/><tableParts count="1"><tablePart r:id="table"/></tableParts>',
  } }, styles: { fonts: ['<font><sz val="72"/><name val="Nyala"/></font>'], cellXfs: ['<xf fontId="1"/>', '<xf numFmtId="9"/>', '<xf numFmtId="14"/>'] },
  patch: { '/xl/styles.xml': xml => xml.replace('<name val="Calibri"/>', '<name val="Source Sans Pro"/>').replace('<sz val="12"/>', '<sz val="11"/>')
    .replace(/<dxfs[^>]*(?:\/>|>[\s\S]*?<\/dxfs>)/, '<dxfs count="1"><dxf><font><color rgb="FFFFFFFF"/></font></dxf></dxfs>'),
  '/xl/theme/theme1.xml': xml => xml.replace(/(<a:minorFont>\s*<a:latin) typeface="[^"]*"/, '$1 typeface="Source Sans Pro"') } });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const add = (path, xml) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(xml));
  const rel = (id, kind, target) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${target}"/>`;
  const rels = body => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  add('xl/worksheets/_rels/sheet1.xml.rels', rels(rel('drawing', 'drawing', '../drawings/tasks.xml') + rel('table', 'table', '../tables/tasks.xml')));
  add('xl/tables/tasks.xml', '<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Table_Tasks" displayName="Table_Tasks" ref="B5:F11"><tableColumns count="5">'
    + ['CATEGORY', 'DESCRIPTION', 'DUE DATE', 'PRIORITY', 'STATUS'].map((v, i) => `<tableColumn id="${i + 1}" name="${v}"/>`).join('') + '</tableColumns></table>');
  add('xl/drawings/_rels/tasks.xml.rels', rels(rel('daily', 'chart', '../charts/daily.xml') + rel('weekly', 'chart', '../charts/weekly.xml')));
  const anchor = (r, body) => `<xdr:twoCellAnchor><xdr:from><xdr:col>8</xdr:col><xdr:row>${r}</xdr:row></xdr:from><xdr:to><xdr:col>12</xdr:col><xdr:row>${r + 4}</xdr:row></xdr:to>${body}</xdr:twoCellAnchor>`;
  const shape = `<xdr:sp><xdr:spPr><a:xfrm flipH="1" rot="5400000"><a:off x="10" y="10"/><a:ext cx="80" cy="60"/></a:xfrm><a:custGeom><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:cubicBezTo><a:pt x="90" y="30"/><a:pt x="50" y="80"/><a:pt x="0" y="100"/></a:cubicBezTo>${malformedShape ? '<a:arcTo wR="50" hR="50"/>' : '<a:close/>'}</a:path></a:pathLst></a:custGeom><a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:ln><a:noFill/></a:ln></xdr:spPr></xdr:sp>`;
  const group = (body, rotate = 0) => `<xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr name="Decoration"/></xdr:nvGrpSpPr><xdr:grpSpPr><a:xfrm rot="${rotate}"><a:off x="0" y="0"/><a:ext cx="100" cy="100"/><a:chOff x="0" y="0"/><a:chExt cx="100" cy="100"/></a:xfrm></xdr:grpSpPr>${body}</xdr:grpSp>`;
  add('xl/drawings/tasks.xml', `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchor(8, '<xdr:graphicFrame><c:chart r:id="daily"/></xdr:graphicFrame>')}${anchor(13, '<xdr:graphicFrame><c:chart r:id="weekly"/></xdr:graphicFrame>')}${anchor(0, group(group(shape, 1800000), 1200000))}</xdr:wsDr>`);
  for (const weekly of [false, true]) {
    const source = col => weekly ? `(${quoted}!$${col}$2,${quoted}!$${col}$4)` : `${quoted}!$${col}$5:$${col}$6`;
    const ref = col => `<c:numRef><c:f>${source(col)}</c:f><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>999</c:v></c:pt></c:numCache></c:numRef>`;
    add(`xl/charts/${weekly ? 'weekly' : 'daily'}.xml`, `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:plotArea><c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/><c:ser><c:cat>${ref('N')}</c:cat><c:val>${ref('O')}</c:val></c:ser><c:gapWidth val="100"/><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/></c:catAx><c:valAx><c:axId val="2"/><c:majorUnit val="1"/></c:valAx></c:plotArea></c:chart></c:chartSpace>`);
  }
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
