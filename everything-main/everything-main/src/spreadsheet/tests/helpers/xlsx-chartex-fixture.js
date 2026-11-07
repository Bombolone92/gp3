import * as X from '../../src/vendor/xlsx.mjs';
import { paretoXlsx } from './xlsx-pareto-fixture.js';

// Excel's newer Pareto format uses chartEx relationships, named sources and
// owner-derived lines. Build that structure here, without storing a user's file.
export function chartExXlsx({ external = false, layout = 'clusteredColumn', aggregate = true } = {}) {
  const zip = X.CFB.read(new Uint8Array(paretoXlsx()), { type: 'array' });
  const get = part => new TextDecoder().decode(X.CFB.find(zip, part).content);
  const put = (part, xml) => {
    const bytes = new TextEncoder().encode(xml), existing = X.CFB.find(zip, `/${part}`);
    if (existing) { existing.content = bytes; existing.size = bytes.length; }
    else X.CFB.utils.cfb_add(zip, part, bytes);
  };
  put('xl/workbook.xml', get('/xl/workbook.xml').replace('</workbook>', '<definedNames>'
    + '<definedName name="_xlchart.v1.1" hidden="1">Data!$A$3:$A$5</definedName>'
    + '<definedName name="_xlchart.v1.2" hidden="1">Data!$B$2</definedName>'
    + '<definedName name="_xlchart.v1.3" hidden="1">Data!$B$3:$B$5</definedName></definedNames></workbook>'));
  put('xl/drawings/_rels/cost.xml.rels', get('/xl/drawings/_rels/cost.xml.rels')
    .replace('http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart', 'http://schemas.microsoft.com/office/2014/relationships/chartEx')
    .replace('Target="../charts/pareto.xml"', external ? 'Target="https://example.com/chart.xml" TargetMode="External"' : 'Target="../charts/pareto.xml"'));
  put('xl/drawings/cost.xml', get('/xl/drawings/cost.xml')
    .replace('<xdr:graphicFrame><c:chart r:id="plot"/></xdr:graphicFrame>', '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex" Requires="cx"><xdr:graphicFrame><cx:chart r:id="plot"/></xdr:graphicFrame></mc:Choice><mc:Fallback><xdr:sp><xdr:txBody><a:p><a:r><a:t>Unsupported chart</a:t></a:r></a:p></xdr:txBody></xdr:sp></mc:Fallback></mc:AlternateContent>')
    .replace('flipH="1"', 'rot="10800000"')
    .replace('</xdr:wsDr>', '<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:row>2</xdr:row></xdr:from><xdr:ext cx="952500" cy="3810000"/><xdr:sp><xdr:spPr><a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="3C9FE0"/></a:solidFill><a:ln><a:noFill/></a:ln></xdr:spPr></xdr:sp></xdr:oneCellAnchor></xdr:wsDr>'));
  const tx = '<cx:txPr><a:p><a:pPr><a:defRPr sz="1000"><a:latin typeface="Avenir Next LT Pro"/></a:defRPr></a:pPr></a:p></cx:txPr>';
  put('xl/charts/pareto.xml', `<cx:chartSpace xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
    <cx:chartData><cx:data id="0"><cx:strDim type="cat"><cx:f>_xlchart.v1.1</cx:f></cx:strDim><cx:numDim type="val"><cx:f>_xlchart.v1.3</cx:f></cx:numDim></cx:data></cx:chartData>
    <cx:chart><cx:plotArea><cx:plotAreaRegion>
      <cx:series layoutId="${layout}"><cx:tx><cx:txData><cx:f>_xlchart.v1.2</cx:f><cx:v>Occurrences</cx:v></cx:txData></cx:tx><cx:spPr><a:solidFill><a:srgbClr val="E95A29"/></a:solidFill></cx:spPr><cx:dataId val="0"/><cx:layoutPr>${aggregate ? '<cx:aggregation/>' : '<cx:binning/>'}</cx:layoutPr><cx:axisId val="1"/></cx:series>
      <cx:series layoutId="paretoLine" ownerIdx="0"><cx:spPr><a:ln w="34925"><a:solidFill><a:srgbClr val="26A6FC"/></a:solidFill></a:ln></cx:spPr><cx:axisId val="2"/></cx:series>
      <cx:series layoutId="clusteredColumn" hidden="1"><cx:dataId val="99"/><cx:axisId val="1"/></cx:series>
      <cx:series layoutId="paretoLine" ownerIdx="2"><cx:axisId val="2"/></cx:series>
    </cx:plotAreaRegion>
      <cx:axis id="2"><cx:valScaling min="0" max="1"/><cx:units unit="percentage"/>${tx}</cx:axis>
      <cx:axis id="0"><cx:catScaling gapWidth="1"/>${tx}</cx:axis>
      <cx:axis id="1"><cx:valScaling/><cx:majorGridlines><cx:spPr><a:ln><a:solidFill><a:srgbClr val="DDDDDD"/></a:solidFill></a:ln></cx:spPr></cx:majorGridlines>${tx}</cx:axis>
    </cx:plotArea></cx:chart><cx:spPr><a:noFill/><a:ln><a:noFill/></a:ln></cx:spPr></cx:chartSpace>`);
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
