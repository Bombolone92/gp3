import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {board,item,validateBoard} from '../src/model.js';
import {createAI as before} from './ai-summary-omission-initial-source.js';
import {createAI as after} from '../src/ai/ai-ui.js';
const b=board('Exact budget and empty tables');
b.items=[...Array.from({length:25},(_,n)=>item('note',n,0,{text:'A'.repeat(n===24?1991:1990)})),...Array.from({length:4975},(_,n)=>item('table',n,1,{cells:Array.from({length:20},()=>Array(12).fill(''))}))];
validateBoard(structuredClone(b));const source=JSON.stringify(b);
const dom=new JSDOM('<body></body>',{url:'https://whiteboard.test'}),descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');
Object.defineProperty(globalThis,'document',{value:dom.window.document,configurable:true,writable:true});
try{
 const samples={before:[],after:[]};
 for(let round=0;round<7;round++)for(const version of round%2?['after','before']:['before','after']){
  const d=dom.window.document.createElement('dialog');d.innerHTML='<div id="ai-work"></div><p id="ai-status"></p>';dom.window.document.body.append(d);d.close=()=>{d.dispatchEvent(new dom.window.Event('close'));d.remove();};
  let start,elapsed,captured;
  const ai=(version==='before'?before:after)({org:{info:{role:'member'},allows:()=>true,request:async(op,data)=>{elapsed=performance.now()-start;captured=data;return {text:'Reviewed summary.'};}},session:()=>null,board:()=>b,view:()=>b,selection:()=>new Set(),mutate(){throw Error('Unexpected source write');},center:()=>({x:0,y:0}),select(){},canEdit:()=>true,toast(){},refresh(){},puter:()=>null});
  start=performance.now();await ai.summarize(d);
  assert.equal(captured.prompt.split('\n\nContent:\n')[1].length,50000);assert.equal(d.querySelector('#ai-summary-scope'),null);d.close();
  if(round>1)samples[version].push(elapsed);
 }
 assert.equal(JSON.stringify(b),source);
 const median=a=>a.toSorted((a,b)=>a-b)[Math.floor(a.length/2)];
 console.log(JSON.stringify({validItems:b.items.length,blankTableCells:4975*240,samples,medianBeforeMs:median(samples.before),medianAfterMs:median(samples.after),sourceUnchanged:true}));
}finally{dom.window.close();if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else delete globalThis.document;}
