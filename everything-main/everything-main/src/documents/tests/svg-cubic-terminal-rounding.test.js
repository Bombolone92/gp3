import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {flattenSvgGroupCubic} from '../src/engine/svg-group-cubic.js';

const root='tests/fixtures/svg-cubic-terminal-rounding/';
const bytes=readFileSync(root+'cases.json'),cases=JSON.parse(bytes);
const native=JSON.parse(readFileSync(root+'native-api.json','utf8').replace(/^\uFEFF/,''));
expect(createHash('sha256').update(bytes).digest('hex')).toBe(native.inputSha256);
expect(native.quantizeInput).toBe(true);expect(native.tolerance).toBe(.25);
expect(native.cases).toHaveLength(cases.length);
for(const [i,c] of cases.entries())it(`native narrow cubic coordinates: ${c.name}`,()=>{
 expect(native.cases[i].name).toBe(c.name);
 const flat=native.cases[i].points,points=Array.from({length:flat.length/2},(_,i)=>flat.slice(i*2,i*2+2));
 expect(flattenSvgGroupCubic(c.points)).toEqual(points);
});
