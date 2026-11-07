import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
const parser = new (new JSDOM('').window.DOMParser)();
const data = {categories:['A','B','C'],series:[{name:'Columns',values:[20,80,40]},{name:'Line',values:[2,8,4]}]};
function draw(appearance = {}, type = 'combo', width = 600) {
  const chart=normalizeChart({type,secondaryAxis:type==='combo',anchor:{r:0,c:3},range:{r1:0,c1:0,r2:2,c2:1},legend:false,yMin:0,yMax:100,
    appearance:{plot:{x:.2,y:.2,w:.6,h:.6},y2Min:0,y2Max:10,yStep:25,y2Step:2,y2Format:'0" units"',
      xRotationAuto:false,yStyle:{color:'#336699'},y2Style:{color:'#cc2255'},
      axisStyles:{x:{color:'#000000'},y:{color:'#336699',majorTick:'out'},y2:{color:'#cc2255',majorTick:'out'}},...appearance}});
  const svg=renderChartSvg(data,chart,width,400);expect(svg).not.toMatch(/NaN|Infinity/);
  const doc=parser.parseFromString(svg,'image/svg+xml'),clip=doc.querySelector('clipPath rect');
  return {chart,doc,plot:{x:+clip.getAttribute('x'),y:+clip.getAttribute('y')+1,w:+clip.getAttribute('width'),h:+clip.getAttribute('height')-2},
    primary:[...doc.querySelectorAll('text[fill="#336699"]')],second:[...doc.querySelectorAll('text[fill="#cc2255"]')]};
}
it.each(['nextTo','low','high','none'])('places secondary %s labels independently of crossings and reversal',position=>{
  for(const reverse of [false,true]) for(const crossing of ['min','max',2]) {
    const {doc,plot,second}=draw({y2LabelPosition:position,reverseCategories:reverse,axisCrossings:{y2:crossing},yLabelPosition:'none'});
    const axis=doc.querySelector('.chart-axis-line.chart-axis-y2');
    expect(axis).not.toBeNull();expect(doc.querySelectorAll('.chart-axis-y2.chart-axis-tick-major')).toHaveLength(6);
    expect(second).toHaveLength(position==='none'?0:6);
    const high=(position==='nextTo'?crossing==='max':position==='high')!==reverse;
    const origin=position==='nextTo'?+axis.getAttribute('x1'):plot.x+(high?plot.w:0);
    for(const label of second) {
      expect(+label.getAttribute('x')).toBeCloseTo(origin+(high?10:-10));
      expect(label.getAttribute('text-anchor')).toBe(high?'start':'end');
    }
  }
});
it.each(['low','high'])('packs two %s label columns without moving axis lines',side=>{
  const plot={x:.25,y:.2,w:.5,h:.6};
  const visible=draw({plot,yLabelPosition:side,y2LabelPosition:side}),hidden=draw({plot,yLabelPosition:'none',y2LabelPosition:side});
  const primaryX=+visible.primary[0].getAttribute('x'),secondaryX=+visible.second[0].getAttribute('x');
  expect((secondaryX-primaryX)*(side==='high'?1:-1)).toBeGreaterThan(25);
  expect(visible.doc.querySelector('.chart-axis-line.chart-axis-y2').getAttribute('x1')).toBe(hidden.doc.querySelector('.chart-axis-line.chart-axis-y2').getAttribute('x1'));
  expect(+hidden.second[0].getAttribute('x')).toBeCloseTo(hidden.plot.x+(side==='high'?hidden.plot.w+10:-10));
});
it.each(['low','high'])('fits large secondary %s labels while retaining the opposite plot edge',side=>{
  const appearance={y2LabelPosition:side,yLabelPosition:'none',y2Style:{size:24,color:'#cc2255'},y2Format:'0.00" metres"'};
  const visible=draw(appearance,'combo',420),hidden=draw({...appearance,y2LabelPosition:'none'},'combo',420);
  expect(visible.plot.w).toBeLessThan(hidden.plot.w);
  expect(side==='low'?visible.plot.x+visible.plot.w:visible.plot.x).toBeCloseTo(side==='low'?hidden.plot.x+hidden.plot.w:hidden.plot.x);
  for(const label of visible.second) expect(+label.getAttribute('x')).toBeGreaterThan(0);
  expect(visible.chart.appearance.plot).toEqual({x:.2,y:.2,w:.6,h:.6});
});
it.each(['column','bar','scatter'])('places %s primary low/high labels at perpendicular domain ends',type=>{
  for(const reverseCategories of [false,true]) for(const side of ['low','high']) {
    const {primary,plot}=draw({reverseCategories,yLabelPosition:side},type);
    const high=(side==='high')!==reverseCategories;
    for(const label of primary) {
      if(type==='bar') expect(high?+label.getAttribute('y')<plot.y:+label.getAttribute('y')>plot.y+plot.h).toBe(true);
      else expect(high?+label.getAttribute('x')>plot.x+plot.w:+label.getAttribute('x')<plot.x).toBe(true);
    }
  }
});
it('retains finite drawable geometry for oversized secondary labels and invalid settings',()=>{
  const result=draw({y2LabelPosition:'high',y2Style:{size:72},y2Format:'0.0000000000" extremely long units"'},'combo',120);
  expect(result.plot.w).toBeGreaterThanOrEqual(10);
  expect(draw({y2LabelPosition:'<bad>'}).chart.appearance.y2LabelPosition).toBe('nextTo');
});
