import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {flattenSvgGroupCubic} from '../src/engine/svg-group-cubic.js';
import {flattenSvgGroupCubic as midpoint} from '../tools/candidates/svg-cubic-midpoint-state.mjs';

const root='tests/fixtures/svg-cubic-state-controls/',hash=b=>createHash('sha256').update(b).digest('hex');
const reference=JSON.parse(readFileSync(root+'reference.json'));
const inputs=gunzipSync(readFileSync(root+'cases.json.gz')),capture=gunzipSync(readFileSync(root+'native-api.json.gz'));
const cases=JSON.parse(inputs),native=JSON.parse(capture.toString('utf8').replace(/^\uFEFF/,''));
const vertices=row=>Array.from({length:row.points.length/2},(_,i)=>row.points.slice(2*i,2*i+2));

it('binds independent affine controls to their native API capture and authoring source',()=>{
 for(const [name,expected] of Object.entries(reference.sourceHashes))expect(hash(readFileSync(name))).toBe(expected);
 for(const [name,expected] of Object.entries(reference.compressed))expect(hash(readFileSync(root+name))).toBe(expected);
 expect(hash(inputs)).toBe(reference.inputSha256);expect(hash(capture)).toBe(reference.captureSha256);
 expect(native.inputSha256).toBe(reference.inputSha256);expect(native.quantizeInput).toBe(true);expect(native.tolerance).toBe(.25);
 expect(cases).toHaveLength(504);expect(native.cases.map(c=>c.name)).toEqual(cases.map(c=>c.name));
 expect(new Set(cases.map(c=>c.name)).size).toBe(cases.length);
});

it('retains all currently correct native curves while allowing other curves to improve',()=>{
 const accepted=new Set(reference.acceptedCurrentCaseNames);
 expect(accepted.size).toBe(reference.currentExact);
 let checked=0;
 for(const [i,c] of cases.entries())if(accepted.has(c.name)){
  expect(flattenSvgGroupCubic(c.points),c.name).toEqual(vertices(native.cases[i]));checked++;
 }
 expect(checked).toBe(accepted.size);
});

it('native and current whole and half curves retain fractional translation invariance',()=>{
 const originals=new Map();
 for(const [i,c] of cases.entries())if(c.kind==='phase' && c.transform.name==='0,0')
  originals.set(`${c.base}/${c.representation}`,{native:vertices(native.cases[i]),current:flattenSvgGroupCubic(c.points)});
 let checked=0;
 for(const [i,c] of cases.entries())if(c.kind==='phase'){
  const original=originals.get(`${c.base}/${c.representation}`),unshift=points=>points.map(p=>p.map((v,k)=>v-c.transform.shift[k]));
  expect(unshift(vertices(native.cases[i])),c.name).toEqual(original.native);
  expect(unshift(flattenSvgGroupCubic(c.points)),c.name).toEqual(original.current);checked++;
 }
 expect(checked).toBe(120);
});

it('the experimental whole-curve fit has a native split counterexample',()=>{
 let exactWhole=0,rightCounterexample;
 for(const [i,c] of cases.entries())if(c.kind==='phase'){
  const expected=vertices(native.cases[i]);
  if(c.representation==='whole'){expect(midpoint(c.points),c.name).toEqual(expected);exactWhole++;}
  if(c.representation==='right' && JSON.stringify(midpoint(c.points))!==JSON.stringify(expected))rightCounterexample=c;
 }
 expect(exactWhole).toBe(40);expect(rightCounterexample).toBeDefined();
});
