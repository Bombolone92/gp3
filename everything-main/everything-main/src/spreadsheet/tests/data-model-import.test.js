import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { inspectDataModel } from '../src/core/xlsx-data-model.js';
import { linkedModelSource } from '../src/core/data-model-source.js';
import { chartData } from '../src/core/charts.js';
import { parseModelXml } from '../src/core/data-model-metadata.js';
import { fixture, nativeRoundTrip } from './helpers/linked-model-workbook.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

it('imports a model with live renamed sheets and conflicting names, with undo and native round trips', async () => {
  const source = fixture(), before = source.toJSON(), destination = new Workbook({ sheets: [{ name: 'Input' }, { name: 'Report' }] });
  destination.defineName('SourceAlias', '999'); destination.defineName('_ModelSource1', '123');
  const original = destination.toJSON(), added = destination.importSheets(source);
  expect(added.map(s => s.name)).toEqual(['Input (2)', 'Report (2)']);
  expect(source.toJSON()).toEqual(before);
  expect(destination.namedEntry('SourceAlias', null).ref).toBe('999');
  expect(await destination.evaluateModelMeasure('Orders', 'Total')).toBe(20);
  expect(destination.dataModel.archive).toBe(source.dataModel.archive);
  destination.undo(); expect(destination.toJSON()).toEqual(original);
  destination.redo(); expect(await destination.evaluateModelMeasure('Orders', 'Total')).toBe(20);
  destination.setInput(added[0].id, 2, 1, '31');
  expect(await destination.evaluateModelMeasure('Orders', 'Total')).toBe(44);
  let copy = destination;
  for (let pass = 0; pass < 2; pass++) {
    copy = await nativeRoundTrip(copy);
    expect(await copy.evaluateModelMeasure('Orders', 'Total')).toBe(44);
    const report = copy.sheetByName('Report (2)');
    expect(copy.nativePivots.tables[0].owner).toBe(report.id);
    expect(chartData(copy, report.id, report.charts[0]).series[0].values).toEqual([20]);
    expect(copy.dataModel.archive).toBe(source.dataModel.archive);
  }
});

it('imports an extracted model after existing external books and preserves both caches', async () => {
  const source = fixture(), extracted = source.sheetToWorkbook(source.sheets[1].id, { sourceWorkbook: '/Source.xlsx' });
  const other = new Workbook({ sheets: [{ name: 'Lookup', cells: { '0,0': { v: 81 } } }, { name: 'Existing', cells: { '0,0': { f: 'Lookup!A1' } } }] });
  const destination = other.sheetToWorkbook(other.sheets[1].id, { sourceWorkbook: '/Other.xlsx' });
  const added = destination.importSheets(extracted);
  expect(destination.externalWorkbooks.books.map(b => b.target)).toEqual(['/Other.xlsx', '/Source.xlsx']);
  expect(destination.getValue(destination.sheets[0].id, 0, 0)).toBe(81);
  expect(await destination.evaluateModelMeasure('Orders', 'Total')).toBe(20);
  const schema = inspectDataModel(destination.dataModel), src = linkedModelSource(destination, schema, schema.tables[0]);
  expect(src.sheet.name).toBe('[2]Input'); expect(src.sheet.externalCache).toBe(true);
  expect(added[0].charts[0].pivotSource).toMatchObject({ name: 'Report!Summary', standalone: false });
  const copy = await nativeRoundTrip(destination);
  expect(await copy.evaluateModelMeasure('Orders', 'Total')).toBe(20);
  expect(copy.getValue(copy.sheets[0].id, 0, 0)).toBe(81);
});

it('keeps imported table sources dynamic after a table-name collision', async () => {
  const source = fixture(), destination = new Workbook(), input = source.sheets[0];
  source.addTable(input.id, { r1: 1, c1: 1, r2: 3, c2: 1 }, { name: 'DataRows' });
  source.defineName('SourceAlias', 'DataRows[]');
  destination.setInput(destination.activeSheetId, 0, 0, 'Gross');
  destination.addTable(destination.activeSheetId, { r1: 0, c1: 0, r2: 1, c2: 0 }, { name: 'DataRows' });
  const added = destination.importSheets(source), table = added[0].tables[0];
  expect(table.name).not.toBe('DataRows');
  const schema = inspectDataModel(destination.dataModel), binding = schema.bindings.connections.find(c => c.type === '102');
  expect(destination.namedEntry(binding.sourceName).ref).toBe(`${table.name}[]`);
  destination.setInput(added[0].id, 4, 1, '17');
  destination.resizeTable(added[0].id, table.id, { r1: 1, c1: 1, r2: 4, c2: 1 });
  expect(await destination.evaluateModelMeasure('Orders', 'Total')).toBe(37);
  expect(await (await nativeRoundTrip(destination)).evaluateModelMeasure('Orders', 'Total')).toBe(37);
});

