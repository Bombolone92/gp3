import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {projection3d,intersectExtrusion} from '../src/engine/drawing-3d-geometry.js';
import {shade3d} from '../src/engine/drawing-3d-lighting.js';
const reference=JSON.parse(readFileSync('tests/fixtures/picture-3d-left-outlines/wall-interior.json'));
it('matches native lossless gray extrusion-wall colors at fixed interior points',()=>{
 const camera=projection3d({turn:-20,perspective:true});
 expect(reference.samples).toHaveLength(1512);
 for(const [x,y,...rgb]of reference.samples){
  const ray=camera.ray(x-172,y-194);
  const hit=intersectExtrusion(ray,{width:144,height:108,depth:20,geometry:'ellipse'});
  expect(hit?.surface).toBe('side');
  const actual=shade3d(reference.sourceColor,hit.normal,ray.direction.map(value=>-value));
  for(let i=0;i<3;i++)expect(Math.abs(actual[i]-rgb[i]),`native wall (${x},${y}), channel ${i}`).toBeLessThanOrEqual(3);
 }
});
