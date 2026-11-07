import {it,expect} from 'vitest';
import {displacedRightFillLimits,clippedFillRects} from './fixtures/border-shared-origin/rejected-fill-clip.js';
it('subtracts overlapping right cuts once and preserves their union independently of order',()=>{
 const limits=[{top:2,bottom:6,right:8},{top:4,bottom:8,right:7},{top:4,bottom:8,right:7}];
 const expected=[[0,0,10,2],[0,2,8,2],[0,4,7,4],[0,8,10,2]];
 expect(clippedFillRects(0,0,10,10,limits)).toEqual(expected);
 expect(clippedFillRects(0,0,10,10,[...limits].reverse())).toEqual(expected);
 expect(expected.reduce((sum,[,,w,h])=>sum+w*h,0)).toBe(84);
});
it('uses physical shared-edge position rather than the source border side without mutating cells',()=>{
 const cell={id:'c',fill:'red',x:0,y:0,width:10,height:10},before=JSON.stringify(cell);
 const ctx={getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0})};
 for(const side of ['left','right']){
  const s={side,x:9.9,width:.2,y:0,height:10,border:{style:'single'},cellIds:['c']};
  const result=displacedRightFillLimits(ctx,[cell],[s],[{x:8,y:0,width:1,height:10}]);
  expect(result.get(cell)).toEqual([{top:0,bottom:10,right:9}]);
 }
 expect(JSON.stringify(cell)).toBe(before);
 expect(displacedRightFillLimits({getTransform:()=>({a:1,b:1,c:0,d:1})},[cell],[],[]).size).toBe(0);
});
it('clips to the fill rectangle and rejects empty areas',()=>{
 expect(clippedFillRects(1,1,5,5,[{top:-10,bottom:10,right:3}])).toEqual([[1,1,2,4]]);
 expect(clippedFillRects(1,1,5,5,[{top:1,bottom:5,right:0}])).toEqual([]);
 expect(clippedFillRects(5,1,1,5)).toEqual([]);
});
