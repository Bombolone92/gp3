import { it, expect } from 'vitest';
import { supportsDrawingDisplay, drawingDisplayPlacement, drawingDisplaySurface } from '../src/engine/drawing-display.js';
const shape={type:'shape',width:952500,height:476250,outline:{width:4327,color:'#C0C0C0'},fill:'#D5D5D5'};
it('keeps unsupported display families on their original raster',()=>{
  expect(supportsDrawingDisplay({scene:shape})).toBe(true);
  for(const change of [{text:{}},{shadow:{}},{shapeRotation:1},{flipH:true},{pictureOutline:true},{fill:{type:'linearGradient'}},{outline:{compound:'dbl'}},{outline:{headEnd:{}}},{type:'picture'}]){
    expect(supportsDrawingDisplay({scene:{...shape,...change}}),JSON.stringify(change)).toBe(false);
    expect(supportsDrawingDisplay({scene:{type:'group',width:1,height:1,children:[shape,{...shape,...change}]}}),JSON.stringify(change)).toBe(false);
  }
  expect(supportsDrawingDisplay({scene:shape,shadow:{}})).toBe(false);
});
it('keys integer device-pixel translations together but preserves fractional phase and zoom',()=>{
  const frame={width:100,height:50};
  const at=(x,y,pixelRatio=1)=>drawingDisplayPlacement({...frame,x,y,pixelRatio},frame);
  expect(at(1.25,4.5)).toEqual(at(21.25,30.5));
  expect(at(1.25,4.5)).not.toEqual(at(1.5,4.5));
  expect(at(1.25,4.5,2)).not.toEqual(at(1.25,4.5));
  expect(drawingDisplayPlacement({...frame,x:0,y:0,pixelRatio:1,originX:.25,originY:.5},frame)).toEqual(at(.25,.5));
  expect(drawingDisplayPlacement({...frame,width:101,x:0,y:0,pixelRatio:1},frame)).toBeUndefined();
  expect(drawingDisplayPlacement({...frame,x:0,y:0,pixelRatio:1,axisAligned:false},frame)).toBeUndefined();
});
it('aligns bounds to device pixels while keeping 2x density and hard resource ceilings',()=>{
  for(const scale of [.25,.75,1,1.25,2,3]){
    const d={scale,x:.125,y:.375},s=drawingDisplaySurface({left:-.2,top:-.7,right:100.1,bottom:50.3},d);
    expect(s.resolution).toBeGreaterThanOrEqual(2);
    expect((s.left+d.x)*scale).toBeCloseTo(Math.round((s.left+d.x)*scale),10);
    expect((s.top+d.y)*scale).toBeCloseTo(Math.round((s.top+d.y)*scale),10);
    expect(s.pixelsWide*s.pixelsHigh).toBeLessThanOrEqual(16000000);
  }
  for(const scale of [.01,1,100])expect(drawingDisplaySurface({left:0,top:0,right:2000,bottom:2000},{scale,x:0,y:0})).toBeUndefined();
});
