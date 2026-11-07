import '../src/style.css';
import '../src/organization/organization.css';
import {createElement,X} from 'lucide';
import {board,item,validateBoard,escape} from '../src/model.js';
import {setLanguage,t,translateUI} from '../src/i18n.js';
import {createAltText} from '../src/accessibility/alt-text.js';
const locale=new URLSearchParams(location.search).get('locale')==='fr'?'fr':'en';
setLanguage(locale);document.documentElement.dataset.theme=locale==='fr'?'light':'dark';
const b=board('Pending description fixture'),photo=item('image',0,0,{src:FIXTURE_IMAGE_SRC,w:4,h:4,alt:'Saved description.',lang:'fr-CA'});
b.items=[photo];validateBoard(structuredClone(b));
const original=JSON.stringify(b);let release=null,request=null,writes=0;
const reply=locale==='fr'?'Description suggérée.':'Suggested description.';
const alt=createAltText({board:()=>b,canEdit:()=>true,mutate(fn){writes++;fn();report();},toast(){report();},
 ai:{availability:()=>false,ask(...args){request={task:args[0],usesAuthoredLanguage:args[1].includes('in fr-CA.'),imageJPEG:args[2].startsWith('data:image/jpeg;')};return new Promise(resolve=>{release=resolve;document.querySelector('#fixture-finish').disabled=false;report();});}},
 modal(title,html,init){
  const d=document.createElement('dialog');
  d.innerHTML=`<div class="dialog-header"><h2>${escape(t(title))}</h2><button class="icon-btn" id="fixture-close" aria-label="${t('Close')}">${createElement(X,{'aria-hidden':'true','stroke-width':1.65}).outerHTML}</button></div><button class="secondary" type="button" id="fixture-finish" disabled>${locale==='fr'?'Terminer la réponse de test locale':'Finish local test reply'}</button>${html}`;
  document.body.append(d);d.querySelector('#fixture-close').onclick=()=>d.close();
  d.querySelector('#fixture-finish').onclick=()=>{if(release){const resolve=release;release=null;d.querySelector('#fixture-finish').disabled=true;resolve(` "${reply}" `);report();}};
  d.addEventListener('close',()=>{d.remove();document.querySelector('#open').focus();report();},{once:true});
  init(d);translateUI(d);d.showModal();return d;
 },
});
document.querySelector('#open').onclick=()=>alt.open(photo);
function report(){const f=document.querySelector('#alt-text');parent.postMessage({locale,request,pending:!!release,field:f?.value??null,fieldLanguage:f?.lang??null,count:document.querySelector('#alt-count')?.textContent??null,status:document.querySelector('#alt-status')?.textContent??null,original:{alt:photo.alt,language:photo.lang,unchanged:JSON.stringify(b)===original},writes,focus:document.activeElement?.id},'*');}
new MutationObserver(()=>requestAnimationFrame(report)).observe(document.body,{childList:true,subtree:true,attributes:true});
document.addEventListener('focusin',report);document.addEventListener('input',report);report();
