import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {svgGroupCubicContours,svgGroupCoverageCounts,flattenSvgGroupCubic} from '../src/engine/svg-group-cubic.js';

for(const [family,remaining] of [['svg-cubic-coverage',[0,0,0,0,0,0]],['svg-cubic-coverage-large',[7,0,0,51,0,2]]]){
 const root=`tests/fixtures/${family}/`,cases=JSON.parse(readFileSync(root+'cases.json'));
 const native=JSON.parse(readFileSync(root+'native-coverage-reference.json')),frames=JSON.parse(readFileSync(root+'metafile-reference.json'));
 for(const [i,c] of cases.entries())it(`${family}: ${c.name} retains native subdivision evidence`,()=>{
  const contours=svgGroupCubicContours(c.path);expect(contours).not.toBeNull();
  const f=frames.images[i],r=native.rows[i];
  expect(createHash('sha256').update(readFileSync(root+f.path)).digest('hex')).toBe(f.sha256);
  const alpha=r.alphaBase64?Buffer.from(r.alphaBase64,'base64'):inflateSync(Buffer.from(r.alphaDeflateBase64,'base64'));
  const counts=svgGroupCoverageCounts(contours,{x:f.transform[4],y:f.transform[5],width:f.size[0],height:f.size[1]});
  let different=0;counts.forEach((n,i)=>{different+=Math.round(n*255/32)!==alpha[i];});
  expect(different).toBe(remaining[i]);
 });
}

it('implicit cubic segments and move pairs preserve equivalent SVG contours',()=>{
 expect(svgGroupCubicContours('M0 0C0 10 10 10 10 0 10 20 20 20 20 0L20 30 0 30Z'))
  .toEqual(svgGroupCubicContours('M0 0C0 10 10 10 10 0C10 20 20 20 20 0L20 30L0 30Z'));
 expect(svgGroupCubicContours('M0 0 0 10C0 20 10 20 10 10Z'))
  .toEqual(svgGroupCubicContours('M0 0L0 10C0 20 10 20 10 10Z'));
});

it('invalid, unsupported and excessive paths retain the existing coverage path',()=>{
 for(const d of ['M0 0 L10 10Z','M0 0 C1 2 3 4 5','M0 0 c1 2 3 4 5 6Z','M0 0 C1 2 3 4 5 6Z L8 9','M0 0 C1 2 3 4 1e999 6Z',`M0 0C0 1 1 1 1 0${'L0 0'.repeat(5000)}Z`])
  expect(svgGroupCubicContours(d)).toBeNull();
 expect(flattenSvgGroupCubic([[0,0],[1,2],[3,4],[Infinity,0]])).toBeNull();
});

it('half-open boundaries exclude bottom/right samples and retain winding holes',()=>{
 const contours=[[[0,0],[3,0],[3,3],[0,3]],[[1,1],[2,1],[2,2],[1,2]]];
 expect([...svgGroupCoverageCounts(contours,{x:0,y:0,width:4,height:4},'nonzero')]).toEqual([32,32,32,0,32,32,32,0,32,32,32,0,0,0,0,0]);
 expect(svgGroupCoverageCounts(contours,{x:0,y:0,width:4,height:4},'evenodd')[5]).toBe(0);
});
