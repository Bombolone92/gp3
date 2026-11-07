import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';

const parser = new (new JSDOM('', { url: 'https://test.invalid' }).window.DOMParser)();
const doc = xml => parser.parseFromString(xml, 'application/xml');
const read = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path).content);
const patch = (zip, path, transform) => { const p = X.CFB.find(zip, path); p.content = new TextEncoder().encode(transform(read(zip, path))); p.size = p.content.length; };
const get = (node, name) => node.getElementsByTagNameNS('*', name)[0];
const axisLine = axis => get([...axis.children].find(n => n.localName === 'spPr'), 'ln');
const native = async wb => {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  patch(zip, '/xl/workbook.xml', s => s.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return zip;
};
async function setup({ type = 'column', major = 'out', minor = 'in', color = '2266AA', width = 19050, dash = 'dashDot', axisExtra = '', date = false } = {}) {
  const categories = type === 'scatter' ? [1, 2, 4, 6] : date ? [46052, 46083, 46111, 46142] : ['Alpha', 'Beta', 'Gamma', 'Delta'];
  const wb = new Workbook({ sheets: [{ name: 'Data', charts: [{ type, secondaryAxis: type === 'combo',
    range: { r1: 0, c1: 0, r2: 4, c2: 1 }, anchor: { r: 0, c: 3 }, w: 700, h: 400, yMin: 0, yMax: 10, legend: false,
    sourceRefs: [{ name: 'Values', literal: { categories, values: [2, 5, 9, 4] } },
      ...(type === 'combo' ? [{ name: 'Other', literal: { categories, values: [30, 50, 80, 40] } }] : [])],
    appearance: { plot: { x: .2, y: .2, w: .65, h: .6 }, plotStroke: '#111111', yStep: 2, dateAxis: date, xTimeUnit: date ? 'months' : 'days', xStep: date ? 1 : null },
  }] }] });
  const zip = await native(wb);
  patch(zip, '/xl/charts/chart1_1.xml', xml => xml.replace(/<(c:catAx|c:dateAx|c:valAx)>([\s\S]*?)<\/\1>/g, (_, tag, body) => {
    const tick = (name, value) => value === null ? '' : `<c:${name}${value === '' ? '' : ` val="${value}"`}/>`;
    const fill = color === 'none' ? '<a:noFill/>' : `<a:solidFill><a:srgbClr val="${color}"><a:alpha val="60000"/></a:srgbClr></a:solidFill>`;
    body = body.replace(/<c:majorTickMark[^>]*\/>/g, '').replace('<c:tickLblPos', tick('majorTickMark', major) + tick('minorTickMark', minor) + '<c:tickLblPos')
      .replace('<c:txPr>', `<c:spPr><a:ln w="${width}">${fill}<a:prstDash val="${dash}"/></a:ln></c:spPr><c:txPr>`);
    if (tag === 'c:catAx') body += '<c:tickMarkSkip val="2"/>';
    else body += `<c:minorUnit val="${date && tag === 'c:dateAx' ? 1 : .5}"/>${date && tag === 'c:dateAx' ? '<c:minorTimeUnit val="months"/>' : ''}`;
    return `<${tag}>${body}${axisExtra}</${tag}>`;
  }));
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'axes.xlsx');
}
function draw(wb) {
  const sheet = wb.sheets[0], chart = sheet.charts[0];
  const svg = renderChartSvg(chartData(wb, sheet.id, chart), chart, 700, 400);
  expect(svg).not.toMatch(/NaN|Infinity/);
  return doc(svg);
}

