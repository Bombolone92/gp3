import test from 'node:test';
import assert from 'node:assert/strict';
import {board,item,validateBoard} from '../src/model.js';
import {workshopEvents} from '../src/facilitation/model.js';
const live=(kind,text,lang,runs)=>kind==='vote'?{id:'v',title:text,...(lang?{titleLang:lang}:{}),...(runs?{titleRuns:runs}:{}),votes:1,multiple:false,anonymous:false,hidden:false,targets:['a'],state:'active',revealed:true,startedAt:1,endsAt:0}:{id:'p',question:text,...(lang?{questionLang:lang}:{}),...(runs?{questionRuns:runs}:{}),options:[{id:'a',text:'Yes'},{id:'b',text:'No'}],multiple:false,anonymous:false,hidden:false,state:'open',revealed:true,startedAt:1};
for(const kind of ['vote','poll'])test(`${kind} audit snapshots whole-title and passage languages at its Unicode-safe limit`,()=>{
  const text='Start. Veuillez choisir les prochaines étapes. End.';
  const source=live(kind,text,'en-CA',[{start:7,end:46,style:{lang:'fr-CA'}}]);
  const b=board();b.items=[item('note',0,0,{id:'a'})];b.workshop={[kind]:source};validateBoard(structuredClone(b));
  const details=workshopEvents({},b.workshop)[0].details;
  assert.equal(details.title,text);assert.equal(details.titleLang,'en-CA');assert.deepEqual(details.titleRuns,[{start:7,end:46,style:{lang:'fr-CA'}}]);
  assert.notEqual(details.titleRuns,source[kind==='vote'?'titleRuns':'questionRuns']);
  details.titleRuns[0].style.lang='de';assert.equal(source[kind==='vote'?'titleRuns':'questionRuns'][0].style.lang,'fr-CA');
  const long='a'.repeat(199)+'😀 suite';
  const clipped=workshopEvents({},{[kind]:live(kind,long,'en',[{start:195,end:long.length,style:{lang:'fr'}}])})[0].details;
  assert.equal(clipped.title,'a'.repeat(199));assert.deepEqual(clipped.titleRuns,[{start:195,end:199,style:{lang:'fr'}}]);
  const legacy=workshopEvents({},{[kind]:live(kind,'Legacy')})[0].details;
  assert.deepEqual(legacy,{id:kind==='vote'?'v':'p',title:'Legacy',anonymous:false});
});
