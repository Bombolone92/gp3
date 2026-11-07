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
const setPart = (zip, name, text) => { const p = X.CFB.find(zip, name); p.content = new TextEncoder().encode(text); p.size = p.content.length; };
const grid = content => content == null ? '' : `<c:majorGridlines>${content}</c:majorGridlines>`;
const line = content => `<c:spPr><a:ln w="19050">${content}</a:ln></c:spPr>`;

async function setup({ x = '', y = '', between = true, reverse = false, type = 'line' } = {}) {
  const zip = X.CFB.read(new Uint8Array(chartXlsx({ embedded: true })), { type: 'array' });
  let xml = part(zip, '/xl/charts/run.xml').replaceAll('dateAx', 'catAx')
    .replace(/<c:majorGridlines>[\s\S]*?<\/c:majorGridlines>/g, '')
    .replace('<c:catAx>', `<c:catAx><c:scaling><c:orientation val="${reverse ? 'maxMin' : 'minMax'}"/></c:scaling>${grid(x)}`)
    .replace('<c:valAx>', `<c:valAx><c:crossBetween val="${between ? 'between' : 'midCat'}"/>${grid(y)}`);
  if (type === 'bar' || type === 'column') xml = xml.replace('<c:lineChart>', `<c:barChart><c:barDir val="${type === 'bar' ? 'bar' : 'col'}"/><c:grouping val="clustered"/>`).replace('</c:lineChart>', '</c:barChart>');
  if (type === 'date') xml = xml.replaceAll('catAx', 'dateAx');
  if (type === 'scatter') xml = xml.replaceAll('catAx', 'valAx').replaceAll('lineChart', 'scatterChart')
    .replace('<c:scatterChart>', '<c:scatterChart><c:scatterStyle val="lineMarker"/>').replaceAll('c:cat>', 'c:xVal>').replaceAll('c:val>', 'c:yVal>');
  setPart(zip, '/xl/charts/run.xml', xml);
  const wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'axes.xlsx');
  return { wb, sheet: wb.sheets[0], chart: wb.sheets[0].charts[0] };
}
const svgDoc = ({ wb, sheet, chart }) => doc(renderChartSvg(chartData(wb, sheet.id, chart), chart, 600, 400));

