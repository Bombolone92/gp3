import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createCanvas} from '@napi-rs/canvas';
import {board,item,validateBoard} from '../src/model.js';
import {language,setLanguage,t} from '../src/i18n.js';
const {createAltText}=await import(process.env.WHITEBOARD_ALT_DRAFT_CANDIDATE?'./alt-suggestion-draft-candidate.js':'../src/accessibility/alt-text.js');

for(const locale of ['en','fr']) for(const scenario of ['untouched','edited','cleared','closed'])
test(`pending AI image description preserves ${scenario} review in ${locale}`,async()=>{
 const dom=new JSDOM('<button id="opener">Alternative text</button>',{url:'https://whiteboard.test'});
 const descriptors=Object.fromEntries(['document','Image','fetch'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const previousLanguage=language;
 Object.defineProperty(globalThis,'document',{value:dom.window.document,writable:true,configurable:true});
 Object.defineProperty(globalThis,'Image',{value:class {naturalWidth=4;naturalHeight=4;set src(value){queueMicrotask(()=>this.onload());}},writable:true,configurable:true});
 Object.defineProperty(globalThis,'fetch',{value:async()=>({blob:async()=>new Blob([''],{type:'image/png'})}),writable:true,configurable:true});
 dom.window.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){},drawImage(){}});
 dom.window.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,AA==';
 let close;
 try {
  setLanguage(locale);
  const b=board('Description draft'),photo=item('image',0,0,{src:createCanvas(4,4).toDataURL(),w:4,h:4,alt:'Saved description.',lang:'fr-CA'});b.items=[photo];validateBoard(structuredClone(b));
  const original=JSON.stringify(b),reply='Suggested description.',draft=scenario==='cleared'?'':locale==='fr'?'Description saisie pendant l’attente.':'Description typed while waiting.';
  let resolveReply,request,writes=0,notify;
  const requested=new Promise(r=>notify=r);
  const alt=createAltText({board:()=>b,canEdit:()=>true,toast(){},mutate(fn){writes++;fn();},
   modal(title,html,ready){const d=dom.window.document.createElement('dialog');d.innerHTML=html;d.open=true;d.close=()=>{d.open=false;d.dispatchEvent(new dom.window.Event('close'));d.remove();dom.window.document.querySelector('#opener').focus();};close=d.close;dom.window.document.body.append(d);ready(d);return d;},
   ai:{availability:()=>false,ask(...args){request=args;notify();return new Promise(r=>resolveReply=r);}},
  });
  alt.open(photo);
  const field=dom.window.document.querySelector('#alt-text'),button=dom.window.document.querySelector('#alt-suggest');
  button.click();await requested;
  assert.equal(button.disabled,true);
  assert.equal(request[0],'describe');
  assert.match(request[1],/in fr-CA\./);
  if(scenario==='edited'||scenario==='cleared'){field.value=draft;field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));}
  if(scenario==='closed')close();
  resolveReply(` "${reply}" `);
  for(let n=0;button.disabled&&n<100;n++)await new Promise(r=>setImmediate(r));
  assert.equal(button.disabled,false);
  assert.equal(JSON.stringify(b),original);
  assert.equal(writes,0);
  if(scenario==='closed'){
   assert.equal(dom.window.document.querySelector('#alt-form'),null);
   assert.equal(dom.window.document.activeElement.id,'opener');
   return;
  }
  const expected=scenario==='untouched'?reply:draft;
  assert.equal(field.value,expected,'A later AI response must keep edits made while waiting.');
  assert.equal(field.lang,'fr-CA');
  assert.equal(dom.window.document.querySelector('#alt-count').textContent,`${expected.length} / 1000`);
  assert.equal(dom.window.document.querySelector('#alt-status').textContent,t(scenario==='untouched'?'Review the suggestion before saving.':'Your description changed while AI was working. It has been kept. Request another suggestion to replace it.'));
  dom.window.document.querySelector('#alt-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  assert.equal(writes,1);
  assert.equal(photo.alt,expected||undefined);
  assert.equal(photo.lang,'fr-CA');
  assert.equal(photo.src,JSON.parse(original).items[0].src);
  validateBoard(structuredClone(b));
  assert.equal(dom.window.document.querySelector('#alt-form'),null);
 } finally {
  close?.();setLanguage(previousLanguage);dom.window.close();
  for(const [key,descriptor] of Object.entries(descriptors))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
 }
});