it.each(['column', 'bar', 'line', 'scatter', 'combo'])('preserves %s axis line formatting and tick semantics without sidecar metadata', async type => {
  let wb = await setup({ type });
  for (let pass = 0; pass < 2; pass++) {
    const chart = wb.sheets[0].charts[0], styles = chart.appearance.axisStyles;
    expect(styles.y).toMatchObject({ color: '#2266aa99', width: 2, dash: 'dashDot', majorTick: 'out', minorTick: 'in', minorUnit: .5 });
    expect(styles.x.tickSkip).toBe(type === 'scatter' ? null : 2);
    if (type === 'combo') expect(styles.y2).toEqual(styles.y);
    const svg = draw(wb), line = svg.querySelector('.chart-axis-line.chart-axis-y');
    expect(line.getAttribute('stroke')).toBe('#2266aa99');
    expect(line.getAttribute('stroke-width')).toBe('2');
    expect(line.getAttribute('stroke-dasharray')).toBe('8 6 2 6');
    expect(svg.querySelectorAll('.chart-axis-y.chart-axis-tick-major')).toHaveLength(6);
    expect(svg.querySelectorAll('.chart-axis-y.chart-axis-tick-minor')).toHaveLength(15);
    const zip = await native(wb), xml = doc(read(zip, '/xl/charts/chart1_1.xml'));
    const y = [...xml.getElementsByTagNameNS('*', 'valAx')].find(n => get(n, 'axId').getAttribute('val') === '2');
    expect(get(y, 'majorTickMark').getAttribute('val')).toBe('out');
    expect(get(y, 'minorTickMark').getAttribute('val')).toBe('in');
    expect(axisLine(y).getAttribute('w')).toBe('19050');
    expect(get(y, 'alpha').getAttribute('val')).toBe('60000');
    expect(get(y, 'prstDash').getAttribute('val')).toBe('dashDot');
    expect(get(y, 'minorUnit').getAttribute('val')).toBe('0.5');
    expect([...y.children].map(n => n.localName).indexOf('spPr')).toBeLessThan([...y.children].map(n => n.localName).indexOf('txPr'));
    const copy = wb.duplicateChart(wb.activeSheetId, chart.id);
    expect(wb.chartById(wb.activeSheetId, copy).appearance.axisStyles).toEqual(styles);
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  }
});

it.each(['none', 'in', 'out', 'cross'])('draws %s tick direction on both physical orientations', async kind => {
  for (const type of ['column', 'bar']) {
    const wb = await setup({ type, major: kind, minor: 'none' }), svg = draw(wb);
    const axis = svg.querySelector('.chart-axis-line.chart-axis-y'), ticks = [...svg.querySelectorAll('.chart-axis-y.chart-axis-tick-major')];
    expect(ticks.length).toBe(kind === 'none' ? 0 : 6);
    const dimension = type === 'bar' ? 'y' : 'x', origin = +axis.getAttribute(`${dimension}1`), outward = type === 'bar' ? 1 : -1;
    for (const tick of ticks) {
      const from = (+tick.getAttribute(`${dimension}1`) - origin) * outward;
      const to = (+tick.getAttribute(`${dimension}2`) - origin) * outward;
      expect(from).toBeCloseTo(kind === 'out' ? 0 : -5);
      expect(to).toBeCloseTo(kind === 'in' ? 0 : 5);
    }
    expect(svg.querySelectorAll('.chart-axis-tick-minor')).toHaveLength(0);
  }
});

it('keeps no-fill axes and tick settings while leaving their labels visible', async () => {
  let wb = await setup({ color: 'none', major: 'cross', minor: 'cross' });
  for (let pass = 0; pass < 2; pass++) {
    const svg = draw(wb);
    expect(svg.querySelectorAll('.chart-axis-line, .chart-axis-tick')).toHaveLength(0);
    expect([...svg.querySelectorAll('text')].map(n => n.textContent)).toContain('Alpha');
    const zip = await native(wb), xml = doc(read(zip, '/xl/charts/chart1_1.xml'));
    expect([...xml.getElementsByTagNameNS('*', 'valAx')].every(n => !!get(axisLine(n), 'noFill'))).toBe(true);
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  }
});

it.each([null, ''])('distinguishes automatic and empty tick settings (%s) from explicit none', async value => {
  const wb = await setup({ major: value, minor: value });
  expect(wb.activeSheet.charts[0].appearance.axisStyles.y.majorTick).toBe(value === '' ? 'cross' : null);
  expect(draw(wb).querySelectorAll('.chart-axis-y.chart-axis-tick-major')).toHaveLength(6);
  const zip = await native(wb), y = get(doc(read(zip, '/xl/charts/chart1_1.xml')), 'valAx');
  if (value === null) expect(get(y, 'majorTickMark')).toBeUndefined();
  else expect(get(y, 'majorTickMark').getAttribute('val')).toBe('cross');
});

it('does not couple category tick intervals to label skipping', async () => {
  const wb = await setup(), chart = wb.activeSheet.charts[0];
  chart.appearance.xLabelSkip = 3;
  const svg = draw(wb);
  expect(svg.querySelectorAll('.chart-axis-x.chart-axis-tick-major')).toHaveLength(3);
  expect(svg.querySelectorAll('.chart-axis-x.chart-axis-tick-minor')).toHaveLength(2);
  expect([...svg.querySelectorAll('text')].map(n => n.textContent).filter(t => ['Alpha', 'Beta', 'Gamma', 'Delta'].includes(t))).toEqual(['Alpha', 'Delta']);
});

