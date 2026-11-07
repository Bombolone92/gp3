import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { funnelXlsx } from './helpers/xlsx-funnel-fixture.js';

it('preserves a layered funnel, tall chart row, fonts and live helper labels through save/reopen', async () => {
  let wb = await workbookFromFile(funnelXlsx(), 'campaign.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.sheets[0], helper = wb.sheets[1], chart = sheet.charts[0];
    expect(helper.hidden).toBe(true);
    expect(sheet.gridlines).toBe(false);
    expect(wb.colWidth(sheet.id, 2)).toBe(326);
    expect(wb.rowHeight(sheet.id, 3)).toBeCloseTo(400.15 * 4 / 3);
    expect(wb.getCell(sheet.id, 1, 2).s).toMatchObject({ font: 'century', size: 64 });
    expect(chart).toMatchObject({ type: 'combo', anchor: { r: 3, c: 1 }, w: 1352,
      appearance: { background: 'none', border: false, hideXAxis: true, hideYAxis: true,
        seriesTypes: ['area', 'area', 'area', 'scatter', 'scatter', 'scatter', 'scatter'] } });
    expect(chart.h).toBeCloseTo(570.2);
    expect(chart.appearance.lines[5]).toMatchObject({ visible: false, markerStroke: 'none' });
    expect(chart.appearance.lines[5]).toMatchObject({ markerSize: 62, markerSizeUnit: 'pt' });
    const data = chartData(wb, sheet.id, chart);
    expect(data.series[1].values).toEqual([null, 308, 233, null]);
    expect(data.series[5].x).toEqual([2.45, 3.45, null, null]);
    expect(data.series[5].labels).toEqual(['100%', '40%', '', '']);
    expect(data.series[6].labels).toEqual(['IDENTIFIED 250', 'WON 100', '', '']);
    const svg = renderChartSvg(data, chart, chart.w, chart.h);
    expect(svg.match(/class="chart-series chart-area"/g)).toHaveLength(3);
    const markers = [...new JSDOM(svg).window.document.querySelectorAll('.chart-marker')];
    expect(markers).toHaveLength(4);
    markers.forEach(marker => expect(Number(marker.getAttribute('r')) * 2).toBeCloseTo(62 * 4 / 3, 1));
    expect(svg).toContain('>IDENTIFIED 250</text>');
    expect(svg).toContain('>40%</text>');
    expect(svg).toContain('font-family="&quot;Century Gothic&quot;');
    expect(svg).not.toMatch(/NaN|Infinity|STALE|chart-column/);
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
  const sheet = wb.sheets[0], chart = sheet.charts[0];
  wb.setInput(sheet.id, 6, 3, '300');
  expect(chartData(wb, sheet.id, chart).series[6].labels[0]).toBe('IDENTIFIED 300');
  wb.undo();
  expect(chartData(wb, sheet.id, chart).series[6].labels[0]).toBe('IDENTIFIED 250');
});

it('keeps label references attached through helper sheet renames and structural edits', async () => {
  const wb = await workbookFromFile(funnelXlsx(), 'campaign.xlsx'), sheet = wb.sheets[0], helper = wb.sheets[1];
  const chart = () => wb.sheet(sheet.id).charts[0];
  const labels = () => chartData(wb, sheet.id, chart()).series[6].labels;
  wb.renameSheet(helper.id, 'Renamed helper');
  wb.insertRows(helper.id, 0, 2);
  expect(chart().sourceRefs[6].labels).toBe("'Renamed helper'!$H$3:$H$4");
  expect(labels().slice(0, 2)).toEqual(['IDENTIFIED 250', 'WON 100']);
  wb.undo();
  expect(chart().sourceRefs[6].labels).toBe("'Renamed helper'!$H$1:$H$2");
  wb.deleteSheet(helper.id);
  expect(chart().sourceRefs[6].labels).toContain('#REF!');
  expect(labels()).toEqual([]);
  wb.undo();
  expect(labels().slice(0, 2)).toEqual(['IDENTIFIED 250', 'WON 100']);
});

it('does not partially import separate-axis area/scatter charts', async () => {
  const wb = await workbookFromFile(funnelXlsx({ secondary: true }), 'unsupported.xlsx');
  expect(wb.sheets[0].charts).toEqual([]);
});

it('bounds imported label metadata and leaves gaps when a scatter X cell is hidden', async () => {
  const wb = await workbookFromFile(funnelXlsx(), 'campaign.xlsx'), sheet = wb.sheets[0], helper = wb.sheets[1];
  const chart = normalizeChart({ ...sheet.charts[0], appearance: { ...sheet.charts[0].appearance,
    dataLabels: [{ style: { color: 'url(bad)', size: Infinity }, points: [{ index: -1 }, { index: 0, dx: 1e9, dy: NaN }] }] } });
  expect(chart.appearance.dataLabels[0]).toMatchObject({ style: { color: '#000000', size: 16 }, points: [{ index: 0, dx: 1, dy: 0 }] });
  wb.setHidden(helper.id, 'col', [4], true);
  const data = chartData(wb, sheet.id, sheet.charts[0]);
  expect(data.series[5].values).toEqual([null, null, null, null]);
  const svg = renderChartSvg(data, sheet.charts[0], 1352, 570);
  expect(svg).not.toContain('>IDENTIFIED 250</text>');
  expect(svg).not.toMatch(/NaN|Infinity/);
});
