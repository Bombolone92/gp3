import {createAI} from '../src/ai/ai-ui.js';
import {openClusters} from '../src/clusters-ui.js';
import {board,item} from '../src/model.js';
import {setLanguage,translateUI,t} from '../src/i18n.js';
import '../src/style.css';
import '../src/organization/organization.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-400-italic.css';
import '@fontsource/dm-sans/latin-600-italic.css';
const params=new URLSearchParams(location.search),pageLanguage=params.get('lang')==='fr'?'fr':'en',mode=['notes','themes','named'].includes(params.get('mode'))?params.get('mode'):'summary';
setLanguage(pageLanguage);document.documentElement.lang=pageLanguage;
const b=board('Local AI review layout fixture');b.items=[item('note',0,0,{text:'Visible local source.'}),item('note',240,0,{text:'Another visible local source.'})];
const text='Veuillez lire cette étape. Read first. '+ 'Veuillez discuter les prochaines étapes. '.repeat(40);
let lastDialog;
const modal=(title,html,ready)=>{
 const previous=document.activeElement,d=document.createElement('dialog');lastDialog=d;d.setAttribute('aria-label',t(title));
 d.innerHTML=`<div class="dialog-header"><h2>${t(title)}</h2><button type="button" class="icon-btn" aria-label="${t('Close dialog')}">×</button></div>${html}`;
 document.body.append(d);d.querySelector('.dialog-header button').onclick=()=>d.close();
 d.addEventListener('close',()=>{d.remove();previous?.focus();});d.showModal();ready?.(d);translateUI(d);return d;
};
const ai=createAI({
 org:{info:{role:'member'},allows:()=>true,async request(op,{task}){return {text:task==='cluster'?JSON.stringify({themes:[{name:text,notes:[1]},{name:'Follow the review steps',notes:[2]}]}):text};}},session:()=>null,board:()=>b,view:()=>b,selection:()=>new Set(b.items.filter(i=>i.type==='note').map(i=>i.id)),modal,
 toast:message=>{document.querySelector('#fixture-status').textContent=t(message);},icon:()=>'',mutate:fn=>fn(),center:()=>({x:0,y:0}),select(){},canEdit:()=>true,refresh:()=>translateUI(),puter:()=>null,
 fileInput(){document.querySelector('#fixture-status').textContent='This local fixture does not read photos.';},
});
async function open(){
 let d,id;
 if(mode==='named'){
  openClusters({board:()=>b,selection:()=>new Set(b.items.filter(i=>i.type==='note').map(i=>i.id)),canEdit:()=>true,modal,toast(){},mutate:fn=>fn(),select(){},focusClusters(){}});d=lastDialog;id='cluster-name';d.querySelector('#cluster-mode').value='one';d.querySelector('#cluster-mode').dispatchEvent(new Event('change'));d.querySelector('#cluster-name').value=text;d.querySelector('#cluster-name').dispatchEvent(new Event('input',{bubbles:true}));
 }else{
  d=ai.open();
  if(mode==='notes')ai.review(d,[{text:'Veuillez lire cette étape.'},{text:'Read first.'},{text}], 'Review the ideas before adding them.');else if(mode==='themes')await ai.themes(d);else await ai.summarize(d);
  id=mode==='notes'?'ai-notes':mode==='themes'?'ai-theme-0':'ai-summary';
 }
 const input=d.querySelector('#'+id);
 const declare=(tag,scope,start=0,end=start)=>{input.setSelectionRange(start,end);d.querySelector('#'+id+'-language-options').click();d.querySelector('#'+id+'-language-scope').value=scope;d.querySelector('#'+id+'-language-tag').value=tag;d.querySelector('#'+id+'-language-save').click();};
 declare('fr-CA','field');const start=input.value.indexOf('Read first.');declare('en-CA','text',start,start+11);
 input.setSelectionRange(0,0);d.querySelector('#'+id+'-language-options').click();
 return d;
}
document.querySelector('#fixture-open').onclick=open;
document.documentElement.setAttribute('data-theme',params.get('theme')==='dark'?'dark':'light');
window.wcagAIReviewReady=open();
