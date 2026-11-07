import * as archiveStorage from '../src/core/data-model-archive.js';
import { it, expect, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { fixture as storageFixture } from './helpers/rewrite-model-storage.js';
import { modelArchive, modelLoad, escapeXml } from './helpers/data-model-fixture.js';
import { nativeRoundTrip } from './helpers/linked-model-workbook.js';
import { dataModelBytes, encodeDataModelBytes } from '../src/core/data-model.js';
import { readDataModelArchive } from '../src/core/data-model-archive.js';
import { decodeModelXml } from '../src/core/data-model-metadata.js';
import { inspectDataModel } from '../src/core/xlsx-data-model.js';
import { resolveModelTableStorage } from '../src/core/data-model-table.js';
import { readModelColumnValues } from '../src/core/data-model-values.js';
import { prepareLinkedDataModelRefresh, refreshLinkedModelReports } from '../src/core/data-model-refresh.js';
const M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', X15 = 'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main';
const ENGINE200 = 'http://schemas.microsoft.com/analysisservices/2010/engine/200/200';
function fixture({ tables = 1, strings = false, rowNumbers = false, decorate = (_path, xml) => xml } = {}) {
  const records = [], sheets = [], names = [], bindings = [], connections = [];
  for (let i = 0; i < tables; i++) {
    const id = `Orders${i}`, folder = `store${i}`, group = { id, name: 'Unrelated storage caption', class: 100006, persistPath: folder };
    const raw = storageFixture({ rowNumbers, ...(strings ? { columnDictionaries: [null, { dictionaryValues: ['a', 'b', 'c'] }] } : {}) });
    const archive = readDataModelArchive(raw.input), dataFiles = [];
    for (const file of archive.files) {
      const name = file.path.slice('scope/'.length), path = `${folder}/${name}`; let bytes = file.read();
      if (name.endsWith('.tbl.xml')) {
        let xml = decodeModelXml(bytes).xml;
        if (name === 'main.tbl.xml') xml = xml.replace('><Members>', '><Properties><Settings>1</Settings></Properties><Members>');
        bytes = new TextEncoder().encode(decorate(path, xml));
      }
      records.push({ path, group, xml: bytes }); dataFiles.push(name);
    }
    const fields = [['Amount', 'BigInt'], ['Other', strings ? 'WChar' : 'BigInt'], ...(rowNumbers ? [['RowNumber', 'Integer']] : [])];
    const attributes = fields.map(([name, type]) => `<Attribute><ID>${name}</ID><Name>${name}</Name><Type>${name === 'RowNumber' ? 'RowNumber' : 'Regular'}</Type><Usage>${name === 'RowNumber' ? 'Key' : 'Regular'}</Usage><KeyColumns><KeyColumn><DataType>${type}</DataType><NullProcessing>Preserve</NullProcessing><Trimming>None</Trimming>${name === 'RowNumber' ? `<Source xmlns:r="${ENGINE200}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="r:RowNumberBinding"/>` : ''}</KeyColumn></KeyColumns></Attribute>`).join('');
    const path = `${folder}/metadata.dim.xml`;
    records.push({ path, group, xml: decorate(path, modelLoad('Dimension', `<ID>${id}</ID><Name>${id}</Name><DataFileList>${dataFiles.join(';')}</DataFileList><Attributes>${attributes}</Attributes>`)) });
    const values = [5, null, 6, 5, 7], other = strings ? ['a', null, 'b', 'a', 'c'] : values;
    const cells = { '1,1': { v: ' Amount ' }, '1,2': { v: 'Other' } };
    for (let row = 0; row < 5; row++) { cells[`${row + 2},1`] = { v: values[row] }; cells[`${row + 2},2`] = { v: other[row] }; }
    sheets.push({ name: `Input${i}`, cells }); names.push({ name: `Source${i}`, ref: `Input${i}!$B$2:$C$7` });
    bindings.push(`<x:modelTable id="${id}" name="${id}" connection="Linked${i}"/>`);
    connections.push(`<connection id="${i + 10}" name="Linked${i}" type="102"><extLst><ext><x:connection><x:rangePr sourceName="Source${i}"/></x:connection></ext></extLst></connection>`);
    records.push({ path: `${folder}/measures.scr.xml`, xml: modelLoad('MdxScript', `<Commands><Command><Text>${escapeXml(`CREATE MEASURE ${id}[Total] = SUM(${id}[Amount]);`)}</Text></Command></Commands>`) });
  }
  const wb = new Workbook({ sheets, names, dataModel: { version: 1, archive: encodeDataModelBytes(modelArchive(records)),
    modelXml: `<x:dataModel xmlns:x="${X15}"><x:modelTables>${bindings.join('')}</x:modelTables></x:dataModel>`,
    connectionsXml: `<connections xmlns="${M}" xmlns:x="${X15}">${connections.join('')}</connections>` } });
  wb.nativePivots = { version: 1, caches: [], tables: [], connections: wb.dataModel.connectionsXml };
  return wb;
}
function values(model, id = 'Orders0') {
  const schema = inspectDataModel(model), archive = readDataModelArchive(dataModelBytes(model)), table = schema.tables.find(t => t.id === id), file = resolveModelTableStorage(archive, table);
  return table.columns.map(c => readModelColumnValues(archive, file, c.id));
}
it('prepares all linked columns in worksheet order without publishing or editing headers', () => {
  const wb = fixture({ rowNumbers: true }); wb.setInput(wb.sheets[0].id, 2, 1, '50000');
  const before = wb.toJSON(), prepared = prepareLinkedDataModelRefresh(wb);
  expect(prepared.previous).toBe(wb.dataModel); expect(wb.toJSON()).toEqual(before);
  expect(values(prepared.next)).toEqual([[50000n, null, 6n, 5n, 7n], [5n, null, 6n, 5n, 7n], [0n, 1n, 2n, 3n, 4n]]);
  expect(prepared.next.modelXml).toBe(wb.dataModel.modelXml); expect(prepared.next.connectionsXml).toBe(wb.dataModel.connectionsXml);
});
it('combines every linked table in one replacement snapshot', () => {
  const wb = fixture({ tables: 2 }); wb.setInput(wb.sheets[0].id, 2, 1, '17'); wb.setInput(wb.sheets[1].id, 2, 1, '23');
  const prepared = prepareLinkedDataModelRefresh(wb);
  expect(values(prepared.next)[0][0]).toBe(17n); expect(values(prepared.next, 'Orders1')[0][0]).toBe(23n);
});
it('enforces the projection limit cumulatively across tables', () => {
  const wb = fixture({ tables: 2 }), before = wb.toJSON();
  expect(() => prepareLinkedDataModelRefresh(wb, { maxValues: 19 })).toThrow(/limit/);
  expect(wb.toJSON()).toEqual(before); expect(() => prepareLinkedDataModelRefresh(wb, { maxValues: 20 })).not.toThrow();
});
it.each(['header', 'rows', 'type', 'fraction'])('leaves every table untouched after a later source %s failure', issue => {
  const wb = fixture({ tables: 2 }); wb.setInput(wb.sheets[0].id, 2, 1, '17');
  if (issue === 'header') wb.setInput(wb.sheets[1].id, 1, 1, 'Missing');
  if (issue === 'rows') wb.defineName('Source1', 'Input1!$B$2:$C$6');
  if (issue === 'type') wb.setInput(wb.sheets[1].id, 2, 1, 'text');
  if (issue === 'fraction') { wb.setInput(wb.sheets[1].id, 2, 1, '1.5'); }
  const before = wb.toJSON(); expect(() => prepareLinkedDataModelRefresh(wb)).toThrow(); expect(wb.toJSON()).toEqual(before);
});
it.each(['relationship', 'hierarchy', 'attribute-source', 'name-source', 'attribute-relation', 'storage'])('rejects unrebuilt %s dependencies', issue => {
  const wb = fixture({ decorate: (path, xml) => {
    if (path.endsWith('.dim.xml')) {
      if (issue === 'relationship') return xml.replace('</Dimension>', '<Relationships xmlns="http://schemas.microsoft.com/analysisservices/2011/engine/300/300"><Relationship><ID>Rel</ID></Relationship></Relationships></Dimension>');
      if (issue === 'hierarchy') return xml.replace('</Dimension>', '<Hierarchies><Hierarchy><ID>Levels</ID></Hierarchy></Hierarchies></Dimension>');
      if (issue === 'attribute-source') return xml.replace('</Attribute>', '<Source/></Attribute>');
      if (issue === 'name-source') return xml.replace('</Attribute>', '<NameColumn><Source xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="ColumnBinding"><TableID>Orders0</TableID><ColumnID>Different</ColumnID></Source></NameColumn></Attribute>');
      if (issue === 'attribute-relation') return xml.replace('</Attribute>', '<AttributeRelationships><AttributeRelationship><AttributeID>Other</AttributeID></AttributeRelationship></AttributeRelationships></Attribute>');
    }
    return issue === 'storage' && path.endsWith('hierarchy0.tbl.xml') ? xml.replace('<Settings>4</Settings>', '<Settings>5</Settings>') : xml;
  } }), before = wb.toJSON();
  expect(() => prepareLinkedDataModelRefresh(wb)).toThrow(/rebuilding|dependencies|implemented|dependent/); expect(wb.toJSON()).toEqual(before);
});
it('requires explicit collation keys for new strings and routes them to the correct table/column', () => {
  const wb = fixture({ strings: true, tables: 2 }); wb.setInput(wb.sheets[1].id, 2, 2, 'd');
  expect(() => prepareLinkedDataModelRefresh(wb)).toThrow(/dictionary member rebuild/);
  const keys = new Map(['a', 'b', 'c', 'd'].map((s, i) => [s, Uint8Array.of(i + 1)]));
  const prepared = prepareLinkedDataModelRefresh(wb, { stringSortKeys: new Map([['Orders1', new Map([['Other', keys]])]]) });
  expect(values(prepared.next, 'Orders1')[1]).toEqual(['d', null, 'b', 'a', 'c']); expect(values(prepared.next)[1]).toEqual(['a', null, 'b', 'a', 'c']);
});
it.each([{}, new Map([['Unknown', new Map()]]), new Map([['Orders0', {}]]), new Map([['Orders0', new Map([['Other', new Map([['a', 'invalid']])]])]])])('rejects invalid collation maps before mutation', stringSortKeys => {
  const wb = fixture(), before = wb.toJSON(); expect(() => prepareLinkedDataModelRefresh(wb, { stringSortKeys })).toThrow(); expect(wb.toJSON()).toEqual(before);
});
it('publishes the complete source refresh through the existing undo transaction', async () => {
  let wb = fixture(); wb.setInput(wb.sheets[0].id, 2, 1, '17'); const before = wb.toJSON();
  expect(refreshLinkedModelReports(wb)).toBe(true); expect(values(wb.dataModel)[0][0]).toBe(17n);
  const after = wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
  wb = await nativeRoundTrip(wb); expect(await wb.evaluateModelMeasure('Orders0', 'Total', { source: 'stored' })).toBe(35);
  expect(await wb.evaluateModelMeasure('Orders0', 'Total')).toBe(35);
  wb.setInput(wb.sheets[0].id, 2, 1, '27'); const restored = wb.toJSON();
  expect(await wb.refreshDataModel()).toBe(true);
  expect(await wb.evaluateModelMeasure('Orders0', 'Total', { source: 'stored' })).toBe(45);
  wb.undo(); expect(wb.toJSON()).toEqual(restored);
});

it('accepts generated-row relationships while preserving fixed row identity', () => {
  const wb = fixture({ rowNumbers: true, decorate: (path, xml) => path.endsWith('.dim.xml') ? xml.replace('<Type>RowNumber</Type>', '<Type>RowNumber</Type><AttributeRelationships><AttributeRelationship><AttributeID>Other</AttributeID><RelationshipType>Flexible</RelationshipType><Cardinality>Many</Cardinality></AttributeRelationship></AttributeRelationships>') : xml });
  expect(values(prepareLinkedDataModelRefresh(wb).next)[2]).toEqual([0n, 1n, 2n, 3n, 4n]);
});
it('does not treat a user source named RowNumber as a generated row identity', () => {
  const wb = fixture({ rowNumbers: true, decorate: (path, xml) => path.endsWith('.dim.xml') ? xml.replace(/<Source xmlns:r=[^>]*\/>/, '').replace('<Type>RowNumber</Type>', '<Type>RowNumber</Type><AttributeRelationships><AttributeRelationship><AttributeID>Other</AttributeID></AttributeRelationship></AttributeRelationships>') : xml });
  expect(() => prepareLinkedDataModelRefresh(wb)).toThrow(/attribute relationships/);
});
it.each([-1, Infinity, 16 * 1048576 + 1])('rejects an invalid source budget %s before mutation', maxValues => {
  const wb = fixture(), before = wb.toJSON(); expect(() => prepareLinkedDataModelRefresh(wb, { maxValues })).toThrow(/options/); expect(wb.toJSON()).toEqual(before);
});

it('repacks the archive once for a multiple-table refresh', () => {
  const wb = fixture({ tables: 2 }), spy = vi.spyOn(archiveStorage, 'replaceDataModelArchiveFiles');
  try { prepareLinkedDataModelRefresh(wb); expect(spy).toHaveBeenCalledTimes(1); }
  finally { spy.mockRestore(); }
});
it('bounds supplied collation key bytes across tables before rewriting storage', () => {
  const wb = fixture({ tables: 2, strings: true }), before = wb.toJSON();
  const keys = new Map([['Other', new Map([['a', new Uint8Array(8 * 1048576 + 1)]])]]);
  expect(() => prepareLinkedDataModelRefresh(wb, { stringSortKeys: new Map([['Orders0', keys], ['Orders1', keys]]) })).toThrow(/collation key limit/);
  expect(wb.toJSON()).toEqual(before);
});
it('refreshes a model without pivot metadata and exposes one coherent undoable state', async () => {
  const wb = fixture(); wb.nativePivots = null; wb.setInput(wb.sheets[0].id, 2, 1, '17');
  const before = wb.toJSON(), events = []; wb.addEventListener('change', () => events.push(values(wb.dataModel)[0][0]));
  expect(await wb.refreshDataModel()).toBe(true); expect(events.length).toBeGreaterThan(0); expect(events.every(n => n === 17n)).toBe(true);
  const after = wb.toJSON(); events.length = 0; wb.undo(); expect(wb.toJSON()).toEqual(before); expect(events.every(n => n === 5n)).toBe(true);
  events.length = 0; wb.redo(); expect(wb.toJSON()).toEqual(after); expect(events.every(n => n === 17n)).toBe(true); expect(wb.nativePivots).toBeNull();
});
