import { expect, it } from 'vitest';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { progressChartXlsx } from './helpers/xlsx-progress-chart-fixture.js';

const bars = svg => [...svg.matchAll(/<rect class="chart-series chart-bar" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" fill="([^"]+)"/g)]
  .map(m => ({ x: +m[1], y: +m[2], width: +m[3], height: +m[4], fill: m[5] }));

it('preserves compact progress bars, point colors, fonts and fixed percentage axes through save/reopen', async () => {
  let wb = await workbookFromFile(progressChartXlsx(), 'planner.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.sheets[0], chart = sheet.charts[0];
    expect(chart).toMatchObject({ type: 'bar', yMax: 1, h: 76.8, appearance: { hideXAxis: true, yStep: .25, gapWidth: 7,
      background: 'none', border: false, plotStroke: '#000000', pointColors: [[{ index: 0, color: '#c67431' }]], yStyle: { font: 'corbel', italic: true } } });
    expect(wb.styleAt(sheet.id, 0, 0)).toMatchObject({ font: 'impact', size: 128 / 3 });
    expect(wb.styleAt(sheet.id, 4, 4).font).toBe('corbel');
    const data = chartData(wb, sheet.id, chart), svg = renderChartSvg(data, chart, chart.w, chart.h);
    expect(data.series[0]).toMatchObject({ name: 'Progress 1 of 6', values: [1 / 6] });
    expect(bars(svg)).toHaveLength(1);
    expect(bars(svg)[0].fill).toBe('#c67431');
    expect(svg).toContain('height="76.8"');
    expect(svg).toContain('font-style="italic"');
    expect(svg).toContain('class="chart-plot-border"');
    for (const tick of ['0%', '25%', '50%', '75%', '100%']) expect(svg).toContain(`>${tick}</text>`);
    expect(svg).not.toMatch(/>Bought<|NaN|Infinity|STALE/);
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
  const sheet = wb.sheets[0], chart = sheet.charts[0];
  const render = () => renderChartSvg(chartData(wb, sheet.id, chart), chart, chart.w, chart.h);
  const initial = bars(render())[0];
  wb.setInput(sheet.id, 1, 5, '3');
  expect(bars(render())[0].width / initial.width).toBeCloseTo(3, 2);
  expect(render()).toContain('Progress 3 of 6');
  wb.undo();
  expect(bars(render())[0]).toEqual(initial);
  wb.setInput(sheet.id, 1, 5, '0');
  expect(bars(render())[0].width).toBe(0);
  wb.setInput(sheet.id, 1, 5, '6');
  expect(bars(render())[0].width / initial.width).toBeCloseTo(6, 2);
});

it('uses native default row heights for chart spans and reserves room for currency ticks', async () => {
  const wb = await workbookFromFile(progressChartXlsx(), 'planner.xlsx'), sheet = wb.sheets[1], chart = sheet.charts[0];
  expect(chart.h).toBe(339); // eight 40px rows, except an explicit 26px row, plus 33px offsets
  const svg = renderChartSvg(chartData(wb, sheet.id, chart), chart, chart.w, chart.h);
  const tick = svg.match(/<text x="([^"]+)"[^>]*>\$300\.00<\/text>/);
  expect(tick).not.toBeNull();
  expect(+tick[1]).toBeGreaterThan(60);
});

it.each(['stacked', 'percentStacked'])('supports horizontal %s charts with negative values and category order', async grouping => {
  const wb = await workbookFromFile(progressChartXlsx({ grouping, reversed: true }), 'bars.xlsx');
  const chart = normalizeChart({ ...wb.sheets[0].charts[0], h: 300, yMin: null, yMax: null,
    appearance: { ...wb.sheets[0].charts[0].appearance, hideXAxis: false, yStep: null, pointColors: [] } });
  const data = { categories: ['First', 'Second'], series: [{ name: 'A', values: [20, -10] }, { name: 'B', values: [30, -40] }] };
  const svg = renderChartSvg(data, chart, 600, 300), rects = bars(svg);
  expect(rects).toHaveLength(4);
  expect(rects[0].y).toBeLessThan(rects[1].y);
  expect(rects[2].x).toBeCloseTo(rects[0].x + rects[0].width, 1);
  expect(rects[3].x + rects[3].width).toBeCloseTo(rects[1].x, 1);
  expect(svg).toContain('>First</text>');
  expect(svg).not.toMatch(/NaN|Infinity/);
  if (grouping === 'percentStacked') expect(svg).toContain('>100%</text>');
});
