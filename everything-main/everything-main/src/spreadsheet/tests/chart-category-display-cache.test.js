import { JSDOM } from 'jsdom';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { normalizeChart, chartData } from '../src/core/charts.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
function fixture(type = 'column') {
  const chart = normalizeChart({ type, anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 2, c2: 1 },
    sourceRefs: [{ categories: 'Data!A1:A3', values: 'Data!B1:B3' }] });
  return new Workbook({ sheets: [{ name: 'Report', charts: [chart] }, { name: 'Data', cells: {
    '0,0': { v: .25, s: { fmt: 'custom', code: '0%' } }, '1,0': { v: 'East' },
    '2,0': { v: 12, s: { fmt: 'custom', code: '"$"0.00' } },
    '0,1': { v: 4 }, '1,1': { v: 7 }, '2,1': { v: 9 },
  } }] });
}
const data = wb => chartData(wb, wb.activeSheetId, wb.activeSheet.charts[0]);
async function roundtrip(wb, { native = true, patch } = {}) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const get = p => new TextDecoder().decode(X.CFB.find(zip, p).content);
  const put = (p, text) => X.CFB.utils.cfb_add(zip, p, new TextEncoder().encode(text));
  if (native) put('/xl/workbook.xml', get('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  if (patch) put('/xl/charts/chart1_1.xml', patch(get('/xl/charts/chart1_1.xml')));
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
}
async function imported(type) {
  const original = fixture(type);
  return roundtrip(original.sheetToWorkbook(original.activeSheetId, { sourceWorkbook: '/Source.xlsx' }));
}
it.each(['column', 'pie', 'donut'])('retains mixed-category native display strings through two %s round trips', async type => {
  let wb = await imported(type);
  for (let i = 0; i < 2; i++) {
    expect(data(wb).categories).toEqual(['25%', 'East', '$12.00']);
    const rendered = [...new JSDOM(renderChartSvg(data(wb), wb.activeSheet.charts[0], 640, 420)).window.document.querySelectorAll('text')].map(node => node.textContent).join(' ');
    expect(rendered).toContain('25%');
    expect(rendered).toContain('$12.00');
    expect(data(wb).series[0].values).toEqual([4, 7, 9]);
    expect(wb.activeSheet.charts[0].sourceRefs[0].nativeCategoryTexts).toBeUndefined();
    wb = await roundtrip(wb);
  }
});
it('invalidates only the changed numeric value without changing the underlying source data', async () => {
  const wb = await imported(), json = wb.toJSON();
  const cells = json.externalWorkbooks.books[0].sheets.find(s => s.name === 'Data').cells;
  expect(cells['0,0']).toBe(.25);
  cells['0,0'] = .5;
  const changed = new Workbook(json);
  expect(data(changed).categories).toEqual(['0.5', 'East', '$12.00']);
  expect(data(await roundtrip(changed)).categories).toEqual(['0.5', 'East', '$12.00']);
});
it('does not use saved display text after supporting workbook identity changes', async () => {
  const json = (await imported()).toJSON();
  json.externalWorkbooks.books[0].target = '/Different.xlsx';
  expect(data(new Workbook(json)).categories).toEqual(['0.25', 'East', '12']);
});
it('does not move display strings to other cells with the same numeric values', async () => {
  const json = (await imported()).toJSON();
  const cells = json.externalWorkbooks.books[0].sheets.find(s => s.name === 'Data').cells;
  for (let r = 0; r < 3; r++) cells[`${r},2`] = cells[`${r},0`];
  json.sheets[0].charts[0].sourceRefs[0].categories = "'[1]Data'!C1:C3";
  expect(data(new Workbook(json)).categories).toEqual(['0.25', 'East', '12']);
});
it('never substitutes cached labels for a broken reference', async () => {
  const wb = await imported();
  wb.activeSheet.charts[0].sourceRefs[0].categories = "'[1]Missing'!A1:A3";
  expect(data(wb).categories).toEqual(['1', '2', '3']);
});
it('ignores cached display strings when live local worksheet formatting is available', async () => {
  const wb = await roundtrip(fixture(), { patch: xml => xml.replace('<c:v>25%</c:v>', '<c:v>STALE</c:v>') });
  expect(data(wb).categories).toEqual(['25%', 'East', '$12.00']);
  wb.applyStyle(wb.sheetByName('Data').id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '0.00' });
  expect(data(wb).categories[0]).toBe('0.25');
});
it('preserves bound labels through JSON, chart duplication, sheet copy and sidecar reconciliation', async () => {
  const wb = await imported();
  wb.duplicateChart(wb.activeSheetId, wb.activeSheet.charts[0].id);
  const restored = new Workbook(wb.toJSON());
  const [a, b] = restored.activeSheet.charts;
  expect(a.sourceRefs[0].categoryDisplayCache).not.toBe(b.sourceRefs[0].categoryDisplayCache);
  expect(a.sourceRefs[0].categoryDisplayCache[0]).not.toBe(b.sourceRefs[0].categoryDisplayCache[0]);
  const copy = restored.sheetToWorkbook(restored.activeSheetId, { sourceWorkbook: '/Report.xlsx' });
  expect(data(copy).categories).toEqual(['25%', 'East', '$12.00']);
  expect(data(await roundtrip(copy, { native: false })).categories).toEqual(['25%', 'East', '$12.00']);
});
it('validates bounded saved label metadata without binding it to new values on JSON load', async () => {
  const json = (await imported()).toJSON(), source = json.sheets[0].charts[0].sourceRefs[0];
  source.categoryDisplayCache[0].value = .75;
  source.categoryDisplayCache[2] = { value: Infinity, text: 'invalid', source: '' };
  const wb = new Workbook(json);
  expect(data(wb).categories).toEqual(['0.25', 'East', '12']);
  source.categoryDisplayCache = Array(5001).fill({ value: 1, text: 'a', source: 'x' });
  expect(new Workbook(json).activeSheet.charts[0].sourceRefs[0].categoryDisplayCache).toHaveLength(5000);
});
it('keeps sparse native string-cache indexes and last duplicate precedence', async () => {
  const original = fixture(), copy = original.sheetToWorkbook(original.activeSheetId, { sourceWorkbook: '/Source.xlsx' });
  const wb = await roundtrip(copy, { patch: xml => xml.replace(/(<c:cat>[\s\S]*?<c:strCache>)[\s\S]*?(<\/c:strCache>)/,
    '$1<c:ptCount val="3"/><c:pt idx="2"><c:v>old</c:v></c:pt><c:pt idx="2"><c:v>twelve dollars</c:v></c:pt><c:pt idx="5000"><c:v>ignored</c:v></c:pt>$2') });
  expect(data(wb).categories).toEqual(['0.25', 'East', 'twelve dollars']);
  expect(wb.activeSheet.charts[0].sourceRefs[0].categoryDisplayCache).toHaveLength(3);
});
it('does not treat numeric-looking text as the saved numeric source value', async () => {
  const json = (await imported()).toJSON();
  json.externalWorkbooks.books[0].sheets.find(s => s.name === 'Data').cells['0,0'] = '0.25';
  expect(data(new Workbook(json)).categories).toEqual(['0.25', 'East', '$12.00']);
});

