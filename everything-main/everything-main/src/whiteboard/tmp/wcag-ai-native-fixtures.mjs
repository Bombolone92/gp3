import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { board, item, validateBoard } from '../src/model.js';
const target=new URL('./wcag-current-app/',import.meta.url);
await mkdir(target,{recursive:true});
await cp(new URL('../dist/assets/',import.meta.url),new URL('assets/',target),{recursive:true});
let html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const sdk='<script src="https://js.puter.com/v2/" defer></script>';
if(!html.includes(sdk))throw Error('Expected SDK tag');
html=html.replace(sdk,'');
const finalScript=html.match(/<script type="module" crossorigin src="([^"]+)"><\/script>/)[1];
const stylesheet=html.match(/<link rel="stylesheet" crossorigin href="([^"]+)"/)[1];
const baselineScript='/assets/index-DKClv8fZ.js';
const cases={};
for(const lang of ['en','fr'])for(const scenario of ['empty','blank','limit']){
 const b=board(`Native AI ${lang} ${scenario}`);
 const count=scenario==='limit'?301:scenario==='blank'?2:0;
 b.items=Array.from({length:count},(_,n)=>item('note',(n%20)*230,Math.floor(n/20)*210,{text:scenario==='blank'?'':`Local option ${n}`,lang:'en'}));
 validateBoard(b);
 cases[`${lang}-${scenario}`]=b;
}
await writeFile(new URL('ai-native-boards.json',target),JSON.stringify(cases));
const loader=String.raw`
const fixture=new URLSearchParams(location.search),lang=fixture.get('lang')==='fr'?'fr':'en',scenario=fixture.get('case')||'empty';
const cases=await(await fetch('/ai-native-boards.json')).json(),board=cases[lang+'-'+scenario];
if(!board)throw Error('Unknown fixture');
const getItem=Storage.prototype.getItem;
Storage.prototype.getItem=function(key){if(this===localStorage){if(key==='whiteboard-language')return lang;if(key==='whiteboard-theme')return lang==='fr'?'dark':'light';}return getItem.call(this,key);};
if(lang==='fr'){const spacing=document.createElement('style');spacing.textContent='*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important;}p{margin-bottom:2em!important;}';document.head.append(spacing);}
const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('whiteboard-v1',3);request.onupgradeneeded=()=>{const db=request.result;for(const name of ['boards','templates'])if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:'id'});for(const [name,key] of [['revisions','boardId'],['collaboration','scope']])if(!db.objectStoreNames.contains(name)){const store=db.createObjectStore(name,{keyPath:'id'});store.createIndex(key,key);}};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
await new Promise((resolve,reject)=>{const tx=db.transaction('boards','readwrite');tx.objectStore('boards').put(board);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
location.hash='local='+board.id;
let feedbackSince=0,lastFeedback='';
const observe=()=>{const status=document.querySelector('#ai-status'),toast=document.querySelector('#toast'),dialog=document.querySelector('dialog[open]'),focus=document.activeElement;const active=(status?.textContent||'')||(toast?.classList.contains('visible')?toast.textContent:'');if(active&&active!==lastFeedback){lastFeedback=active;feedbackSince=performance.now();}const rect=status?.getBoundingClientRect(),view={width:innerWidth,height:innerHeight};const data={fixture:lang+'-'+scenario,viewport:view,documentLanguage:document.documentElement.lang,theme:document.documentElement.dataset.theme,focus:focus?.getAttribute('aria-label')||focus?.textContent?.trim().slice(0,100)||focus?.id,status:status?.textContent||'',toastVisible:toast?.classList.contains('visible')||false,toastOpacity:toast?getComputedStyle(toast).opacity:null,feedbackAgeMs:feedbackSince?Math.round(performance.now()-feedbackSince):null,statusRect:rect?[rect.x,rect.y,rect.width,rect.height]:null,dialogScrollTop:dialog?.scrollTop,modelItems:board.items.length};parent.postMessage({audit:'ai-native-feedback',description:JSON.stringify(data)},'http://127.0.0.1:5181');};
setInterval(observe,250);
await import(SCRIPT_PATH);
observe();
`;
const manifest={};
for(const [version,script] of [['before',baselineScript],['final',finalScript]]){
 const boot=loader.replace('SCRIPT_PATH',JSON.stringify(script));
 const page=html.replace(/<script type="module" crossorigin src="[^"]+"><\/script>/,`<script type="module">${boot}</script>`);
 await writeFile(new URL(`ai-precondition-${version}.html`,target),page);
 manifest[version]={script,sha256:createHash('sha256').update(await readFile(new URL('.'+script,target))).digest('hex'),stylesheet,cssSha256:createHash('sha256').update(await readFile(new URL('.'+stylesheet,target))).digest('hex')};
 for(const lang of ['en','fr'])for(const scenario of ['empty','blank','limit']){
  const url=`http://127.0.0.1:5182/ai-precondition-${version}.html?lang=${lang}&case=${scenario}`;
  const wrapper=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Native AI ${version} ${lang} ${scenario}</title><iframe title="Actual local Whiteboard" style="width:320px;height:300px;border:0" src="${url}"></iframe><p id="metrics"></p><script>addEventListener('message',e=>{if(e.origin==='http://127.0.0.1:5182'&&e.data?.audit==='ai-native-feedback')document.getElementById('metrics').textContent=e.data.description;});</script></html>`;
  await writeFile(new URL(`wcag-ai-native-${version}-${lang}-${scenario}-300.html`,import.meta.url),wrapper);
 }
}
await writeFile(new URL('./wcag-ai-native-assets.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
