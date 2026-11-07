import { expect, it } from 'vitest';
import { encodeDataModelBytes } from '../src/core/data-model.js';
import { modelArchive, modelLoad } from './helpers/data-model-fixture.js';
import { Workbook } from '../src/core/workbook.js';
import { inspectDataModel } from '../src/core/xlsx-data-model.js';
import { parseModelXml, standaloneModelXml } from '../src/core/data-model-metadata.js';
import { encodeXlsxAttribute } from '../src/core/xlsx-string.js';
import { fixture, nativeRoundTrip } from './helpers/linked-model-workbook.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const X15 = 'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main';
function withStrings(connectionName, sourceName, sourceId) {
  const wb = fixture(), root = parseModelXml(wb.dataModel.connectionsXml), model = parseModelXml(wb.dataModel.modelXml);
  const connection = Array.from(root.getElementsByTagNameNS(MAIN, 'connection')).find(n => n.getAttribute('type') === '102');
  connection.setAttribute('name', encodeXlsxAttribute(connectionName));
  connection.getElementsByTagNameNS(X15, 'connection')[0].setAttribute('id', encodeXlsxAttribute(sourceId));
  connection.getElementsByTagNameNS(X15, 'rangePr')[0].setAttribute('sourceName', encodeXlsxAttribute(sourceName));
  model.getElementsByTagNameNS(X15, 'modelTable')[0].setAttribute('connection', encodeXlsxAttribute(connectionName));
  wb.dataModel.connectionsXml = standaloneModelXml(root); wb.dataModel.modelXml = standaloneModelXml(model);
  wb.names[0].name = sourceName;
  return wb;
}
it.each([
  ['Linked_x0041_', 'Source_x0042_', 'ID_x0043_'],
  ['Line\r\nTab\t&"<>', 'Source_x005F_x0041_', 'Identifier_x005f_'],
  ['Crème 数据 😀', 'SourceUnicode', '表格😀'],
])('decodes workbook binding strings once: %j', async (connectionName, sourceName, sourceId) => {
  let wb = withStrings(connectionName, sourceName, sourceId);
  const before = wb.toJSON();
  for (let pass = 0; pass < 3; pass++) {
    const schema = inspectDataModel(wb.dataModel);
    expect(schema.bindings.tables[0].connection).toBe(connectionName);
    expect(schema.bindings.connections.find(c => c.type === '102')).toMatchObject({ name: connectionName, sourceName, sourceId });
    expect(await wb.evaluateModelMeasure('Orders', 'Total')).toBe(20);
    if (!pass) expect(wb.toJSON()).toEqual(before);
    if (pass < 2) wb = await nativeRoundTrip(wb);
  }
});
it('matches different legal encodings of the same model and connection identity', async () => {
  const wb = fixture();
  wb.dataModel.modelXml = wb.dataModel.modelXml.replace('id="Orders"', 'id="_x004F_rders"').replace('name="Orders"', 'name="Caption_x005F_x0041_"');
  wb.dataModel.connectionsXml = wb.dataModel.connectionsXml.replace('name="Linked"', 'name="_x004C_inked"');
  expect(inspectDataModel(wb.dataModel).bindings.tables[0]).toEqual({ id: 'Orders', name: 'Caption_x0041_', connection: 'Linked' });
  expect(await wb.evaluateModelMeasure('Orders', 'Total')).toBe(20);
});
it('keeps escaped source names working through extraction and existing-workbook import', async () => {
  const wb = withStrings('Connection_x0041_', 'Source_x0042_', 'Table_x0043_');
  const copy = wb.sheetToWorkbook(wb.sheets[0].id);
  expect(await copy.evaluateModelMeasure('Orders', 'Total')).toBe(20);
  const destination = new Workbook(); destination.importSheets(wb);
  expect(await destination.evaluateModelMeasure('Orders', 'Total')).toBe(20);
  expect(await (await nativeRoundTrip(destination)).evaluateModelMeasure('Orders', 'Total')).toBe(20);
});

it('decodes workbook table IDs while preserving literal escape-like ASSL identifiers', async () => {
  let wb = fixture();
  const table = 'Orders_x0041_';
  wb.dataModel.archive = encodeDataModelBytes(modelArchive([
    { path: 'model.dim.xml', xml: modelLoad('Dimension', `<ID>${table}</ID><Name>${table}</Name><Attributes><Attribute><ID>Gross</ID><Name>Gross</Name><KeyColumns><KeyColumn><DataType>BigInt</DataType></KeyColumn></KeyColumns></Attribute></Attributes>`) },
    { path: 'model.scr.xml', xml: modelLoad('MdxScript', `<Commands><Command><Text>CREATE MEASURE ${table}[Total] = SUM(${table}[Gross]);</Text></Command></Commands>`) },
  ]));
  wb.dataModel.modelXml = wb.dataModel.modelXml.replace('id="Orders"', `id="${encodeXlsxAttribute(table)}"`).replace('name="Orders"', `name="${encodeXlsxAttribute(table)}"`);
  const archive = wb.dataModel.archive;
  for (let pass = 0; pass < 3; pass++) {
    const schema = inspectDataModel(wb.dataModel);
    expect(schema.tables[0].id).toBe(table); expect(schema.bindings.tables[0].id).toBe(table);
    expect(await wb.evaluateModelMeasure(table, 'Total')).toBe(20); expect(wb.dataModel.archive).toBe(archive);
    if (pass < 2) wb = await nativeRoundTrip(wb);
  }
});
