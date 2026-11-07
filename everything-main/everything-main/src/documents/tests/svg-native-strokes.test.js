import { it, expect } from 'vitest';
import { nativeStrokeWidth } from '../src/engine/svg-native-strokes.js';
const matrix=(a=1,b=0,c=0,d=a)=>({a,b,c,d});
it('matches the uniform viewport/transform floor measured in native reference SVG probes',()=>{
  for(const width of [.125,.25,.5,.75,1]) expect(nativeStrokeWidth(width,matrix())).toBeCloseTo(7/6);
  expect(nativeStrokeWidth(.5,matrix(2))).toBeCloseTo(7/12);
  expect(nativeStrokeWidth(.5,matrix(0,2,-2,0))).toBeCloseTo(7/12);
  expect(nativeStrokeWidth(.5,matrix(-2,0,0,2))).toBeCloseTo(7/12);
  for(const width of [1.5,2,4]) expect(nativeStrokeWidth(width,matrix())).toBe(width);
});
it('does not invent strokes or a scale for degenerate or unverified transforms',()=>{
  expect(nativeStrokeWidth(0,matrix())).toBe(0);
  expect(nativeStrokeWidth(.5,matrix(0))).toBe(.5);
  expect(nativeStrokeWidth(.5,matrix(2,0,0,1))).toBe(.5);
  expect(nativeStrokeWidth(.5,matrix(1,0,1,1))).toBe(.5);
});
