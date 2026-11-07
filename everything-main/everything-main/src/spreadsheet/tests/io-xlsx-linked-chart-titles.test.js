import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { chartData, chartTitles, normalizeChart } from '../src/core/charts.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { chartXlsx } from './helpers/xlsx-chart-fixture.js';

function linkedFixture() {
  const zip = X.CFB.read(new Uint8Array(chartXlsx()), { type: 'array' });
  const file = X.CFB.find(zip, '/xl/charts/run.xml');
  const title = ref => `<c:title><c:tx><c:strRef><c:f>${ref}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Stale cache</c:v></c:pt></c:strCache></c:strRef></c:tx><c:txPr><a:p><a:pPr><a:defRPr sz="1800" b="1"/></a:pPr></a:p></c:txPr></c:title>`;
  file.content = new TextEncoder().encode(new TextDecoder().decode(file.content)
    .replace(/<c:title>[\s\S]*?<\/c:title>/, title('[0]!Data!$D$2:$E$2'))
    .replace('<c:dateAx>', `<c:dateAx>${title('Data!$D$3')}`)
    .replace('<c:valAx>', `<c:valAx>${title('Data!$D$4')}`));
  file.size = file.content.length;
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

async function setup() {
  const wb = await workbookFromFile(linkedFixture(), 'linked.xlsx');
  const data = wb.sheets[0], sheet = wb.sheets[1];
  wb.setInput(data.id, 1, 3, 'Live & current');
  wb.setInput(data.id, 2, 3, 'Dates');
  wb.setInput(data.id, 3, 3, '=2+3');
  return { wb, data, sheet, chart: () => wb.sheet(sheet.id).charts[0] };
}

it('resolves chart and axis titles from current cells, including merged-range references, formulas, blanks and hidden cells', async () => {
  const { wb, data, sheet, chart } = await setup();
  expect(chart()).toMatchObject({ titleRef: 'Data!$D$2:$E$2', xTitleRef: 'Data!$D$3', yTitleRef: 'Data!$D$4', appearance: { titleStyle: { size: 24, bold: true } } });
  wb.setHidden(data.id, 'row', [1], true);
  expect(chartTitles(wb, sheet.id, chart())).toEqual({ title: 'Live & current', xTitle: 'Dates', yTitle: '5' });
  let svg = renderChartSvg(chartData(wb, sheet.id, chart()), chart(), 800, 500);
  expect(svg).toContain('Live &amp; current');
  expect(svg).toContain('>Dates</text>');
  expect(svg).not.toContain('Stale cache');
  wb.setInput(data.id, 1, 3, '');
  expect(chartTitles(wb, sheet.id, chart()).title).toBe('');
  wb.undo();
  expect(chartTitles(wb, sheet.id, chart()).title).toBe('Live & current');
});

it('follows structural edits, duplicated charts, JSON and undo without reviving deleted sources', async () => {
  const { wb, data, sheet, chart } = await setup();
  wb.renameSheet(data.id, "O'Brien data");
  wb.insertRows(data.id, 0, 3);
  expect(chart().titleRef).toBe("'O''Brien data'!$D$5:$E$5");
  const copy = wb.duplicateChart(sheet.id, chart().id);
  expect(chartTitles(wb, sheet.id, wb.chartById(sheet.id, copy)).title).toBe('Live & current');
  const back = new Workbook(wb.toJSON());
  expect(chartTitles(back, sheet.id, back.sheet(sheet.id).charts[0]).title).toBe('Live & current');
  wb.deleteSheet(data.id);
  expect(chartTitles(wb, sheet.id, chart()).title).toBe('#REF!');
  wb.addSheet("O'Brien data");
  expect(chartTitles(wb, sheet.id, chart()).title).toBe('#REF!');
  wb.undo(); wb.undo();
  expect(chartTitles(wb, sheet.id, chart()).title).toBe('Live & current');
});

it('exports native live title references with fresh caches and formatting, independently of app metadata', async () => {
  const { wb, data, sheet, chart } = await setup();
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' });
  const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/charts/chart2_1.xml').content);
  expect(xml).toContain('<c:f>Data!$D$2:$E$2</c:f>');
  expect(xml).toContain('<c:v>Live &amp; current</c:v>');
  expect(xml).toContain('<c:f>Data!$D$3</c:f>');
  expect(xml).toContain('<c:f>Data!$D$4</c:f>');
  expect(xml).toContain('sz="1800" b="1"');
  const book = X.CFB.find(zip, '/xl/workbook.xml');
  book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  book.size = book.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect(back.sheets[1].charts[0]).toMatchObject({ titleRef: chart().titleRef, xTitleRef: chart().xTitleRef, yTitleRef: chart().yTitleRef });
  back.setInput(back.sheets[0].id, 1, 3, 'Edited after export');
  expect(chartTitles(back, back.sheets[1].id, back.sheets[1].charts[0]).title).toBe('Edited after export');
});

it.each(['column', 'pie', 'scatter'])('renders linked titles for range-authored %s charts and never falls back to stale text', type => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Heading'); wb.setInput(id, 1, 0, '5'); wb.setInput(id, 1, 1, '6');
  const chart = normalizeChart({ type, range: { r1: 0, c1: 0, r2: 1, c2: 1 }, anchor: { r: 4, c: 0 }, title: 'Stale', titleRef: 'A1' });
  expect(renderChartSvg(chartData(wb, id, chart), chart, 600, 400)).toContain('Heading');
  chart.titleRef = 'Missing!A1';
  expect(renderChartSvg(chartData(wb, id, chart), chart, 600, 400)).toContain('#REF!');
  expect(normalizeChart({ ...chart, titleRef: {}, xTitleRef: '', yTitleRef: 'X'.repeat(9000) })).toMatchObject({ yTitleRef: 'X'.repeat(8192) });
});
