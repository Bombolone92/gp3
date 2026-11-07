import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { bubbleXlsx } from './helpers/xlsx-bubble-fixture.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

it('preserves independent literal X/Y/size vectors, appearance and sheet geometry on save', async () => {
  let wb = await workbookFromFile(bubbleXlsx(), 'portfolio.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.sheets[0], chart = sheet.charts[0];
    // Schema base: 8 characters × Calibri 11 digit width 7 + 5 pixels padding.
    expect(sheet.defaultColWidth).toBe(61);
    expect(wb.colWidth(sheet.id, 20)).toBe(61);
    // Nine columns between markers, plus the 20 - 4 pixel offset difference.
    expect(chart).toMatchObject({ type: 'bubble', labels: true, w: 565, h: 424, anchor: { r: 2, c: 1 }, dx: 4, dy: 6,
      appearance: { background: 'none', border: false, xRotation: 0,
        annotations: [{ text: 'Standard error & uncertainty', box: { x: .2, y: .12 }, style: { font: 'lato-light', size: 14 } }],
        bubble: { scale: 100, sizeRepresents: 'area' } } });
    expect(chart.appearance.bubble.series).toHaveLength(3);
    expect(chart.appearance.bubble.series[0]).toMatchObject({ labels: { value: true, size: false } });
    expect(chart.errorBars[0]).toMatchObject({ x: { type: 'stdErr' }, y: { type: 'stdErr' } });
    const data = chartData(wb, sheet.id, chart);
    expect(data.series.map(s => [s.x, s.values, s.sizes])).toEqual([
      [[2, 4, null], [6, 8, null], [9, 36, null]],
      [[3, 6, null], [4, 9, null], [16, 25, null]],
      [[7, 9, 5], [10, 8, 15], [49, 25, 36]],
    ]);
    const svg = renderChartSvg(data, chart, 600, 400);
    expect(svg.match(/class="chart-bubble"/g)).toHaveLength(7);
    expect(svg.match(/class="chart-error-bar"/g)).toHaveLength(14);
    expect(svg.match(/class="chart-data-label"/g)).toHaveLength(7);
    expect(svg.match(/<linearGradient/g)).toHaveLength(3);
    expect(svg).toContain('Standard error &amp; uncertainty');
    expect(svg).not.toMatch(/NaN|Infinity|rotate\(-90/);
    wb.setInput(wb.sheets[1].id, 0, 3, '123');
    expect(chartData(wb, sheet.id, chart).series[0].values[0]).toBe(6);
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'reopened.xlsx');
  }
});

it('reads linked values instead of stale caches and tracks size references through structural edits', async () => {
  const wb = await workbookFromFile(bubbleXlsx({ referenced: true }), 'linked.xlsx'), sheet = wb.sheets[0], helper = wb.sheets[1];
  const data = () => chartData(wb, sheet.id, wb.sheet(sheet.id).charts[0]);
  expect(data().series[0].sizes).toEqual([9, 36, null]);
  wb.setInput(helper.id, 0, 6, '81');
  expect(data().series[0].sizes[0]).toBe(81);
  wb.renameSheet(helper.id, 'New values');
  wb.insertCols(helper.id, 0, 1);
  expect(sheet.charts[0].sourceRefs[0].sizes).toBe("'New values'!$H$1:$I$1");
  expect(data().series[0].sizes[0]).toBe(81);
  wb.undo();
  expect(data().series[0].sizes[0]).toBe(81);
  wb.deleteSheet(helper.id);
  expect(data().series[0].sizes).not.toContain(999);
  const svg = renderChartSvg(data(), wb.sheet(sheet.id).charts[0], 600, 400);
  expect(svg).not.toContain('class="chart-bubble"');
});

it('keeps literal point indices aligned and ignores missing or nonpositive sizes', async () => {
  const wb = await workbookFromFile(bubbleXlsx({ editChart: s => s
    .replace('<c:pt idx="0"><c:v>2</c:v></c:pt>', '')
    .replace('<c:pt idx="1"><c:v>36</c:v></c:pt>', '<c:pt idx="1"><c:v>-36</c:v></c:pt>') }), 'gaps.xlsx');
  const sheet = wb.sheets[0], chart = sheet.charts[0];
  const data = chartData(wb, sheet.id, chart);
  expect(data.series[0].x).toEqual([null, 4, null]);
  expect(renderChartSvg(data, chart, 600, 400).match(/class="chart-bubble"/g)).toHaveLength(5);
  chart.appearance.bubble.showNegative = true;
  expect(renderChartSvg(data, chart, 600, 400).match(/class="chart-bubble"/g)).toHaveLength(6);
});

