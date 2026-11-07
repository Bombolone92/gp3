import * as X from '../../src/vendor/xlsx.mjs';
import { otherProgramsXlsx } from './xlsx-fixture.js';

export const dashboardImage = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
export function dashboardXlsx({ pivot = true, externalImage = false, missingImageLink = false } = {}) {
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const relationship = (id, type, target, mode = '') => `<Relationship Id="${id}" Type="${type}" Target="${target}" ${mode}/>`;
  const relationships = text => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${text}</Relationships>`;
  const txt = (a, t) => `<c r="${a}" t="inlineStr"><is><t>${t}</t></is></c>`;
  const source = otherProgramsXlsx({ sheetNames: ['Data', 'Dashboard', 'Assets'], sheetXml: {
    Data: { rows: `<row r="1">${txt('A1', 'One')}<c r="B1"><v>10</v></c><c r="C1"><v>7</v></c>${txt('D1', 'One')}</row><row r="2">${txt('A2', 'Two')}<c r="B2"><v>20</v></c><c r="C2" t="e"><v>#N/A</v></c></row><row r="3">${txt('A3', 'Grand Total')}<c r="B3"><v>30</v></c></row>` },
    Dashboard: { head: '<sheetViews><sheetView workbookViewId="0" zoomScale="81" showGridLines="0"/></sheetViews>', rows: '<row r="1"><c r="A1" t="e" vm="2"><f>XLOOKUP(Data!D1,Assets!A1:A2,Assets!B1:B2)</f><v>#VALUE!</v></c><c r="C1"><f t="array" ref="C1:C2">Data!A1:A2</f><v>0</v></c></row>', tail: '<drawing r:id="drawing"/>' },
    Assets: { rows: `<row r="1">${txt('A1', 'One')}<c r="B1" t="e" vm="2"><v>#VALUE!</v></c></row><row r="2">${txt('A2', 'Two')}<c r="B2" t="e" vm="1"><v>#VALUE!</v></c></row>` },
  }, patch: { '/xl/workbook.xml': xml => xml.replace('<sheets>', '<bookViews><workbookView activeTab="1"/></bookViews><sheets>') } });
  const zip = X.CFB.read(new Uint8Array(source), { type: 'array' });
  const add = (p, s) => X.CFB.utils.cfb_add(zip, p, typeof s === 'string' ? new TextEncoder().encode(s) : s);
  const get = p => new TextDecoder().decode(X.CFB.find(zip, `/${p}`).content);
  const rels = [['metadata', `${R}sheetMetadata`, 'metadata.xml'], ['values', 'http://schemas.microsoft.com/office/2017/06/relationships/rdRichValue', 'richData/values.xml'], ['structure', 'http://schemas.microsoft.com/office/2017/06/relationships/rdRichValueStructure', 'richData/structure.xml'], ['links', 'http://schemas.microsoft.com/office/2022/10/relationships/richValueRel', 'richData/links.xml']];
  add('xl/_rels/workbook.xml.rels', get('xl/_rels/workbook.xml.rels').replace('</Relationships>', rels.map(r => relationship(...r)).join('') + '</Relationships>'));
  add('xl/metadata.xml', '<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:rd="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata"><metadataTypes count="2"><metadataType name="XLDAPR"/><metadataType name="XLRICHVALUE"/></metadataTypes><futureMetadata name="XLRICHVALUE"><bk><extLst><ext><rd:rvb i="0"/></ext></extLst></bk><bk><extLst><ext><rd:rvb i="1"/></ext></extLst></bk></futureMetadata><valueMetadata><bk><rc t="2" v="1"/></bk><bk><rc t="2" v="0"/></bk></valueMetadata></metadata>');
  add('xl/richData/values.xml', '<rvData><rv s="0"><v>5</v><v>0</v></rv><rv s="0"><v>5</v><v>1</v></rv></rvData>');
  add('xl/richData/structure.xml', '<rvStructures><s t="_localImage"><k n="CalcOrigin"/><k n="_rvRel:LocalImageIdentifier"/></s></rvStructures>');
  add('xl/richData/links.xml', `<richValueRels><rel r:id="${missingImageLink ? 'missing' : 'picture'}"/><rel r:id="other"/></richValueRels>`);
  add('xl/richData/_rels/links.xml.rels', relationships(relationship('other', `${R}image`, '../media/other.png') + relationship('picture', `${R}image`, externalImage ? 'https://example.com/photo.png' : '../media/photo.png', externalImage ? 'TargetMode="External"' : '')));
  add('xl/media/photo.png', Uint8Array.from(atob(dashboardImage), c => c.charCodeAt(0)));
  add('xl/media/other.png', Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg=='), c => c.charCodeAt(0)));
  add('xl/worksheets/_rels/sheet2.xml.rels', relationships(relationship('drawing', `${R}drawing`, '../drawings/dashboard.xml')));
  add('xl/drawings/_rels/dashboard.xml.rels', relationships(relationship('chart1', `${R}chart`, '../charts/first.xml') + relationship('chart2', `${R}chart`, '../charts/second.xml')));
  const transform = (x, y, w, h, group = false) => `<a:xfrm><a:off x="${x * 9525}" y="${y * 9525}"/><a:ext cx="${w * 9525}" cy="${h * 9525}"/>${group ? '<a:chOff x="0" y="0"/><a:chExt cx="11430000" cy="7620000"/>' : ''}</a:xfrm>`;
  const frame = (id, x) => `<xdr:graphicFrame>${transform(x, 100, 560, 600)}<a:graphic><a:graphicData><c:chart r:id="${id}"/></a:graphicData></a:graphic></xdr:graphicFrame>`;
  const text = `<xdr:sp textlink="Data!$B$1"><xdr:spPr>${transform(20, 0, 200, 60)}<a:prstGeom prst="rect"/><a:noFill/><a:ln><a:noFill/></a:ln></xdr:spPr><xdr:txBody><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0"/><a:p><a:fld type="TxLink"><a:rPr sz="1800"><a:solidFill><a:prstClr val="white"/></a:solidFill></a:rPr><a:t>STALE</a:t></a:fld><a:r><a:t> calls</a:t></a:r></a:p></xdr:txBody></xdr:sp>`;
  add('xl/drawings/dashboard.xml', `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${R.slice(0, -1)}"><xdr:oneCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:row>2</xdr:row></xdr:from><xdr:ext cx="5715000" cy="3810000"/><xdr:grpSp><xdr:grpSpPr>${transform(0, 0, 600, 400, true)}</xdr:grpSpPr><xdr:grpSp><xdr:grpSpPr>${transform(0, 0, 1200, 800, true)}</xdr:grpSpPr>${text}${frame('chart1', 20)}${frame('chart2', 620)}</xdr:grpSp></xdr:grpSp></xdr:oneCellAnchor></xdr:wsDr>`);
  const ref = (col, count = 2) => `<c:numRef><c:f>Data!$${col}$1:$${col}$3</c:f><c:numCache><c:ptCount val="${count}"/><c:pt idx="0"><c:v>9999</c:v></c:pt></c:numCache></c:numRef>`;
  const series = (i, col) => `<c:ser><c:idx val="${i}"/><c:tx><c:v>Series ${i}</c:v></c:tx><c:cat>${ref('A')}</c:cat><c:val>${ref(col)}</c:val><c:dLbls><c:showVal val="1"/><c:dLblPos val="outEnd"/></c:dLbls></c:ser>`;
  for (const n of ['first', 'second']) add(`xl/charts/${n}.xml`, `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${pivot ? '<c:pivotSource><c:name>Data!Summary</c:name></c:pivotSource>' : ''}<c:chart><c:plotArea><c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/>${series(0, 'B')}${series(1, 'C')}<c:overlap val="100"/><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:min val="0"/></c:scaling></c:valAx></c:plotArea></c:chart></c:chartSpace>`);
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
