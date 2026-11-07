import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { chartAxisScale } from '../src/core/chart-axis-scale.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

it.each([
  [2,18, {step:2}, [0,20]],
  [-18,-2, {step:2}, [-20,0]],
  [-12,4, {step:2}, [-14,6]],
  [90,100, {step:1}, [85,101]],
  [-100,-90, {step:1}, [-101,-85]],
  [90,100, {step:1,numeric:true}, [89,101]],
  [-100,-90, {step:1,numeric:true}, [-101,-89]],
  [50,60, {step:1}, [0,63]],
  [50.01,60, {step:1}, [45,61]],
  [0,1, {step:.1,percent:true}, [0,1]],
  [-1,0, {step:.1,percent:true}, [-1,0]],
  [80,100, {step:1}, [0,105]],
  [-100,-80, {step:1}, [-105,0]],
  [80,100, {step:1,numeric:true}, [0,105]],
  [-100,-80, {step:1,numeric:true}, [-105,0]],
  [80,100, {min:80,step:1}, [80,101]],
  [-100,-80, {max:-80,step:1}, [-101,-80]],
  [80,100, {max:100,step:1}, [0,100]],
  [-100,-80, {min:-100,step:1}, [-100,0]],
])('computes automatic range for %s..%s with options %j', (lo,hi,opts,expected) => {
  const scale = chartAxisScale(lo,hi,opts);
  expect(scale.min).toBeCloseTo(expected[0],10); expect(scale.max).toBeCloseTo(expected[1],10);
  expect(scale.step).toBe(opts.step);
});

it('anchors automatic rounding to the fixed opposite endpoint', () => {
  expect(chartAxisScale(4,9,{min:2.3,step:2})).toEqual({min:2.3,max:10.3,step:2});
  const scale = chartAxisScale(98,102,{max:108.3,step:2});
  expect(scale.min).toBeCloseTo(92.3); expect(scale.max).toBe(108.3);
  expect(chartAxisScale(4,9,{min:2.3,max:8.7,step:2})).toEqual({min:2.3,max:8.7,step:2});
});

it('opens a finite domain when a fixed bound excludes all data', () => {
  expect(chartAxisScale(Infinity,-Infinity,{min:12,step:2})).toEqual({min:12,max:24,step:2});
  expect(chartAxisScale(Infinity,-Infinity,{max:-3,step:1})).toEqual({min:-6,max:-3,step:1});
  expect(chartAxisScale(Infinity,-Infinity,{min:0,step:.2})).toEqual({min:0,max:1,step:.2});
});

it('handles constant, zero, missing and extreme values without nonfinite bounds', () => {
  expect(chartAxisScale(20,20,{step:5})).toEqual({min:0,max:25,step:5});
  expect(chartAxisScale(-20,-20,{step:5})).toEqual({min:-25,max:0,step:5});
  expect(chartAxisScale(0,0,{step:.2})).toEqual({min:0,max:1,step:.2});
  for (const [lo,hi] of [[NaN,NaN],[-Number.MAX_VALUE,Number.MAX_VALUE],[0,Number.MAX_VALUE],[Number.MIN_VALUE,Number.MIN_VALUE*5],[1e16,1e16+2]]) {
    const scale = chartAxisScale(lo,hi);
    expect(Object.values(scale).every(Number.isFinite)).toBe(true); expect(scale.step).toBeGreaterThan(0);
    expect(scale.max).toBeGreaterThan(scale.min);
  }
});

it('keeps domain rules invariant across units and sign', () => {
  for (const factor of [1e-12,.01,1,1e6,1e100]) {
    const positive = chartAxisScale(91*factor,100*factor,{step:factor});
    const negative = chartAxisScale(-100*factor,-91*factor,{step:factor});
    expect(positive.min/factor).toBeCloseTo(86); expect(positive.max/factor).toBeCloseTo(101);
    expect(negative.min/factor).toBeCloseTo(-101); expect(negative.max/factor).toBeCloseTo(-86);
    const zeroPositive = chartAxisScale(75*factor,100*factor,{step:factor});
    const zeroNegative = chartAxisScale(-100*factor,-75*factor,{step:factor});
    expect(zeroPositive.min).toBe(0); expect(zeroPositive.max/factor).toBeCloseTo(105);
    expect(zeroNegative.min/factor).toBeCloseTo(-105); expect(zeroNegative.max).toBe(0);
  }
});

const parser = new (new JSDOM('').window.DOMParser)();
function render(values, options = {}, types = 'column') {
  const chart = normalizeChart({type:types,legend:false,range:{r1:0,c1:0,r2:1,c2:1},anchor:{r:0,c:3},...options,
    appearance:{yStyle:{color:'#123456'},yFormat:'0.00',...options.appearance}});
  const series = values.map((v,i) => ({name:`S${i}`,values:v}));
  const before = structuredClone(chart), svg = renderChartSvg({categories:['A','B'],series},chart,520,320);
  expect(chart).toEqual(before); expect(svg).not.toMatch(/NaN|Infinity/);
  const doc = parser.parseFromString(svg,'image/svg+xml');
  return {chart,doc,ticks:[...doc.querySelectorAll('text[fill="#123456"]')].map(n=>Number(n.textContent))};
}

