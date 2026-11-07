import { it, expect } from 'vitest';
import { layoutTableBorders } from '../src/engine/table-border-layout.js';
import { deviceTableBorders, deviceTableFillRects } from '../src/engine/border-device-layout.js';
import { paintTableBorder } from '../src/engine/canvas-table-borders.js';
const context = (scale=1) => ({getTransform:()=>({a:scale,b:0,c:0,d:scale,e:0,f:0})});
const border = (size, color='000000', style='single') => ({size,color,style,space:0});
const grid = (h,v) => Array.from({length:4},(_,i)=>({id:String(i),tableId:'t',page:0,x:i%2*100,y:Math.floor(i/2)*40,width:100,height:40,
 borders:{top:h,bottom:h,left:v,right:v}}));
const ink = strokes => {
 const rects=[],ctx={save(){},restore(){},fillRect(x,y,w,h){rects.push({x,y,w,h,color:this.fillStyle});}};
 for(const s of strokes.filter(s=>!s.guide))paintTableBorder(ctx,s);
 return rects;
};
it.each([[816,624,468.1],[1056,624,468.07],[960,624,468.07],[408,240,180.07],[408,48,36.024],[408,0,0]])(
 'matches native vertical pen placement on a %s CSS-pixel-wide paper at source x=%s', (width,x,nativeLeftPt)=>{
 const source=[{tableId:'paper',page:0,horizontal:false,side:'right',x,y:48,width:4/3,height:28,border:border(8)}];
 const before=JSON.stringify(source);
 for(const scale of [1,2,4]){
  const painted=deviceTableBorders(context(scale),source,true,{width});
  expect(Math.abs(painted[0].x*.75-nativeLeftPt)).toBeLessThan(.00005);
  expect(painted[0].width*.75).toBeCloseTo(.96,12);
  expect(painted[0].y).toBe(source[0].y);expect(painted[0].height).toBe(source[0].height);
  const canvasContext={...context(scale),canvas:{width:width*scale}};
  expect(deviceTableBorders(canvasContext,source,true)).toEqual(painted);
 }
 expect(JSON.stringify(source)).toBe(before);
 expect(deviceTableBorders(context(),source,false,{width})).toEqual(deviceTableBorders(context(),source));
});
it('physical print joins retain authored crossing ownership and source geometry across raster scales',()=>{
 const source=layoutTableBorders(grid(border(2,'0000FF'),border(4,'FF0000'))),before=JSON.stringify(source);
 const first=deviceTableBorders(context(1),source,true),second=deviceTableBorders(context(2),source,true);
 expect(second).toEqual(first);
 const v=first.find(s=>!s.horizontal&&Math.abs(s.x+s.width/2-100)<1);
 const h=first.find(s=>s.horizontal&&Math.abs(s.y+s.height/2-40)<1);
 const x=v.x+v.width/2,y=h.y+h.height/2;
 const overlap=ink(first).filter(r=>r.x<=x&&r.x+r.w>x&&r.y<=y&&r.y+r.h>y);
 expect(overlap.length).toBeGreaterThan(0);expect(overlap.every(r=>r.color==='#FF0000')).toBe(true);
 expect(JSON.stringify(source)).toBe(before);
});
it('print shading keeps physical fractional clipping and row reserves without device snapping',()=>{
 const cells=[{id:'a',tableId:'t',x:10.2,y:20.1,width:40.3,height:30.2,fill:'DDEEFF',borderInsets:{top:.2,bottom:.3},fillTopInset:.1,fillBottomInset:.1,cellClip:{left:10.3,right:49.9,top:20.05,bottom:49.95}}];
 const before=JSON.stringify(cells),rect=deviceTableFillRects(context(2),cells,[],[],true).get('a');
 for(const [key,value]of Object.entries({x:10.3,y:20.05,width:39.6,height:29.85}))expect(rect[key]).toBeCloseTo(value,8);
 expect(JSON.stringify(cells)).toBe(before);
});
it.each([[2,3,'#FF0000'],[3,2,'#0000FF']])('keeps authored print crossing ownership when %s/8pt and %s/8pt both paint .24pt',(hSize,vSize,color)=>{
 const source=layoutTableBorders(grid(border(hSize,'0000FF'),border(vSize,'FF0000'))),before=JSON.stringify(source);
 const printed=deviceTableBorders(context(2),source,true);
 const vertical=printed.find(s=>!s.horizontal&&Math.abs(s.x+s.width/2-100)<1);
 const horizontal=printed.find(s=>s.horizontal&&Math.abs(s.y+s.height/2-40)<1);
 expect(vertical.width).toBe(.32);expect(horizontal.height).toBe(.32);
 const x=vertical.x+vertical.width/2,y=horizontal.y+horizontal.height/2;
 const crossing=ink(printed).filter(r=>r.x<=x&&r.x+r.w>x&&r.y<=y&&r.y+r.h>y);
 expect(crossing.length).toBeGreaterThan(0);expect(crossing.every(r=>r.color===color)).toBe(true);
 expect(JSON.stringify(source)).toBe(before);
});
it('projects print centerlines in physical coordinates under scale and whole-grid translation',()=>{
 const source=layoutTableBorders(grid(border(5),border(3))),before=JSON.stringify(source);
 const first=deviceTableBorders(context(2),source,true);
 const translated=deviceTableBorders({getTransform:()=>({a:4,b:0,c:0,d:4,e:.64,f:0})},source,true);
 expect(translated).toHaveLength(first.length);
 for(const [i,stroke]of translated.entries())for(const field of ['x','y','width','height'])expect(stroke[field]).toBeCloseTo(first[i][field],12);
 expect(JSON.stringify(source)).toBe(before);
});
it('retains authored crossing precedence when unequal widths round to one device pixel',()=>{
 const source=layoutTableBorders(grid(border(2,'0000FF'),border(4,'FF0000'))),before=JSON.stringify(source);
  for(const order of [source,[...source].reverse()]){
  const display=deviceTableBorders(context(),order),rects=ink(display);
  // Native thin-crossing controls establish the shifted body position. Query
  // its painted intersection, rather than a former logical-coordinate pixel.
  const v=display[order.findIndex(s=>!s.horizontal&&Math.abs(s.x+s.width/2-100)<1e-6)];
  const h=display[order.findIndex(s=>s.horizontal&&Math.abs(s.y+s.height/2-40)<1e-6)];
  const x=v.x+v.width/2,y=h.y+h.height/2;
  const overlap=rects.filter(r=>r.x<=x&&r.x+r.w>x&&r.y<=y&&r.y+r.h>y);
  expect(overlap.length).toBeGreaterThan(0);expect(overlap.every(r=>r.color==='#FF0000')).toBe(true);
 }
 expect(JSON.stringify(source)).toBe(before);
});
it('rebuilds translated page-story joins independently on each page',()=>{
 const source=layoutTableBorders(grid(border(8),border(8)));
 const shifted=source.map(s=>({...s,page:1,pageStory:'word/header1.xml',y:s.y+200}));
 const display=deviceTableBorders(context(2),[...source,...shifted]);
 const first=ink(display.filter(s=>s.page===0)),second=ink(display.filter(s=>s.page===1));
 expect(second.map(r=>({...r,y:r.y-200}))).toEqual(first);
});
it('preserves compound band gaps at mixed single/double corners',()=>{
 const source=layoutTableBorders([{id:'a',tableId:'t',page:0,x:20,y:20,width:100,height:40,
  borders:{top:border(2),bottom:border(2),left:border(8,'000000','double'),right:border(8,'000000','double')}}]);
 const display=deviceTableBorders(context(),source),left=display.find(s=>s.side==='left');
 expect(left.width).toBe(4);expect(left.bandEnds).toHaveLength(2);
 const rects=ink(display);expect(rects.some(r=>r.x<20&&r.x+r.w>20&&r.y<40&&r.y+r.h>40)).toBe(false);
});
it('leaves rotated contexts unchanged',()=>{
 const source=layoutTableBorders(grid(border(2),border(4)));
 expect(deviceTableBorders({getTransform:()=>({a:1,b:.1,c:0,d:1,e:0,f:0})},source)).toBe(source);
});

