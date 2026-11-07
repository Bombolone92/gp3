import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import axe from 'axe-core';

test('audit and board activity preserve captured title language and escaped JSON while paginating and exporting',async()=>{
 const dom=new JSDOM('<!doctype html><html lang="en"><body></body></html>',{url:'https://whiteboard.test',runScripts:'outside-only',pretendToBeVisual:true});
 const keys=['document','localStorage','NodeFilter','HTMLElement','Node','Event'];for(const key of keys)globalThis[key]=dom.window[key];
 try{
  const {createAdminConsole}=await import('../src/organization/admin-ui.js');
  const {setLanguage}=await import('../src/i18n.js');setLanguage('en');
  const phrase='Choisissez "les étapes" <img id="pwn-audit"> \\ ensemble.\n';
  const mixed='Start. '+phrase+'End.';
  const first={id:'first',at:1,category:'content',action:'vote.started',target:{id:'r1'},details:{id:'v1',title:phrase,titleLang:'fr-CA',anonymous:false}};
  const second={id:'second',at:2,category:'content',action:'poll.started',target:{id:'r1'},details:{id:'p1',title:mixed,titleLang:'en-CA',titleRuns:[{start:7,end:7+phrase.length,style:{lang:'fr-CA'}}],anonymous:true}};
  const legacy={id:'legacy',at:3,category:'content',action:'vote.started',details:{id:'old',title:'Ancien choix',anonymous:false}};
  const invalid={id:'invalid',at:4,category:'content',action:'vote.started',details:{id:'bad',title:'Broken',titleLang:'bad tag',titleRuns:[{start:1,end:1000,style:{lang:'fr'}}]}};
  const downloads=[];
  const admin=createAdminConsole({org:{isAdmin:true,server:'https://whiteboard.test',request:async(op,data)=>op==='org.audit'?(data?.cursor?{entries:[second,legacy,invalid],cursor:null}:{entries:[first],cursor:'next'}):op==='org.board.activity'?{entries:[second]}:op==='org.boards'?{boards:[{room:'r1',title:'Test',created:1}],total:1}:op==='teams.list'?{teams:[]}:op==='spaces.list'?{spaces:[]}:{}},modal(title,html,ready){const d=document.createElement('dialog');d.setAttribute('aria-label',title);d.innerHTML=html;document.body.append(d);ready?.(d);return d;},toast(){},icon(){return ''},download(...args){downloads.push(args)}});
  const d=admin.open('audit');const settle=()=>new Promise(r=>setTimeout(r,20));await settle();
  let details=d.querySelector('.admin-table tbody tr td:last-child');
  assert.equal(details.textContent,JSON.stringify(first.details));assert.equal(details.querySelector('[lang="fr-CA"]').textContent,JSON.stringify(phrase).slice(1,-1));assert.equal(d.querySelector('#pwn-audit'),null);
  d.querySelector('#au-more').focus();d.querySelector('#au-more').click();await settle();
  const rows=[...d.querySelectorAll('.admin-table tbody tr')];assert.equal(rows.length,4);
  details=rows[1].lastElementChild;assert.equal(details.textContent,JSON.stringify(second.details));
  assert.equal(details.querySelector('[lang="en-CA"] [lang="fr-CA"]').textContent,JSON.stringify(phrase).slice(1,-1));
  assert.equal(rows[2].lastElementChild.querySelector('[lang]'),null);assert.equal(rows[3].lastElementChild.querySelector('[lang]'),null);
  assert.equal(rows[3].lastElementChild.textContent,JSON.stringify(invalid.details));assert.equal(document.activeElement.id,'admin-panel');
  d.querySelector('#au-json').click();await settle();assert.deepEqual(JSON.parse(downloads.at(-1)[0]),[first,second,legacy,invalid]);
  d.querySelector('#au-csv').click();await settle();assert.match(downloads.at(-1)[0],/fr-CA/);
  dom.window.eval(axe.source);const result=await dom.window.axe.run(d,{rules:{'color-contrast':{enabled:false}}});assert.deepEqual(Array.from(result.violations,v=>v.id),[]);
  setLanguage('fr');d.querySelector('[data-tab="boards"]').click();await settle();d.querySelector('[data-activity="r1"]').click();await settle();
  details=d.querySelector('#board-detail .admin-table tbody tr td:last-child');assert.equal(details.textContent,JSON.stringify(second.details));assert.equal(details.querySelector('[lang="en-CA"] [lang="fr-CA"]').textContent,JSON.stringify(phrase).slice(1,-1));
 }finally{for(const key of keys)delete globalThis[key];dom.window.close();}
});
