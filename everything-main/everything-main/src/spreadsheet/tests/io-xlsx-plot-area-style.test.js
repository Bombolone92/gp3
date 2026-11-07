import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { chartXlsx } from './helpers/xlsx-chart-fixture.js';

const parser = new (new JSDOM('', { url: 'https://test.invalid' }).window.DOMParser)();
const get = (node, name) => [...node.children].find(n => n.localName === name);
const doc = xml => parser.parseFromString(xml, 'application/xml');
const read = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path).content);
const patch = (zip, path, text) => { const p = X.CFB.find(zip, path); p.content = new TextEncoder().encode(text); p.size = p.content.length; };
async function source(properties) {
  const zip = X.CFB.read(new Uint8Array(chartXlsx({ embedded: true })), { type: 'array' });
  patch(zip, '/xl/charts/run.xml', read(zip, '/xl/charts/run.xml').replace('</c:plotArea>', `<c:spPr>${properties}</c:spPr></c:plotArea>`));
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'plot.xlsx');
}
const draw = wb => { const s = wb.sheets[0], ch = s.charts[0]; return doc(renderChartSvg(chartData(wb, s.id, ch), ch, 700, 400)); };
async function save(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  patch(zip, '/xl/workbook.xml', read(zip, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  const chart = doc(read(zip, '/xl/charts/chart1_1.xml'));
  const plot = chart.getElementsByTagNameNS('*', 'plotArea')[0];
  return { properties: get(plot, 'spPr'), back: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx') };
}

it.each([0, .5, 3.25])('preserves %s pixel plot outlines, transparency and dashes without private metadata', async width => {
  let wb = await source(`<a:solidFill><a:srgbClr val="DDCCAA"><a:alpha val="40000"/></a:srgbClr></a:solidFill><a:ln w="${Math.round(width * 9525)}"><a:solidFill><a:srgbClr val="225588"><a:alpha val="60000"/></a:srgbClr></a:solidFill><a:prstDash val="lgDashDot"/></a:ln>`);
  // OOXML stores integral EMUs, so fractional CSS lengths retain that precision.
  const expectedWidth = Math.round(width * 9525) / 9525;
  for (let pass = 0; pass < 2; pass++) {
    const ch = wb.sheets[0].charts[0];
    expect(ch.appearance).toMatchObject({ plotFill: '#ddccaa66', plotStroke: '#22558899', plotStrokeWidth: expectedWidth, plotStrokeDash: 'lgDashDot' });
    const svg = draw(wb), border = svg.querySelector('.chart-plot-border');
    expect(border.getAttribute('stroke')).toBe('#22558899');
    expect(+border.getAttribute('stroke-width')).toBe(expectedWidth || 1);
    expect(border.getAttribute('vector-effect')).toBe(width === 0 ? 'non-scaling-stroke' : null);
    expect(svg.querySelector('rect[fill="#ddccaa66"]')).toBeTruthy();
    expect(svg.querySelector('.chart-plot-border, .chart-axis-line, .chart-series')).toBe(border); // Axes and data paint over the plot outline.
    const { properties, back } = await save(wb), line = get(properties, 'ln');
    expect(+line.getAttribute('w')).toBe(Math.round(width * 9525));
    expect(get(line, 'prstDash').getAttribute('val')).toBe('lgDashDot');
    expect(get(get(get(line, 'solidFill'), 'srgbClr'), 'alpha').getAttribute('val')).toBe('60000');
    expect(get(get(get(properties, 'solidFill'), 'srgbClr'), 'alpha').getAttribute('val')).toBe('40000');
    wb = back;
  }
});

it('distinguishes an automatic plot outline from explicitly no outline', async () => {
  for (const hidden of [true, false]) {
    const wb = await source(hidden ? '<a:noFill/><a:ln><a:noFill/></a:ln>' : '<a:noFill/>');
    expect(wb.sheets[0].charts[0].appearance.plotStroke).toBe(hidden ? 'none' : null);
    expect(wb.sheets[0].charts[0].appearance.plotStrokeWidth).toBeNull();
    expect(draw(wb).querySelector('.chart-plot-border')).toBeNull();
    const { properties, back } = await save(wb), line = get(properties, 'ln');
    if (hidden) expect(get(line, 'noFill')).toBeTruthy();
    else expect(line).toBeUndefined();
    expect(back.sheets[0].charts[0].appearance.plotStroke).toBe(hidden ? 'none' : null);
  }
});

it('retains a width-only automatic-color outline and resolves theme colors', async () => {
  const widthOnly = await source('<a:ln w="28575"/>');
  expect(draw(widthOnly).querySelector('.chart-plot-border').getAttribute('stroke-width')).toBe('3');
  const { properties } = await save(widthOnly);
  expect(get(get(properties, 'ln'), 'solidFill')).toBeUndefined();
  const themed = await source('<a:ln><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:ln>');
  expect(themed.sheets[0].charts[0].appearance.plotStroke).toBe('#ff723a');
  expect((await save(themed)).back.sheets[0].charts[0].appearance.plotStroke).toBe('#ff723a');
});

it('exports the edited outline and retains formatting on chart duplication', async () => {
  const wb = await source('<a:ln><a:noFill/></a:ln>'), sheet = wb.sheets[0], chart = sheet.charts[0];
  wb.updateChart(sheet.id, chart.id, { appearance: { ...chart.appearance, plotStroke: '#113355', plotStrokeWidth: 4, plotStrokeDash: 'dot' } });
  const copy = wb.duplicateChart(sheet.id, chart.id);
  expect(wb.chartById(sheet.id, copy).appearance).toEqual(wb.chartById(sheet.id, chart.id).appearance);
  const { back } = await save(wb);
  expect(back.sheets[0].charts[0].appearance).toMatchObject({ plotStroke: '#113355', plotStrokeWidth: 4, plotStrokeDash: 'dot' });
});