it('limits a rounded fill to the painted frame without modifying logical cells or borders',()=>{
  const cell={id:'a',tableId:'t',page:0,x:24.6,y:24.6,width:48,height:24,fill:'#FF0000',
    borders:{top:border(2),bottom:border(2),left:border(2),right:border(2)},borderInsets:{top:1/6,bottom:1/6}};
  const source=layoutTableBorders([cell]),before=JSON.stringify({cell,source});
  const painted=deviceTableBorders(context(),source),fill=deviceTableFillRects(context(),[cell],source,painted).get('a');
  const right=painted.find(s=>!s.horizontal&&s.side==='right'),bottom=painted.find(s=>s.exposedBottom);
  expect(fill.x+fill.width).toBeLessThanOrEqual(right.x+right.width);
  expect(fill.y+fill.height).toBeLessThanOrEqual(bottom.y+bottom.height);
  expect(fill.width).toBeGreaterThan(0);expect(fill.height).toBeGreaterThan(0);
  expect(JSON.stringify({cell,source})).toBe(before);
});

it('retains raw shading bounds for rotated contexts, explicit reserves and parent clips',()=>{
  const cell={id:'c',fill:'#FF0000',x:10.2,y:20.3,width:30.4,height:40.5,
    borderInsets:{top:2,bottom:3},fillTopInset:1,fillBottomInset:2,
    cellClip:{left:11,right:35,top:22,bottom:55}};
  const ctx={getTransform:()=>({a:1,b:.1,c:0,d:1,e:0,f:0})};
  expect(deviceTableFillRects(ctx,[cell],[],[]).get('c')).toEqual({x:11,y:22,width:24,height:33});
});

it('distinguishes an exposed bottom from a shared winner owned by the preceding cell',()=>{
  const source=layoutTableBorders(grid(border(2),border(4)));
  const shared=source.filter(s=>s.horizontal&&s.cellIds.length===2),bottom=source.filter(s=>s.horizontal&&s.side==='bottom'&&s.cellIds.length===1);
  expect(shared.length).toBeGreaterThan(0);expect(shared.every(s=>!s.exposedBottom)).toBe(true);
  expect(bottom.length).toBeGreaterThan(0);expect(bottom.every(s=>s.exposedBottom)).toBe(true);
});

it('joins adjacent shading at a minimum-width white border without a second white gap pixel',()=>{
  const cells=[0,1].map(i=>({id:String(i),tableId:'t',page:0,x:264+13/15+48*i,y:24+1/3,width:48,height:24,fill:'#4472C4',
    borders:{top:border(4,'FFFFFF'),bottom:border(4,'FFFFFF'),left:border(4,'FFFFFF'),right:border(4,'FFFFFF')},borderInsets:{top:1/3,bottom:1/3}}));
  const source=layoutTableBorders(cells),painted=deviceTableBorders(context(),source);
  const rects=deviceTableFillRects(context(),cells,source,painted),left=rects.get('0'),right=rects.get('1');
  expect(left.x+left.width).toBe(right.x);
  const clipped={...cells[1],cellClip:{left:313,right:350,top:25,bottom:45}};
  const rect=deviceTableFillRects(context(),[clipped],source,painted).get('1');
  expect(rect.x).toBeGreaterThanOrEqual(313);expect(rect.x+rect.width).toBeLessThanOrEqual(350);
});
