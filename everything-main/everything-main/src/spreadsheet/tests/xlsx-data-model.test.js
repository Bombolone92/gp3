import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { dataModelBytes, normalizeDataModel } from '../src/core/data-model.js';
import { readXlsxDataModel, inspectDataModel, writeXlsxDataModel } from '../src/core/xlsx-data-model.js';
import { simpleModel } from './helpers/data-model-fixture.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const X15 = 'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main';
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const modelXml = `<q:dataModel xmlns:q="${X15}"><q:modelTables><q:modelTable id="Orders" name="Sales caption" connection="Source connection"/></q:modelTables></q:dataModel>`;
const connectionsXml = `<connections xmlns="${MAIN}" xmlns:z="${X15}"><connection id="7" name="Source connection" type="102"><extLst><ext uri="{DE250136-89BD-433C-8126-D09CA5730AF9}"><z:connection id="source-id"><z:rangePr sourceName="SourceRange"/></z:connection></ext></extLst></connection></connections>`;
function packageBook(mode = '') {
  const encoder = new TextEncoder(), content = xml => ({ content: encoder.encode(xml) });
  return { Directory: { workbooks: ['/documents/book.xml'] }, files: {
    'documents/book.xml': content(`<workbook xmlns="${MAIN}"><extLst><ext>${modelXml}</ext></extLst></workbook>`),
    'documents/_rels/book.xml.rels': content(`<Relationships xmlns="${PACKAGE}"><Relationship Id="model" Type="${REL}powerPivotData" Target="../data/./schema.bin" ${mode}/><Relationship Id="c" Type="${REL}connections" Target="bindings.xml"/></Relationships>`),
    'documents/bindings.xml': content(connectionsXml), 'data/schema.bin': { content: simpleModel() },
  } };
}
it('follows package relationships and explicit bindings rather than filenames or captions', () => {
  const data = readXlsxDataModel(packageBook()), model = inspectDataModel(data);
  expect(dataModelBytes(data)).toEqual(simpleModel());
  expect(model.bindings).toEqual({ tables: [{ id: 'Orders', name: 'Sales caption', connection: 'Source connection' }],
    connections: [{ id: '7', name: 'Source connection', type: '102', sourceId: 'source-id', model: false, sourceName: 'SourceRange' }] });
  expect(model.scripts[0].commands[0].measures[0]).toMatchObject({ name: 'Margin', expression: 'SUM(Orders[Net])' });
});
it('does not follow external model relationships, and detects missing local storage', () => {
  expect(readXlsxDataModel(packageBook('TargetMode="External"'))).toBeNull();
  const book = packageBook(); delete book.files['data/schema.bin'];
  expect(() => readXlsxDataModel(book)).toThrow(/Missing embedded/);
  expect(readXlsxDataModel({})).toBeNull();
});
it('keeps model storage through workbook JSON and replacement without sharing mutable descriptors', () => {
  const data = readXlsxDataModel(packageBook()), wb = new Workbook({ dataModel: data });
  const json = wb.toJSON(), copy = new Workbook(json);
  expect(copy.dataModel).toEqual(data); expect(copy.dataModel).not.toBe(wb.dataModel);
  json.dataModel.modelXml = ''; expect(wb.dataModel.modelXml).not.toBe('');
  copy.replaceWith({ sheets: [{ name: 'Empty' }] }); expect(copy.dataModel).toBeNull();
  for (const value of [{ ...data, version: 2 }, { ...data, archive: '$$$$' }, { ...data, modelXml: {} }]) expect(normalizeDataModel(value)).toBeNull();
});
it('writes native model parts through edits and repeated round trips without the private sheet', async () => {
  let wb = new Workbook({ dataModel: readXlsxDataModel(packageBook()), names: [{ name: 'SourceRange', ref: 'Data!$A$1:$A$2', hidden: true }],
    sheets: [{ name: 'Data', cells: { '0,0': { v: 'Net' }, '1,0': { v: 10 } } }] });
  const original = wb.dataModel;
  for (let pass = 0; pass < 2; pass++) {
    wb.setInput(wb.activeSheetId, 1, 0, String(20 + pass));
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const get = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
    expect(new Uint8Array(X.CFB.find(zip, '/xl/model/item.data').content)).toEqual(simpleModel());
    expect(get('/xl/connections.xml')).toBe(connectionsXml);
    expect(get('/[Content_Types].xml')).toContain('application/vnd.openxmlformats-officedocument.model+data');
    expect(get('/xl/_rels/workbook.xml.rels')).toContain(`${REL}powerPivotData`);
    expect(get('/xl/workbook.xml')).toContain('dataModel');
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(get('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
    expect(wb.dataModel.archive).toBe(original.archive);
    expect(wb.dataModel.connectionsXml).toBe(original.connectionsXml);
    expect(inspectDataModel(wb.dataModel).bindings.tables[0].id).toBe('Orders');
    expect(wb.getValue(wb.activeSheetId, 1, 0)).toBe(20 + pass);
    expect(wb.names.find(n => n.name === 'SourceRange')?.hidden).toBe(true);
  }
});
it('allocates relationship IDs without colliding with existing workbook parts', () => {
  const model = readXlsxDataModel(packageBook()), parts = new Map([['/xl/_rels/workbook.xml.rels', `<Relationships xmlns="${PACKAGE}"><Relationship Id="puterDataModel" Type="unrelated" Target="other.xml"/></Relationships>`]]);
  writeXlsxDataModel(model, `<workbook xmlns="${MAIN}"/>`.replace('/>', '></workbook>'), { get: p => parts.get(p) || '', set: (p, text) => parts.set(p, text), binary: () => {}, contentType: () => {} });
  expect(parts.get('/xl/_rels/workbook.xml.rels')).toContain('Id="puterDataModel1"');
  expect(parts.get('/xl/_rels/workbook.xml.rels')).toContain('Target="other.xml"');
});
