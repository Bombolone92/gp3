import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {board,item,validateBoard} from '../src/model.js';
import {createAI} from '../src/ai/ai-ui.js';
import {language,setLanguage} from '../src/i18n.js';
import {fieldContent} from '../src/facilitation/authored-field.js';
for(const locale of ['en','fr'])test(`full-board summary uses the exact bounded request and preserves source in ${locale}`,async()=>{
 const dom=new JSDOM('<dialog open><div id="ai-work"></div><p id="ai-status"></p></dialog>',{url:'https://whiteboard.test'}),descriptor=Object.getOwnPropertyDescriptor(globalThis,'document'),previousLanguage=language,d=dom.window.document.querySelector('dialog');
 Object.defineProperty(globalThis,'document',{value:dom.window.document,configurable:true,writable:true});
 d.close=()=>{d.open=false;d.dispatchEvent(new dom.window.Event('close'));d.remove();};
 try{
  setLanguage(locale);const b=board('Full summary budget'),f=item('frame',0,0,{text:'F'.repeat(20000)});b.items=[f,...Array.from({length:4999},(_,n)=>item('note',n%100,Math.floor(n/100),{text:'Note '+n,parentId:f.id}))];b.items[1].lang='fr-CA';b.items[1].textRuns=[{start:0,end:4,style:{lang:'en-GB'}}];validateBoard(structuredClone(b));const original=JSON.stringify(b),reply=locale==='fr'?'Résumé vérifié':'Reviewed summary';let captured,writes=0;
  const ai=createAI({org:{info:{role:'member'},allows:()=>true,request:async(op,data)=>{assert.equal(op,'org.ai');captured=data;return {text:reply};}},session:()=>null,board:()=>b,view:()=>b,selection:()=>new Set(b.items.map(i=>i.id)),mutate(fn){writes++;fn();},center:()=>({x:0,y:0}),select(){},canEdit:()=>true,toast(){},refresh(){},puter:()=>null});
  await ai.summarize(d);assert.equal(captured.task,'summarize');const body=captured.prompt.split('\n\nContent:\n')[1],expected=Array.from({length:3},(_,n)=>'- (note, '+f.text+') Note '+n).join('\n').slice(0,50000);assert.equal(body,expected);assert.equal(body.length,50000);assert.equal(body.isWellFormed(),true);assert.deepEqual(fieldContent(d.querySelector('#ai-summary')),{text:reply,lang:locale});assert.equal(JSON.stringify(b),original);assert.equal(writes,0);assert.equal(dom.window.document.documentElement.lang,locale);assert.equal(d.dataset.aiBusy,undefined);
 }finally{d.close();setLanguage(previousLanguage);dom.window.close();if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else delete globalThis.document;}
});
