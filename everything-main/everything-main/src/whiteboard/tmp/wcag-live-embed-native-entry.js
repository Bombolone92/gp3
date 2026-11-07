import {createLiveEmbeds} from '../src/content/embed-live.js';
import {board,item} from '../src/model.js';
import {setLanguage,t} from '../src/i18n.js';
import '../src/content/strings.js';
import '../src/style.css';
import '../src/content/content.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-400-italic.css';
import '@fontsource/dm-sans/latin-600-italic.css';
const params=new URLSearchParams(location.search);
setLanguage(params.get('lang')==='fr'?'fr':'en');
document.documentElement.dataset.theme=params.get('theme')==='dark'?'dark':'light';
// This fixture checks local caption/control layout, not a provider player.
// Keep iframe creation and all production naming logic; suppress navigation.
const create=document.createElement.bind(document);
document.createElement=function(name,...args){
 const node=create(name,...args);
 if(String(name).toLowerCase()==='iframe')Object.defineProperty(node,'src',{get(){return node.getAttribute('src')||'';},set(value){node.dataset.fixtureSource=String(value);node.setAttribute('src','about:blank');}});
 return node;
};
const text='Veuillez lire les prochaines étapes. Read first.';
const b=board('Local live-caption fixture');
const e=item('embed',12,28,{id:'local-caption',w:280,h:220,text,lang:'fr-CA',textRuns:[{start:text.indexOf('Read first.'),end:text.length,style:{lang:'en-CA'}}],provider:'youtube',url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'});
b.items=[e];
const wrap=document.querySelector('.canvas-wrap'),canvas=document.querySelector('#canvas');
const live=createLiveEmbeds({board:()=>b,selection:()=>new Set([e.id]),view:()=>({x:0,y:0,z:1}),allows:()=>true,hidden:()=>false,toast(){}});
const open=()=>{live.render();document.querySelector('.embed-open').click();};
document.querySelector('#fixture-open').textContent=t('Open live');
document.querySelector('#fixture-open').onclick=open;
live.render();open();
window.wcagLiveCaptionReady=Promise.resolve({live,embed:e,board:b});
