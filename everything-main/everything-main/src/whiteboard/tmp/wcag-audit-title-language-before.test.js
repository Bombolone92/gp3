import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {board,item,validateBoard} from '../src/model.js';
import {SharedDocument} from '../src/collaboration/document.js';
import {encode,hash} from '../src/collaboration/protocol.js';
import {adminCall} from '../worker/admin.js';
import {environment,owner} from '../tests/collaboration-helpers.js';

for(const kind of ['vote','poll']) test(`actual ${kind} audit title retains the authored French language`, async()=>{
  const env=environment(), service=env.service, org=service.org;
  await adminCall(org,service,owner,{op:'org.setup',name:'Audit test'});
  const b=board('Audit test'); b.items=[item('note',0,0,{id:'a',text:'A'})];
  const doc=new SharedDocument();doc.commit(b);
  await service.call(owner,{op:'create',room:b.id,update:encode(doc.update())});
  const before=doc.vector();
  const sentence='Veuillez choisir les prochaines étapes.';
  b.workshop=kind==='vote'?{vote:{id:'audit-vote',title:sentence,titleLang:'fr',votes:1,multiple:false,anonymous:false,hidden:false,targets:['a'],state:'active',revealed:true,startedAt:env.now,endsAt:0}}:{poll:{id:'audit-poll',question:sentence,questionLang:'fr',options:[{id:'yes',text:'Oui'},{id:'no',text:'Non'}],multiple:false,anonymous:false,hidden:false,state:'open',revealed:true,startedAt:env.now}};
  validateBoard(structuredClone(b));doc.commit(b);const update=doc.update(before);
  await service.call(owner,{op:'commit',room:b.id,id:await hash(update),update:encode(update)});doc.destroy();
  const entries=(await adminCall(org,service,owner,{op:'org.audit'})).entries.filter(e=>e.action===`${kind}.started`);
  assert.equal(entries.length,1); assert.equal(entries[0].details.title,sentence);
  const dom=new JSDOM('<!doctype html><html lang="en"><body></body></html>',{url:'https://whiteboard.test'});
  const keys=['document','localStorage','NodeFilter','HTMLElement'];for(const k of keys)globalThis[k]=dom.window[k];
  try {
    const {createAdminConsole}=await import('../src/organization/admin-ui.js');
    const {setLanguage}=await import('../src/i18n.js');setLanguage('en');
    const admin=createAdminConsole({org:{isAdmin:true,server:'https://whiteboard.test',request:async()=>({entries,cursor:null})},modal(title,html,ready){const d=document.createElement('dialog');d.innerHTML=html;document.body.append(d);ready?.(d);return d;},toast(){},icon(){return ''},download(){}});
    const dialog=admin.open('audit');await new Promise(r=>setTimeout(r,20));
    const details=dialog.querySelector('.admin-table tbody tr td:last-child');
    console.log(JSON.stringify({kind,record:entries[0],html:details.outerHTML,pageLanguage:document.documentElement.lang}));
    const authored=[...details.querySelectorAll('[lang]')].find(n=>n.textContent.includes(sentence));
    assert.equal(authored?.getAttribute('lang'),'fr');
  }finally{for(const k of keys)delete globalThis[k];dom.window.close();}
});
