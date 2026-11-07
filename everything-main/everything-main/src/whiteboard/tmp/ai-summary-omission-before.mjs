import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {board,item,validateBoard} from '../src/model.js';
import {createAI,boardText} from '../src/ai/ai-ui.js';
import {language,setLanguage} from '../src/i18n.js';

for (const locale of ['en','fr']) for (const limit of ['object','board']) {
  const dom=new JSDOM('<button id="open">Open</button>',{url:'https://whiteboard.test'});
  const globals=Object.fromEntries(['document','localStorage'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const previousLanguage=language;
  for (const key of ['document','localStorage']) Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true,writable:true});
  try {
    setLanguage(locale);
    const b=board('Summary scope verification');
    const missing='Decision: retain the current launch date.';
    b.items=limit==='object' ? [item('text',0,0,{text:'A'.repeat(2000)+missing})] : [
      ...Array.from({length:30},(_,n)=>item('note',n*10,0,{text:'N'+n+' '+ 'A'.repeat(1900)})),
      item('note',0,100,{text:missing,lang:'fr-CA',textRuns:[{start:0,end:8,style:{lang:'en-GB'}}]}),
    ];
    validateBoard(structuredClone(b));
    const source=JSON.stringify(b);
    let captured,writes=0;
    const ai=createAI({
      org:{info:{role:'member'},allows:()=>true,request:async(op,data)=>{assert.equal(op,'org.ai');captured=data;return {text:'Controlled review response.'};}},
      session:()=>null,board:()=>b,view:()=>b,selection:()=>new Set(),
      modal(title,html,init){const d=dom.window.document.createElement('dialog');d.open=true;d.innerHTML=html;d.close=()=>{d.open=false;d.dispatchEvent(new dom.window.Event('close'));d.remove();};dom.window.document.body.append(d);init(d);return d;},
      icon:()=>'',mutate(fn){writes++;fn();},center:()=>({x:0,y:0}),select(){},canEdit:()=>true,toast(){},refresh(){},puter:()=>null,
    });
    const d=ai.open(),button=d.querySelector('[data-ai="summarize"]');
    assert.equal(button.querySelector('small').textContent,locale==='en'?'The whole board':'Le tableau entier');
    await button.onclick();
    const body=captured.prompt.split('\n\nContent:\n')[1];
    assert.equal(body,boardText(b.items));
    assert.equal(body.includes(missing),false);
    assert.equal(d.querySelector('#ai-status').textContent,locale==='en'?'Summary ready. Review it before adding it to the board.':'Résumé prêt. Relisez-le avant de l’ajouter au tableau.');
    assert.doesNotMatch(d.textContent,/shortened|omitted|incomplete|raccourci|omis|incomplet/i);
    assert.equal(JSON.stringify(b),source);
    assert.equal(writes,0);
    console.log(JSON.stringify({locale,limit,items:b.items.length,inputLength:body.length,decisionSent:body.includes(missing),scope:button.querySelector('small').textContent,status:d.querySelector('#ai-status').textContent,sourcePreserved:true,writes}));
    d.close();
  } finally {
    setLanguage(previousLanguage);dom.window.close();
    for(const [key,descriptor] of Object.entries(globals)) if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
}
