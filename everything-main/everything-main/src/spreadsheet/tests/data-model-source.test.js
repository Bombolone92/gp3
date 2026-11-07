import { it, expect, vi } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { Workbook } from '../src/core/workbook.js';
import { encodeDataModelBytes } from '../src/core/data-model.js';
import { inspectDataModel } from '../src/core/xlsx-data-model.js';
import { readLinkedModelTable } from '../src/core/data-model-source.js';
import { modelArchive, modelLoad, modelEngine } from './helpers/data-model-fixture.js';
const engine200='http://schemas.microsoft.com/analysisservices/2010/engine/200/200', xsi='http://www.w3.org/2001/XMLSchema-instance';
function fixture({ sourceType='ColumnBinding', sourceNS=modelEngine, sourceTable='Orders', legacy=false, records=3, nullProcessing='Preserve' }={}) {
  const attribute=(id,type,key,kind='Regular')=>`<Attribute><ID>${id}</ID><Name>Caption ${id}</Name><Type>${kind}</Type><KeyColumns><KeyColumn><DataType>${type}</DataType>${nullProcessing===null?'':`<NullProcessing>${nullProcessing}</NullProcessing>`}${key}</KeyColumn></KeyColumns></Attribute>`;
  const source=`<Source xmlns:xsi="${xsi}" xmlns:s="${sourceNS}" xsi:type="s:${sourceType}"><TableID>${sourceTable}</TableID><ColumnID>Gross</ColumnID></Source>`;
  const rowSource=`<Source xmlns:xsi="${xsi}" xmlns:r="${engine200}" xsi:type="r:RowNumberBinding"/>`;
  const dimension=modelLoad('Dimension','<ID>Orders</ID><Name>Sales caption</Name><DataFileList>physical.tbl.xml;hierarchy.tbl.xml</DataFileList><Attributes>'+attribute('Net','BigInt',source)+attribute('Label','WChar','<Trimming>LeftRight</Trimming>')+attribute('Sequence_23','Integer',rowSource,'RowNumber')+(legacy?attribute('Net1','BigInt',''):'')+'</Attributes>');
  const archive=modelArchive([{path:'scope/unrelated.dim.xml',xml:dimension},{path:'formula.scr.xml',xml:modelLoad('MdxScript','<Commands><Command><Text>CREATE MEASURE Orders[Total] = SUM(Orders[Net]); CREATE MEASURE Orders[Rows] = SUM(Orders[Sequence_23]);</Text></Command></Commands>')}]);
  return new Workbook({dataModel:{version:1,archive:encodeDataModelBytes(archive),modelXml:'<dataModel xmlns="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><modelTables><modelTable id="Orders" name="Unrelated caption" connection="Local"/></modelTables></dataModel>',connectionsXml:'<connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:x="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><connection name="Local" type="102"><extLst><ext><x:connection><x:rangePr sourceName="SourceAlias"/></x:connection></ext></extLst></connection></connections>'},names:[{name:'SourceAlias',ref:`Input!$B$2:$C$${2+records}`}],sheets:[{name:'Input',cells:{'1,1':{v:'Gross'},'1,2':{v:'Label'},'2,1':{v:4},'2,2':{v:' A '},'3,2':{v:' B '},'4,1':{v:8},'4,2':{v:' C '}}}]});
}
it('reads explicit column bindings and declared generated row numbers in worksheet order',async()=>{
  const wb=fixture(),before=wb.dataModel.archive,schema=inspectDataModel(wb.dataModel),table=readLinkedModelTable(wb,schema,'Orders');
  expect(table.rowCount).toBe(3);expect(table.columns.map(c=>c.values)).toEqual([[4n,null,8n],['A','B','C'],[0n,1n,2n]]);
  expect(schema.tables[0]).toMatchObject({path:'scope/unrelated.dim.xml',dataFiles:['physical.tbl.xml','hierarchy.tbl.xml'],columns:[{keys:[{source:{type:'ColumnBinding',namespace:modelEngine,tableId:'Orders',columnId:'Gross'}}]},{},{type:'RowNumber',keys:[{source:{type:'RowNumberBinding',namespace:engine200}}]}]});
  expect(await wb.evaluateModelMeasure('Orders','Total')).toBe(12);expect(await wb.evaluateModelMeasure('Orders','Rows')).toBe(3);expect(wb.dataModel.archive).toBe(before);
  wb.setInput(wb.sheets[0].id,2,1,'14');expect(readLinkedModelTable(wb,schema,'Orders',{columns:['Net']}).columns[0].values).toEqual([14n,null,8n]);
});
it('does not invent source mappings for orphaned or legacy columns',()=>{
  const wb=fixture({legacy:true}),schema=inspectDataModel(wb.dataModel);
  expect(()=>readLinkedModelTable(wb,schema,'Orders')).toThrow(/Net1/);
  expect(readLinkedModelTable(wb,schema,'Orders',{columns:['Net']}).columns).toHaveLength(1);
  expect(()=>readLinkedModelTable(wb,schema,'Orders',{columns:['Net','net']})).toThrow(/columns/);
});
it.each([{sourceNS:'urn:foreign'},{sourceTable:'OtherTable'},{sourceType:'ExpressionBinding'}])('rejects unsupported source binding %j',async options=>{
  const wb=fixture(options),schema=inspectDataModel(wb.dataModel);
  expect(()=>readLinkedModelTable(wb,schema,'Orders')).toThrow(/source (binding|table)/);
  await expect(wb.evaluateModelMeasure('Orders','Total')).rejects.toThrow(/source (binding|table)/);
});
it('checks the projection budget before reading data and validates empty-table bindings',()=>{
  const wb=fixture(),schema=inspectDataModel(wb.dataModel),get=vi.spyOn(wb,'getValue');
  expect(()=>readLinkedModelTable(wb,schema,'Orders',{maxValues:8})).toThrow(/limit/);expect(get.mock.calls.every(([,row])=>row===1)).toBe(true);
  const empty=fixture({records:0});expect(readLinkedModelTable(empty,inspectDataModel(empty.dataModel),'Orders').columns.map(c=>c.values)).toEqual([[],[],[]]);
});

