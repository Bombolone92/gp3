import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { pieXlsx } from './helpers/xlsx-pie-fixture.js';

const points = (kind, data, count = data.length) => `<c:${kind}><c:formatCode>0.00</c:formatCode><c:ptCount val="${count}"/>${data.map(([i, v]) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:${kind}>`;
const literalValues = points('numLit', [[3, 7.5], [0, 2.5]], 5);
const literalCategories = points('strLit', [[3, 'South'], [0, 'North'], [1, 'Missing']], 5).replace('<c:formatCode>0.00</c:formatCode>', '');
const fixture = (type, categories = literalCategories, values = literalValues) => pieXlsx({ type, editChart: xml => xml
  .replace(/<c:cat>.*?<\/c:cat>/s, categories == null ? '' : `<c:cat>${categories}</c:cat>`)
  .replace(/<c:val>.*?<\/c:val>/s, `<c:val>${values}</c:val>`) });
const nativeOnly = async wb => {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  expect(X.CFB.find(zip, '/xl/charts/chart1_1.xml')).toBeTruthy();
  const chartXml = new TextDecoder().decode(X.CFB.find(zip, '/xl/charts/chart1_1.xml').content);
  if (wb.sheets[0].charts[0].type === 'donut') expect(chartXml).not.toContain('<c:dLblPos');
  expect(chartXml).toContain('<c:showLegendKey val="0"');
  const book = X.CFB.find(zip, '/xl/workbook.xml');
  book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  book.size = book.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
};

it.each(['pieChart', 'doughnutChart'])('retains signed %s data through native round trips and chart duplication', async type => {
  const values = points('numLit', [[0, -2.5], [1, 0], [3, 7.5]], 5);
  let wb = await workbookFromFile(fixture(type, literalCategories, values), 'signed.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.sheets[0], chart = sheet.charts[0], data = chartData(wb, sheet.id, chart);
    expect(data.series[0].values).toEqual([-2.5, 0, null, 7.5, null]);
    const svg = renderChartSvg(data, chart, 640, 420);
    expect(svg.match(/class="chart-data-label"/g)).toHaveLength(2);
    expect(svg).toContain('-2.50');
    expect(svg).toContain('(-25%)');
    const copy = wb.chartById(sheet.id, wb.duplicateChart(sheet.id, chart.id));
    expect(chartData(wb, sheet.id, copy).series[0].values).toEqual(data.series[0].values);
    if (!pass) wb = await nativeOnly(wb);
  }
});

it.each(['pieChart', 'doughnutChart'])('imports sparse %s literals without shifting points and preserves them through duplication and native export', async type => {
  let wb = await workbookFromFile(fixture(type), 'embedded.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.sheets[0], chart = sheet.charts[0];
    expect(chart).toBeDefined();
    expect(chart.sourceRefs[0]).toMatchObject({ values: '', categories: '', valueFormat: '0.00', literal: {
      categories: ['North', 'Missing', null, 'South', null], values: [2.5, null, null, 7.5, null],
    } });
    const data = chartData(wb, sheet.id, chart);
    expect(data.series[0].values).toEqual([2.5, null, null, 7.5, null]);
    expect(data.categories).toEqual(['North', 'Missing', '', 'South', '']);
    const svg = renderChartSvg(data, chart, 640, 420);
    expect(svg.match(/class="chart-data-label"/g)).toHaveLength(2);
    expect(svg).toContain('South');
    expect(svg).toContain('Missing'); // A blank-valued point still has its own legend entry.
    expect(svg).toContain('7.50');
    expect(svg).not.toMatch(/NaN|Infinity/);
    wb.setInput(wb.sheets[1].id, 0, 1, '12345');
    expect(chartData(wb, sheet.id, chart).series[0].values).toEqual(data.series[0].values);
    const copied = wb.chartById(sheet.id, wb.duplicateChart(sheet.id, chart.id));
    expect(copied.sourceRefs).toEqual(chart.sourceRefs);
    copied.sourceRefs[0].literal.values[0] = 99;
    expect(chart.sourceRefs[0].literal.values[0]).toBe(2.5);
    if (!pass) wb = await nativeOnly(wb);
  }
});