async function nativeRoundTrip(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const xml = doc(part(zip, '/xl/charts/chart1_1.xml'));
  setPart(zip, '/xl/workbook.xml', part(zip, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return { xml, back: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx') };
}

it.each(['line', 'column', 'bar', 'date', 'scatter'])('renders independently present default gridlines on %s axes', async type => {
  const state = await setup({ type, y: null });
  expect(state.chart.gridlines).toBe(false);
  expect(state.chart.appearance.xGridlines).toBe(true);
  const svg = svgDoc(state), lines = [...svg.querySelectorAll('.chart-gridline-x')];
  expect(lines.length).toBeGreaterThan(0);
  expect(svg.querySelector('.chart-gridline-y')).toBeNull();
  expect(lines.every(l => type === 'bar' ? l.getAttribute('y1') === l.getAttribute('y2') : l.getAttribute('x1') === l.getAttribute('x2'))).toBe(true);
  state.chart.gridlines = true;
  expect(svgDoc(state).querySelectorAll('.chart-gridline-y').length).toBeGreaterThan(0);
});

it('keeps default gridline elements automatic in native XLSX and distinguishes absent axes', async () => {
  const { wb } = await setup({ x: null });
  const { xml, back } = await nativeRoundTrip(wb);
  const grids = [...xml.getElementsByTagNameNS('*', 'majorGridlines')];
  expect(grids).toHaveLength(1);
  expect(grids[0].children).toHaveLength(0);
  expect(back.sheets[0].charts[0]).toMatchObject({ gridlines: true, appearance: { xGridlines: false, gridlineStyles: { y: { color: null, width: null } } } });
});

it('preserves explicit color, width, transparency and no-fill without mistaking missing formatting for invisibility', async () => {
  const state = await setup({ x: line('<a:solidFill><a:srgbClr val="123456"><a:alpha val="50000"/></a:srgbClr></a:solidFill>'), y: line('<a:noFill/>') });
  expect(state.chart).toMatchObject({ gridlines: false, appearance: { xGridlines: true, gridlineStyles: {
    x: { color: '#12345680', width: 2 }, y: { color: 'none', width: 2 },
  } } });
  const svg = svgDoc(state), x = svg.querySelector('.chart-gridline-x');
  expect(x.getAttribute('stroke')).toBe('#12345680');
  expect(x.getAttribute('stroke-width')).toBe('2');
  expect(svg.querySelector('.chart-gridline-y')).toBeNull();
  const { xml, back } = await nativeRoundTrip(state.wb);
  expect(xml.getElementsByTagNameNS('*', 'alpha')[0].getAttribute('val')).toBe('50196');
  expect(back.sheets[0].charts[0].appearance.gridlineStyles).toEqual(state.chart.appearance.gridlineStyles);
  // Enabling value gridlines must override the previously saved no-fill choice.
  state.chart.gridlines = true;
  expect(svgDoc(state).querySelector('.chart-gridline-y').getAttribute('stroke')).not.toBe('none');
});

it.each([false, true])('aligns category gridlines with native crossing positions, between=%s', async between => {
  const state = await setup({ between });
  const chart = state.chart;
  chart.appearance.plotStroke = '#000000'; chart.appearance.xLabelSkip = 2;
  const svg = svgDoc(state), border = svg.querySelector('.chart-plot-border');
  const left = Number(border.getAttribute('x')), width = Number(border.getAttribute('width'));
  const positions = [...svg.querySelectorAll('.chart-gridline-x')].map(l => Number(l.getAttribute('x1')));
  const expected = between ? [left, left + width / 3, left + width * 2 / 3, left + width] : [left, left + width / 2, left + width];
  expect(positions).toHaveLength(expected.length);
  positions.forEach((position, i) => expect(position).toBeCloseTo(expected[i], 1)); // SVG coordinates round to hundredths.
  const { xml, back } = await nativeRoundTrip(state.wb);
  expect(xml.getElementsByTagNameNS('*', 'crossBetween')[0].getAttribute('val')).toBe(between ? 'between' : 'midCat');
  expect(back.sheets[0].charts[0].appearance.categoryBetween).toBe(between);
});

it('preserves secondary gridlines independently through native export', async () => {
  const state = await setup({ x: null, y: null });
  Object.assign(state.chart, { type: 'combo', secondaryAxis: true });
  Object.assign(state.chart.appearance, { y2Gridlines: true, y2Min: 0, y2Max: 10, y2Step: 5,
    gridlineStyles: { y2: { color: '#008888', width: 2 } } });
  expect(svgDoc(state).querySelectorAll('.chart-gridline-y2')).toHaveLength(3);
  const { back } = await nativeRoundTrip(state.wb);
  expect(back.sheets[0].charts[0]).toMatchObject({ secondaryAxis: true, gridlines: false, appearance: { xGridlines: false, y2Gridlines: true, gridlineStyles: { y2: { color: '#008888', width: 2 } } } });
});

it('draws gridlines independently of category labels and rejects unsafe style values', async () => {
  const state = await setup();
  Object.assign(state.chart.appearance, { hideXAxis: true, xLabelSkip: 99 });
  expect(svgDoc(state).querySelectorAll('.chart-gridline-x')).toHaveLength(4);
  const normalized = normalizeChart({ ...state.chart, appearance: { ...state.chart.appearance, gridlineStyles: { x: { color: 'url(unsafe)', width: Infinity } } } });
  expect(normalized.appearance.gridlineStyles.x).toEqual({ color: null, width: null });
});

it.each(['line', 'bar'])('places reversed on-category grids and a single category consistently on %s charts', async type => {
  const state = await setup({ type, between: false, reverse: true });
  state.chart.appearance.plotStroke = '#000000';
  const svg = svgDoc(state), border = svg.querySelector('.chart-plot-border');
  const coordinate = type === 'bar' ? 'y1' : 'x1', start = Number(border.getAttribute(type === 'bar' ? 'y' : 'x'));
  const extent = Number(border.getAttribute(type === 'bar' ? 'height' : 'width'));
  expect([...svg.querySelectorAll('.chart-gridline-x')].map(n => Number(n.getAttribute(coordinate))))
    .toEqual(type === 'bar' ? [start, start + extent / 2, start + extent] : [start + extent, start + extent / 2, start]);
  state.chart.sourceRefs = state.chart.sourceRefs.map(s => ({ ...s, categories: '', values: '', literal: { categories: ['One'], values: [4] } }));
  const single = svgDoc(state).querySelector('.chart-gridline-x');
  expect(Number(single.getAttribute(coordinate))).toBe(start + extent / 2);
});

it.each([0, -45, 45])('reserves endpoint label overhang for an automatic on-category plot at %s degrees', async angle => {
  const state = await setup({ between: false });
  Object.assign(state.chart.appearance, { plot: null, xRotation: angle, xRotationAuto: false, xLabelSkip: 1 });
  const categories = ['FirstLongCategory', 'Middle', 'LastLongCategory'];
  state.chart.sourceRefs = state.chart.sourceRefs.map(s => ({ ...s, categories: '', values: '', literal: { categories, values: [2, 4, 3] } }));
  const svg = svgDoc(state);
  for (const label of [...svg.querySelectorAll('text')].filter(n => categories.includes(n.textContent))) {
    const size = Number(label.getAttribute('font-size')), width = label.textContent.length * .56 * size;
    const xs = angle < 0 ? [-width, 0] : angle > 0 ? [0, width] : [-width / 2, width / 2];
    const cos = Math.cos(angle * Math.PI / 180), sin = Math.sin(angle * Math.PI / 180);
    const x = Number(label.getAttribute('x'));
    const corners = xs.flatMap(dx => [-.8 * size, .2 * size].map(dy => x + dx * cos - dy * sin));
    expect(Math.min(...corners)).toBeGreaterThan(0);
    expect(Math.max(...corners)).toBeLessThan(600);
  }
});

it.each([{ seriesTypes: undefined }, { seriesTypes: [] }, { seriesTypes: ['unsupported'] }])('keeps ordinary category spacing when mixed-series input is invalid: %j', ({ seriesTypes }) => {
  const base = { range: { r1: 0, c1: 0, r2: 2, c2: 1 }, anchor: { r: 4, c: 0 } };
  expect(normalizeChart({ ...base, type: 'line', appearance: { seriesTypes } }).appearance.categoryBetween).toBe(true);
  expect(normalizeChart({ ...base, type: 'combo', appearance: { seriesTypes: ['area', 'line'] } }).appearance.categoryBetween).toBe(false);
});

it('renders zero-width DrawingML lines as hairlines while preserving native zero width', async () => {
  const state = await setup({ x: line('<a:solidFill><a:srgbClr val="123456"/></a:solidFill>').replace('w="19050"', 'w="0"') });
  expect(state.chart.appearance.gridlineStyles.x.width).toBe(0);
  expect(svgDoc(state).querySelector('.chart-gridline-x').getAttribute('stroke-width')).toBe('1');
  expect(svgDoc(state).querySelector('.chart-gridline-x').getAttribute('vector-effect')).toBe('non-scaling-stroke');
  const { back } = await nativeRoundTrip(state.wb);
  expect(back.sheets[0].charts[0].appearance.gridlineStyles.x.width).toBe(0);
});

it('does not reserve endpoint axis-label margins when a data table replaces the labels', async () => {
  const state = await setup({ between: false });
  state.chart = normalizeChart({ ...state.chart, appearance: { ...state.chart.appearance, plot: null, plotStroke: '#000000',
    dataTable: { horizontal: true, vertical: true, outline: true }, xStyle: { size: 28 } } });
  state.chart.sourceRefs = state.chart.sourceRefs.map(s => ({ ...s, categories: '', values: '', literal: { categories: ['A very long endpoint category', 'Middle', 'Another long endpoint category'], values: [2, 4, 3] } }));
  const border = svgDoc(state).querySelector('.chart-plot-border');
  state.chart.appearance.hideXAxis = true;
  const hidden = svgDoc(state).querySelector('.chart-plot-border');
  expect(border.getAttribute('x')).toBe(hidden.getAttribute('x'));
  expect(border.getAttribute('width')).toBe(hidden.getAttribute('width'));
});