it('preserves explicit unlinked axis formats over source display strings', async () => {
  const wb = await imported();
  wb.activeSheet.charts[0].appearance.xSourceLinked = false;
  wb.activeSheet.charts[0].appearance.xFormat = '"Value "0.00';
  const reopened = await roundtrip(wb), chart = reopened.activeSheet.charts[0];
  const rendered = [...new JSDOM(renderChartSvg(data(reopened), chart, 640, 420)).window.document.querySelectorAll('text')].map(node => node.textContent).join(' ');
  expect(rendered).toContain('Value 0.25');
  expect(rendered).not.toContain('25%');
});

it('rebases valid label source identities during relative-link sheet copy without rebinding stale values', async () => {
  const original = fixture();
  const wb = await roundtrip(original.sheetToWorkbook(original.activeSheetId, { sourceWorkbook: '../Source.xlsx' }));
  const copied = wb.sheetToWorkbook(wb.activeSheetId, { sourceWorkbook: 'https://example.com/reports/Report.xlsx' });
  expect(copied.externalWorkbooks.books[0].target).toBe('https://example.com/Source.xlsx');
  expect(data(copied).categories).toEqual(['25%', 'East', '$12.00']);
  expect(data(await roundtrip(copied)).categories).toEqual(['25%', 'East', '$12.00']);
  const changed = wb.toJSON();
  changed.externalWorkbooks.books[0].sheets.find(s => s.name === 'Data').cells['0,0'] = .5;
  const stale = new Workbook(changed);
  const staleCopy = stale.sheetToWorkbook(stale.activeSheetId, { sourceWorkbook: 'https://example.com/reports/Report.xlsx' });
  expect(data(staleCopy).categories).toEqual(['0.5', 'East', '$12.00']);
});
