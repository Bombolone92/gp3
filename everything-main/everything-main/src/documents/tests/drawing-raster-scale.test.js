import {it,expect} from 'vitest';
import {drawingRasterScale} from '../src/engine/drawing-raster-scale.js';

it('preserves ordinary rendering and resolves fractional display enlargement',()=>{
 for(const ratio of [0,.5,1,1.5,2,NaN,Infinity])expect(drawingRasterScale(192,96,ratio)).toBe(2);
 expect(drawingRasterScale(192,96,2.5)).toBe(3);
 expect(drawingRasterScale(192,96,4)).toBe(4);
});
it('keeps enlarged surfaces inside the existing dimension and pixel limits',()=>{
 for(const [width,height] of [[100,100],[4096,1],[2000,2000],[800,1100],[3000,1000]])for(const wanted of [3,4,8,100]){
  const scale=drawingRasterScale(width,height,wanted);
  expect(width*scale).toBeLessThanOrEqual(8192);expect(height*scale).toBeLessThanOrEqual(8192);
  expect(width*height*scale*scale).toBeLessThanOrEqual(16000000);
  expect(scale).toBeGreaterThanOrEqual(2);
 }
});
