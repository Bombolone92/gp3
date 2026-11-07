import assert from 'node:assert/strict';
import { regionNotes as original } from '../src/export-pptx.js';
import { regionNotes as candidate } from './pptx-language-candidate.js';
let seed=42;
const rand=n=>(seed=(Math.imul(seed,1664525)+1013904223)>>>0)%n;
const units=['Hello','bonjour','😀','& <x>',' ','\t','\n','\r','\r\n','\u00a0','é'];
const string=()=>Array.from({length:rand(80)},()=>units[rand(units.length)]).join('');
const types=['text','note','frame','table','image','pen','link','file'];
for(let n=0;n<2000;n++){
 const items=Array.from({length:rand(20)},()=>{
  const type=types[rand(types.length)],text=string();
  return {type,text,x:rand(10),y:rand(10),lang:rand(2)?'fr':undefined,
   alt:rand(2)?string():'',url:'https://example.com',fileName:'example.pdf',
   ...(type==='table'?{cells:Array.from({length:rand(5)+1},()=>Array.from({length:rand(4)+1},string))}:{}),
  };
 });
 const r={name:'frame',items};
 assert.deepEqual(candidate(r),original(r),`sample ${n}`);
}
console.log('2,000 generated region text equivalence checks pass');
const r={name:'Load',items:Array.from({length:5000},(_,n)=>({type:'note',x:n,y:n,text:'Line one\nLine two\tthird'}))};
for(const [name,fn] of [['original',original],['candidate',candidate]]){
 for(let n=0;n<5;n++)fn(r);
 const start=performance.now();for(let n=0;n<10;n++)fn(r);
 console.log(`${name}: ${((performance.now()-start)/10).toFixed(2)}ms for 5,000 two-line notes`);
}
