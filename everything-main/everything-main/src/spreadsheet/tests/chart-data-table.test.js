// @vitest-environment jsdom
import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { renderChartSvg, standaloneSvg } from '../src/ui/chartsvg.js';
import { chartXlsx } from './helpers/xlsx-chart-fixture.js';

const xml = bytes => new TextDecoder().decode(bytes);
const bytesOf = blob => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result)); reader.onerror = reject; reader.readAsArrayBuffer(blob);
});
function patch(zip, path, transform) {
  const entry = X.CFB.find(zip, path);
  entry.content = new TextEncoder().encode(transform(xml(entry.content))); entry.size = entry.content.length;
}
function fixture(flags = '<c:showHorzBorder/><c:showVertBorder val="1"/><c:showOutline val="true"/><c:showKeys val="1"/>') {
  const zip = X.CFB.read(new Uint8Array(chartXlsx({ embedded: true })), { type: 'array' });
  patch(zip, '/xl/charts/run.xml', text => text.replace('</c:plotArea>', `<c:dTable>${flags}<c:spPr><a:noFill/><a:ln w="19050"><a:solidFill><a:srgbClr val="445566"/></a:solidFill></a:ln></c:spPr><c:txPr><a:p><a:pPr><a:defRPr sz="1050" b="1"><a:solidFill><a:srgbClr val="224466"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:pPr></a:p></c:txPr></c:dTable></c:plotArea>`));
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
const render = (wb, size = [700, 450]) => {
  const sheet = wb.sheets[0], chart = sheet.charts[0];
  const svg = renderChartSvg(chartData(wb, sheet.id, chart), chart, ...size);
  expect(svg).not.toMatch(/NaN|Infinity/);
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return { svg, doc, table: doc.querySelector('.chart-data-table') };
};

it('imports table text, borders and keys, renders live values, and exports native DrawingML', async () => {
  let wb = await workbookFromFile(fixture(), 'external.xlsx');
  const expected = { horizontal: true, vertical: true, outline: true, keys: true, fill: 'none', stroke: '#445566', width: 2,
    style: { size: 14, bold: true, color: '#224466', font: 'arial' } };
  for (let pass = 0; pass < 3; pass++) {
    expect(wb.sheets[0].charts[0].appearance.dataTable).toEqual(expected);
    const { table } = render(wb);
    expect(table.querySelectorAll('[role="row"]')).toHaveLength(3);
    expect(table.querySelectorAll('[role="cell"]')).toHaveLength(11);
    expect(table.textContent).toContain('Daily average');
    expect(table.querySelectorAll('.chart-table-key')).toHaveLength(3); // line+marker, line
    expect(table.querySelector('.chart-table-borders').getAttribute('stroke')).toBe('#445566');
    const bytes = await bytesOf(await workbookToXlsx(wb)), zip = X.CFB.read(bytes, { type: 'array' });
    const native = xml(X.CFB.find(zip, '/xl/charts/chart1_1.xml').content);
    expect(native).toContain('<c:dTable><c:showHorzBorder val="1"/>');
    expect(native).toContain('<a:ln w="19050">');
    patch(zip, '/xl/workbook.xml', text => text.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  }
  wb.setInput(wb.sheets[0].id, 0, 1, '23.75');
  expect(render(wb).table.textContent).toContain('23.8');
  expect(render(wb).table.textContent).not.toContain('2.8');
});

it('distinguishes omitted and false flags from a present boolean with its default value', async () => {
  const wb = await workbookFromFile(fixture('<c:showHorzBorder val="false"/><c:showOutline val="0"/><c:showKeys/>'), 'flags.xlsx');
  expect(wb.sheets[0].charts[0].appearance.dataTable).toMatchObject({ horizontal: false, vertical: false, outline: false, keys: true });
  expect(render(wb).table.querySelector('.chart-table-borders')).toBeNull();
  wb.sheets[0].charts[0].appearance.dataTable.keys = false;
  expect(render(wb).table.querySelector('.chart-table-key')).toBeNull();
});

it.each(['column', 'bar', 'line', 'area', 'combo'])('retains actual values in %s tables across stacked plots, resizes and copies', async type => {
  const wb = await workbookFromFile(fixture(), 'table.xlsx'), sheet = wb.sheets[0];
  sheet.charts[0] = normalizeChart({ ...sheet.charts[0], type, stacked: true, stack100: true, legend: false,
    sourceRefs: [{ name: 'Revenue & refunds', literal: { categories: ['First', 'Second', 'Third'], values: [1500, -2250, null] }, valueFormat: '$#,##0.00' },
      { name: 'Margin', literal: { categories: ['First', 'Second', 'Third'], values: [.25, .5, .75] }, valueFormat: '0%' }],
    appearance: { ...sheet.charts[0].appearance, plot: null, dateAxis: false, yUnits: { builtIn: 'thousands' } } });
  for (const size of [[800, 500], [400, 240], [120, 80]]) {
    const { table, svg } = render(wb, size);
    expect(table.textContent).toContain('$1,500.00');
    expect(table.textContent).toContain('-$2,250.00');
    expect(table.textContent).toContain('25%');
    expect(table.querySelectorAll('[role="cell"]')).toHaveLength(11);
    expect(standaloneSvg(svg, () => '')).toContain('Chart data'); // same SVG powers Copy as picture
  }
  const copy = wb.duplicateChart(sheet.id, sheet.charts[0].id);
  const duplicate = sheet.charts.find(c => c.id === copy);
  expect(duplicate.appearance.dataTable).toEqual(sheet.charts[0].appearance.dataTable);
  duplicate.appearance.dataTable.style.size = 19;
  expect(sheet.charts[0].appearance.dataTable.style.size).toBe(14);
});

it('keeps table text escaped and handles empty data and malformed table dimensions', async () => {
  const wb = await workbookFromFile(fixture(), 'invalid.xlsx'), sheet = wb.sheets[0];
  sheet.charts[0] = normalizeChart({ ...sheet.charts[0], sourceRefs: [{ name: '<script>unsafe</script>', literal: { categories: ['<x>'], values: [1] } }],
    appearance: { dataTable: { outline: true, width: NaN, style: { size: Infinity } } } });
  const { table, doc } = render(wb);
  expect(doc.querySelector('script')).toBeNull();
  expect(table.textContent).toContain('<script>unsafe</script>');
  expect(sheet.charts[0].appearance.dataTable.width).toBe(1);
  sheet.charts[0].sourceRefs[0].literal = { categories: [], values: [] };
  expect(render(wb).table).toBeNull();
});

it('retains blank entries and reserves space beneath a manual plot without covering the legend', async () => {
  const wb = await workbookFromFile(fixture(), 'layout.xlsx'), sheet = wb.sheets[0];
  sheet.charts[0] = normalizeChart({ ...sheet.charts[0], type: 'area', legendPos: 'bottom',
    sourceRefs: [{ name: 'Not reported yet', literal: { categories: ['A', 'B'], values: [null, null] } }],
    appearance: { ...sheet.charts[0].appearance, dateAxis: false } });
  expect(render(wb).table.querySelectorAll('[role="cell"]')).toHaveLength(5);
  sheet.charts[0] = normalizeChart({ ...sheet.charts[0], type: 'column',
    appearance: { ...sheet.charts[0].appearance, plot: { x: .2, y: .15, w: .7, h: .8 }, legend: { x: .1, y: .9, w: .8, h: .1 }, legendPos: 'bottom' } });
  for (const size of [[600, 400], [1200, 800]]) {
    const { table, doc } = render(wb, size);
    const [, x, y, scale] = table.getAttribute('transform').match(/translate\((\S+) (\S+)\) scale\(1 (\S+)\)/).map(Number);
    const height = Number(table.querySelector('rect').getAttribute('height')) * scale;
    const plot = doc.querySelector('clipPath rect');
    expect(y).toBeCloseTo(Number(plot.getAttribute('y')) + Number(plot.getAttribute('height')) - 1, 1);
    expect(y + height).toBeLessThanOrEqual(size[1] * .9);
    const header = table.querySelector('[role="cell"]');
    expect(x + Number(header.getAttribute('x'))).toBeCloseTo(size[0] * .2, 1);
  }
});
