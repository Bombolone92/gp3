import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const decode = part => new TextDecoder().decode(part.content);
function fixture() {
  return new Workbook({ sheets: [{ name: 'Report', charts: [{ type: 'radar', title: 'Performance', anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 3, c2: 2 },
    sourceRefs: [{ name: 'North', categories: 'Data!A1:A4', values: 'Data!B1:B4' }, { name: 'South', categories: 'Data!A1:A4', values: 'Data!C1:C4' }] }] },
  { name: 'Data', cells: Object.fromEntries(['Quality', 'Speed', 'Cost', 'Support'].flatMap((v, r) => [[`${r},0`, { v }], [`${r},1`, { v: [4,7,3,6][r] }], [`${r},2`, { v: [6,2,8,5][r] }]])) }] });
}
const chart = wb => wb.activeSheet.charts[0];
function draw(wb, width = 640, height = 420) {
  const ch = chart(wb), svg = renderChartSvg(chartData(wb, wb.activeSheetId, ch), ch, width, height);
  expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  return new JSDOM(svg).window.document;
}
async function cycle(wb, mutate, metadata = false) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const path = '/xl/charts/chart1_1.xml'; let xml = decode(X.CFB.find(zip, path));
  if (mutate) { xml = mutate(xml); X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(xml)); }
  if (!metadata) {
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(decode(part).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  }
  return { wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' })), xml };
}
async function imported(style) {
  return (await cycle(fixture(), xml => xml.replace(/<c:radarStyle val="marker"\/>/, `<c:radarStyle val="${style}"/>`)
    .replace(/<c:marker>[\s\S]*?<\/c:marker>/g, ''))).wb;
}
it.each(['standard', 'marker', 'filled'])('imports and retains native %s radar semantics through two further cycles', async style => {
  let wb = await imported(style);
  for (let pass = 0; pass < 3; pass++) {
    expect(wb.activeSheet.charts).toHaveLength(1); expect(chart(wb).type).toBe('radar');
    expect(chart(wb).appearance.radar.style).toBe(style);
    expect(chartData(wb, wb.activeSheetId, chart(wb)).series.map(s => s.values)).toEqual([[4,7,3,6],[6,2,8,5]]);
    const doc = draw(wb), paths = [...doc.querySelectorAll('.chart-radar-series')];
    expect(paths).toHaveLength(2);
    expect(doc.querySelectorAll('.chart-radar-marker')).toHaveLength(style === 'marker' ? 8 : 0);
    expect(paths.every(p => p.getAttribute('fill') === 'none')).toBe(style !== 'filled');
    expect(doc.querySelectorAll('.chart-radar-category')).toHaveLength(4);
    if (pass < 2) { const next = await cycle(wb); expect(next.xml).toContain(`<c:radarStyle val="${style}"/>`); wb = next.wb; }
  }
});
it('retains independent fill alpha, stroke, dash and explicit marker shape overrides', async () => {
  let wb = await imported('filled');
  const json = wb.toJSON(), ch = json.sheets[0].charts[0];
  ch.colors = []; ch.appearance.radar.series[0] = { fill: '#2277bb66', stroke: '#ee1133', dash: 'dash', markerSymbol: 'diamond' };
  ch.appearance.lines[0] = { width: 3, marker: true, markerSize: 10, markerFill: '#22cc33', markerStroke: '#000000' };
  wb = new Workbook(json);
  for (let pass = 0; pass < 2; pass++) {
    const result = await cycle(wb); wb = result.wb;
    expect(result.xml).toContain('<a:alpha val="40000"/>');
    expect(result.xml).toContain('<c:symbol val="diamond"/>');
    const doc = draw(wb), first = doc.querySelector('.chart-radar-series');
    expect(first.getAttribute('fill')).toBe('#2277bb66'); expect(first.getAttribute('stroke')).toBe('#ee1133');
    expect(first.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(doc.querySelector('.chart-radar-marker').tagName.toLowerCase()).toBe('polygon');
  }
});
it('retains gradient artwork and saved manual layout without mutating the source', async () => {
  const wb = await imported('filled'), ch = chart(wb);
  ch.colors = []; ch.appearance.radar.series[0].fill = null;
  ch.appearance.radar.series[0].gradient = { angle: 45, stops: [{ offset: 0, color: '#123456', opacity: .25 }, { offset: 1, color: '#abcdef', opacity: 1 }] };
  ch.appearance.plot = { x: .25, y: .25, w: .5, h: .5 };
  const before = JSON.stringify(ch), result = await cycle(wb), doc = draw(result.wb);
  expect(result.wb.activeSheet.charts[0].appearance.radar.series[0].gradient.stops).toHaveLength(2);
  expect(doc.querySelector('linearGradient')).not.toBeNull(); expect(doc.querySelector('stop').getAttribute('stop-opacity')).toBe('0.25');
  expect(JSON.stringify(ch)).toBe(before);
});
it('keeps references live through editing, sheet copy, JSON and metadata', async () => {
  const wb = await imported('marker'); wb.setInput(wb.sheets[1].id, 1, 1, '12');
  let copy = wb.sheetToWorkbook(wb.activeSheetId, { sourceWorkbook: '/Source.xlsx' });
  copy = new Workbook(copy.toJSON()); copy = (await cycle(copy, null, true)).wb; copy = (await cycle(copy)).wb;
  expect(chartData(copy, copy.activeSheetId, chart(copy)).series[0].values).toEqual([4,12,3,6]);
  expect(draw(copy).querySelectorAll('.chart-radar-marker')).toHaveLength(8);
});
it.each(['gap', 'span', 'zero'])('preserves %s blank handling without connecting gaps across missing categories', async blanks => {
  let wb = await imported('standard'); wb.setInput(wb.sheets[1].id, 1, 1, ''); chart(wb).appearance.radar.blanks = blanks;
  const result = await cycle(wb); wb = result.wb;
  expect(result.xml).toContain(`<c:dispBlanksAs val="${blanks}"/>`);
  const path = draw(wb).querySelector('.chart-radar-series').getAttribute('d');
  expect(path.endsWith('Z')).toBe(blanks !== 'gap');
  expect((path.match(/L/g) || []).length).toBe(blanks === 'zero' ? 3 : 2);
});
it.each([false, true])('plots negative values on a finite radial scale and reverses it, reverse=%s', async reverse => {
  const wb = await imported('marker'); wb.setInput(wb.sheets[1].id, 0, 1, '-4'); wb.setInput(wb.sheets[1].id, 1, 1, '-1');
  chart(wb).yMin = -5; chart(wb).yMax = 10; chart(wb).appearance.reverseValues = reverse;
  const doc = draw(wb), first = doc.querySelector('.chart-radar-marker'), clip = doc.querySelector('clipPath circle');
  const cy = +clip.getAttribute('cy'), radius = +clip.getAttribute('r'), distance = Math.abs(+first.getAttribute('cy') - cy);
  expect(distance / radius).toBeCloseTo(reverse ? 14/15 : 1/15, 3);
});
it.each([1,2,60])('keeps native radar data with %s categories drawable', async count => {
  const wb = await imported('marker'), ch = chart(wb);
  ch.sourceRefs = [{ name: 'Series', literal: { categories: Array.from({length:count},(_,i)=>`P${i}`), values: Array.from({length:count},(_,i)=>i+1) } }];
  const next = (await cycle(wb)).wb;
  expect(draw(next, 240, 180).querySelectorAll('.chart-radar-series')).toHaveLength(1);
  expect(chartData(next, next.activeSheetId, chart(next)).categories).toHaveLength(count);
});
it('normalizes malformed radar style/artwork and retains the authored renderer', () => {
  const ch = normalizeChart({ type: 'radar', anchor: {r:0,c:0}, range: {r1:0,c1:0,r2:3,c2:1}, appearance: { radar: { style: '<bad>', blanks: 'bad', series: [{fill:'red',stroke:'javascript:',markerSymbol:'<bad>'}] } } });
  expect(ch.appearance.radar.style).toBe('standard'); expect(ch.appearance.radar.blanks).toBe('gap'); expect(ch.appearance.radar.series[0].fill).toBeNull();
  const source = fixture(), svg = renderChartSvg(chartData(source, source.activeSheetId, chart(source)), chart(source), 640, 420);
  expect(svg.match(/fill-opacity="0.18"/g)).toHaveLength(2); expect(svg.match(/<circle /g)).toHaveLength(8);
});

it.each(['standard', 'marker'])('retains transparent %s series lines through native cycles', async style => {
  let wb = await imported(style);
  chart(wb).colors = [];
  chart(wb).appearance.radar.series[0].stroke = '#12345666';
  for (let pass = 0; pass < 2; pass++) {
    const next = await cycle(wb); wb = next.wb;
    expect(next.xml).toContain('<a:alpha val="40000"/>');
    expect(draw(wb).querySelector('.chart-radar-series').getAttribute('stroke')).toBe('#12345666');
  }
});
it('renders empty and entirely blank native radar data without invalid coordinates', async () => {
  const wb = await imported('marker');
  chart(wb).sourceRefs = [{ name: 'Empty', literal: { categories: [], values: [] } }];
  expect(draw(wb).querySelectorAll('.chart-radar-series')).toHaveLength(0);
  chart(wb).sourceRefs = [{ name: 'Blank', literal: { categories: ['A', 'B', 'C'], values: [null, null, null] } }];
  expect(draw(wb).querySelectorAll('.chart-radar-marker')).toHaveLength(0);
});
