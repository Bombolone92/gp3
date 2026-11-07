import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { chartData } from '../src/core/charts.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';
import { chartXlsx } from './helpers/xlsx-chart-fixture.js';

const read = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path)?.content);
function patch(zip, path, transform) {
  const part = X.CFB.find(zip, path); part.content = new TextEncoder().encode(transform(read(zip, path))); part.size = part.content.length;
}
function fixture(fit = true) {
  const zip = X.CFB.read(new Uint8Array(chartXlsx()), { type: 'array' });
  patch(zip, '/xl/chartsheets/run.xml', xml => xml.replace('<drawing', `<sheetViews><sheetView workbookViewId="0" zoomScale="175" zoomToFit="${Number(fit)}"/></sheetViews><pageMargins left="0.2" right="0.3" top="0.4" bottom="0.5" header="0.1" footer="0.1"/><pageSetup orientation="landscape" paperSize="9"/><drawing`));
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
async function native(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  patch(zip, '/xl/workbook.xml', xml => xml.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return { zip, back: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx') };
}

it.each([true, false])('preserves native chartsheet identity, fit=%s, page setup and live data without metadata', async fit => {
  let wb = await workbookFromFile(fixture(fit), 'external.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.sheets[1];
    expect(sheet).toMatchObject({ kind: 'chart', zoomToFit: fit, viewZoom: 1.75, color: '#ffddaf' });
    expect(sheet.cells.size).toBe(0); // chart caches are not worksheet cells
    expect(sheet.printSettings).toMatchObject({ orientation: 'landscape', paperSize: 9, margins: { left: .2, right: .3 } });
    const { zip, back } = await native(wb);
    const xml = read(zip, '/xl/chartsheets/sheet2.xml');
    expect(xml).toContain('<chartsheet');
    expect(xml).toContain(`zoomToFit="${Number(fit)}"`);
    expect(xml).not.toMatch(/sheetData|sheetFormatPr|printOptions|fitToWidth|<dimension/);
    expect(read(zip, '/xl/_rels/workbook.xml.rels')).toMatch(/Type="[^"]*\/chartsheet" Target="chartsheets\/sheet2.xml"/);
    expect(read(zip, '/[Content_Types].xml')).toContain('spreadsheetml.chartsheet+xml');
    expect(X.CFB.find(zip, '/xl/worksheets/sheet2.xml')).toBeNull();
    expect(read(zip, '/xl/drawings/drawing2.xml')).toContain('<xdr:absoluteAnchor>');
    wb = back;
  }
  wb.setInput(wb.sheets[0].id, 0, 1, '12.5');
  expect(chartData(wb, wb.sheets[1].id, wb.sheets[1].charts[0]).series[0].values[0]).toBe(12.5);
});

it('keeps chart-only sheet identity through drafts, sheet copies, order changes and ODS app settings', async () => {
  const wb = await workbookFromFile(fixture(), 'chart.xlsx');
  const chart = wb.sheets[1], copy = wb.duplicateSheet(chart.id);
  expect(copy.kind).toBe('chart'); expect(copy.charts[0].id).not.toBe(chart.charts[0].id);
  wb.moveSheet(copy.id, 0); wb.renameSheet(copy.id, 'Overview'); wb.setSheetHidden(chart.id, true);
  const restored = new Workbook(wb.toJSON());
  expect(restored.sheets.map(s => s.kind)).toEqual(['chart', undefined, 'chart']);
  expect((await native(restored)).back.sheets.map(s => [s.name, s.kind, s.hidden])).toEqual(restored.sheets.map(s => [s.name, s.kind, s.hidden]));
  const ods = await workbookFromFile(new Uint8Array(await (await workbookToOds(restored)).arrayBuffer()), 'charts.ods');
  expect(ods.sheets[0]).toMatchObject({ kind: 'chart', zoomToFit: true });
});

it('refuses cell mutations while keeping chart editing and undo available', async () => {
  const wb = await workbookFromFile(fixture(), 'chart.xlsx'), sheet = wb.sheets[1], id = sheet.id;
  wb.setInput(id, 0, 0, '5');
  expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: 12 } }])).toBe(0);
  wb.pasteCells(id, [[{ v: 8 }]], 0, 0);
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 2, c2: 2 }, { bold: true });
  wb.setColWidth(id, 0, 234); wb.setRowHeight(id, 0, 57);
  expect(sheet.cells.size).toBe(0); expect(sheet.colWidths.size).toBe(0); expect(sheet.rowHeights.size).toBe(0);
  expect(wb.canUndo()).toBe(false);
  wb.updateChart(id, sheet.charts[0].id, { title: 'Changed title' });
  expect(sheet.charts[0].title).toBe('Changed title');
  wb.undo(); expect(sheet.charts[0].title).not.toBe('Changed title');
});