it('rebases model connection IDs and names without changing existing external pivot connections', async () => {
  const source = fixture(), destination = fixture(); destination.dataModel = null;
  destination.nativePivots.connections = `<connections xmlns="${MAIN}"><connection id="007" name="Model" type="5"/><connection id="9" name="Linked" type="5"/></connections>`;
  const oldCache = destination.nativePivots.caches[0], oldXML = oldCache.xml;
  const added = destination.importSheets(source), schema = inspectDataModel(destination.dataModel);
  expect(destination.nativePivots.caches[0].xml).toBe(oldXML);
  const model = schema.bindings.connections.find(c => c.model), linked = schema.bindings.connections.find(c => c.type === '102');
  expect(Number(model.id)).not.toBe(7); expect(model.name).not.toBe('Model');
  expect(linked.name).not.toBe('Linked'); expect(schema.bindings.tables[0].connection).toBe(linked.name);
  const cache = destination.nativePivots.caches[1], root = parseModelXml(cache.xml);
  expect(root.getElementsByTagNameNS(MAIN, 'cacheSource')[0].getAttribute('connectionId')).toBe(model.id);
  expect(destination.nativePivots.tables[1].name).not.toBe('Summary');
  expect(added[1].charts[0].pivotSource.name).toContain(destination.nativePivots.tables[1].name);
  expect(await destination.evaluateModelMeasure('Orders', 'Total')).toBe(20);
  const copy = await nativeRoundTrip(destination);
  expect(inspectDataModel(copy.dataModel).bindings.connections).toHaveLength(4);
  expect(await copy.evaluateModelMeasure('Orders', 'Total')).toBe(20);
});

it('retains a model without reports instead of silently dropping it during import', async () => {
  const source = fixture(); source.nativePivots = null; source.sheets[1].charts = [];
  const destination = new Workbook(); destination.importSheets(source);
  expect(destination.nativePivots).toBeNull();
  expect(await destination.evaluateModelMeasure('Orders', 'Total')).toBe(20);
  destination.undo(); expect(destination.dataModel).toBeNull();
  destination.redo(); expect(await (await nativeRoundTrip(destination)).evaluateModelMeasure('Orders', 'Total')).toBe(20);
});

it('does not discard or replace either model when an independent-model merge is unsupported', () => {
  const source = fixture(), destination = fixture(), before = destination.toJSON(), original = source.toJSON();
  expect(() => destination.importSheets(source)).toThrow(/merging two Data Models/);
  expect(destination.toJSON()).toEqual(before); expect(source.toJSON()).toEqual(original);
});

it('rejects invalid source bindings and duplicate connection identities before any mutation', () => {
  for (const mutate of [
    w => { w.dataModel.connectionsXml = w.dataModel.connectionsXml.replace('sourceName="SourceAlias"', 'sourceName="Missing"'); },
    w => { w.dataModel.connectionsXml = w.dataModel.connectionsXml.replace('id="9"', 'id="007"'); },
  ]) {
    const source = fixture(), destination = new Workbook(); mutate(source);
    const before = destination.toJSON(), original = source.toJSON();
    expect(() => destination.importSheets(source)).toThrow();
    expect(destination.toJSON()).toEqual(before); expect(source.toJSON()).toEqual(original);
  }
});

it('imports ordinary sheets into a model workbook without changing its model or undo state', async () => {
  const destination = fixture(), model = destination.dataModel, source = new Workbook();
  destination.importSheets(source);
  expect(destination.dataModel).toBe(model); expect(await destination.evaluateModelMeasure('Orders', 'Total')).toBe(20);
  destination.undo(); expect(destination.dataModel).toBe(model);
  destination.redo(); expect(destination.dataModel).toBe(model);
});

