import assert from 'node:assert/strict';
import {board,item,validateBoard} from '../src/model.js';
import {boardText as original} from './ai-request-unicode-candidate.js';
import {boardText as candidate} from './ai-summary-prompt-memory-candidate.js';
let seed=87329;
const next=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
for(let n=0;n<300;n++){
 const b=board('Prompt equivalence');
 const f=item('frame',0,0,{text:'F'.repeat(Math.floor(next()*19000))+'😀'});
 b.items=[f,...Array.from({length:Math.floor(next()*60)},(_,index)=>item('note',index*10,0,{text:index%7===0?'  \n ':'Q'.repeat(Math.floor(next()*2050))+'😀\nRead',...(next()<0.7?{parentId:f.id}:{})}))];
 validateBoard(structuredClone(b));
 const ids=n%3===0?null:new Set(b.items.filter(()=>next()<0.6).map(i=>i.id));
 const before=JSON.stringify(b),a=original(b.items,ids),c=candidate(b.items,ids);
 assert.equal(c,a,'fixture '+n);assert.equal(c.isWellFormed(),true);assert.equal(JSON.stringify(b),before);
}
const b=board('Full board');const f=item('frame',0,0,{text:'F'.repeat(20000)});b.items=[f,...Array.from({length:4999},(_,n)=>item('note',n%100,Math.floor(n/100),{text:'Note '+n,parentId:f.id}))];validateBoard(structuredClone(b));assert.equal(candidate(b.items),original(b.items));
console.log('301 exact summary-output/selection/source equivalence cases passed, including the full valid 5,000-object board');
