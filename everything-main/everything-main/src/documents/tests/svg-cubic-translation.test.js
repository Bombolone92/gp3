import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {flattenSvgGroupCubic} from '../src/engine/svg-group-cubic.js';

const folder='tests/fixtures/svg-cubic-translation/';
const reference=JSON.parse(readFileSync(folder+'reference.json'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=name=>{
 const bytes=readFileSync(folder+name+'.gz');
 expect(hash(bytes)).toBe(reference.compressed[name+'.gz']);
 return gunzipSync(bytes);
};
const bytes=read('cases.json'),capture=read('native-api.json');
expect(hash(bytes)).toBe(reference.inputSha256);
expect(hash(capture)).toBe(reference.captureSha256);
for(const [path,expected] of Object.entries(reference.sources))expect(hash(readFileSync(path))).toBe(expected);
const cases=JSON.parse(bytes),native=JSON.parse(capture.toString().replace(/^\uFEFF/,''));
expect(native.inputSha256).toBe(hash(bytes));
expect(native.quantizeInput).toBe(true);expect(native.tolerance).toBe(.25);
expect(cases).toHaveLength(903);expect(native.cases).toHaveLength(cases.length);

for(const family of ['svg-cubic-flatten-sweep','svg-cubic-terminal-rounding'])it(`${family}: native and renderer integer-translation invariance`,()=>{
 const nativeBase=new Map(),rendererBase=new Map();
 const file=family==='svg-cubic-flatten-sweep'?'native-quantized.json':'native-api.json';
 const retained=JSON.parse(readFileSync(`tests/fixtures/${family}/${file}`,'utf8').replace(/^\uFEFF/,''));
 const retainedByName=new Map(retained.cases.map(c=>[c.name,c.points]));
 for(const [i,c] of cases.entries()) {
  if(c.family!==family)continue;
  const row=native.cases[i];expect(row.name).toBe(c.name);
  const expected=Array.from({length:row.points.length/2},(_,at)=>row.points.slice(at*2,at*2+2));
  const actual=flattenSvgGroupCubic(c.points);expect(actual).not.toBeNull();
  const unshift=points=>points.map(p=>p.map((value,axis)=>value-c.shift[axis]));
  if(c.shift.every(v=>v===0)){
   expect(row.points,c.name+' retained capture').toEqual(retainedByName.get(c.base));
   nativeBase.set(c.base,expected);rendererBase.set(c.base,actual);
  }
  else {
   expect(unshift(expected),c.name+' native').toEqual(nativeBase.get(c.base));
   expect(unshift(actual),c.name+' renderer').toEqual(rendererBase.get(c.base));
  }
 }
});