it('keeps zero-valued and blank pie legend entries unless explicitly hidden', async () => {
  const wb = await workbookFromFile(fixture('pieChart', literalCategories, points('numLit', [[0, 2], [1, 0], [3, 8]], 5)), 'legend.xlsx');
  const sheet = wb.sheets[0], chart = sheet.charts[0];
  chart.appearance.legend = null;
  const svg = () => renderChartSvg(chartData(wb, sheet.id, chart), chart, 640, 420);
  expect(svg().match(/class="chart-legend-label"/g)).toHaveLength(5);
  expect(svg()).toContain('Missing');
  chart.appearance.legendHidden = [1];
  expect(svg().match(/class="chart-legend-label"/g)).toHaveLength(4);
  expect(svg()).not.toContain('Missing');
});

it.each(['pieChart', 'doughnutChart'])('exports %s as an editable native chart with referenced data and point formatting', async type => {
  const wb = await workbookFromFile(pieXlsx({ type }), 'styled.xlsx');
  const chart = wb.sheets[0].charts[0], before = chart.appearance;
  const back = await nativeOnly(wb), copy = back.sheets[0].charts[0];
  expect(copy.type).toBe(chart.type);
  expect(copy.sourceRefs).toEqual(chart.sourceRefs);
  const label = l => ({ ...l, numberFormat: '"$"#,##0', ...(type === 'doughnutChart' ? { position: 'ctr' } : {}) });
  expect(copy.appearance.pie).toEqual({ ...before.pie, holeSize: type === 'pieChart' ? 50 : before.pie.holeSize,
    labels: { ...label(before.pie.labels), points: before.pie.labels.points.map(label) } });
  // Office permits no dLblPos on a doughnut; native labels center while keeping
  // manual offsets. A pie has no holeSize. Both remain editable, never pictures.
  expect(copy.appearance.pointColors[0]).toEqual(before.pointColors[0]);
  expect(copy.appearance.plot).toEqual(before.plot);
  const helper = back.sheets[1];
  back.setInput(helper.id, 0, 1, '777');
  expect(chartData(back, back.sheets[0].id, copy).series[0].values[0]).toBe(777);
});

it('exports hidden labels, series field templates, explicit no-fill and hairline point borders', async () => {
  const wb = await workbookFromFile(pieXlsx(), 'styles.xlsx'), chart = wb.sheets[0].charts[0], pie = chart.appearance.pie;
  pie.varyColors = false; pie.color = '#aabbcc'; pie.stroke = 'none'; pie.strokeWidth = 0;
  pie.points = [{ index: 1, stroke: 'none', strokeWidth: 0 }];
  chart.appearance.pointColors = [[{ index: 0, color: 'none' }]];
  pie.labels.content = [{ kind: 'series' }, { kind: 'text', text: ': ' }, { kind: 'category' }, { kind: 'text', text: '\n' }, { kind: 'value' }];
  pie.labels.points = [{ ...pie.labels, index: 2, hidden: true }];
  const back = await nativeOnly(wb), after = back.sheets[0].charts[0].appearance;
  expect(after.pie).toMatchObject({ varyColors: false, color: '#aabbcc', stroke: 'none', strokeWidth: 0,
    points: [{ index: 1, stroke: 'none', strokeWidth: 0 }] });
  expect(after.pointColors[0]).toEqual([{ index: 0, color: 'none' }, ...[1, 2, 3].map(index => ({ index, color: '#aabbcc' }))]);
  expect(after.pie.labels.points.find(p => p.index === 0).content).toEqual(pie.labels.content);
  expect(after.pie.labels.points.find(p => p.index === 2).hidden).toBe(true);
});

