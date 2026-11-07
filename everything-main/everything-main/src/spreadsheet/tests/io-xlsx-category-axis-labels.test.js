import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { chartXlsx } from './helpers/xlsx-chart-fixture.js';

const parser = new (new JSDOM('').window.DOMParser)();
const doc = xml => parser.parseFromString(xml, 'application/xml');
const part = (zip, name) => new TextDecoder().decode(X.CFB.find(zip, name).content);

function source({ angle = -35, rotation = angle == null ? null : angle * 60000, skip = 1, type = 'line', manual = false } = {}) {
  const zip = X.CFB.read(new Uint8Array(chartXlsx({ embedded: true })), { type: 'array' });
  const file = X.CFB.find(zip, '/xl/charts/run.xml');
  let xml = part(zip, '/xl/charts/run.xml').replaceAll('dateAx', 'catAx');
  xml = xml.replace('<c:catAx>', `<c:catAx>${skip == null ? '' : `<c:tickLblSkip val="${skip}"/>`}`)
    .replace(/(<c:catAx>[\s\S]*?<c:txPr>)/, `$1<a:bodyPr${rotation == null ? '' : ` rot="${rotation}"`}/>`);
  if (!manual) xml = xml.replace(/<c:layout>[\s\S]*?<\/c:layout>/g, '');
  if (type !== 'line') xml = xml.replace('<c:lineChart>', `<c:barChart><c:barDir val="${type === 'bar' ? 'bar' : 'col'}"/><c:grouping val="clustered"/>`)
    .replace('</c:lineChart>', '</c:barChart>');
  file.content = new TextEncoder().encode(xml); file.size = file.content.length;
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

async function setup(options) {
  const wb = await workbookFromFile(source(options), 'categories.xlsx'), sheet = wb.sheets[0];
  ['First category', 'Second category', 'Third category'].forEach((v, r) => wb.setInput(sheet.id, r, 0, v));
  return { wb, sheet, chart: sheet.charts[0] };
}
const labels = svg => [...doc(svg).getElementsByTagName('text')].filter(n => /^(First|Second|Third) category$/.test(n.textContent));

it.each(['line', 'column', 'bar'])('honors saved category rotation and label intervals on %s charts', async type => {
  const { wb, sheet, chart } = await setup({ type, angle: 30, skip: 2 });
  expect(chart.appearance).toMatchObject({ xRotation: 30, xRotationAuto: false, xLabelSkip: 2 });
  const nodes = labels(renderChartSvg(chartData(wb, sheet.id, chart), chart, 570, 350));
  expect(nodes.map(n => n.textContent)).toEqual(['First category', 'Third category']);
  expect(nodes.every(n => n.getAttribute('transform').startsWith('rotate(30 '))).toBe(true);
});

it.each([-70, -35, 25, 90])('keeps %s degree category labels within automatic bottom layout without changing explicit plot layout', async angle => {
  const { wb, sheet, chart } = await setup({ angle });
  const nodes = labels(renderChartSvg(chartData(wb, sheet.id, chart), chart, 570, 220));
  expect(nodes).toHaveLength(3); // Explicit skip=1 is never silently replaced by automatic thinning.
  for (const node of nodes) {
    expect(node.getAttribute('transform')).toContain(`rotate(${angle} `);
    expect(node.getAttribute('text-anchor')).toBe(angle < 0 ? 'end' : 'start');
    expect(Number(node.getAttribute('y'))).toBeLessThan(220);
  }
  const manual = { ...chart, appearance: { ...chart.appearance, plot: { x: .2, y: .2, w: .6, h: .4 }, plotStroke: '#000000' } };
  const border = doc(renderChartSvg(chartData(wb, sheet.id, manual), manual, 570, 220)).querySelector('.chart-plot-border');
  expect(Number(border.getAttribute('y'))).toBe(44);
  expect(Number(border.getAttribute('height'))).toBe(88);
});

it.each([-270, -180, -135, -90, -35, 35, 90, 135, 180, 270, 450])('centers rotated bar labels at %s degrees and leaves room at both chart edges', async angle => {
  const { wb, sheet, chart } = await setup({ type: 'bar', angle });
  chart.appearance.plotStroke = '#000000';
  const svg = renderChartSvg(chartData(wb, sheet.id, chart), chart, 570, 310);
  const border = doc(svg).querySelector('.chart-plot-border');
  const plotY = Number(border.getAttribute('y')), plotH = Number(border.getAttribute('height'));
  const radians = angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  labels(svg).forEach((node, i) => {
    const size = Number(node.getAttribute('font-size')), width = node.textContent.length * .56 * size;
    const x = Number(node.getAttribute('x')), y = Number(node.getAttribute('y'));
    // Transform all corners of the end-anchored text's em box, including descent.
    const corners = [-width, 0].flatMap(dx => [-.8 * size, .2 * size].map(dy =>
      ({ x: x + dx * cos - dy * sin, y: y + dx * sin + dy * cos })));
    const top = Math.min(...corners.map(p => p.y)), bottom = Math.max(...corners.map(p => p.y));
    const expectedY = plotY + plotH * (chart.appearance.reverseCategories ? (i + .5) / 3 : 1 - (i + .5) / 3);
    expect((top + bottom) / 2).toBeCloseTo(expectedY, 1);
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeLessThan(310);
    expect(Math.min(...corners.map(p => p.x))).toBeGreaterThan(0);
    expect(Math.max(...corners.map(p => p.x))).toBeCloseTo(Number(border.getAttribute('x')) - 10, 1);
  });
});

it('distinguishes explicit horizontal text from automatic rotation and rejects malformed intervals', async () => {
  const { wb, sheet, chart } = await setup({ type: 'column', angle: 0 });
  let svg = renderChartSvg(chartData(wb, sheet.id, chart), chart, 200, 220);
  expect(labels(svg).every(n => !n.hasAttribute('transform'))).toBe(true);
  const auto = { ...chart, appearance: { ...chart.appearance, xRotationAuto: true } };
  svg = renderChartSvg(chartData(wb, sheet.id, auto), auto, 200, 220);
  expect(labels(svg).every(n => n.getAttribute('transform')?.startsWith('rotate(-45 '))).toBe(true);
  for (const xLabelSkip of [0, -1, 1.5, Infinity, 4294967296]) {
    expect(normalizeChart({ ...chart, appearance: { ...chart.appearance, xLabelSkip } }).appearance.xLabelSkip).toBeUndefined();
  }
});

it.each([null, 0, -35])('retains %s rotation and category intervals in native XLSX independently of metadata', async angle => {
  const { wb, chart } = await setup({ angle, skip: 2 });
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const xml = doc(part(zip, '/xl/charts/chart1_1.xml'));
  const cat = xml.getElementsByTagNameNS('*', 'catAx')[0];
  expect(cat.getElementsByTagNameNS('*', 'tickLblSkip')[0].getAttribute('val')).toBe('2');
  expect(cat.getElementsByTagNameNS('*', 'bodyPr')[0].getAttribute('rot')).toBe(angle == null ? null : String(angle * 60000));
  const file = X.CFB.find(zip, '/xl/workbook.xml');
  file.content = new TextEncoder().encode(part(zip, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  file.size = file.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect(back.sheets[0].charts[0].appearance).toMatchObject({ xRotation: chart.appearance.xRotation,
    xRotationAuto: angle == null, xLabelSkip: 2 });
});

it.each([-60000000, -60000001])('imports Excel rotation sentinel %s as automatic, not explicit horizontal text', async rotation => {
  // Desktop Excel probes with both short and long category names
  // render these identically to omitted rot. Explicit rot=0 disables rotation.
  const { wb, sheet, chart } = await setup({ type: 'column', rotation, skip: null });
  expect(chart.appearance).toMatchObject({ xRotation: 0, xRotationAuto: true });
  const data = chartData(wb, sheet.id, chart);
  const narrow = labels(renderChartSvg(data, chart, 240, 350));
  expect(narrow).toHaveLength(3);
  expect(narrow.every(n => n.getAttribute('transform')?.startsWith('rotate(-45 '))).toBe(true);
  const wide = labels(renderChartSvg(data, chart, 1500, 350));
  expect(wide).toHaveLength(3);
  expect(wide.every(n => !n.hasAttribute('transform'))).toBe(true);
  const copy = wb.duplicateChart(sheet.id, chart.id);
  expect(wb.chartById(sheet.id, copy).appearance).toEqual(chart.appearance);

  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const axis = doc(part(zip, '/xl/charts/chart1_1.xml')).getElementsByTagNameNS('*', 'catAx')[0];
  // Canonical automatic representation; never bake the renderer's current angle
  // into the file, since Excel must be able to lay out resized charts again.
  expect(axis.getElementsByTagNameNS('*', 'bodyPr')[0].hasAttribute('rot')).toBe(false);
  const file = X.CFB.find(zip, '/xl/workbook.xml');
  file.content = new TextEncoder().encode(part(zip, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  file.size = file.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect(back.sheets[0].charts[0].appearance).toMatchObject({ xRotation: 0, xRotationAuto: true });
});

it.each([135, -135, 180, -180, 225, -225, 270, -270, 360, -360, 450])('retains full DrawingML rotation %s and lays out its rotated bounds', async angle => {
  const { wb, sheet, chart } = await setup({ type: 'column', angle });
  expect(chart.appearance).toMatchObject({ xRotation: angle, xRotationAuto: false });
  chart.appearance.plotStroke = '#000000';
  const svg = renderChartSvg(chartData(wb, sheet.id, chart), chart, 700, 400), xml = doc(svg);
  const border = xml.querySelector('.chart-plot-border'), bottom = +border.getAttribute('y') + +border.getAttribute('height');
  for (const node of labels(svg)) {
    expect(node.getAttribute('transform')).toContain(`rotate(${angle} `);
    const size = +node.getAttribute('font-size'), w = node.textContent.length * .56 * size;
    const anchor = node.getAttribute('text-anchor'), dx = anchor === 'end' ? -w : anchor === 'middle' ? -w / 2 : 0;
    const x = +node.getAttribute('x'), y = +node.getAttribute('y');
    const cos = Math.cos(angle * Math.PI / 180), sin = Math.sin(angle * Math.PI / 180);
    const corners = [dx, dx + w].flatMap(px => [-.8 * size, .2 * size].map(py => ({ x: x + px * cos - py * sin, y: y + px * sin + py * cos })));
    expect(Math.min(...corners.map(p => p.x))).toBeGreaterThan(0);
    expect(Math.max(...corners.map(p => p.x))).toBeLessThan(700);
    expect(Math.min(...corners.map(p => p.y))).toBeGreaterThan(bottom + 5.9);
    expect(Math.max(...corners.map(p => p.y))).toBeLessThan(400);
  }
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const cat = doc(part(zip, '/xl/charts/chart1_1.xml')).getElementsByTagNameNS('*', 'catAx')[0];
  expect(cat.getElementsByTagNameNS('*', 'bodyPr')[0].getAttribute('rot')).toBe(String(angle * 60000));
  const book = X.CFB.find(zip, '/xl/workbook.xml');
  book.content = new TextEncoder().encode(part(zip, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); book.size = book.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect(back.sheets[0].charts[0].appearance).toMatchObject({ xRotation: angle, xRotationAuto: false });
  const copy = wb.duplicateChart(sheet.id, chart.id);
  expect(wb.chartById(sheet.id, copy).appearance.xRotation).toBe(angle);
});

it.each([[0, 'middle'], [180, 'end'], [-180, 'start'], [360, 'start'], [-360, 'end']])('preserves Excel alignment for the signed rotation %s', async (angle, anchor) => {
  // Desktop Excel probes: full turns and opposite half turns are
  // visually equivalent rotations, but their label alignment is not equivalent.
  const { wb, sheet, chart } = await setup({ angle });
  expect(labels(renderChartSvg(chartData(wb, sheet.id, chart), chart, 700, 400)).map(n => n.getAttribute('text-anchor'))).toEqual([anchor, anchor, anchor]);
});

it.each(['NaN', '', '3.5', '2147483648', '-2147483649'])('treats invalid ST_Angle %s as automatic without inventing a clamped angle', async rotation => {
  const { chart } = await setup({ rotation });
  expect(chart.appearance).toMatchObject({ xRotation: 0, xRotationAuto: true });
});

it.each([-2147483648, 2147483647])('preserves the signed ST_Angle boundary %s', async rotation => {
  const { chart } = await setup({ rotation });
  expect(chart.appearance).toMatchObject({ xRotation: rotation / 60000, xRotationAuto: false });
});
