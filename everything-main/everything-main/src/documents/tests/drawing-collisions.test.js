import { it, expect } from 'vitest';
import { resolveDrawingCollisions } from '../src/engine/drawing-collisions.js';
const frame=(x,y,allowOverlap=false,page=0,wrap='none')=>({x,y,width:96,height:96,page,image:{anchor:{allowOverlap,wrap}}});
it('rechecks earlier obstacles when a later collision moves an object into them',()=>{
 const frames=[frame(300,0,true),frame(150,0,true),frame(200,0)];
 resolveDrawingCollisions(frames,[{width:816}]);
 expect(frames[2].x).toBeCloseTo(396-1/15);
});
it('keeps identical positions on separate pages and leaves all-permitted frames untouched',()=>{
 const frames=[frame(100,100,false,0),frame(100,100,false,1)];
 const before=structuredClone(frames);resolveDrawingCollisions(frames,[{width:816},{width:816}]);expect(frames).toEqual(before);
 const permitted=[frame(100,100,true),frame(100,100,true)],copy=structuredClone(permitted);
 resolveDrawingCollisions(permitted,[{width:816}]);expect(permitted).toEqual(copy);
});
it('guards collisions requiring text-wrap reflow rather than moving ink independently of text',()=>{
 expect(()=>resolveDrawingCollisions([frame(100,100),frame(100,100,true,0,'square')],[{width:816}])).toThrow(/text-wrapped/);
});