it('imports worksheet PivotTables into an existing model workbook and preserves both graphs', async () => {
  const destination = fixture(), model = destination.dataModel, source = fixture();
  source.dataModel = null; source.nativePivots.connections = '';
  source.nativePivots.caches[0].xml = source.nativePivots.caches[0].xml.replace('<cacheSource type="external" connectionId="7"/>', '<cacheSource type="worksheet"><worksheetSource sheet="Input" ref="B2:B4"/></cacheSource>');
  const added = destination.importSheets(source);
  expect(destination.dataModel).toBe(model); expect(destination.nativePivots.tables).toHaveLength(2);
  expect(destination.nativePivots.caches[1].xml).toContain('sheet="Input (2)"');
  expect(added[1].charts[0].pivotSource.name).toContain('Summary_2');
  expect(await destination.evaluateModelMeasure('Orders', 'Total')).toBe(20);
  const copy = await nativeRoundTrip(destination);
  expect(copy.nativePivots.tables).toHaveLength(2); expect(await copy.evaluateModelMeasure('Orders', 'Total')).toBe(20);
  destination.undo(); expect(destination.nativePivots.tables).toHaveLength(1); expect(destination.dataModel).toBe(model);
  destination.redo(); expect(destination.nativePivots.tables).toHaveLength(2);
});

it('rolls back a grouped model import together with its names, connections and sheets', async () => {
  const destination = new Workbook(), source = fixture(), original = destination.toJSON();
  destination.transaction('Import and edit', () => {
    const added = destination.importSheets(source);
    destination.setInput(added[0].id, 2, 1, '27');
  });
  expect(await destination.evaluateModelMeasure('Orders', 'Total')).toBe(40);
  destination.undo(); expect(destination.toJSON()).toEqual(original);
  destination.redo(); expect(await destination.evaluateModelMeasure('Orders', 'Total')).toBe(40);
});

it('preserves deleted connection placeholders that legitimately have no numeric ID', async () => {
  const source = fixture(), destination = fixture(); destination.dataModel = null;
  destination.nativePivots.connections = `<connections xmlns="${MAIN}"><connection id="7" name="Existing"/><connection name="Model" deleted="1"/></connections>`;
  source.dataModel.connectionsXml = source.dataModel.connectionsXml.replace('</connections>', '<connection name="OldSource" deleted="true"/></connections>');
  destination.importSheets(source);
  const copy = await nativeRoundTrip(destination), schema = inspectDataModel(copy.dataModel);
  expect(schema.bindings.connections.filter(c => !c.id).map(c => c.name)).toEqual(['Model', 'OldSource']);
  expect(schema.bindings.connections.find(c => c.model).name).toBe('Model_2');
  expect(await copy.evaluateModelMeasure('Orders', 'Total')).toBe(20);
});

it('rejects ambiguous destination connection IDs without adding sheets or changing the model', () => {
  const source = fixture(), destination = fixture(); destination.dataModel = null;
  destination.nativePivots.connections = `<connections xmlns="${MAIN}"><connection id="7" name="One"/><connection id="007" name="Two"/></connections>`;
  const before = destination.toJSON();
  expect(() => destination.importSheets(source)).toThrow(/ambiguous destination connection/);
  expect(destination.toJSON()).toEqual(before);
});

it('rejects a combined connection graph above the model storage limit atomically', () => {
  const source = fixture(), destination = fixture(), description = 'x'.repeat(8 * 1024 * 1024);
  source.nativePivots = null; source.sheets[1].charts = [];
  source.dataModel.connectionsXml = source.dataModel.connectionsXml.replace('name="Model"', `name="Model" description="${description}"`);
  destination.dataModel = null;
  destination.nativePivots.connections = `<connections xmlns="${MAIN}"><connection id="7" name="Existing" description="${description}"/></connections>`;
  const sheets = destination.sheets.slice(), native = destination.nativePivots, names = destination.names;
  expect(() => destination.importSheets(source)).toThrow(/merged metadata exceeds storage limits/);
  expect(destination.sheets).toEqual(sheets); expect(destination.nativePivots).toBe(native);
  expect(destination.names).toBe(names); expect(destination.dataModel).toBeNull();
});
