import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { stackedChartXlsx } from './helpers/xlsx-stacked-chart-fixture.js';

const columns = svg => [...svg.matchAll(/<rect class="chart-series chart-column" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)]
  .map(m => ({ x: +m[1], y: +m[2], width: +m[3], height: +m[4] }));
const render = (wb, chart = wb.sheets[0].charts[0]) => renderChartSvg(chartData(wb, wb.sheets[0].id, chart), chart, 740, 600);

it('imports a designed stacked comparison with live horizontal sources, Tahoma and a hidden broken helper through save/reopen', async () => {
  let wb = await workbookFromFile(stackedChartXlsx(), 'costs.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.sheets[0], chart = sheet.charts[0];
    expect(chart).toMatchObject({ type: 'combo', stacked: true, stack100: false, secondaryAxis: false,
      anchor: { r: 2, c: 5 }, dx: 28, w: 738, legendPos: 'top',
      appearance: { border: false, gapWidth: 20, legendHidden: [5], titleStyle: { font: 'tahoma', bold: true } } });
    expect(chart.appearance.lines[5]).toMatchObject({ visible: false, marker: false });
    expect(wb.colWidth(sheet.id, 2)).toBe(262);
    expect(wb.colWidth(sheet.id, 3)).toBe(246);
    expect(wb.getCell(sheet.id, 0, 0).s).toMatchObject({ font: 'tahoma', size: 48 });
    expect(chart.h).toBeCloseTo(46.15 * 4 / 3 + 5 * 40);
    const data = chartData(wb, sheet.id, chart);
    expect(data.categories).toEqual(['Buy a car', 'Rideshare']);
    expect(data.series.map(s => s.values)).toEqual([[100, null], [20, null], [5, null], [null, 80], [30, 10], [null, null]]);
    const svg = render(wb), bars = columns(svg);
    expect(bars).toHaveLength(6);
    expect(bars[1].x).toBe(bars[0].x);
    expect(bars[2].x).toBe(bars[0].x);
    expect(bars[4].x).toBe(bars[0].x);
    expect(bars[3].x).toBe(bars[5].x);
    expect(bars[1].y + bars[1].height).toBeCloseTo(bars[0].y, 1);
    expect(bars[4].y + bars[4].height).toBeCloseTo(bars[2].y, 1);
    expect(bars[0].height / bars[1].height).toBeCloseTo(5, 1);
    expect(svg).toContain('font-family="Tahoma, Verdana, Arial, sans-serif"');
    expect(svg).toContain('>Car usage costs</text>');
    expect(svg).not.toMatch(/#REF!|Hidden helper|NaN|Infinity|<path class="chart-series"/);
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
  const old = columns(render(wb));
  wb.setInput(wb.sheets[1].id, 0, 0, '110');
  const changed = columns(render(wb));
  expect(changed[0].height / changed[1].height).toBeCloseTo(5.5, 1);
  expect(render(wb)).toContain('Purchase cost · Buy a car: $110');
  wb.undo();
  expect(columns(render(wb))).toEqual(old);
});

it('stacks negative values below zero without subtracting from positive segments', async () => {
  const wb = await workbookFromFile(stackedChartXlsx({ negative: true, line: 'none' }), 'negative.xlsx');
  expect(wb.sheets[0].charts[0]).toMatchObject({ type: 'column', stacked: true });
  const bars = columns(render(wb));
  const zero = bars[0].y + bars[0].height;
  expect(bars[1].y).toBeCloseTo(zero, 1);
  expect(bars[2].y + bars[2].height).toBeCloseTo(bars[0].y, 1);
});

it('normalizes percent stacks independently and retains original values in tooltips', async () => {
  const wb = await workbookFromFile(stackedChartXlsx({ grouping: 'percentStacked', line: 'none' }), 'percent.xlsx');
  expect(wb.sheets[0].charts[0]).toMatchObject({ type: 'column', stacked: true, stack100: true });
  const svg = render(wb), bars = columns(svg);
  expect(bars[4].y).toBeCloseTo(bars[5].y, 1);
  expect(svg).toContain('>100%</text>');
  expect(svg).not.toContain('>150%</text>');
  expect(svg).toContain('Purchase cost · Buy a car: $100');
  wb.setInput(wb.sheets[1].id, 3, 1, '0');
  wb.setInput(wb.sheets[1].id, 4, 1, '0');
  expect(render(wb)).not.toMatch(/NaN|Infinity/);
});

it('retains a visible line and its secondary axis alongside stacked columns', async () => {
  const wb = await workbookFromFile(stackedChartXlsx({ line: 'visible' }), 'combo.xlsx'), chart = wb.sheets[0].charts[0];
  expect(chart).toMatchObject({ stacked: true, secondaryAxis: true, appearance: { y2Max: 40 } });
  const svg = render(wb);
  expect(svg.match(/<path class="chart-series"/g)).toHaveLength(1);
  expect(svg).toContain('stroke="#123456"');
  expect(columns(svg)).toHaveLength(6);
});

it('keeps an explicitly invisible line hidden even when its source has valid values', async () => {
  const wb = await workbookFromFile(stackedChartXlsx({ line: 'hidden' }), 'hidden.xlsx');
  expect(chartData(wb, wb.sheets[0].id, wb.sheets[0].charts[0]).series[5].values).toEqual([30, 10]);
  expect(render(wb)).not.toMatch(/<path class="chart-series"|<circle|Hidden helper/);
});

it.each(['clustered', 'stacked', 'percentStacked'])('exports %s columns with an independent ordinary combo line', async grouping => {
  let wb = await workbookFromFile(stackedChartXlsx({ grouping, line: 'visible' }), 'combo.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.sheets[0], chart = sheet.charts[0];
    if (pass) wb.updateChart(sheet.id, chart.id, { appearance: { ...chart.appearance, y2Format: '0.0%' } });
    const values = chartData(wb, sheet.id, chart).series.at(-1).values;
    expect(values).toEqual([30, 10]);
    const copy = wb.duplicateChart(sheet.id, chart.id);
    expect(chartData(wb, sheet.id, wb.chartById(sheet.id, copy)).series.at(-1).values).toEqual(values);
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const decode = part => new TextDecoder().decode(part.content);
    const charts = zip.FullPaths.flatMap((path, i) => /\/charts\/chart[^/]*\.xml$/.test(path) ? [zip.FileIndex[i]] : []);
    expect(charts).toHaveLength(2);
    for (const part of charts) {
      const xml = decode(part);
      expect(xml.match(/<c:barChart>[\s\S]*?<c:grouping val="([^"]+)"/)[1]).toBe(grouping);
      expect(xml.match(/<c:lineChart>[\s\S]*?<c:grouping val="([^"]+)"/)[1]).toBe('standard');
      const secondary = [...xml.matchAll(/<c:valAx>([\s\S]*?)<\/c:valAx>/g)].find(m => m[1].includes('<c:axId val="3"/>'))[1];
      expect(secondary.match(/<c:numFmt formatCode="([^"]+)"/)[1]).toBe(pass ? '0.0%' : 'General');
    }
    const book = X.CFB.find(zip, '/xl/workbook.xml');
    book.content = new TextEncoder().encode(decode(book).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    book.size = book.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
    expect(wb.sheets[0].charts).toHaveLength(2);
    wb.deleteChart(wb.sheets[0].id, wb.sheets[0].charts[1].id);
    expect(wb.sheets[0].charts[0]).toMatchObject({ stacked: grouping !== 'clustered', stack100: grouping === 'percentStacked', secondaryAxis: true });
  }
});
