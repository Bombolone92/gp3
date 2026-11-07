import { expect, it } from 'vitest';
import { inspectDataModel } from '../src/core/xlsx-data-model.js';
import { linkedModelSource } from '../src/core/data-model-source.js';
import { chartData } from '../src/core/charts.js';
import { fixture, nativeRoundTrip } from './helpers/linked-model-workbook.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
it('copies the model, linked headers, measure and pivot graph without mutating the source', async () => {
  const original = fixture(), before = JSON.stringify(original.toJSON());
  let copy = original.sheetToWorkbook(original.sheets[1].id, { sourceWorkbook: '/Input.xlsx' });
  expect(JSON.stringify(original.toJSON())).toBe(before);
  for (let pass = 0; pass < 3; pass++) {
    expect(copy.sheets).toHaveLength(1); expect(copy.nativePivots.tables).toHaveLength(1);
    expect(copy.dataModel.archive).toBe(original.dataModel.archive);
    expect(await copy.evaluateModelMeasure('Orders', 'Total')).toBe(20);
    const schema = inspectDataModel(copy.dataModel), source = linkedModelSource(copy, schema, schema.tables[0]);
    expect(source.headers).toEqual(['Gross']); expect(source.r1).toBe(2); expect(source.r2).toBe(3);
    expect(source.sheet.externalCache).toBe(true);
    const alias = schema.bindings.connections.find(c => c.type === '102').sourceName;
    expect(alias).not.toBe('_ModelSource1');
    expect(copy.namedEntry(alias).ref).toBe("'[1]Input'!$B$2:$B$4");
    expect(chartData(copy, copy.sheets[0].id, copy.sheets[0].charts[0]).series[0].values).toEqual([20]);
    if (pass < 2) copy = await nativeRoundTrip(copy);
  }
});
it('keeps local source names live when copying their own sheet', async () => {
  const original = fixture(), copy = original.sheetToWorkbook(original.sheets[0].id);
  expect(copy.namedEntry('SourceAlias').ref).toBe('Input!$B$2:$B$4');
  expect(copy.externalWorkbooks).toBeNull();
  copy.setInput(copy.sheets[0].id, 2, 1, '19');
  expect(await copy.evaluateModelMeasure('Orders', 'Total')).toBe(32);
  expect(await original.evaluateModelMeasure('Orders', 'Total')).toBe(20);
});
it('includes table headers but excludes totals without changing a shared source name', async () => {
  const wb = fixture(), input = wb.sheets[0], report = wb.sheets[1];
  wb.addTable(input.id, { r1: 1, c1: 1, r2: 4, c2: 1 }, { name: 'OrdersSource' });
  input.tables[0].totalsRow = true; wb.setInput(input.id, 4, 1, '999');
  wb.defineName('SourceAlias', 'OrdersSource[]'); wb.setInput(report.id, 0, 0, '=SUM(SourceAlias)');
  const copy = wb.sheetToWorkbook(report.id, { sourceWorkbook: '/Input.xlsx' });
  expect(copy.getValue(copy.sheets[0].id, 0, 0)).toBe(20);
  expect(copy.namedEntry('SourceAlias').ref).toBe("'[1]Input'!$B$3:$B$4");
  expect(await copy.evaluateModelMeasure('Orders', 'Total')).toBe(20);
});
it('requires the omitted source location and rejects malformed bindings atomically', () => {
  const wb = fixture(), before = JSON.stringify(wb.toJSON());
  expect(() => wb.sheetToWorkbook(wb.sheets[1].id)).toThrow(/Save the source/);
  expect(JSON.stringify(wb.toJSON())).toBe(before);
  wb.dataModel.connectionsXml = wb.dataModel.connectionsXml.replace('sourceName="SourceAlias"', 'sourceName="Missing"');
  expect(() => wb.sheetToWorkbook(wb.sheets[1].id, { sourceWorkbook: '/Input.xlsx' })).toThrow(/source reference/);
});
it('retains already external sources across another sheet extraction', async () => {
  const wb = fixture(), first = wb.sheetToWorkbook(wb.sheets[1].id, { sourceWorkbook: '/Input.xlsx' });
  const second = first.sheetToWorkbook(first.sheets[0].id, { sourceWorkbook: '/Report.xlsx' });
  expect(second.externalWorkbooks.books).toHaveLength(1);
  expect(second.externalWorkbooks.books[0].target).toBe('/Input.xlsx');
  expect(await second.evaluateModelMeasure('Orders', 'Total')).toBe(20);
});
it('retains an empty linked range as a header-only external range', async () => {
  const wb = fixture();
  wb.defineName('SourceAlias', 'Input!$B$2');
  const copy = wb.sheetToWorkbook(wb.sheets[1].id, { sourceWorkbook: '/Input.xlsx' });
  const schema = inspectDataModel(copy.dataModel), source = linkedModelSource(copy, schema, schema.tables[0]);
  expect(source.headers).toEqual(['Gross']); expect(source.r2).toBeLessThan(source.r1);
});
it('does not treat another external pivot connection as the workbook model', () => {
  const wb = fixture();
  wb.nativePivots.caches[0].xml = wb.nativePivots.caches[0].xml.replace('connectionId="7"', 'connectionId="88"');
  expect(() => wb.sheetToWorkbook(wb.sheets[1].id, { sourceWorkbook: '/Input.xlsx' })).toThrow(/external connection/);
});
it('rejects ambiguous connection names without mutating the workbook', () => {
  const wb = fixture();
  wb.dataModel.connectionsXml = wb.dataModel.connectionsXml.replace('</connections>', `<connection name="Linked" type="102"/></connections>`);
  const before = JSON.stringify(wb.toJSON());
  expect(() => wb.sheetToWorkbook(wb.sheets[1].id, { sourceWorkbook: '/Input.xlsx' })).toThrow(/ambiguous model connection/);
  expect(JSON.stringify(wb.toJSON())).toBe(before);
});

it('rejects duplicate numeric connection identities rather than attaching to the wrong model', () => {
  const wb = fixture();
  wb.dataModel.connectionsXml = wb.dataModel.connectionsXml.replace('id="9" name="Linked"', 'id="007" name="Linked"');
  expect(() => wb.sheetToWorkbook(wb.sheets[1].id, { sourceWorkbook: '/Input.xlsx' })).toThrow(/ambiguous model connection ID/);
});

it('matches equivalent unsigned-integer connection IDs by value', () => {
  const wb = fixture();
  wb.dataModel.connectionsXml = wb.dataModel.connectionsXml.replace('id="7" name="Model"', 'id="007" name="Model"');
  const copy = wb.sheetToWorkbook(wb.sheets[1].id, { sourceWorkbook: '/Input.xlsx' });
  expect(copy.nativePivots.tables).toHaveLength(1);
  expect(copy.dataModel.archive).toBe(wb.dataModel.archive);
});
