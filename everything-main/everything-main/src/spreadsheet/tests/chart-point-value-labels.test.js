import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const make = (type, points, show = true) => {
  const wb = new Workbook();
  wb.addChart(wb.activeSheetId, { type, anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 3, c2: 1 }, labels: true, legend: false,
    sourceRefs: [{ literal: { categories: ['A', 'B', 'C'], values: [10, 20, 30] } }],
    appearance: { valueLabels: [{ show, position: 'outEnd', numberFormat: '"v "0',
      style: { size: 20, color: '#112233', bold: true }, points }] } });
  return wb;
};
const texts = wb => {
  const ch = wb.activeSheet.charts[0], svg = renderChartSvg(chartData(wb, wb.activeSheetId, ch), ch, 640, 400);
  return [...new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document.querySelectorAll('text')].filter(n => /^(v |point )/.test(n.textContent));
};
const get = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path).content);
const set = (zip, path, content) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(content));
const save = async wb => X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
const open = zip => {
  set(zip, '/xl/workbook.xml', get(zip, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return workbookFromFile(new Uint8Array(X.CFB.write(zip, { type: 'array', fileType: 'zip' })), 'native.xlsx');
};
it.each(['bar', 'column'])('preserves sparse %s point label overrides, inheritance and copies through native-only export', async type => {
  const points = [{ index: 0, style: { size: 12, bold: false }, position: 'inBase', numberFormat: '"point "0' },
    { index: 1, style: { color: '#abcdef', italic: true } }, { index: 2, hidden: true }];
  let wb = make(type, points);
  const original = wb.activeSheet.charts[0];
  const copy = wb.chartById(wb.activeSheetId, wb.duplicateChart(wb.activeSheetId, original.id));
  expect(copy.appearance.valueLabels[0].points).toEqual(points); wb.undo();
  for (let pass = 0; pass < 2; pass++) {
    const labels = texts(wb);
    expect(labels.map(n => n.textContent)).toEqual(['point 10', 'v 20']);
    expect(labels[0].getAttribute('font-size')).toBe('12'); expect(labels[0].hasAttribute('font-weight')).toBe(false);
    expect(labels[0].getAttribute('fill')).toBe(pass ? '#445566' : '#112233');
    expect(labels[1].getAttribute('fill')).toBe('#abcdef'); expect(labels[1].getAttribute('font-style')).toBe('italic');
    wb = await open(await save(wb));
    expect(wb.activeSheet.charts[0].appearance.valueLabels[0].points).toEqual(points);
    const ch = wb.activeSheet.charts[0];
    wb.updateChart(wb.activeSheetId, ch.id, { appearance: { ...ch.appearance,
      valueLabels: [{ ...ch.appearance.valueLabels[0], style: { ...ch.appearance.valueLabels[0].style, color: '#445566' } }] } });
  }
});
it('honors a visible point when series values are off and CT_Boolean omits val', async () => {
  const wb = make('bar', [{ index: 1, show: true }], false), zip = await save(wb);
  const path = '/xl/charts/chart1_1.xml';
  set(zip, path, get(zip, path).replace('<c:showVal val="1"/>', '<c:showVal/>'));
  const back = await open(zip);
  expect(back.activeSheet.charts[0].labels).toBe(true);
  expect(texts(back).map(n => n.textContent)).toEqual(['v 20']);
});
it('keeps point hiding, explicit show=false and explicit unhide independent', async () => {
  const wb = make('column', [{ index: 0, hidden: false }, { index: 1, show: false }, { index: 2, hidden: true }]);
  const ch = wb.activeSheet.charts[0]; ch.appearance.valueLabels[0].hidden = [0];
  expect(texts(wb).map(n => n.textContent)).toEqual(['v 10']);
  const back = await open(await save(wb));
  expect(texts(back).map(n => n.textContent)).toEqual(['v 10']);
});
it('inherits group label settings when the series contains only point exceptions', async () => {
  const zip = await save(make('column', [{ index: 0, style: { size: 12 } }]));
  const path = '/xl/charts/chart1_1.xml';
  set(zip, path, get(zip, path).replace(/<c:dLbls>[\s\S]*?<\/c:dLbls>/,
    '<c:dLbls><c:dLbl><c:idx val="0"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr></a:p></c:txPr></c:dLbl></c:dLbls>')
    .replace('<c:gapWidth', '<c:dLbls><c:dLblPos val="inEnd"/><c:showVal/></c:dLbls><c:gapWidth'));
  const back = await open(zip), options = back.activeSheet.charts[0].appearance.valueLabels[0];
  expect(options.show).toBe(true); expect(options.position).toBe('inEnd');
  expect(options.points).toEqual([{ index: 0, style: { size: 12 } }]);
  const again = await open(await save(back));
  const restored = again.activeSheet.charts[0].appearance.valueLabels[0];
  expect({ ...restored, style: { ...restored.style, size: options.style.size } }).toEqual(options);
  expect(restored.style.size).toBeCloseTo(options.style.size, 2); // native hundredths of a point
});
