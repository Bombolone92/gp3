import { expect, it } from 'vitest';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { chartXlsx } from './helpers/xlsx-chart-fixture.js';

it('imports a native chart sheet with live sources, layout, theme colors, fonts and date spacing through save/reopen', async () => {
  let wb = await workbookFromFile(chartXlsx(), 'chart.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.sheets[1], chart = sheet.charts[0];
    expect(sheet.cells.size).toBe(0);
    expect(sheet.gridlines).toBe(false);
    expect(sheet.color).toBe('#ffddaf');
    expect(chart).toMatchObject({ type: 'line', title: 'Daily average & sample mean', w: 896, h: 608, legendPos: 'top', gridlines: false,
      colors: ['#135679', '#ff723a'], appearance: { background: '#ffeed7', titleStyle: { font: 'rockwell', size: 32, color: '#135679' },
        xStyle: { font: 'arial', size: 16 }, dateAxis: true, xStep: 1, lines: [{ marker: true, width: 4, markerFill: '#ffffff' }, { marker: false }] } });
    const data = chartData(wb, sheet.id, chart);
    expect(data.series.map(s => s.values)).toEqual([[2.8, 4.2, 2], [3, 3, 3]]);
    expect(data.x).toEqual([46251, 46252, 46254]);
    const svg = renderChartSvg(data, chart, chart.w, chart.h);
    expect(svg).toContain('Daily average &amp; sample mean');
    expect(svg).toContain('font-family="Rockwell, &quot;Rockwell Nova&quot;, Georgia, serif"');
    expect(svg).toContain('fill="#ffeed7"');
    expect(svg).toContain('>4.5</text>');
    expect(svg).toContain('>8/19/2026</text>'); // a tick between sampled dates
    const points = [...svg.matchAll(/<circle\b[^>]*\bcx="([\d.]+)" cy="([\d.]+)"/g)].slice(0, 3).map(m => Number(m[1]));
    expect(points[2] - points[1]).toBeCloseTo(2 * (points[1] - points[0]), 1);
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
  const sheet = wb.sheets[1], chart = sheet.charts[0];
  wb.setInput(wb.sheets[0].id, 0, 1, '5.8');
  expect(chartData(wb, sheet.id, chart).series.map(s => s.values)).toEqual([[5.8, 4.2, 2], [4, 4, 4]]);
  wb.undo();
  expect(chartData(wb, sheet.id, chart).series[1].values).toEqual([3, 3, 3]);
});

it('keeps chart references attached through renames, row insertion, deletion and undo', async () => {
  const wb = await workbookFromFile(chartXlsx(), 'chart.xlsx');
  const dataId = wb.sheets[0].id, chartId = wb.sheets[1].id;
  const chart = () => wb.sheet(chartId).charts[0];
  const values = () => chartData(wb, chartId, chart()).series[0].values;
  wb.renameSheet(dataId, 'Renamed data');
  expect(chart().sourceRefs[0].values).toBe("'Renamed data'!$B$1:$B$80");
  wb.insertRows(dataId, 0, 2);
  expect(chart().sourceRefs[0].values).toBe("'Renamed data'!$B$3:$B$82");
  expect(values()).toEqual([2.8, 4.2, 2]);
  wb.undo();
  expect(chart().sourceRefs[0].values).toBe("'Renamed data'!$B$1:$B$80");
  wb.deleteSheet(dataId);
  expect(chart().sourceRefs[0].values).toContain('#REF!');
  expect(values()).toEqual([]);
  wb.addSheet('Renamed data');
  expect(values()).toEqual([]);
  wb.undo(); wb.undo();
  expect(values()).toEqual([2.8, 4.2, 2]);
});

it('imports embedded line charts at their drawing anchor and skips external chart relationships', async () => {
  const wb = await workbookFromFile(chartXlsx({ embedded: true }), 'embedded.xlsx');
  expect(wb.sheets[0].charts[0]).toMatchObject({ anchor: { r: 2, c: 4 }, dx: 10, dy: 5, w: 896, h: 608 });
  const external = await workbookFromFile(chartXlsx({ external: true }), 'external.xlsx');
  expect(external.sheets[1].charts).toEqual([]);
});

it('excludes hidden source rows and bounds reads for oversized chart references', async () => {
  const wb = await workbookFromFile(chartXlsx(), 'chart.xlsx'), sheet = wb.sheets[1], chart = sheet.charts[0];
  wb.setHidden(wb.sheets[0].id, 'row', [1], true);
  expect(chartData(wb, sheet.id, chart).series[0].values).toEqual([2.8, 2]);
  expect(chartData(wb, sheet.id, { ...chart, includeHidden: true }).series[0].values).toEqual([2.8, 4.2, 2]);
  const huge = normalizeChart({ ...chart, sourceRefs: [{ values: 'Data!B1:B1048576' }], appearance: { background: 'url(bad)', titleStyle: { size: Infinity } } });
  expect(huge.appearance.background).toBe('#ffffff');
  const result = chartData(wb, sheet.id, huge);
  expect(result.series[0].values).toEqual([2.8, 2]);
});
