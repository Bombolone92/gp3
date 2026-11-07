import assert from 'node:assert/strict';
import {board,item,validateBoard} from '../src/model.js';
import {boardText as before} from './ai-summary-omission-before.js';
import {boardText as after} from '../src/ai/ai-ui.js';
const full=board('Full board'),f=item('frame',0,0,{text:'F'.repeat(20000)});
full.items=[f,...Array.from({length:4999},(_,n)=>item('note',n%100,Math.floor(n/100),{text:'Note '+n,parentId:f.id}))];
const exact=board('Exact limit');exact.items=Array.from({length:25},(_,n)=>item('note',n,0,{text:'A'.repeat(n===24?1991:1990)}));
const short=board('Short content');short.items=[item('note',0,0,{text:'Decision: keep the launch date.'})];
for(const b of [full,exact,short])validateBoard(structuredClone(b));
let consumed=0;
for(const [name,b] of [['full5000',full],['exact50000',exact],['short',short]]){
 const source=JSON.stringify(b);assert.equal(after(b.items),before(b.items));
 for(let n=0;n<200;n++){consumed+=before(b.items).length;consumed+=after(b.items).length;}
 const samples={before:[],after:[]},iterations=500;
 for(let round=0;round<9;round++)for(const version of round%2?['after','before']:['before','after']){
  globalThis.gc();const fn=version==='before'?before:after,start=performance.now();
  for(let n=0;n<iterations;n++)consumed+=fn(b.items).length;
  samples[version].push((performance.now()-start)/iterations);
 }
 const median=a=>a.toSorted((a,b)=>a-b)[Math.floor(a.length/2)];
 assert.equal(JSON.stringify(b),source);
 console.log(JSON.stringify({name,iterations,samples,medianBeforeMs:median(samples.before),medianAfterMs:median(samples.after),ratio:median(samples.after)/median(samples.before)}));
}
assert.ok(consumed>0);
