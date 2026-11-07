import {createAdminConsole} from '../src/organization/admin-ui.js';
import {setLanguage,translateUI,t} from '../src/i18n.js';
import '../src/style.css';
import '../src/organization/organization.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
const params = new URLSearchParams(location.search),locale=params.get('lang')==='fr'?'fr':'en';
setLanguage(locale);document.documentElement.lang=locale;
document.documentElement.dataset.theme=params.get('theme')==='dark'?'dark':'light';
const entries=Array.from({length:3},(_,n)=>({at:Date.parse('2026-10-01T18:00:00Z')+n*1000, category:'content',action:'vote.started',actor:{uuid:'local-facilitator',username:'Local facilitator'},target:{type:'board',id:'offline-board',name:'Planning review'},details:{title:'Please review these choices.',titleLang:'en',votes:5,anonymous:true}}));
let d, lastKey = "none";
const update=()=>{
 const scroller=d?.querySelector('.table-scroll');if(!scroller)return;
 const focus=document.activeElement;
 const description=`table=${Math.round(scroller.scrollLeft)}/${scroller.scrollWidth-scroller.clientWidth}; focus=${focus?.id||focus?.tagName}; rows=${scroller.querySelectorAll('tbody tr').length}; key=${lastKey}`;
 document.title='Audit keyboard | '+description;
 parent.postMessage({audit:'audit-keyboard',description},location.origin);
};
const admin=createAdminConsole({org:{isAdmin:true,info:{role:'owner'},async request(op,{cursor}={}){if(op!=='org.audit')throw Error('Offline fixture only supports local audit data.');return {entries:structuredClone(entries),cursor:null};}},icon:()=>'',toast(){},download(){},refresh(){translateUI();
 const scroller=d.querySelector('.table-scroll');scroller?.addEventListener('scroll',update);requestAnimationFrame(update);
},modal(title,html,ready){
 const previous=document.activeElement;
 d=document.createElement('dialog');d.setAttribute('aria-label',t(title));d.innerHTML=`<div class="dialog-header"><h2>${t(title)}</h2><button type="button" class="icon-btn" aria-label="${t('Close dialog')}">×</button></div>${html}`;
 document.body.append(d);d.querySelector('.dialog-header button').onclick=()=>d.close();d.addEventListener('close',()=>{d.remove();previous?.focus();});d.addEventListener('focusin',update);d.addEventListener('keydown',event=>{lastKey=event.key;setTimeout(()=>{lastKey=event.key+':prevented='+event.defaultPrevented;update();},0);});d.showModal();ready?.(d);return d;
}});
document.querySelector('#open').onclick=()=>admin.open('audit');admin.open('audit');