it('exports a valid empty drawing relationship for a chart sheet with no objects', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Chart', kind: 'chart', charts: [] }, { name: 'Data' }] });
  const { zip, back } = await native(wb);
  expect(read(zip, '/xl/chartsheets/sheet1.xml')).toContain('<drawing r:id="puterDrawing"/>');
  expect(read(zip, '/xl/drawings/drawing1.xml')).toContain('<xdr:wsDr');
  expect(back.sheets[0].kind).toBe('chart'); expect(back.sheets[0].charts).toHaveLength(0);
});

it('excludes chart sheets from cell calculations but counts them in SHEET and SHEETS', () => {
  const wb = new Workbook({ sheets: [{ name: 'First', cells: { '0,0': { v: 5 } } }, { name: 'Plot', kind: 'chart' },
    { name: 'Last', cells: { '0,0': { v: 7 } } }] }), id = wb.sheets[0].id;
  const formulas = ['=SUM(First:Last!A1)', '=SHEETS(First:Last!A1)', '=SHEETS()', '=SHEET("Plot")', '=Plot!A1', '=SUM(Plot!A1:A2)', '=INDIRECT("Plot!A1")'];
  formulas.forEach((f, i) => wb.setInput(id, i, 2, f));
  expect(formulas.map((_, i) => wb.getValue(id, i, 2))).toEqual([12, 3, 3, 2, { error: '#REF!' }, { error: '#REF!' }, { error: '#REF!' }]);
});

it('uses the chart-sheet landscape default without changing an explicit portrait setting', async () => {
  const base = X.CFB.read(new Uint8Array(fixture()), { type: 'array' });
  patch(base, '/xl/chartsheets/run.xml', xml => xml.replace(/<pageSetup\b[^>]*\/>/, ''));
  const wb = await workbookFromFile(X.CFB.write(base, { type: 'array', fileType: 'zip' }), 'default.xlsx');
  expect(wb.sheets[1].printSettings.orientation).toBe('landscape');
  expect((await native(wb)).back.sheets[1].printSettings.orientation).toBe('landscape');
  wb.setPrintSettings(wb.sheets[1].id, { ...wb.sheets[1].printSettings, orientation: 'portrait' });
  expect((await native(wb)).back.sheets[1].printSettings.orientation).toBe('portrait');
});

it('accepts alternate chart prefixes and drawings containing only shapes without inventing cells', async () => {
  const zip = X.CFB.read(new Uint8Array(fixture()), { type: 'array' });
  patch(zip, '/xl/drawings/run.xml', xml => xml.replaceAll('xmlns:c=', 'xmlns:plot=').replaceAll('<c:chart', '<plot:chart'));
  const wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'prefix.xlsx');
  expect(wb.sheets[1].charts).toHaveLength(1);
  const onlyShape = new Workbook({ sheets: [{ name: 'Canvas', kind: 'chart', charts: [{ type: 'text', text: 'Annotation', anchor: { r: 0, c: 0 }, w: 120, h: 40 }] }] });
  const back = (await native(onlyShape)).back;
  expect(back.sheets[0].kind).toBe('chart'); expect(back.sheets[0].cells.size).toBe(0);
  // Rich DrawingML text uses the existing vector representation, retaining
  // its native shape for editable Excel export, rather than becoming cells.
  expect(JSON.stringify(back.sheets[0].charts[0].nativeDrawing)).toContain('Annotation');
  expect(atob(back.sheets[0].charts[0].src.split(',')[1])).toContain('Annotation');
});

it('saves explicit view changes without adding cell undo steps', async () => {
  const wb = await workbookFromFile(fixture(), 'view.xlsx'), id = wb.sheets[1].id;
  wb.setSheetView(id, { zoomToFit: false, viewZoom: .25 });
  expect(wb.dirty).toBe(true); expect(wb.canUndo()).toBe(false);
  expect((await native(wb)).back.sheets[1]).toMatchObject({ zoomToFit: false, viewZoom: .25 });
});

it('does not recalculate formulas when only chart-sheet zoom changes', () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { f: 'RAND()' } } }, { name: 'Chart', kind: 'chart' }] });
  const before = wb.getValue(wb.sheets[0].id, 0, 0);
  wb.setSheetView(wb.sheets[1].id, { zoomToFit: true });
  expect(wb.getValue(wb.sheets[0].id, 0, 0)).toBe(before);
});

it('reads native chart protection and writes the chart-sheet protection vocabulary', async () => {
  const zip = X.CFB.read(new Uint8Array(fixture()), { type: 'array' });
  patch(zip, '/xl/chartsheets/run.xml', xml => xml.replace('<pageMargins', '<sheetProtection content="1" objects="1"/><pageMargins'));
  const wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'protected.xlsx');
  expect(wb.sheets[1].protected).toBe(true);
  const result = await native(wb);
  expect(result.back.sheets[1].protected).toBe(true);
  expect(read(result.zip, '/xl/chartsheets/sheet2.xml')).toContain('<sheetProtection content="1" objects="1"/>');
});
