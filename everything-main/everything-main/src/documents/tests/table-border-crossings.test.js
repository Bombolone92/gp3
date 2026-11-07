import {it, expect} from 'vitest';
import {layoutTableBorders} from '../src/engine/table-border-layout.js';
import {paintTableBorder} from '../src/engine/canvas-table-borders.js';
import {joinTableBorderCrossing} from '../src/engine/table-border-corners.js';

const border = (size, color) => ({style:'single', size, color, space:0});
const grid = (h, v) => Array.from({length:6}, (_,i) => {
  const row = Math.floor(i/2), col = i%2;
  return {id:String(i), tableId:'t', page:0, x:col*100, y:row*40, width:100, height:40,
    borders:{top:row?h:undefined, bottom:row<2?h:undefined, left:col?v:undefined, right:col?undefined:v}};
});
const boxes = strokes => {
  const result=[], ctx={save(){},restore(){},fillRect(x,y,w,h){result.push({x,y,w,h,color:this.fillStyle});}};
  for (const stroke of strokes.filter(s=>!s.guide)) paintTableBorder(ctx,stroke);
  return result;
};
const at = (ink,x,y) => ink.findLast(b=>x>b.x&&x<b.x+b.w&&y>b.y&&y<b.y+b.h)?.color;

it.each(['top', 'bottom'])('aligns a shared row reserve independently of the winning %s declaration', side => {
  const ink = border(16, '0055CC'), none = {style:'nil',size:0};
  const cells = [
    {id:'a',tableId:'t',page:0,x:0,y:0,width:100,height:40,borders:{bottom:side === 'bottom' ? ink : none},borderInsets:{top:0,bottom:8/3}},
    {id:'b',tableId:'t',page:0,x:0,y:40,width:100,height:40,borders:{top:side === 'top' ? ink : none,bottom:ink},borderInsets:{top:8/3,bottom:0}},
  ];
  const strokes = layoutTableBorders(cells).filter(s=>s.horizontal&&!s.guide);
  expect(strokes.find(s=>s.cellIds.length===2).y).toBeCloseTo(40-8/3,6);
  // An exposed bottom still paints inside its trailing reserve.
  expect(strokes.find(s=>s.cellIds.length===1).y).toBeCloseTo(80-8/3,6);
});

it.each([
  [2,'000000',48,'FFFFFF','#FFFFFF'],
  [2,'0000FF',48,'FF0000','#FF0000'],
  [48,'0000FF',2,'FF0000','#0000FF'],
  [24,'0000FF',24,'FF0000','#0000FF'],
  [24,'FF0000',24,'0000FF','#FF0000'],
  [24,'FFFFFF',24,'000000','#FFFFFF'],
])('paints %s/%s horizontal and %s/%s vertical consistently at both crossings', (hs,hc,vs,vc,color) => {
  const strokes=layoutTableBorders(grid(border(hs,hc),border(vs,vc)));
  for(const ordered of [strokes,[...strokes].reverse()]) {
    const ink=boxes(ordered);
    for(const y of [40,80]) for(const dx of [-.05,.05]) for(const dy of [-.05,.05]) expect(at(ink,100+dx,y+dy)).toBe(color);
  }
});

it('retains junction cuts when strokes are translated into a page story', () => {
  const strokes=layoutTableBorders(grid(border(2,'000000'),border(48,'FFFFFF')));
  const ink=boxes(strokes.map(s=>({...s,y:s.y+200})));
  for(const y of [240,280]) expect(at(ink,100.05,y+.05)).toBe('#FFFFFF');
});

it('keeps a continuous horizontal edge over a wider terminating vertical border at either end', () => {
  // The priority/properties native reference controls have a 2 pt blue perimeter
  // and a 6 pt red divider; both divider ends stop inside the perimeter.
  const cells = [0,1].map(col => ({id:String(col),tableId:'t',page:0,
    x:col*100,y:0,width:100,height:60,
    borders:{top:border(16,'2050D0'),bottom:border(16,'2050D0'),
      left:col?border(48,'E02030'):undefined,right:col?undefined:border(48,'E02030')}}));
  const strokes=layoutTableBorders(cells);
  for(const ordered of [strokes,[...strokes].reverse()]) {
    const ink=boxes(ordered);
    for(const y of [-.5,.5,59.5,60.5]) expect(at(ink,100.1,y)).toBe('#2050D0');
    for(const y of [2,58]) expect(at(ink,100.1,y)).toBe('#E02030');
  }
});

it('does not apply single cross-junction rules to compound borders or row prepasses', () => {
  const cells=grid({...border(8,'000000'),style:'double'},border(48,'FFFFFF'));
  expect(layoutTableBorders(cells).every(s=>!s.crossingCuts)).toBe(true);
  expect(layoutTableBorders(grid(border(2,'000000'),border(48,'FFFFFF')),true).every(s=>!s.crossingCuts)).toBe(true);
});

it('cuts only the visible portion of a winning border clipped by its cell', () => {
  const h={horizontal:true, border:border(6,'000000'), x:0,y:39.5,width:100,height:1};
  const v={horizontal:false, border:border(48,'FFFFFF'), x:96,y:0,width:8,height:40};
  const edges=[{stroke:h,first:false},{stroke:{...h,x:100},first:true},
    {stroke:{...v,cellClip:{top:0,bottom:39.8}},first:false},
    {stroke:{...v,y:40,cellClip:{top:40.2,bottom:80}},first:true}];
  joinTableBorderCrossing(edges);
  const ink=boxes(edges.map(e=>e.stroke));
  for(const y of [39.9,40.1]) expect(at(ink,100.05,y)).toBe('#000000');
  for(const y of [39.7,40.3]) expect(at(ink,100.05,y)).toBe('#FFFFFF');
});
