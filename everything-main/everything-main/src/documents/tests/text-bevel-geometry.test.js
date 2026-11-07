import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {emboldenGlyphContours,flattenGlyphContours} from '../src/engine/text-bevel-geometry.js';

const reference=JSON.parse(readFileSync('tests/fixtures/text-3d/outline-reference.json'));
for(const record of reference.records)it(`matches independent native ${record.name} at ${record.unitsPerEm} units/em`,()=>{
  const strengthY=Math.ceil(record.unitsPerEm/50)-1;
  const original=structuredClone(record.input);
  const actual=emboldenGlyphContours(record.input,{
    scale:1-strengthY/record.unitsPerEm,strengthX:strengthY+1,strengthY,
  });
  expect(record.input).toEqual(original);
  expect(actual.map(c=>c.length)).toEqual(record.expected.map(c=>c.length));
  for(let i=0;i<actual.length;i++)for(let j=0;j<actual[i].length;j++){
    expect(actual[i][j].onCurve).toBe(record.expected[i][j].onCurve);
    // GDI quantizes its output and its diagonal directions. This bound is
    // 0.0001em (0.0144pt at 144pt), not exact native coordinate equivalence.
    for(const key of ['x','y'])expect(Math.abs(actual[i][j][key]-record.expected[i][j][key])).toBeLessThanOrEqual(record.unitsPerEm*.0001);
  }
});

it('supports reversed contour conventions, including holes',()=>{
  const input=reference.records.find(r=>r.name==='quadratic ring').input;
  const options={scale:.98,strengthX:20,strengthY:19};
  const result=emboldenGlyphContours(input,options);
  const reversed=emboldenGlyphContours(input.map(c=>c.toReversed()),{...options,interiorLeft:false});
  expect(reversed.map(c=>c.toReversed())).toEqual(result);
});

const p=(x,y,onCurve=true)=>({x,y,onCurve});
it('forms implied curve points after expansion rather than expanding invented vertices',()=>{
  const raw=[p(80,0),p(40,0,false),p(0,-50,false),p(0,-90),p(-20,-90),p(-20,20),p(80,20)];
  const explicit=[...raw.slice(0,2),p(20,-25),...raw.slice(2)];
  expect(flattenGlyphContours([raw],.01)).toEqual(flattenGlyphContours([explicit],.01));
  const options={strengthX:10,strengthY:9};
  expect(flattenGlyphContours(emboldenGlyphContours([raw],options),.01))
    .not.toEqual(flattenGlyphContours(emboldenGlyphContours([explicit],options),.01));
});

it('closes an all-off-curve contour through the implied last/first midpoint',()=>{
  const [polygon]=flattenGlyphContours([[p(-10,0,false),p(0,-10,false),p(10,0,false),p(0,10,false)]],.01);
  expect(polygon[0]).toEqual({x:-5,y:5});
  for(const [x,y] of [[0,-7.5],[7.5,0],[0,7.5],[-7.5,0]])expect(polygon).toContainEqual({x,y});
  expect(polygon.at(-1)).not.toEqual(polygon[0]);
});

it('uses the last on-curve point when the first point is off the curve',()=>{
  const contour=[p(0,-20,false),p(20,0),p(0,0)];
  const [polygon]=flattenGlyphContours([contour],.1);
  expect(polygon[0]).toEqual({x:0,y:0});
  expect(polygon).toContainEqual({x:5,y:-10});
  expect(polygon.at(-1)).toEqual({x:20,y:0});
});

it('keeps duplicate vertices and sharp reversals finite without mutating input',()=>{
  const contour=[p(0,0),p(0,0),p(10,0),p(0,0),p(0,10)];
  const result=emboldenGlyphContours([contour],{strengthX:2,strengthY:2});
  expect(result.flat().every(v=>Number.isFinite(v.x)&&Number.isFinite(v.y))).toBe(true);
  expect(flattenGlyphContours([contour],.1)[0]).toEqual([{x:0,y:0},{x:10,y:0},{x:0,y:0},{x:0,y:10}]);
});

it('rejects invalid geometry parameters before subdivision',()=>{
  for(const tolerance of [0,-1,Infinity,NaN])expect(()=>flattenGlyphContours([[p(0,0),p(1,1)]],tolerance)).toThrow();
  expect(()=>emboldenGlyphContours([[p(0,0),p(1,1)]],{strengthX:-1,strengthY:1})).toThrow();
  expect(()=>flattenGlyphContours([[p(NaN,0),p(1,1)]],.1)).toThrow();
});
