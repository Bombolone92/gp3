import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root=new URL('./wcag-current-app/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('./wcag-ai-native-assets.json',import.meta.url),'utf8'));
const cases=JSON.parse(await readFile(new URL('ai-native-boards.json',root),'utf8'));
let css=await readFile(new URL('.'+manifest.final.stylesheet,root),'utf8');
const resources=[];
for(const url of [...new Set([...css.matchAll(/url\(([^)]+)\)/g)].map(m=>m[1].replace(/^['"]|['"]$/g,'')))]){
 if(url.startsWith('data:'))continue;
 const resource=url.startsWith('/')?new URL('.'+url,root):new URL(url,new URL('.'+manifest.final.stylesheet,root));
 const bytes=await readFile(resource);
 const mime=url.endsWith('.woff2')?'font/woff2':url.endsWith('.woff')?'font/woff':'application/octet-stream';
 css=css.split(`url(${url})`).join(`url(data:${mime};base64,${bytes.toString('base64')})`);
 resources.push({path:resource.pathname,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const sourceLoader=(b,lang)=>String.raw`
const board=BOARD_JSON,lang=LANG_JSON;
const reportError=(error)=>parent.postMessage({audit:'ai-file-feedback',description:'FIXTURE LOAD ERROR: '+String(error)},'*');
try{
const getItem=Storage.prototype.getItem;
Storage.prototype.getItem=function(key){if(this===localStorage){if(key==='whiteboard-language')return lang;if(key==='whiteboard-theme')return lang==='fr'?'dark':'light';}return getItem.call(this,key);};
const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('whiteboard-v1',3);request.onupgradeneeded=()=>{const db=request.result;for(const name of ['boards','templates'])if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:'id'});for(const [name,key] of [['revisions','boardId'],['collaboration','scope']])if(!db.objectStoreNames.contains(name)){const store=db.createObjectStore(name,{keyPath:'id'});store.createIndex(key,key);}};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
await new Promise((resolve,reject)=>{const tx=db.transaction('boards','readwrite');tx.objectStore('boards').put(board);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();location.hash='local='+board.id;
let since=0,last='';
setInterval(()=>{const status=document.querySelector('#ai-status'),toast=document.querySelector('#toast'),dialog=document.querySelector('dialog[open]'),focus=document.activeElement;const active=(status?.textContent||'')||(toast?.classList.contains('visible')?toast.textContent:'');if(active&&active!==last){last=active;since=performance.now();}const rect=status?.getBoundingClientRect();parent.postMessage({audit:'ai-file-feedback',description:JSON.stringify({viewport:[innerWidth,innerHeight],lang:document.documentElement.lang,theme:document.documentElement.dataset.theme,focus:focus?.getAttribute('aria-label')||focus?.textContent?.trim().slice(0,100)||focus?.id,status:status?.textContent||'',toastVisible:toast?.classList.contains('visible')||false,toastOpacity:toast?getComputedStyle(toast).opacity:null,feedbackAgeMs:since?Math.round(performance.now()-since):null,statusRect:rect?[rect.x,rect.y,rect.width,rect.height]:null,dialogScrollTop:dialog?.scrollTop,seededItems:board.items.length,fontLoaded:document.fonts.check('14px "DM Sans"')})},'*');},250);
}catch(error){reportError(error);throw error;}
`.replace('BOARD_JSON',JSON.stringify(b)).replace('LANG_JSON',JSON.stringify(lang));
for(const version of ['before','final']){
 const script=await readFile(new URL('.'+manifest[version].script,root),'utf8');
 for(const lang of ['en','fr'])for(const scenario of ['empty','blank','limit']){
  const spacing=lang==='fr'?'*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important;}p{margin-bottom:2em!important;}':'';
  const boot=sourceLoader(cases[lang+'-'+scenario],lang);
  const code=`${boot}\n${script}`.replace(/<\/script/gi,'<\\/script');
  const body=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline actual AI ${version} ${lang} ${scenario}</title><style>${css}${spacing}</style><div id="app"></div><div id="toast" role="status" aria-live="polite"></div><script type="module">${code}</script></html>`;
  const name=`wcag-ai-file-${version}-${lang}-${scenario}.html`;
  await writeFile(new URL(name,import.meta.url),body);
  const wrapper=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Offline native AI ${version} ${lang} ${scenario}</title><iframe title="Offline actual Whiteboard" style="width:320px;height:300px;border:0" src="${name}"></iframe><p id="metrics"></p><script>addEventListener('message',e=>{if(e.data?.audit==='ai-file-feedback')document.getElementById('metrics').textContent=e.data.description;});</script></html>`;
  await writeFile(new URL(`wcag-ai-file-${version}-${lang}-${scenario}-300.html`,import.meta.url),wrapper);
 }
}
await writeFile(new URL('wcag-ai-native-file-assets.json',import.meta.url),JSON.stringify({production:manifest,inlinedResources:resources,notes:'Actual production JavaScript and CSS; font URLs replaced with equivalent base64 bytes; script closing tags HTML-escaped; isolated IDB model seed and preference-read adapter, no SDK or external requests.'},null,2)+'\n');
console.log('Wrote 12 self-contained actual-app hosts and 12 short-viewport wrappers; embedded resource count:',resources.length);
