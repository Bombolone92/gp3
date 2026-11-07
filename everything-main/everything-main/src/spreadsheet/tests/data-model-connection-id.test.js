import { expect, it } from 'vitest';
import { modelConnectionId } from '../src/core/data-model-bindings.js';
import { Workbook } from '../src/core/workbook.js';
import { inspectDataModel } from '../src/core/xlsx-data-model.js';
import { parseModelXml, modelChildren } from '../src/core/data-model-metadata.js';
import { fixture, nativeRoundTrip } from './helpers/linked-model-workbook.js';
it('reads the unsignedInt value space including signed zero and the maximum', () => {
  for (const [text, expected] of [['0', 0], ['-000', 0], ['+000', 0], ['\t+0042\r\n', 42], ['4294967295', 4294967295]]) {
    expect(modelConnectionId(text)).toBe(expected);
  }
});
it.each([['0', null], ['-000', '0'], ['+0042', '00042'], ['4294967295', '+04294967295']])('retains numeric connection %s through sheet extraction, import and native XLSX', async (connection, cacheId) => {
  const original = fixture();
  original.dataModel.connectionsXml = original.dataModel.connectionsXml.replace('id="7"', `id="${connection}"`);
  original.nativePivots.connections = original.dataModel.connectionsXml;
  original.nativePivots.caches[0].xml = original.nativePivots.caches[0].xml.replace('connectionId="7"', cacheId === null ? '' : `connectionId="${cacheId}"`);
  const before = JSON.stringify(original.toJSON());
  let copy = original.sheetToWorkbook(original.sheets[1].id, { sourceWorkbook: '/Source.xlsx' });
  const destination = new Workbook({ sheets: [{ name: 'Existing' }] }); destination.importSheets(copy);
  expect(JSON.stringify(original.toJSON())).toBe(before);
  const verify = async wb => {
    const id = inspectDataModel(wb.dataModel).bindings.connections.find(c => c.model).id;
    const source = modelChildren(parseModelXml(wb.nativePivots.caches[0].xml), 'cacheSource', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')[0];
    expect(modelConnectionId(source.getAttribute('connectionId') ?? '0')).toBe(modelConnectionId(id));
    expect(await wb.evaluateModelMeasure('Orders', 'Total')).toBe(20);
  };
  await verify(copy); await verify(destination);
  for (let i = 0; i < 2; i++) { copy = await nativeRoundTrip(copy); await verify(copy); }
  await verify(await nativeRoundTrip(destination));
});
it('rejects other numeric syntax and non-XML whitespace', () => {
  for (const value of [null, undefined, '', ' ', '-1', '4294967296', '4.0', '4e0', '0x4', '+ 4', '4 0', '\u00a04', '4\u2003', '\u000b4', '4\u000c', NaN, Infinity]) {
    expect(modelConnectionId(value)).toBeNull();
  }
});

it('does not default missing workbook connection IDs or explicitly empty cache IDs during transfer', () => {
  for (const missingConnection of [true, false]) {
    const wb = fixture();
    wb.dataModel.connectionsXml = wb.dataModel.connectionsXml.replace('id="7"', missingConnection ? '' : 'id="0"');
    wb.nativePivots.connections = wb.dataModel.connectionsXml;
    wb.nativePivots.caches[0].xml = wb.nativePivots.caches[0].xml.replace('connectionId="7"', missingConnection ? '' : 'connectionId=""');
    const destination = new Workbook({ sheets: [{ name: 'Existing' }] }), before = JSON.stringify(destination.toJSON());
    expect(() => wb.sheetToWorkbook(wb.sheets[1].id, { sourceWorkbook: '/Source.xlsx' })).toThrow(/connection/);
    expect(() => destination.importSheets(wb)).toThrow(/connection/);
    expect(JSON.stringify(destination.toJSON())).toBe(before);
  }
});
