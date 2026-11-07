import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { chartData } from '../src/core/charts.js';
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
function styled(style, legendPos = 'bottom') {
  const wb = fixture(), ch = chart(wb);
  ch.legendPos = legendPos;
  ch.colors = [];
  ch.appearance = { radar: { style, series: [0,1].map(i => ({
    stroke: i ? '#66009999' : '#aa004466', dash: i ? 'dot' : 'dash', markerSymbol: i ? 'square' : 'diamond',
    gradient: { angle: i ? 90 : 0, stops: [{offset:0,color:'#123456',opacity:.4},{offset:1,color:'#eeaa00',opacity:1}] },
  })) }, lines: [0,1].map(i => ({width:i+2,marker:style==='marker',markerSize:9,markerFill:'#00aa6699',markerStroke:'#770099'})) };
  return new Workbook(wb.toJSON());
}
function keys(doc) { return [...doc.querySelectorAll('.chart-radar-legend-key')]; }
function samePaint(doc, style) {
  const paths = [...doc.querySelectorAll('.chart-radar-series')];
  expect(keys(doc)).toHaveLength(2);
  for (const key of keys(doc)) {
    const index = Number(key.getAttribute('data-series'));
    const sample = key.querySelector(style === 'filled' ? 'rect' : 'line');
    expect(sample).not.toBeNull();
    for (const attr of ['stroke','stroke-width','stroke-dasharray']) expect(sample.getAttribute(attr)).toBe(paths[index].getAttribute(attr));
    if (style === 'filled') {
      expect(sample.getAttribute('fill')).toBe(paths[index].getAttribute('fill'));
      expect(sample.getAttribute('fill')).toMatch(/^url\(#/);
      const id = sample.getAttribute('fill').slice(5,-1);
      expect(doc.getElementById(id).querySelectorAll('stop')).toHaveLength(2);
    }
    const mark = key.querySelector('.chart-radar-legend-marker');
    expect(!!mark).toBe(style === 'marker');
    if (mark) { expect(mark.getAttribute('fill')).toBe('#00aa6699'); expect(mark.getAttribute('stroke')).toBe('#770099'); }
  }
}
it.each(['standard','marker','filled'].flatMap(style => ['top','bottom','right'].map(pos=>[style,pos])))('matches %s series artwork in the %s legend', (style,pos) => {
  samePaint(draw(styled(style,pos)),style);
});
it.each(['circle','square','diamond','triangle','plus','x','star','dash','dot'])('uses the %s marker shape in both plot and legend',symbol=>{
  const wb=styled('marker');chart(wb).appearance.radar.series[0].markerSymbol=symbol;
  const doc=draw(wb), plot=doc.querySelector('.chart-radar-marker'), key=doc.querySelector('.chart-radar-legend-marker');
  expect(key).not.toBeNull();expect(key.tagName).toBe(plot.tagName);
  expect(key.getAttribute('fill')).toBe(plot.getAttribute('fill'));expect(key.getAttribute('stroke')).toBe(plot.getAttribute('stroke'));
});
it.each(['standard','marker','filled'])('retains %s legend artwork through copying and two native cycles',async style=>{
  let wb=styled(style);const before=JSON.stringify(chart(wb));
  samePaint(draw(wb),style);expect(JSON.stringify(chart(wb))).toBe(before);
  wb=wb.sheetToWorkbook(wb.activeSheetId,{sourceWorkbook:'/Radar.xlsx'});
  wb=new Workbook(wb.toJSON());
  for(let i=0;i<2;i++){wb=(await cycle(wb)).wb;samePaint(draw(wb),style);}
});
it('keeps hidden legend entries mapped to the original series',()=>{
  const wb=styled('marker');chart(wb).appearance.legendHidden=[0];
  const doc=draw(wb), [key]=keys(doc);expect(keys(doc)).toHaveLength(1);expect(key.getAttribute('data-series')).toBe('1');
  expect(key.querySelector('line').getAttribute('stroke')).toBe('#66009999');
  expect(key.querySelector('.chart-radar-legend-marker').tagName.toLowerCase()).toBe('rect');
  chart(wb).legend=false;expect(keys(draw(wb))).toHaveLength(0);
});
it('applies explicit series color edits to both filled series and legend swatch',()=>{
  const wb=styled('filled');chart(wb).colors=['#cc2255'];
  const doc=draw(wb);expect(doc.querySelector('.chart-radar-series').getAttribute('fill')).toBe('#cc2255');
  expect(keys(doc)[0].querySelector('rect').getAttribute('fill')).toBe('#cc2255');
  expect(keys(doc)[1].querySelector('rect').getAttribute('fill')).toMatch(/^url\(#/);
});
it('does not invent visible line or marker paint in a legend key',()=>{
  const wb=styled('marker'),ch=chart(wb);ch.appearance.lines[0].visible=false;ch.appearance.radar.series[0].markerSymbol='none';
  ch.appearance.lines[1].markerFill='none';ch.appearance.lines[1].markerStroke='none';
  const doc=draw(wb), [first,second]=keys(doc);
  expect(first.querySelector('line').getAttribute('stroke')).toBe('none');expect(first.querySelector('.chart-radar-legend-marker')).toBeNull();
  expect(second.querySelector('.chart-radar-legend-marker').getAttribute('fill')).toBe('none');expect(second.querySelector('.chart-radar-legend-marker').getAttribute('stroke')).toBe('none');
});
it('fits oversized native markers within a compact legend row',()=>{
  const wb=styled('marker'),ch=chart(wb);ch.appearance.lines[0].markerSize=72;ch.appearance.radar.series[0].markerSymbol='circle';
  const doc=draw(wb,300,220), mark=doc.querySelector('.chart-radar-legend-marker'),plot=doc.querySelector('.chart-radar-marker');
  expect(+mark.getAttribute('r')*2).toBeLessThanOrEqual(ch.appearance.legendStyle.size+.001);
  expect(+plot.getAttribute('r')*2).toBeCloseTo(96);
});