it('retains calendar minor intervals and major time units in native date axes', async () => {
  const wb = await setup({ date: true });
  expect(wb.activeSheet.charts[0].appearance.axisStyles.x).toMatchObject({ minorUnit: 1, minorTimeUnit: 'months' });
  expect(draw(wb).querySelectorAll('.chart-axis-x.chart-axis-tick-minor')).toHaveLength(0); // Coincident major ticks are not doubled.
  const zip = await native(wb), x = get(doc(read(zip, '/xl/charts/chart1_1.xml')), 'dateAx');
  expect(get(x, 'majorTimeUnit').getAttribute('val')).toBe('months');
  expect(get(x, 'minorTimeUnit').getAttribute('val')).toBe('months');
});

it('retains hairlines, hidden axes, and finite geometry with extreme minor units', async () => {
  const wb = await setup({ width: 0 }), chart = wb.activeSheet.charts[0];
  let line = draw(wb).querySelector('.chart-axis-line.chart-axis-y');
  expect(line.getAttribute('vector-effect')).toBe('non-scaling-stroke');
  chart.appearance.axisStyles.y.minorUnit = 1e-250;
  expect(draw(wb).querySelectorAll('.chart-axis-y.chart-axis-tick-minor').length).toBeLessThanOrEqual(1000);
  chart.appearance.hideYAxis = true;
  expect(draw(wb).querySelectorAll('.chart-axis-y')).toHaveLength(0);
  const bad = normalizeChart({ ...chart, appearance: { axisStyles: { y: { color: 'url(unsafe)', width: Infinity, dash: 'unknown', majorTick: 'maybe', minorTick: 3, minorUnit: -1, tickSkip: 0 } } } });
  expect(bad.appearance.axisStyles.y).toEqual({ color: null, width: null, dash: null, majorTick: null, minorTick: null, minorUnit: null, minorTimeUnit: null, tickSkip: null });
});

it.each([1, 2, 3])('places category minor ticks halfway between major intervals of %s', async tickSkip => {
  const wb = await setup(), chart = wb.activeSheet.charts[0];
  chart.appearance.axisStyles.x.tickSkip = tickSkip;
  for (const between of [true, false]) for (const reverse of [true, false]) {
    chart.appearance.categoryBetween = between;
    chart.appearance.reverseCategories = reverse;
    const svg = draw(wb), line = svg.querySelector('.chart-axis-line.chart-axis-x'), x = +line.getAttribute('x1'), w = +line.getAttribute('x2') - x;
    const ticks = [...svg.querySelectorAll('.chart-axis-x.chart-axis-tick-minor')].map(t => +t.getAttribute('x1'));
    const positions = tickSkip === 1 ? between ? [.5, 1.5, 2.5, 3.5] : [.5, 1.5, 2.5] : tickSkip === 2 ? [1, 3] : [1.5];
    expect(ticks).toHaveLength(positions.length);
    positions.forEach((v, i) => expect(ticks[i]).toBeCloseTo(x + w * (reverse ? 1 - v / (between ? 4 : 3) : v / (between ? 4 : 3)), 1));
  }
});

it('keeps outward ticks on the axis side when the zero crossing is inside the plot', async () => {
  const wb = await setup(), chart = wb.activeSheet.charts[0];
  chart.yMin = -8; chart.yMax = 2;
  const svg = draw(wb), axis = svg.querySelector('.chart-axis-line.chart-axis-x');
  expect(+axis.getAttribute('y1')).toBeGreaterThan(chart.appearance.plot.y * 400);
  for (const tick of svg.querySelectorAll('.chart-axis-x.chart-axis-tick-major')) {
    expect(+tick.getAttribute('y2')).toBeGreaterThan(+tick.getAttribute('y1'));
  }
});

it.each([['column', 'r', 'x', 1], ['bar', 't', 'y', -1]])('points %s outward value ticks away from its %s axis', async (type, yPosition, dimension, direction) => {
  const wb = await setup({ type }), chart = wb.activeSheet.charts[0];
  chart.appearance.yPosition = yPosition;
  // Native crossings now survive setup's XLSX round trip. Moving a native
  // axis must change crosses too: Office ignores a conflicting axPos.
  // Also retain the legacy authored yPosition-only behavior.
  for (const axisCrossings of [{ y: 'max' }, {}]) {
    chart.appearance.axisCrossings = axisCrossings;
    const svg = draw(wb);
    for (const tick of svg.querySelectorAll('.chart-axis-y.chart-axis-tick-major')) {
      expect((+tick.getAttribute(`${dimension}2`) - +tick.getAttribute(`${dimension}1`)) * direction).toBeGreaterThan(0);
    }
  }
});
