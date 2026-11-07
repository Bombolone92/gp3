import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { encodeDataModelBytes } from '../src/core/data-model.js';
import { modelArchive, modelLoad } from './helpers/data-model-fixture.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', X15 = 'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main';
function fixture(expression = 'SUM(Orders[Net])', textSettings = '', groupType = 'WChar', netSettings = '') {
  const archive = modelArchive([
    { path: 'sales.dim.xml', xml: modelLoad('Dimension', `<ID>Orders</ID><Name>Orders</Name><Attributes><Attribute><ID>Net</ID><Name>Net</Name><KeyColumns><KeyColumn><DataType>BigInt</DataType>${netSettings}</KeyColumn></KeyColumns></Attribute><Attribute><ID>Group</ID><Name>Group</Name><KeyColumns><KeyColumn><DataType>${groupType}</DataType>${textSettings}</KeyColumn></KeyColumns></Attribute></Attributes>`) },
    { path: 'formulas.scr.xml', xml: modelLoad('MdxScript', `<Commands><Command><Text>CREATE MEASURE [Model].Orders[Total] = ${expression};</Text></Command></Commands>`) },
  ]);
  return new Workbook({ dataModel: { version: 1, archive: encodeDataModelBytes(archive),
    modelXml: `<x:dataModel xmlns:x="${X15}"><x:modelTables><x:modelTable id="Orders" name="Caption differs" connection="Named binding"/></x:modelTables></x:dataModel>`,
    connectionsXml: `<connections xmlns="${MAIN}" xmlns:x="${X15}"><connection id="9" name="Named binding" type="102"><extLst><ext><x:connection id="Orders"><x:rangePr sourceName="SourceAlias"/></x:connection></ext></extLst></connection></connections>` },
    names: [{ name: 'SourceAlias', ref: 'Input!$B$2:$C$5' }],
    sheets: [{ name: 'Input', cells: { '1,1': { v: 'Net' }, '1,2': { v: 'Group' }, '2,1': { v: 4 }, '2,2': { v: 'A' }, '3,1': { v: 0 }, '3,2': { v: 'B' }, '4,1': { v: 8 }, '4,2': { v: 'A' } } }] });
}
it('evaluates declared measures through explicit source names and current worksheet values', async () => {
  const wb = fixture(), archive = wb.dataModel.archive;
  expect(await wb.evaluateModelMeasure('Orders', 'Total')).toBe(12);
  expect(await wb.evaluateModelMeasure('orders', 'total', { acceptRow: (_table, get) => get('Group') === 'A' })).toBe(12);
  wb.setInput(wb.sheets[0].id, 2, 1, '14');
  expect(await wb.evaluateModelMeasure('Orders', 'Total')).toBe(22);
  expect(wb.dataModel.archive).toBe(archive); // Calculation alone is not native model serialization.
  wb.undo(); expect(await wb.evaluateModelMeasure('Orders', 'Total')).toBe(12);
});
it('evaluates linked tables by their connection name even when sheet/model/table captions differ', async () => {
  const wb = fixture();
  wb.sheets[0].tables = [{ id: 'source', name: 'WorksheetSales', range: { r1: 1, c1: 1, r2: 4, c2: 2 }, totalsRow: true }];
  wb.names[0].ref = 'WorksheetSales[]';
  expect(await wb.evaluateModelMeasure('Orders', 'Total')).toBe(4); // Header and totals are excluded.
  wb.renameSheet(wb.sheets[0].id, 'Renamed sheet');
  expect(await wb.evaluateModelMeasure('Orders', 'Total')).toBe(4);
});
it('counts filtered source rows and supports nested aggregate calls', async () => {
  const wb = fixture('DIVIDE(SUM(Orders[Net]), COUNTROWS(Orders))');
  expect(await wb.evaluateModelMeasure('Orders', 'Total')).toBe(4);
  expect(await wb.evaluateModelMeasure('Orders', 'Total', { acceptRow: (_t, get) => get('Group') === 'A' })).toBe(6);
  expect(await wb.evaluateModelMeasure('Orders', 'Total', { acceptRow: () => false })).toBeNull();
});
it('rejects missing, ambiguous, external and cyclic bindings instead of guessing', async () => {
  const wb = fixture(); wb.names[0].ref = 'SourceAlias';
  await expect(wb.evaluateModelMeasure('Orders', 'Total')).rejects.toThrow(/source name/);
  wb.names[0].ref = 'MissingTable'; await expect(wb.evaluateModelMeasure('Orders', 'Total')).rejects.toThrow(/source reference/);
  wb.dataModel.connectionsXml = wb.dataModel.connectionsXml.replace('type="102"', 'type="5"');
  await expect(wb.evaluateModelMeasure('Orders', 'Total')).rejects.toThrow(/linked worksheet/);
  await expect(fixture('[Total]').evaluateModelMeasure('Orders', 'Total')).rejects.toThrow(/Circular/);
  const ambiguous = fixture(); ambiguous.names.push({ ...ambiguous.names[0] });
  await expect(ambiguous.evaluateModelMeasure('Orders', 'Total')).rejects.toThrow(/Ambiguous/);
});
it('enforces shared source-read limits and reports missing source columns', async () => {
  const wb = fixture();
  await expect(wb.evaluateModelMeasure('Orders', 'Total', { maxValues: 2 })).rejects.toThrow(/limit/);
  wb.setInput(wb.sheets[0].id, 1, 1, 'Unrelated');
  await expect(wb.evaluateModelMeasure('Orders', 'Total')).rejects.toThrow(/source column/);
});
it.each(['1.25', '1e20'])('does not silently accept %s as a whole-number model value', async value => {
  const wb = fixture(); wb.setInput(wb.sheets[0].id, 2, 1, value);
  await expect(wb.evaluateModelMeasure('Orders', 'Total')).rejects.toThrow(/(column|integer) type/);
});
it('rejects deeply chained source names rather than bypassing a remaining alias', async () => {
  const wb = fixture(); wb.names[0].ref = 'Alias0';
  for (let i = 0; i < 70; i++) wb.names.push({ name: `Alias${i}`, ref: i === 69 ? 'Input!$B$2:$C$5' : `Alias${i + 1}` });
  await expect(wb.evaluateModelMeasure('Orders', 'Total')).rejects.toThrow(/nesting limit/);
});
it.each([
  ['', ' A'], ['<Trimming>Right</Trimming>', ' A'], ['<Trimming>Left</Trimming>', 'A  '],
  ['<Trimming>LeftRight</Trimming>', 'A'], ['<Trimming>None</Trimming>', ' A  '], ['<Format>TrimNone</Format>', ' A  '],
])('applies declared model text trimming: %s', async (settings, expected) => {
  const wb = fixture('SUM(Orders[Net])', settings), sheet = wb.sheets[0];
  wb.setInput(sheet.id, 2, 2, ' A  ');
  expect(await wb.evaluateModelMeasure('Orders', 'Total', { acceptRow: (_t, get) => get('Group') === expected })).toBe(4 + (expected === 'A' ? 8 : 0));
  expect(wb.getValue(sheet.id, 2, 2)).toBe(' A  ');
});
it('rejects contradictory trimming metadata', async () => {
  const wb = fixture('SUM(Orders[Net])', '<Trimming>Left</Trimming><Format>TrimRight</Format>');
  await expect(wb.evaluateModelMeasure('Orders', 'Total', { acceptRow: (_t, get) => get('Group') === 'A' })).rejects.toThrow(/trimming/);
});

