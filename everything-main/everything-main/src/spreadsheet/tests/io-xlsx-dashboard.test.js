import { expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData, textBoxText } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { dashboardXlsx, dashboardImage } from './helpers/xlsx-dashboard-fixture.js';

async function nativeCopy(wb) {
  const data = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(data, { type: 'array' });
  const file = X.CFB.find(zip, '/xl/workbook.xml');
  file.content = new TextEncoder().encode(new TextDecoder().decode(file.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  file.size = file.content.length;
  return { wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' })), zip };
}

it('opens the saved dashboard and imports every nested chart at its own bounds with live KPI text', async () => {
  let wb = await workbookFromFile(dashboardXlsx());
  for (let pass = 0; pass < 3; pass++) {
    const sheet = wb.activeSheet, data = wb.sheets[0];
    expect(sheet.name).toBe('Dashboard');
    expect(sheet.viewZoom).toBe(.81);
    expect(sheet.charts.map(c => c.type)).toEqual(['text', 'bar', 'bar']);
    expect(sheet.charts[1]).toMatchObject({ anchor: { r: 2, c: 3 }, dx: 10, dy: 50, w: 280, h: 300 });
    expect(sheet.charts[2]).toMatchObject({ anchor: { r: 2, c: 3 }, dx: 310, dy: 50, w: 280, h: 300 });
    const label = sheet.charts[0];
    expect(label).toMatchObject({ textRef: 'Data!$B$1', textSuffix: ' calls', style: { color: '#ffffff' } });
    expect(textBoxText(wb, sheet.id, label)).toBe('10 calls');
    wb.setInput(data.id, 0, 1, '15');
    expect(textBoxText(wb, sheet.id, label)).toBe('15 calls');
    wb.undo();
    expect(textBoxText(wb, sheet.id, label)).toBe('10 calls');
    wb = pass === 0 ? await workbookFromFile(await workbookToXlsx(wb)) : (await nativeCopy(wb)).wb;
  }
  wb.renameSheet(wb.sheets[0].id, 'Source Data');
  expect(wb.activeSheet.charts[0].textRef).toBe("'Source Data'!$B$1");
  expect(textBoxText(wb, wb.activeSheetId, wb.activeSheet.charts[0])).toBe('10 calls');
});

it('omits a PivotChart total without reading cached values and overlays selected bars with labels', async () => {
  const wb = await workbookFromFile(dashboardXlsx()), sheet = wb.activeSheet, chart = sheet.charts[1];
  expect(chart).toMatchObject({ labels: true, appearance: { overlap: 100 } });
  expect(chartData(wb, sheet.id, chart).categories).toEqual(['One', 'Two']);
  expect(chartData(wb, sheet.id, chart).series[0].values).toEqual([10, 20]);
  const svg = renderChartSvg(chartData(wb, sheet.id, chart), chart, 400, 300);
  // Generated clip IDs are not displayed source values.
  expect(new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.textContent).not.toMatch(/Grand Total|9999/);
  expect(svg).not.toMatch(/NaN|Infinity/);
  expect(svg).toContain('>20</text>');
  const bars = [...svg.matchAll(/<rect class="chart-series chart-bar"[^>]*y="([^"]+)"/g)].map(m => m[1]);
  expect(bars).toHaveLength(3);
  expect(bars[0]).toBe(bars[2]);
  wb.setInput(wb.sheets[0].id, 0, 1, '12');
  expect(chartData(wb, sheet.id, chart).series[0].values).toEqual([12, 20]);
  const regular = await workbookFromFile(dashboardXlsx({ pivot: false }));
  expect(chartData(regular, regular.activeSheetId, regular.activeSheet.charts[1]).categories).toEqual(['One', 'Two', 'Grand Total']);
});

it('imports rich cell pictures through metadata indices and recalculates image lookups after edit and native save', async () => {
  let wb = await workbookFromFile(dashboardXlsx());
  for (let pass = 0; pass < 3; pass++) {
    const assets = wb.sheets[2], dashboard = wb.activeSheet, data = wb.sheets[0];
    const picture = wb.getValue(assets.id, 0, 1), other = wb.getValue(assets.id, 1, 1);
    expect(picture).toEqual({ image: `data:image/png;base64,${dashboardImage}`, fit: 'contain' });
    expect(other.image).not.toBe(picture.image);
    expect(wb.getValue(dashboard.id, 0, 0)).toEqual(picture);
    wb.setInput(data.id, 0, 3, 'Two');
    expect(wb.getValue(dashboard.id, 0, 0)).toEqual(other);
    wb.undo();
    expect(wb.getValue(dashboard.id, 0, 0)).toEqual(picture);
    const saved = await nativeCopy(wb);
    const metadata = new TextDecoder().decode(X.CFB.find(saved.zip, '/xl/metadata.xml').content);
    expect(metadata).toContain('name="XLRICHVALUE"');
    expect(metadata).toContain('name="XLDAPR"');
    wb = saved.wb;
  }
});

it.each([{ externalImage: true }, { missingImageLink: true }])('does not load external or unresolved rich image relationships: %j', async options => {
  const wb = await workbookFromFile(dashboardXlsx(options));
  expect(wb.getValue(wb.sheets[2].id, 0, 1)).toEqual({ error: '#VALUE!' });
  expect(wb.getValue(wb.sheets[2].id, 1, 1).image).toBeDefined();
});
