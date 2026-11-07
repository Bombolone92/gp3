import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import * as X from '../src/vendor/xlsx.mjs';
function fixture(type = 'column') {
  const chart = normalizeChart({ type, anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 1, c2: 1 },
    titleRef: 'Data!C1', xTitleRef: 'Data!C2', yTitleRef: 'Data!C4',
    sourceRefs: [{ nameRef: 'Data!C3', categories: 'Data!A1:A2', values: 'Data!B1:B2' }] });
  return new Workbook({ sheets: [{ name: 'Report', charts: [chart] }, { name: 'Data', cells: {
    '0,0': { v: 'A' }, '1,0': { v: 'B' }, '0,1': { v: 3 }, '1,1': { v: 7 },
    '0,2': { v: .25, s: { fmt: 'custom', code: '0%' } },
    '1,2': { v: 12, s: { fmt: 'custom', code: '"$"0.00' } },
    '2,2': { v: 45292, s: { fmt: 'custom', code: 'yyyy-mm-dd' } },
    '3,2': { v: 1.125, s: { fmt: 'custom', code: '0.000' } },
  } }] });
}
const chart = wb => wb.activeSheet.charts[0];
const data = wb => chartData(wb, wb.activeSheetId, chart(wb));
const copied = () => { const wb = fixture(); return wb.sheetToWorkbook(wb.activeSheetId, { sourceWorkbook: '/Source.xlsx' }); };
function change(wb, values = [.5, 24, 45293]) {
  const json = wb.toJSON(), cells = json.externalWorkbooks.books[0].sheets.find(s => s.name === 'Data').cells;
  values.forEach((v, r) => { cells[`${r},2`] = v; });
  return new Workbook(json);
}
async function roundtrip(wb, { metadata = false, patch } = {}) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const read = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
  const write = (path, text) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(text));
  if (!metadata) write('/xl/workbook.xml', read('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  if (patch) write('/xl/charts/chart1_1.xml', patch(read('/xl/charts/chart1_1.xml')));
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
}
function expectFormatted(wb) {
  expect(data(wb).titles).toMatchObject({ title: '25%', xTitle: '$12.00', yTitle: '1.125' });
  expect(data(wb).series[0].name).toBe('2024-01-01');
  expect(data(wb).series[0].values).toEqual([3, 7]);
}
it('preserves known number formats through omitted-sheet copying and live supporting edits', () => {
  const wb = copied(); expectFormatted(wb);
  const changed = change(wb);
  expect(data(changed).titles).toMatchObject({ title: '50%', xTitle: '$24.00' });
  expect(data(changed).series[0].name).toBe('2024-01-02');
});
it.each(['column', 'bar', 'line', 'scatter'])('preserves linked %s text through two native-only cycles and SVG rendering', async type => {
  const source = fixture(type);
  let wb = source.sheetToWorkbook(source.activeSheetId, { sourceWorkbook: '/Source.xlsx' });
  for (let i = 0; i < 2; i++) {
    wb = await roundtrip(wb); expectFormatted(wb);
    const text = [...new JSDOM(renderChartSvg(data(wb), chart(wb), 720, 480)).window.document.querySelectorAll('text')].map(n => n.textContent).join(' ');
    expect(text).toContain('25%'); expect(text).toContain('$12.00'); expect(text).toContain('2024-01-01');
    expect(chart(wb).titleNativeText).toBeUndefined();
    expect(chart(wb).sourceRefs[0].nativeNameText).toBeUndefined();
  }
});
it('retains known formats through metadata, JSON, duplicate charts and repeated copying', async () => {
  let wb = new Workbook(copied().toJSON());
  wb.duplicateChart(wb.activeSheetId, chart(wb).id);
  expect(wb.activeSheet.charts[1].linkedText).not.toBe(chart(wb).linkedText);
  wb = await roundtrip(wb, { metadata: true });
  wb = wb.sheetToWorkbook(wb.activeSheetId, { sourceWorkbook: '/Report.xlsx' });
  const changed = change(wb);
  expect(data(changed).titles.title).toBe('50%'); expect(data(changed).series[0].name).toBe('2024-01-02');
});
it('invalidates native display strings after value edits instead of guessing absent number formats', async () => {
  const wb = await roundtrip(copied());
  expect(chart(wb).linkedText.title.format).toBeUndefined();
  const changed = change(wb);
  expect(data(changed).titles).toMatchObject({ title: '0.5', xTitle: '24' });
  expect(data(changed).series[0].name).toBe('45293');
  expect(data(await roundtrip(changed)).titles.title).toBe('0.5');
});
it.each([false, true])('invalidates saved formats and strings after source identity changes, native=%s', async native => {
  const wb = native ? await roundtrip(copied()) : copied();
  const json = wb.toJSON(); json.externalWorkbooks.books[0].target = '/Other.xlsx';
  const changed = new Workbook(json);
  expect(data(changed).titles.title).toBe('0.25'); expect(data(changed).series[0].name).toBe('45292');
});
it('does not move formats to different source cells, even when values match', () => {
  const wb = copied(), json = wb.toJSON();
  const cells = json.externalWorkbooks.books[0].sheets[0].cells;
  cells['0,3'] = .25;
  json.sheets[0].charts[0].titleRef = "'[1]Data'!D1";
  expect(data(new Workbook(json)).titles.title).toBe('0.25');
});
it('keeps local styles authoritative and follows edits and broken references', async () => {
  const wb = await roundtrip(fixture(), { patch: xml => xml.replace('<c:v>25%</c:v>', '<c:v>Wrong</c:v>') });
  expectFormatted(wb);
  const id = wb.sheetByName('Data').id;
  wb.applyStyle(id, { r1: 0, c1: 2, r2: 0, c2: 2 }, { fmt: 'custom', code: '0.000' });
  expect(data(wb).titles.title).toBe('0.250');
  chart(wb).titleRef = 'Missing!C1';
  expect(data(wb).titles.title).toBe('#REF!');
});
it('does not apply numeric formats or native text to string or blank values', async () => {
  const wb = await roundtrip(copied());
  const changed = change(wb, ['New title', null, 'New series']);
  expect(data(changed).titles).toMatchObject({ title: 'New title', xTitle: '' });
  expect(data(changed).series[0].name).toBe('New series');
});
it('does not manufacture empty cached text when the native cache is missing or has no point zero', async () => {
  for (const replacement of ['', '<c:ptCount val="2"/><c:pt idx="1"><c:v>Wrong</c:v></c:pt>']) {
    const wb = await roundtrip(copied(), { patch: xml => xml.replace(/<c:strCache>[\s\S]*?<\/c:strCache>/g, `<c:strCache>${replacement}</c:strCache>`) });
    expect(data(wb).titles.title).toBe('0.25'); expect(data(wb).series[0].name).toBe('45292');
  }
});
it('rebases valid relative sources during copying and never renews stale cache text', async () => {
  const json = copied().toJSON();
  json.externalWorkbooks.books[0].target = '../Source.xlsx';
  for (const entry of Object.values(json.sheets[0].charts[0].linkedText)) {
    const identity = JSON.parse(entry.source); identity[0] = '../Source.xlsx'; entry.source = JSON.stringify(identity);
  }
  const wb = await roundtrip(new Workbook(json));
  const copy = wb.sheetToWorkbook(wb.activeSheetId, { sourceWorkbook: 'https://example.com/reports/Report.xlsx' });
  expectFormatted(copy);
  expect(JSON.parse(chart(copy).linkedText.title.source)[0]).toBe('https://example.com/Source.xlsx');
  const stale = change(wb), next = stale.sheetToWorkbook(stale.activeSheetId, { sourceWorkbook: '/Report.xlsx' });
  expect(data(next).titles.title).toBe('0.5');
});
it('normalizes bounded, isolated metadata and rejects malformed entries', () => {
  const wb = fixture(), raw = chart(wb);
  raw.linkedText = { title: { source: 's', format: 'x'.repeat(8193) }, xTitle: { source: 's', value: Infinity, text: 'bad' },
    yTitle: { source: 's', value: 1, text: 'x'.repeat(40000) }, y2Title: { source: 's'.repeat(65537), format: '0%' },
    'name:59': { source: 's', format: '0%' }, 'name:60': { source: 's', format: '0%' }, bogus: { source: 's', format: '0%' } };
  const normalized = normalizeChart(raw);
  expect(Object.keys(normalized.linkedText)).toEqual(['yTitle', 'name:59']);
  expect(normalized.linkedText.yTitle.text).toHaveLength(32767);
  expect(normalized.linkedText['name:59']).not.toBe(raw.linkedText['name:59']);
});
it('preserves linked titles on range-authored charts without sourceRefs', () => {
  const wb = fixture(); delete chart(wb).sourceRefs;
  const copy = wb.sheetToWorkbook(wb.activeSheetId, { sourceWorkbook: '/Source.xlsx' });
  expect(data(copy).titles.title).toBe('25%');
});

it.each(['pie', 'donut'])('preserves native %s title and series text', async type => {
  const source = fixture(type), wb = await roundtrip(source.sheetToWorkbook(source.activeSheetId, { sourceWorkbook: '/Source.xlsx' }));
  expect(data(wb).titles.title).toBe('25%');
  expect(data(wb).series[0].name).toBe('2024-01-01');
});
it('supports named and hidden title sources, secondary titles and General formats', async () => {
  const wb = fixture();
  wb.names.push({ name: 'Heading', ref: 'Data!C1' });
  chart(wb).titleRef = 'Heading';
  chart(wb).y2TitleRef = 'Data!B1';
  wb.setHidden(wb.sheetByName('Data').id, 'row', [0], true);
  const copy = wb.sheetToWorkbook(wb.activeSheetId, { sourceWorkbook: '/Source.xlsx' });
  expect(data(copy).titles).toMatchObject({ title: '25%', y2Title: '3' });
  expect(data(await roundtrip(copy)).titles.title).toBe('25%');
});
it('leaves unresolved or deleted title references broken after copy and native reopening', async () => {
  const wb = copied(); chart(wb).titleRef = "'[1]Missing'!C1";
  const copy = wb.sheetToWorkbook(wb.activeSheetId, { sourceWorkbook: '/Report.xlsx' });
  expect(data(copy).titles.title).toBe('#REF!');
  expect(data(await roundtrip(copy)).titles.title).toBe('#REF!');
});
it('preserves explicit empty native title text without treating a missing cache as empty', async () => {
  const wb = await roundtrip(copied(), { patch: xml => xml.replace('<c:v>25%</c:v>', '<c:v></c:v>') });
  expect(data(wb).titles.title).toBe('');
});

it('recognizes point zero with valid unsigned-integer lexical forms', async () => {
  for (const index of ['00', '+0', ' 000 ']) {
    const wb = await roundtrip(copied(), { patch: xml => xml.replaceAll('idx="0"', `idx="${index}"`) });
    expectFormatted(wb);
  }
});
