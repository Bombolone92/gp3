import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {board,item,validateBoard} from '../src/model.js';
const {createAI}=await import(process.env.WHITEBOARD_AI_SCOPE_CANDIDATE?'./ai-summary-scope-candidate.js':'../src/ai/ai-ui.js');
import {language,setLanguage} from '../src/i18n.js';
for(const locale of ['en','fr'])for(const scenario of ['selected remains','selected deleted','whole board'])test(`Summary stays within its displayed ${scenario} scope in ${locale}`,async()=>{
 const dom=new JSDOM('<body></body>',{url:'https://whiteboard.test'}),descriptors=Object.fromEntries(['document','localStorage'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),previousLanguage=language;
 for(const key of ['document','localStorage'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true,writable:true});
 let d;
 try{
  setLanguage(locale);
  const b=board('Chosen summary scope'),chosen=item('note',0,0,{text:'Chosen short source.'}),other=item('note',1,0,{text:'Other visible notes that were not chosen.'}),hidden=item('note',2,0,{text:'Private source.'});b.items=[chosen,other,hidden];validateBoard(structuredClone(b));
  const selected=new Set(scenario==='whole board'?[]:[chosen.id]);
  const prompts=[],toasts=[];let writes=0;
  const ai=createAI({org:{info:{role:'member'},allows:()=>true,request:async(op,data)=>{prompts.push(data);return {text:'Controlled review response.'};}},session:()=>null,board:()=>b,view:()=>({...b,items:b.items.filter(i=>i.id!==hidden.id)}),selection:()=>selected,
   modal(title,html,init){d=dom.window.document.createElement('dialog');d.open=true;d.innerHTML=html;d.close=()=>{d.open=false;d.dispatchEvent(new dom.window.Event('close'));d.remove();};dom.window.document.body.append(d);init(d);return d;},icon:()=>'',mutate(fn){writes++;fn();},center:()=>({x:0,y:0}),select(){},canEdit:()=>true,toast:m=>toasts.push(m),refresh(){},puter:()=>null});
  ai.open();const button=d.querySelector('[data-ai="summarize"]');
  const scope=button.querySelector('small').textContent;
  assert.equal(scope,scenario==='whole board'?(locale==='en'?'The whole board':'Le tableau entier'):(locale==='en'?'The selected objects':'Les objets sélectionnés'));
  if(scenario==='selected deleted'){b.items=b.items.filter(i=>i.id!==chosen.id);selected.clear();validateBoard(structuredClone(b));}
  const original=JSON.stringify(b);await button.onclick();
  if(scenario==='selected deleted'){
   assert.equal(prompts.length,0,'The selected-object action must not send other board content after its source disappears.');
   assert.equal(d.querySelector('#ai-summary'),null);
   assert.deepEqual(toasts,['There is no text to summarize.']);
  }else{
   assert.equal(prompts.length,1);
   assert.equal(prompts[0].prompt.includes(other.text),scenario==='whole board');
   assert.equal(prompts[0].prompt.includes(hidden.text),false);
  }
  assert.equal(JSON.stringify(b),original);assert.equal(writes,0);

 }finally{d?.close();setLanguage(previousLanguage);dom.window.close();for(const[key,descriptor]of Object.entries(descriptors))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
});
