import { Workbook } from '../../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../../src/core/io.js';
import { encodeDataModelBytes } from '../../src/core/data-model.js';
import { modelArchive, modelLoad } from './data-model-fixture.js';
import * as X from '../../src/vendor/xlsx.mjs';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', X15 = 'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main';
export function fixture() {
  const archive = modelArchive([
    { path: 'orders.dim.xml', xml: modelLoad('Dimension', '<ID>Orders</ID><Name>Orders</Name><Attributes><Attribute><ID>Gross</ID><Name>Gross</Name><KeyColumns><KeyColumn><DataType>BigInt</DataType></KeyColumn></KeyColumns></Attribute></Attributes>') },
    { path: 'measures.scr.xml', xml: modelLoad('MdxScript', '<Commands><Command><Text>CREATE MEASURE Orders[Total] = SUM(Orders[Gross]);</Text></Command></Commands>') },
  ]);
  const connectionsXml = `<connections xmlns="${MAIN}" xmlns:x="${X15}"><connection id="7" name="Model" type="5"><extLst><ext><x:connection model="1"/></ext></extLst></connection><connection id="9" name="Linked" type="102"><extLst><ext><x:connection><x:rangePr sourceName="SourceAlias"/></x:connection></ext></extLst></connection></connections>`;
  const wb = new Workbook({ dataModel: { version: 1, archive: encodeDataModelBytes(archive), connectionsXml,
    modelXml: `<x:dataModel xmlns:x="${X15}"><x:modelTables><x:modelTable id="Orders" name="Orders" connection="Linked"/></x:modelTables></x:dataModel>` },
    names: [{ name: 'SourceAlias', ref: 'Input!$B$2:$B$4' }, { name: '_ModelSource1', ref: '99' }],
    sheets: [{ name: 'Input', cells: { '1,1': { v: 'Gross' }, '2,1': { v: 7 }, '3,1': { v: 13 } } },
      { name: 'Report', cells: { '2,1': { v: 'Category' }, '2,2': { v: 'Total' }, '3,1': { v: 'Sales' }, '3,2': { v: 20 } } }] });
  const report = wb.sheets[1];
  wb.nativePivots = { version: 1, caches: [{ key: 'model', scope: 'main',
    xml: `<pivotCacheDefinition xmlns="${MAIN}"><cacheSource type="external" connectionId="7"/><cacheFields count="1"><cacheField name="Gross"/></cacheFields></pivotCacheDefinition>`, records: '' }],
    tables: [{ name: 'Summary', cache: 'model', owner: report.id, xml: `<pivotTableDefinition xmlns="${MAIN}" name="Summary" cacheId="1" dataCaption="Values"><location ref="B3:C4" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/><pivotFields count="1"><pivotField dataField="1"/></pivotFields><dataFields count="1"><dataField name="Total" fld="0"/></dataFields></pivotTableDefinition>` }],
    formats: {}, dxfs: [], styles: [], connections: connectionsXml };
  report.charts = [{ id: 'chart', type: 'bar', range: { r1: 2, c1: 1, r2: 3, c2: 2 }, anchor: { r: 6, c: 1 }, w: 400, h: 300,
    pivotSource: { name: 'Report!Summary' }, sourceRefs: [{ name: 'Total', categories: 'Report!B4', values: 'Report!C4' }] }];
  return wb;
}
export async function nativeRoundTrip(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
}
