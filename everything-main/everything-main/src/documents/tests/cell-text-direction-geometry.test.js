import {it,expect} from 'vitest';
import {rotatedCellFrame,cellTextPoint,cellTextLocalPoint,cellTextRect} from '../src/engine/cell-text-direction.js';
import {selectionRects} from '../src/engine/layout.js';
const box={x:100,y:200,width:144,height:164,margins:{left:120,right:240,top:190,bottom:310},borders:{left:{style:'single',size:8},right:{style:'single',size:8}}};
it.each(['btLr','tbRl'])('maps source-space caret rectangles and inverse pointer coordinates: %s',direction=>{
 const frame=rotatedCellFrame(box,direction,'center',32);
 const caret={page:2,x:21,y:8,width:1,height:16},rect=cellTextRect(frame.matrix,caret);
 expect(rect.width).toBe(16);expect(rect.height).toBe(1);expect(rect.page).toBe(2);
 const physical=cellTextPoint(frame.matrix,21,8),local=cellTextLocalPoint(frame.matrix,physical.x,physical.y);
 expect(local.x).toBeCloseTo(21);expect(local.y).toBeCloseTo(8);
 expect(frame.width).toBeCloseTo(164-500/15);
});
it('keeps overflowing content at the leading edge and preserves a zero writing extent',()=>{
 const top=rotatedCellFrame(box,'btLr','top',200),bottom=rotatedCellFrame(box,'btLr','bottom',200);
 expect(bottom.matrix).toEqual(top.matrix);
 expect(rotatedCellFrame({...box,height:10},'btLr').width).toBe(0);
 expect(()=>rotatedCellFrame(box,'tbRlV')).toThrow(/Unsupported/);
});

it('keeps the physical cell transform when selecting disjoint wrapping intervals',()=>{
 const local={start:0,end:4,y:10,height:12,baseline:18,wrapSegments:[
  {start:0,end:2,stops:[{offset:0,x:0},{offset:2,x:10}],fragments:[]},
  {start:2,end:4,stops:[{offset:2,x:20},{offset:4,x:30}],fragments:[]},
 ]};
 const physical={...local,page:0,fragments:[],cellText:{line:local,matrix:[0,-1,1,0,100,200]},
  cellClip:{left:90,right:130,top:150,bottom:210}};
 expect(selectionRects({page:{width:400},lines:[physical]},0,4)).toEqual([
  {page:0,x:110,y:190,width:12,height:10},
  {page:0,x:110,y:170,width:12,height:10},
 ]);
});

it.each(['btLr','tbRl'])('reserves the trailing margin for modern centered and bottom text: %s',direction=>{
 const legacy=rotatedCellFrame(box,direction,'center',32,14);
 const modern=rotatedCellFrame(box,direction,'center',32,15);
 const trailing=direction==='btLr'?'right':'left';
 const difference=box.margins[trailing]/15-2/3;
 expect(legacy.height-modern.height).toBeCloseTo(difference);
 expect(modern.matrix[4]-legacy.matrix[4]).toBeCloseTo((direction==='btLr'?-1:1)*difference/2);
 const bottom=rotatedCellFrame(box,direction,'bottom',32,15);
 expect(Math.abs(bottom.matrix[4]-rotatedCellFrame(box,direction,'bottom',32,14).matrix[4])).toBeCloseTo(difference);
 expect(rotatedCellFrame(box,direction,'top',32,15).matrix).toEqual(rotatedCellFrame(box,direction,'top',32,14).matrix);
 expect(rotatedCellFrame(box,direction,'bottom',1000,15).matrix).toEqual(rotatedCellFrame(box,direction,'top',1000,15).matrix);
});
