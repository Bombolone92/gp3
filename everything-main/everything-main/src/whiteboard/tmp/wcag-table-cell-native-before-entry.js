import {createTableEditor} from '../src/table-editor.js';
import {board,item} from '../src/model.js';
import {tableLanguagePatch} from '../src/table-language.js';
import {setLanguage,translateUI} from '../src/i18n.js';
import './wcag-table-cell-before-style.css';
const previous=localStorage.getItem('whiteboard-language');setLanguage('fr');
if(previous===null)localStorage.removeItem('whiteboard-language');else localStorage.setItem('whiteboard-language',previous);
document.documentElement.lang='fr';document.documentElement.dataset.theme='dark';
const plan=board('Local field-visibility fixture');
const table=item('table',0,0,{w:340,h:225,cells:[['Bonjour, veuillez lire ce tableau.','Texte'],['',''],['','']],cellLanguages:{'0,0':{lang:'fr-CA'}},columnWidths:[170,170],rowHeights:[75,75,75]});plan.items=[table];
const state={board:plan,view:{x:79.25,y:69,z:.8}},canvas=document.getElementById('canvas');let writes=0;
const ui=createTableEditor({state:()=>state,canvas:()=>canvas,selected:()=>true,writable:()=>true,prepare(){},reveal(){},draw(){ui.render();},toast(){},resize(i,patch){writes++;Object.assign(i,patch);ui.render();},change(i,cells,structure,languages){writes++;Object.assign(i,tableLanguagePatch(i,cells,structure,languages));ui.render();}});
function report(){const input=document.getElementById('table-cell-input'),r=input?.getBoundingClientRect(),active=document.activeElement,t=document.querySelector('.table-cell-tools')?.getBoundingClientRect();parent.postMessage({audit:'table-cell-fr',description:JSON.stringify({focus:active?.id||active?.tagName,input:r?[r.x,r.y,r.width,r.height].map(v=>Math.round(v*100)/100):null,toolbar:t?[t.x,t.y,t.width,t.height].map(v=>Math.round(v*100)/100):null,entirelyWithinToolbar:!!(r&&t&&r.x>=t.x&&r.y>=t.y&&r.right<=t.right&&r.bottom<=t.bottom),inputFocused:input===active,zIndex:input?getComputedStyle(input).zIndex:null,centerInToolbar:!!(r&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.table-cell-tools')),writes})},location.origin);}
addEventListener('focusin',()=>requestAnimationFrame(report));new MutationObserver(()=>requestAnimationFrame(report)).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style','hidden']});
document.getElementById('open').onclick=()=>ui.open(table);ui.open(table);translateUI();
