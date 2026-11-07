import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { pieXlsx } from './helpers/xlsx-pie-fixture.js';

const props = '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1500" b="1" i="true"><a:solidFill><a:srgbClr val="375A7F"/></a:solidFill><a:latin typeface="Georgia"/></a:defRPr></a:pPr></a:p></c:txPr>';
const get = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path).content);
const set = (zip, path, xml) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(xml));
const save = async wb => X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
const open = async zip => {
  set(zip, '/xl/workbook.xml', get(zip, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
};
const chartPath = zip => zip.FullPaths.find(p => /\/xl\/charts\/(?:chart1_1|wheel)\.xml$/.test(p));
it.each(['column', 'line', 'pie', 'donut'])('retains %s chart-space defaults, inactive element styles and explicit regular overrides', async type => {
  let zip;
  if (type === 'pie' || type === 'donut') zip = X.CFB.read(pieXlsx({ type: type === 'pie' ? 'pieChart' : 'doughnutChart' }), { type: 'array' });
  else {
    const w = new Workbook(); w.setInput(w.activeSheetId, 0, 0, 'Value'); w.setInput(w.activeSheetId, 1, 0, '12');
    w.addChart(w.activeSheetId, { type, anchor: { r: 0, c: 0 }, legend: false, range: { r1: 0, c1: 0, r2: 1, c2: 0 } }); zip = await save(w);
  }
  const path = chartPath(zip);
  set(zip, path, get(zip, path).replace(/<c:title>[\s\S]*?<\/c:title>/g, '').replace(/<c:legend>[\s\S]*?<\/c:legend>/g, '')
    .replace(/<c:txPr>[\s\S]*?<\/c:txPr>/g, '<c:txPr><a:p><a:pPr><a:defRPr b="false" i="0"/></a:pPr></a:p></c:txPr>')
    .replace('</c:chartSpace>', props + '</c:chartSpace>'));
  let wb = await open(zip);
  const expected = { font: 'georgia', size: 20, color: '#375a7f', bold: true, italic: true };
  for (let pass = 0; pass < 2; pass++) {
    const ch = wb.sheets[0].charts[0], ap = ch.appearance;
    expect(ap.textStyle).toEqual(expected);
    expect(ap.legendStyle).toEqual(expected);
    expect(ap.titleStyle).toEqual({ ...expected, size: 24 });
    if (type === 'column' || type === 'line') {
      expect(ap.xStyle).toMatchObject({ font: 'georgia', size: 20, color: '#375a7f' });
      expect(ap.xStyle.bold).toBeUndefined(); expect(ap.xStyle.italic).toBeUndefined();
    } else {
      expect(ap.pie.labels.style.bold).toBeUndefined(); expect(ap.pie.labels.style.italic).toBeUndefined();
    }
    const copy = wb.chartById(wb.activeSheetId, wb.duplicateChart(wb.activeSheetId, ch.id));
    expect(copy.appearance.textStyle).toEqual(expected); wb.undo();
    zip = await save(wb);
    expect(get(zip, chartPath(zip))).toMatch(/<\/c:chart><c:spPr>[\s\S]*?<\/c:spPr><c:txPr>/);
    wb = await open(zip);
  }
  const ch = wb.sheets[0].charts[0];
  wb.updateChart(wb.activeSheetId, ch.id, { title: 'New title', legend: true });
  const live = wb.chartById(wb.activeSheetId, ch.id);
  const svg = renderChartSvg(chartData(wb, wb.activeSheetId, live), live, 600, 400);
  expect(svg).toContain('New title'); expect(ch.appearance.titleStyle).toEqual({ ...expected, size: 24 });
});
it('keeps omitted chart defaults optional and sanitizes malformed stored defaults', async () => {
  const wb = new Workbook(); wb.setInput(wb.activeSheetId, 0, 0, 'Value'); wb.setInput(wb.activeSheetId, 1, 0, '12');
  wb.addChart(wb.activeSheetId, { type: 'column', anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 1, c2: 0 }, appearance: {} });
  expect(wb.activeSheet.charts[0].appearance.textStyle).toBeUndefined();
  const zip = await save(wb);
  expect((await open(zip)).activeSheet.charts[0].appearance.textStyle).toBeUndefined();
  const ch = wb.activeSheet.charts[0];
  wb.updateChart(wb.activeSheetId, ch.id, { appearance: { ...ch.appearance, textStyle: { size: Infinity, color: 'url(unsafe)', font: null } } });
  expect(wb.activeSheet.charts[0].appearance.textStyle).toEqual({ font: 'arial', size: 16, color: '#000000' });
});
it('reads false XML text flags with whitespace and leaves malformed flags inherited', async () => {
  const wb = await workbookFromFile(pieXlsx({ editChart: xml => xml
    .replaceAll('<a:defRPr sz="1000">', '<a:defRPr sz="1000" b=" 0 " i="invalid">')
    .replace('</c:chartSpace>', props + '</c:chartSpace>') }));
  const ap = wb.activeSheet.charts[0].appearance;
  expect(ap.pie.labels.style.bold).toBeUndefined();
  expect(ap.pie.labels.style.italic).toBe(true);
  expect(ap.textStyle.bold).toBe(true);
});