it.each(['column','bar','line'])('uses headroom for a styled %s without writing fixed bounds', type => {
  const {chart,ticks} = render([[100,400]],{},type);
  expect(Math.min(...ticks)).toBe(0); expect(Math.max(...ticks)).toBeGreaterThan(400);
  expect(chart.yMin).toBeNull(); expect(chart.yMax).toBeNull();
});

it.each(['column','bar','line','scatter'])('includes the zero extension in %s headroom', type => {
  for (const sign of [1,-1]) {
    const {ticks} = render([[80*sign,100*sign]],{appearance:{yStep:1}},type);
    expect(Math.min(...ticks)).toBe(sign > 0 ? 0 : -105);
    expect(Math.max(...ticks)).toBe(sign > 0 ? 105 : 0);
  }
});

it('recomputes independent automatic ranges after native XLSX round trips, duplication and edits', async () => {
  let wb = new Workbook({sheets:[{name:'Ranges',charts:[{
    type:'combo',secondaryAxis:true,legend:false,range:{r1:0,c1:0,r2:1,c2:2},anchor:{r:0,c:4},
    sourceRefs:[{name:'Columns',literal:{categories:['A','B'],values:[80,100]}},
      {name:'Line',literal:{categories:['A','B'],values:[-200,-160]}}],
    appearance:{yStep:1,y2Step:2,yStyle:{color:'#123456'},y2Style:{color:'#654321'}}
  }]}]});
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.sheets[0], chart = sheet.charts[0];
    for (const item of [chart,wb.chartById(sheet.id,wb.duplicateChart(sheet.id,chart.id))]) {
      expect(item.yMin).toBeNull(); expect(item.yMax).toBeNull();
      expect(item.appearance.y2Min ?? null).toBeNull(); expect(item.appearance.y2Max ?? null).toBeNull();
      const svg = renderChartSvg(chartData(wb,sheet.id,item),item,520,320);
      const doc = parser.parseFromString(svg,'image/svg+xml');
      const bounds = color => [...doc.querySelectorAll(`text[fill="${color}"]`)].map(n=>Number(n.textContent));
      expect(Math.max(...bounds('#123456'))).toBe(105);
      expect(Math.min(...bounds('#654321'))).toBe(-210);
    }
    wb.deleteChart(sheet.id,sheet.charts[1].id);
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
    const book = X.CFB.find(zip,'/xl/workbook.xml');
    book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));
    book.size = book.content.length;
    wb = await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'automatic.xlsx');
  }
  const sheet = wb.sheets[0], chart = sheet.charts[0];
  wb.updateChart(sheet.id,chart.id,{yMin:80});
  const svg = renderChartSvg(chartData(wb,sheet.id,sheet.charts[0]),sheet.charts[0],520,320);
  const doc = parser.parseFromString(svg,'image/svg+xml');
  expect(Math.max(...[...doc.querySelectorAll('text[fill="#123456"]')].map(n=>Number(n.textContent)))).toBe(101);
});

it('uses every real stacked endpoint rather than an artificial zero or only final totals', () => {
  const near = render([[90,91],[10,10]],{stacked:true});
  expect(Math.min(...near.ticks)).toBeGreaterThan(0); expect(Math.min(...near.ticks)).toBeLessThan(90);
  expect(Math.max(...near.ticks)).toBeGreaterThan(101);
  const wide = render([[50,50],[50,51]],{stacked:true});
  expect(Math.min(...wide.ticks)).toBe(0);
  const pct = render([[90,91],[10,10]],{stacked:true,stack100:true});
  expect([...pct.doc.querySelectorAll('text[fill="#123456"]')].at(-1).textContent).toBe('100%');
});

it('does not allow values outside a fixed bound to widen its opposite automatic bound', () => {
  const a = render([[-1000,9]],{yMin:7,appearance:{yStep:.5}});
  const b = render([[8,9]],{yMin:7,appearance:{yStep:.5}});
  expect(a.ticks).toEqual(b.ticks); expect(Math.min(...a.ticks)).toBe(7); expect(Math.max(...a.ticks)).toBe(9.5);
});

it('recovers from reversed or equal fixed endpoints without a collapsed domain', () => {
  for (const max of [2, 4]) {
    const scale = chartAxisScale(4, 9, { min: 4, max, step: 2 });
    expect(scale.min).toBe(4); expect(scale.max).toBeGreaterThan(9);
  }
});
