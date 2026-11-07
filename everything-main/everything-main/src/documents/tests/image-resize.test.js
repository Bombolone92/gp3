import { it, expect } from 'vitest';
import { resizeImageFrame } from '../src/engine/image-resize.js';
import { EMU_PER_PX } from '../src/engine/images.js';

const point = (f, corner) => {
  const a=(f.image.rotation || 0)/60000*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  const x=(corner.includes('w')?-1:1)*f.width/2,y=(corner.includes('n')?-1:1)*f.height/2;
  return {x:f.x+f.width/2+x*c-y*s,y:f.y+f.height/2+x*s+y*c};
};
const opposite = {nw:'se',ne:'sw',sw:'ne',se:'nw'};
it('unlocked corners follow the pointer in local axes and retain the opposite physical corner',()=>{
  for(const rotation of [0,30,90,180,270,359]) for(const corner of Object.keys(opposite)) {
    const f={x:96,y:120,width:160,height:80,image:{width:160*EMU_PER_PX,height:80*EMU_PER_PX,aspectLocked:false,rotation:rotation*60000}};
    const resized=resizeImageFrame(f,corner,7,-11),a=point(f,opposite[corner]),b=point(resized.frame,opposite[corner]),old=point(f,corner),next=point(resized.frame,corner);
    expect(b.x).toBeCloseTo(a.x,5);expect(b.y).toBeCloseTo(a.y,5);
    expect(next.x-old.x).toBeCloseTo(7,3);expect(next.y-old.y).toBeCloseTo(-11,3);
  }
});
it('locks and Shift preserve proportions, including fractional EMU rounding',()=>{
  for(const rotation of [0,30,90]) for(const corner of Object.keys(opposite)) {
    const f={x:96,y:120,width:1270001/EMU_PER_PX,height:762001/EMU_PER_PX,image:{width:1270001,height:762001,aspectLocked:true,rotation:rotation*60000}};
    const resized=resizeImageFrame(f,corner,27,-13);
    expect(Math.abs(resized.height-resized.width*f.image.height/f.image.width)).toBeLessThanOrEqual(.5);
    const shifted=resizeImageFrame({...f,image:{...f.image,aspectLocked:false}},corner,27,-13,{preserveAspect:true});
    expect([shifted.width,shifted.height,shifted.frame.x,shifted.frame.y]).toEqual([resized.width,resized.height,resized.frame.x,resized.frame.y]);
    const a=point(f,opposite[corner]),b=point(resized.frame,opposite[corner]);expect(b.x).toBeCloseTo(a.x,5);expect(b.y).toBeCloseTo(a.y,5);
  }
});
it('center resizing retains the physical center and doubles the pointer delta',()=>{
  const f={x:20,y:30,width:160,height:80,image:{width:160*EMU_PER_PX,height:80*EMU_PER_PX,aspectLocked:false,rotation:30*60000}};
  const r=resizeImageFrame(f,'se',13,7,{fromCenter:true}),a=point(f,'se'),b=point(r.frame,'se');
  expect(r.frame.x+r.frame.width/2).toBeCloseTo(100,6);expect(r.frame.y+r.frame.height/2).toBeCloseTo(70,6);
  expect(b.x-a.x).toBeCloseTo(13,3);expect(b.y-a.y).toBeCloseTo(7,3);
});
it('dragging through the opposite corner retains positive dimensions without flipping the picture',()=>{
  const f={x:20,y:30,width:160,height:80,image:{width:160*EMU_PER_PX,height:80*EMU_PER_PX,aspectLocked:false}};
  const r=resizeImageFrame(f,'se',-1000,-1000);
  expect(r.width).toBe(160*.01*EMU_PER_PX);expect(r.height).toBe(80*.01*EMU_PER_PX);
  expect(r.frame.x).toBeCloseTo(f.x,6);expect(r.frame.y).toBeCloseTo(f.y,6);
});