it('preserves linked table source names through native XLSX export and later table growth', async () => {
  const wb=fixture();wb.addTable(wb.sheets[0].id,{r1:1,c1:1,r2:4,c2:2},{name:'InputOrders'});
  expect(wb.defineName('SourceAlias','InputOrders[]')).toBeNull();
  const out=await workbookToXlsx(wb),zip=X.CFB.read(new Uint8Array(await out.arrayBuffer()),{type:'array'}),part=X.CFB.find(zip,'/xl/workbook.xml');
  part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
  const reopened=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}));
  expect(reopened.names.find(n=>n.name==='SourceAlias').ref).toBe('InputOrders[]');
  expect(reopened.dataModel.archive).toBe(wb.dataModel.archive);
  const input=reopened.sheetByName('Input');reopened.addTableRow(input.id,input.tables[0].id);reopened.setInput(input.id,5,1,'9');
  const projection=readLinkedModelTable(reopened,inspectDataModel(reopened.dataModel),'Orders');
  expect(projection.columns[0].values).toEqual([4n,null,8n,9n]);expect(projection.columns[2].values).toEqual([0n,1n,2n,3n]);
  expect(await reopened.evaluateModelMeasure('Orders','Total')).toBe(21);
});

it.each([null,'Automatic','ZeroOrBlank','Preserve'])('applies null policy %s to worksheet projections without changing source cells',nullProcessing=>{
  const wb=fixture({nullProcessing}),before=wb.dataModel.archive;wb.setInput(wb.sheets[0].id,3,2,'');
  const schema=inspectDataModel(wb.dataModel),projection=readLinkedModelTable(wb,schema,'Orders');
  expect(projection.columns[0].values).toEqual([4n,nullProcessing==='Preserve'?null:0n,8n]);
  expect(projection.columns[1].values).toEqual(['A',nullProcessing==='Preserve'?null:'','C']);
  schema.tables[0].columns[0].keys[0].dataType='Double';
  expect(readLinkedModelTable(wb,schema,'Orders',{columns:['Net']}).columns[0].values).toEqual([4,nullProcessing==='Preserve'?null:0,8]);
  expect(wb.getValue(wb.sheets[0].id,3,1)).toBeNull();expect(wb.getValue(wb.sheets[0].id,3,2)).toBeNull();expect(wb.dataModel.archive).toBe(before);
});
it('refuses null-forbidden projections and unknown null policies',()=>{
  for(const nullProcessing of ['Error','UnknownMember','Invalid']) {
    const wb=fixture({nullProcessing});expect(()=>readLinkedModelTable(wb,inspectDataModel(wb.dataModel),'Orders')).toThrow(/Null source|null processing/);
  }
});