it('rejects unsafe appearance values and external annotation relationships', async () => {
  const wb = await workbookFromFile(bubbleXlsx({ externalAnnotation: true }), 'external.xlsx'), sheet = wb.sheets[0], original = sheet.charts[0];
  expect(original.appearance.annotations).toBeUndefined();
  const chart = normalizeChart({ ...original, sourceRefs: [{ literal: { categories: [1, Infinity], values: [2, {}], sizes: [3, 'bad'] } }],
    appearance: { ...original.appearance, annotations: [{ box: { x: 0, y: 0, w: 1, h: 1 }, text: '<script>', fill: 'url(bad)' }],
      bubble: { scale: Infinity, series: [{ gradient: { angle: NaN, stops: [{ offset: 0, color: 'url(bad)' }] }, errors: [{ axis: 'x', type: 'custom' }] }] } } });
  expect(chart.sourceRefs[0].literal).toEqual({ categories: [1, null], values: [2, null], sizes: [3, null] });
  expect(chart.appearance.bubble.scale).toBe(100);
  const svg = renderChartSvg(chartData(wb, sheet.id, chart), chart, 600, 400);
  expect(svg).toContain('&lt;script&gt;');
  expect(svg).not.toMatch(/NaN|Infinity|<script>|url\(bad\)/);
});

it('retains native column defaults through resizing, undo, duplication and file round trips', async () => {
  let wb = await workbookFromFile(bubbleXlsx(), 'layout.xlsx');
  const id = wb.sheets[0].id;
  wb.setColWidth(id, 1, 100);
  expect(wb.colWidth(id, 1)).toBe(100);
  expect(wb.sheet(id).colWidths.get(1)).toBe(100);
  wb.undo();
  expect(wb.colWidth(id, 1)).toBe(61);
  wb.redo();
  expect(wb.colWidth(id, 1)).toBe(100);
  const copy = wb.duplicateSheet(id);
  expect(copy.defaultColWidth).toBe(61);
  expect(copy.colWidths.get(1)).toBe(100);
  wb = new Workbook(wb.toJSON());
  wb = await workbookFromFile(await workbookToXlsx(wb), 'roundtrip.xlsx');
  expect(wb.colWidth(wb.sheets[0].id, 1)).toBe(100);
  wb.setColWidth(wb.sheets[0].id, 1, 61);
  expect(wb.sheets[0].colWidths.has(1)).toBe(false);
  expect(wb.colWidth(wb.sheets[0].id, 1)).toBe(61);
});

it('hiding one series does not suppress points in other independently linked series', async () => {
  const wb = await workbookFromFile(bubbleXlsx({ referenced: true }), 'hidden.xlsx'), sheet = wb.sheets[0], chart = sheet.charts[0];
  wb.setHidden(wb.sheets[1].id, 'row', [0], true);
  let data = chartData(wb, sheet.id, chart);
  expect(data.series[0].values).toEqual([null, null, null]);
  expect(data.series[1].values).toEqual([4, 9, null]);
  expect(renderChartSvg(data, chart, 600, 400).match(/class="chart-bubble"/g)).toHaveLength(5);
  chart.includeHidden = true;
  data = chartData(wb, sheet.id, chart);
  expect(renderChartSvg(data, chart, 600, 400).match(/class="chart-bubble"/g)).toHaveLength(7);
});

it.each([
  ['defaultColWidth="12"', 84],
  ['baseColWidth="8"', 61],
  ['baseColWidth="-1" defaultColWidth="Infinity"', 61],
])('imports sheet column metrics from %s', async (attributes, pixels) => {
  const wb = await workbookFromFile(otherProgramsXlsx({ sheetXml: { Data: { head: '<sheetFormatPr ' + attributes + '/>', rows: '' } },
    patch: { '/xl/styles.xml': s => s.replace('<sz val="12"/>', '<sz val="11"/>') } }), 'widths.xlsx');
  expect(wb.sheets[0].defaultColWidth).toBe(pixels);
});