it.each(['pieChart', 'doughnutChart'])('keeps mixed referenced and literal %s data live without using stale caches', async type => {
  const reference = '<c:numRef><c:f>Helper!$B$1:$B$4</c:f><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>999</c:v></c:pt></c:numCache></c:numRef>';
  const wb = await workbookFromFile(fixture(type, literalCategories, reference), 'mixed.xlsx'), sheet = wb.sheets[0];
  const data = () => chartData(wb, sheet.id, sheet.charts[0]);
  expect(data().series[0].values).toEqual([900, 240, 10, 850, null]);
  wb.setInput(wb.sheets[1].id, 0, 1, '123');
  expect(data().series[0].values[0]).toBe(123);
  wb.deleteSheet(wb.sheets[1].id);
  expect(data().series[0].values).not.toContain(999);
  const back = await nativeOnly(wb);
  expect(back.sheets[0].charts[0].sourceRefs[0].literal.categories).toEqual(['North', 'Missing', null, 'South', null]);
});

it('accepts literal values with linked or absent categories', async () => {
  for (const categories of [null, '<c:strRef><c:f>Helper!$A$1:$A$4</c:f></c:strRef>']) {
    let wb = await workbookFromFile(fixture('pieChart', categories), 'categories.xlsx');
    for (let pass = 0; pass < 2; pass++) {
      const sheet = wb.sheets[0], data = chartData(wb, sheet.id, sheet.charts[0]);
      expect(data.categories).toEqual(categories ? ['Rent', 'Transit', 'Music', 'Savings', ''] : ['1', '2', '3', '4', '5']);
      expect(data.series[0].values).toEqual([2.5, null, null, 7.5, null]);
      if (!pass) wb = await nativeOnly(wb);
    }
  }
});

it('retains numeric literal categories and their format independently of value formats', async () => {
  let wb = await workbookFromFile(fixture('doughnutChart', points('numLit', [[0, .25], [3, .75]], 5).replace('0.00', '0%')), 'numeric.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    expect(wb.sheets[0].charts[0].sourceRefs[0]).toMatchObject({ categoryFormat: '0%', valueFormat: '0.00', literal: { categories: [.25, null, null, .75, null] } });
    expect(chartData(wb, wb.sheets[0].id, wb.sheets[0].charts[0]).categories).toEqual(['25%', '', '', '75%', '']);
    if (!pass) wb = await nativeOnly(wb);
  }
});

it('preserves an explicitly empty literal series', async () => {
  let wb = await workbookFromFile(fixture('doughnutChart', null, points('numLit', [], 0)), 'empty.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    expect(wb.sheets[0].charts[0].sourceRefs[0].literal.values).toEqual([]);
    if (!pass) wb = await nativeOnly(wb);
  }
});

it('does not drop text categories when an authored literal vector mixes numbers and strings', async () => {
  const wb = await workbookFromFile(fixture('pieChart'), 'mixed-labels.xlsx');
  wb.sheets[0].charts[0].sourceRefs[0].literal.categories = [12, 'North', null, 'South', null];
  const back = await nativeOnly(wb);
  expect(chartData(back, back.sheets[0].id, back.sheets[0].charts[0]).categories).toEqual(['12', 'North', '', 'South', '']);
});

it('bounds malformed literal point indices and treats nonnumeric values as missing', async () => {
  const wb = await workbookFromFile(fixture('pieChart', null, points('numLit', [[-1, 5], [5000, 9], [2.5, 8], [1, 'bad'], [2, 'Infinity'], [0, 4]], 999999999)), 'bounded.xlsx');
  const values = wb.sheets[0].charts[0].sourceRefs[0].literal.values;
  expect(values).toHaveLength(5000);
  expect(values[0]).toBe(4);
  expect(values.slice(1).every(v => v === null)).toBe(true);
});