it('reads the native Bool DataItem type without treating false as blank', async () => {
  const wb = fixture('COUNTROWS(Orders)', '', 'Bool'), sheet = wb.sheets[0];
  for (const [row, value] of [[2, 'TRUE'], [3, 'FALSE'], [4, 'TRUE']]) wb.setInput(sheet.id, row, 2, value);
  expect(await wb.evaluateModelMeasure('Orders', 'Total', { acceptRow: (_t, get) => get('Group') === false })).toBe(1);
});

it.each([['',3,4],['Automatic',3,4],['ZeroOrBlank',3,4],['Preserve',2,6]])('applies numeric null processing %s consistently to counts and averages', async (policy,count,average) => {
  for (const [expression,expected] of [['COUNT(Orders[Net])',count],['AVERAGE(Orders[Net])',average]]) {
    const wb=fixture(expression,'','WChar',policy?`<NullProcessing>${policy}</NullProcessing>`:''),before=wb.dataModel.archive;
    wb.setInput(wb.sheets[0].id,3,1,'');
    expect(await wb.evaluateModelMeasure('Orders','Total')).toBe(expected);
    expect(wb.getValue(wb.sheets[0].id,3,1)).toBeNull();expect(wb.dataModel.archive).toBe(before);
  }
});
it('rejects forbidden nulls and unsupported policies even for an empty source', async () => {
  const wb=fixture('SUM(Orders[Net])','','WChar','<NullProcessing>Error</NullProcessing>');
  expect(await wb.evaluateModelMeasure('Orders','Total')).toBe(12);
  wb.setInput(wb.sheets[0].id,3,1,'');await expect(wb.evaluateModelMeasure('Orders','Total')).rejects.toThrow(/Null source/);
  for(const policy of ['UnknownMember','Misspelled']) {
    const empty=fixture('SUM(Orders[Net])','','WChar',`<NullProcessing>${policy}</NullProcessing>`);empty.names[0].ref='Input!$B$2:$C$2';
    await expect(empty.evaluateModelMeasure('Orders','Total')).rejects.toThrow(/null processing/);
  }
});

it.each(['Automatic','ZeroOrBlank','Preserve'])('uses typed blank handling %s in text and boolean filters',async policy=>{
  for(const type of ['WChar','Bool']) {
    const wb=fixture('COUNTROWS(Orders)',`<NullProcessing>${policy}</NullProcessing>`,type),sheet=wb.sheets[0];
    if(type==='Bool')for(const row of [2,4])wb.setInput(sheet.id,row,2,'TRUE');
    wb.setInput(sheet.id,3,2,'');const empty=policy==='Preserve'?null:type==='Bool'?false:'';
    expect(await wb.evaluateModelMeasure('Orders','Total',{acceptRow:(_t,get)=>get('Group')===empty})).toBe(1);
    expect(wb.getValue(sheet.id,3,2)).toBeNull();
  }
});
it('distinguishes a blank cell from an empty string under the Error policy',async()=>{
  const wb=fixture('COUNTROWS(Orders)','<NullProcessing>Error</NullProcessing>'),sheet=wb.sheets[0];
  wb.setInput(sheet.id,3,2,'=""');
  expect(await wb.evaluateModelMeasure('Orders','Total',{acceptRow:(_t,get)=>get('Group')===''})).toBe(1);
  wb.setInput(sheet.id,3,2,'');await expect(wb.evaluateModelMeasure('Orders','Total',{acceptRow:(_t,get)=>get('Group')===''})).rejects.toThrow(/Null source/);
});
