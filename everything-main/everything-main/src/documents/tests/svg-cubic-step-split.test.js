import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {flattenSvgGroupCubic} from '../src/engine/svg-group-cubic.js';

const root='tests/fixtures/svg-cubic-step-split/';
const bytes=readFileSync(root+'api-cases.json'),cases=JSON.parse(bytes);
const native=JSON.parse(readFileSync(root+'native-api.json','utf8').replace(/^\uFEFF/,''));
const documentCases=JSON.parse(readFileSync(root+'cases.json'));
expect(createHash('sha256').update(bytes).digest('hex')).toBe(native.inputSha256);
expect(native.quantizeInput).toBe(true);expect(native.tolerance).toBe(.25);
expect(native.cases).toHaveLength(cases.length);
for(const [i,c] of cases.entries())it(`native split cubic coordinates: ${c.name}`,()=>{
 const parent=documentCases.find(p=>p.name===c.parent);
 expect(parent.segments[c.side==='left'?0:1]).toEqual(c.points);
 expect(native.cases[i].name).toBe(c.name);
 const flat=native.cases[i].points;
 expect(flattenSvgGroupCubic(c.points)).toEqual(Array.from({length:flat.length/2},(_,at)=>flat.slice(at*2,at*2+2)));
});