it.each([' Label', 'Label  ', '  Label  ', ' lAbEl '])('binds an implicit ASSL ID to a space-normalized header %j without changing it', header => {
  const wb = fixture(); wb.setInput(wb.sheets[0].id, 1, 2, header);
  const before = wb.toJSON(), schema = inspectDataModel(wb.dataModel);
  expect(readLinkedModelTable(wb, schema, 'Orders').columns[1].values).toEqual(['A', 'B', 'C']);
  expect(wb.toJSON()).toEqual(before);
});
it.each(['La  bel', '\tLabel', 'Label\n', '\u00a0Label', 'Label\u2003'])('does not broaden implicit header normalization to %j', header => {
  const wb = fixture(); wb.setCells(wb.sheets[0].id, [{ r: 1, c: 2, cell: { v: header } }]);
  expect(() => readLinkedModelTable(wb, inspectDataModel(wb.dataModel), 'Orders')).toThrow(/Missing linked source column Label/);
});
it.each([['Label', ' Label '], [' Label', 'Label '], ['label ', ' LABEL ']])('rejects normalized header collisions %j', (first, second) => {
  const wb = fixture(); wb.setInput(wb.sheets[0].id, 1, 1, first); wb.setInput(wb.sheets[0].id, 1, 2, second);
  const before = wb.toJSON();
  expect(() => readLinkedModelTable(wb, inspectDataModel(wb.dataModel), 'Orders', { columns: ['Label'] })).toThrow(/Ambiguous linked source column Label/);
  expect(wb.toJSON()).toEqual(before);
});
it('keeps explicit source names literal and lets them distinguish normalized collisions', () => {
  const wb = fixture(), schema = inspectDataModel(wb.dataModel), column = schema.tables[0].columns[0];
  wb.setInput(wb.sheets[0].id, 1, 1, ' Gross ');
  expect(() => readLinkedModelTable(wb, schema, 'Orders', { columns: ['Net'] })).toThrow(/Missing linked source column Gross/);
  column.keys[0].source.columnId = ' Gross ';
  wb.setInput(wb.sheets[0].id, 1, 2, 'Gross');
  expect(readLinkedModelTable(wb, schema, 'Orders', { columns: ['Net'] }).columns[0].values).toEqual([4n, null, 8n]);
  wb.setInput(wb.sheets[0].id, 1, 1, 'Gross');
  expect(() => readLinkedModelTable(wb, schema, 'Orders', { columns: ['Net'] })).toThrow(/Missing linked source column/);
});
it('binds normalized implicit headers by name after source columns move', () => {
  const wb = fixture(), id = wb.sheets[0].id;
  for (let r = 1; r <= 4; r++) {
    const left = structuredClone(wb.getCell(id, r, 1)), right = structuredClone(wb.getCell(id, r, 2));
    wb.setCells(id, [{ r, c: 1, cell: right }, { r, c: 2, cell: left }]);
  }
  wb.setInput(id, 1, 1, ' Label ');
  expect(readLinkedModelTable(wb, inspectDataModel(wb.dataModel), 'Orders').columns.map(c => c.values))
    .toEqual([[4n, null, 8n], ['A', 'B', 'C'], [0n, 1n, 2n]]);
});
it.each([false, true])('retains padded source headers and implicit binding through native XLSX cycles, table %s', async table => {
  let wb = fixture(); wb.setInput(wb.sheets[0].id, 1, 2, ' Label  ');
  if (table) {
    wb.addTable(wb.sheets[0].id, { r1: 1, c1: 1, r2: 4, c2: 2 }, { name: 'PaddedSource' });
    expect(wb.defineName('SourceAlias', 'PaddedSource[]')).toBeNull();
  }
  const { nativeRoundTrip } = await import('./helpers/linked-model-workbook.js');
  const archive = wb.dataModel.archive;
  for (let i = 0; i < 2; i++) {
    wb = await nativeRoundTrip(wb);
    expect(wb.getValue(wb.sheetByName('Input').id, 1, 2)).toBe(' Label  ');
    expect(wb.dataModel.archive).toBe(archive);
    expect(readLinkedModelTable(wb, inspectDataModel(wb.dataModel), 'Orders').columns[1].values).toEqual(['A', 'B', 'C']);
  }
});
