import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
const parser = new (new JSDOM('').window.DOMParser)();
const data = { categories: ['A','B','C','D'], series: [{ name:'Values', values:[-50,80,30,60] }] };
function render(type, crossings, appearance = {}, options = {}, values = data) {
  const chart = normalizeChart({anchor:{r:0,c:3},range:{r1:0,c1:0,r2:3,c2:1},type, legend:false, yMin:-100,yMax:100,...options,
    appearance:{plot:{x:.2,y:.2,w:.6,h:.6}, xRotationAuto:false, yStep:50,
      axisStyles:{x:{color:'#111111',majorTick:'out'},y:{color:'#222222',majorTick:'out'},y2:{color:'#333333'}},
      axisCrossings:crossings,...appearance}});
  const doc = parser.parseFromString(renderChartSvg(values,chart,600,400),'image/svg+xml');
  const rect = doc.querySelector('clipPath rect');
  // The clip extends one pixel beyond each vertical edge for strokes.
  const plot = {x:+rect.getAttribute('x'),y:+rect.getAttribute('y')+1,w:+rect.getAttribute('width'),h:+rect.getAttribute('height')-2};
  const axis = key => doc.querySelector(`.chart-axis-line.chart-axis-${key}`);
  return {chart,doc,plot,axis};
}
it.each(['column','bar'])('uses custom %s crossings as the ordinary baseline, with clamping', type => {
  for (const [setting,value] of [['min',-100],['max',100],['autoZero',0],[40,40],[-200,-100],[200,100]]) {
    const {doc,plot,axis}=render(type,{x:setting});
    const horizontal=type==='bar', key=horizontal?'x':'y';
    const coordinate=v=>horizontal?plot.x+(v+100)/200*plot.w:plot.y+(100-v)/200*plot.h;
    expect(+axis('x').getAttribute(`${key}1`)).toBeCloseTo(coordinate(value));
    const bars=[...doc.querySelectorAll(horizontal?'.chart-bar':'.chart-column')];
    bars.forEach((bar,i)=>{
      expect(+bar.getAttribute(key)).toBeCloseTo(Math.min(coordinate(value),coordinate(data.series[0].values[i])));
      expect(+bar.getAttribute(horizontal?'width':'height')).toBeCloseTo(Math.abs(coordinate(value)-coordinate(data.series[0].values[i])));
    });
    const label=[...doc.querySelectorAll('text')].find(e=>e.textContent==='A');
    const offset=+label.getAttribute(key)-coordinate(value);
    expect(offset*(horizontal?1:-1)>0).toBe(setting==='max');
  }
});
it.each(['column','bar'])('places %s value axes and adjacent labels at category boundaries or centers', type => {
  for (const between of [true,false]) for (const reverse of [true,false]) for (const [setting,index] of [['min',0],['max',between?4:3],['autoZero',0],[2,1],[2.5,1.5],[-2,0],[20,between?4:3]]) {
    const {doc,plot,axis}=render(type,{y:setting},{categoryBetween:between,reverseCategories:reverse});
    const horizontal=type==='bar', fraction=index/(between?4:3);
    const expected=horizontal?plot.y+plot.h*(reverse?fraction:1-fraction):plot.x+plot.w*(reverse?1-fraction:fraction);
    const key=horizontal?'y':'x';
    expect(+axis('y').getAttribute(`${key}1`)).toBeCloseTo(expected);
    const label=[...doc.querySelectorAll('text')].find(e=>e.textContent==='100');
    const high=(setting==='max')!==reverse;
    expect((+label.getAttribute(key)-expected)*(horizontal?-1:1)>0).toBe(high);
  }
});
it('keeps low and high labels independent of an interior crossing',()=>{
  for(const position of ['low','high']) {
    const {doc,plot}=render('column',{x:40,y:2},{xLabelPosition:position,yLabelPosition:position});
    const texts=[...doc.querySelectorAll('text')],category=texts.find(e=>e.textContent==='A'),value=texts.find(e=>e.textContent==='100');
    expect(+category.getAttribute('y')<plot.y).toBe(position==='high');
    expect(+value.getAttribute('x')>plot.x+plot.w).toBe(position==='high');
  }
});
it('measures scatter crossings in perpendicular numeric units, including reversed X',()=>{
  for(const reverseCategories of [false,true]) {
    const {plot,axis}=render('scatter',{x:25,y:-20},{xMin:-80,xMax:120,xStep:40,reverseCategories},{},
      {...data,x:[-40,0,40,80],series:[{...data.series[0],x:[-40,0,40,80]}]});
    expect(+axis('x').getAttribute('y1')).toBeCloseTo(plot.y+plot.h*.375);
    expect(+axis('y').getAttribute('x1')).toBeCloseTo(plot.x+plot.w*(reverseCategories?.7:.3));
  }
});
it.each([true,false])('measures date crossings in serial days with categoryBetween=%s',categoryBetween=>{
  const {plot,axis}=render('line',{y:45002},{dateAxis:true,categoryBetween},{},
    {...data,x:[45000,45002,45005,45009],series:[{...data.series[0],x:[45000,45002,45005,45009]}]});
  expect(+axis('y').getAttribute('x1')).toBeCloseTo(plot.x+plot.w*(categoryBetween?.2:2/9));
});
it.each(['column','bar'])('does not shift %s stack sums when changing the crossing',type=>{
  const first=render(type,{x:0},{},{stacked:true}),changed=render(type,{x:40},{},{stacked:true});
  expect([...changed.doc.querySelectorAll('.chart-series')].map(e=>e.outerHTML)).toEqual([...first.doc.querySelectorAll('.chart-series')].map(e=>e.outerHTML));
});
it('closes ordinary area fills at the crossing but keeps algebraic stack bases',()=>{
  for(const grouping of ['standard','stacked']) {
    const appearance={seriesTypes:['area'],seriesGroups:[{id:0,grouping}]};
    const {doc,plot}=render('combo',{x:40},appearance,{}, {...data,series:[{...data.series[0],x:[1,2,3,4]}]});
    const baseline=plot.y+plot.h*(grouping==='standard'?.3:.5);
    expect(doc.querySelector('.chart-area').getAttribute('d')).toContain(` ${baseline}`);
  }
});
it('places secondary value axes at their own category crossing',()=>{
  const {plot,axis}=render('combo',{y2:2},{},{secondaryAxis:true},
    {...data,series:[...data.series,{name:'Second',values:[1,2,3,4]}]});
  expect(+axis('y2').getAttribute('x1')).toBeCloseTo(plot.x+plot.w*.25);
});
it('discards malformed crossing settings while retaining finite values and native modes',()=>{
  const {appearance}=normalizeChart({anchor:{r:0,c:3},range:{r1:0,c1:0,r2:3,c2:1},type:'column',appearance:{axisCrossings:{x:Infinity,y:'42',y2:'invalid',z:20}}});
  expect(appearance.axisCrossings).toEqual({});
  expect(normalizeChart({anchor:{r:0,c:3},range:{r1:0,c1:0,r2:3,c2:1},type:'column',appearance:{axisCrossings:{x:0,y:-1e200,y2:'autoZero'}}}).appearance.axisCrossings).toEqual({x:0,y:-1e200,y2:'autoZero'});
});
it.each(['column','bar'])('places %s outside-end labels beyond the value, even below a positive baseline', type => {
  const {doc}=render(type,{x:40},{valueLabels:[{show:true,position:'outEnd'}]},{labels:true});
  const mark=[...doc.querySelectorAll(type==='bar'?'.chart-bar':'.chart-column')][2];
  const label=[...doc.querySelectorAll('text')].find(e=>e.textContent==='30');
  if(type==='bar') expect(+label.getAttribute('x')).toBeLessThan(+mark.getAttribute('x'));
  else expect(+label.getAttribute('y')).toBeGreaterThan(+mark.getAttribute('y') + +mark.getAttribute('height'));
});
it('honors native crossings over contradictory axPos',()=>{
  const {axis,plot}=render('column',{y:'min'},{yPosition:'r'});
  expect(+axis('y').getAttribute('x1')).toBeCloseTo(plot.x);
  const reversed=render('column',{y:'max'},{reverseCategories:true,yPosition:'r'});
  expect(+reversed.axis('y').getAttribute('x1')).toBeCloseTo(reversed.plot.x);
});
