import { expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { areaComboXlsx } from './helpers/xlsx-area-combo-fixture.js';

const rendered = wb => {
  const sheet = wb.sheets[0], chart = sheet.charts[0];
  return renderChartSvg(chartData(wb, sheet.id, chart), chart, 600, 400);
};
const areaPaths = svg => [...svg.matchAll(/class="chart-series chart-area" d="([^"]+)"/g)].map(m => m[1]);

it('imports independent area, column and scatter groups with live values and algebraic area stacking', async () => {
  const wb = await workbookFromFile(areaComboXlsx(), 'band.xlsx'), sheet = wb.sheets[0], chart = sheet.charts[0];
  expect(chart).toMatchObject({ type: 'combo', appearance: { seriesTypes: ['area', 'area', 'column', 'scatter'],
    seriesGroups: [{ id: 0, grouping: 'stacked' }, { id: 0, grouping: 'stacked' }, { id: 1, grouping: 'clustered' }, { id: 2, grouping: 'standard' }] } });
  const data = chartData(wb, sheet.id, chart);
  expect(data.categories).toEqual(['40', '41', '42']);
  expect(data.series[2].categories).toEqual(data.categories);
  expect(data.series[3].x).toEqual([1, 2, 3]);
  const svg = rendered(wb);
  // Every upper endpoint is 150, including -100 + 250. Return along the
  // lower series, not zero, to preserve the band when the baseline changes.
  expect(areaPaths(svg)[1]).toBe('M 140 120 L 300 120 L 460 120 L 460 280 L 300 520 L 140 200 Z');
  expect(svg.match(/class="chart-series chart-column"/g)).toHaveLength(3);
  expect(svg).toContain('stroke="#123456"');
  // Generated clip IDs are not displayed source values.
  expect(new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.textContent).not.toMatch(/9999/);
  expect(svg).not.toMatch(/NaN|Infinity/);
  wb.setInput(sheet.id, 1, 2, '200');
  expect(areaPaths(rendered(wb))[1]).toContain('L 300 200');
  wb.undo();
  expect(areaPaths(rendered(wb))).toEqual(areaPaths(svg));
});

it('exports editable native chart groups that reopen without app metadata', async () => {
  let wb = await workbookFromFile(areaComboXlsx(), 'band.xlsx');
  const expected = areaPaths(rendered(wb));
  for (let pass = 0; pass < 2; pass++) {
    const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), zip = X.CFB.read(bytes, { type: 'array' });
    const charts = zip.FullPaths.filter(p => /\/charts\/chart[^/]*\.xml$/.test(p));
    expect(charts).toHaveLength(1);
    const xml = new TextDecoder().decode(X.CFB.find(zip, charts[0]).content);
    expect(xml).toMatch(/<c:areaChart><c:grouping val="stacked"/);
    expect(xml).toMatch(/<c:barChart><c:barDir val="col"\/><c:grouping val="clustered"/);
    expect(xml).toContain('<c:scatterChart>');
    expect(xml).toContain('<c:xVal><c:numLit>');
    const book = X.CFB.find(zip, '/xl/workbook.xml');
    book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    book.size = book.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
    expect(areaPaths(rendered(wb))).toEqual(expected);
    expect(wb.sheets[0].charts[0].appearance.lines[3]).toMatchObject({ smooth: true, marker: false, width: 4 });
  }
});

it('keeps area groups on other axes out of the shared-axis model', async () => {
  const wb = await workbookFromFile(areaComboXlsx({ secondary: true }), 'other-axis.xlsx');
  expect(wb.sheets[0].charts).toEqual([]);
});

it('normalizes a percent area group independently of column and scatter values', async () => {
  const wb = await workbookFromFile(areaComboXlsx({ grouping: 'percentStacked' }), 'percent.xlsx');
  const chart = wb.sheets[0].charts[0];
  chart.yMax = 2;
  const paths = areaPaths(rendered(wb));
  expect(paths[1]).toContain('M 140 200'); // (100 + 50) / (100 + 50) = 1
  expect(paths[1]).toContain('L 300 291.43'); // (-100 + 250) / (100 + 250)
  expect(chartData(wb, wb.sheets[0].id, chart).series[2].values).toEqual([20, 25, 30]);
});
