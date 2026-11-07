import { createMinimap } from "../src/minimap-ui.js";
import { board, item } from "../src/model.js";
import { setLanguage } from "../src/i18n.js";
import "../src/style.css";
import "../src/organization/organization.css";
const saved = localStorage.getItem("whiteboard-language");
setLanguage("fr");
if (saved === null) localStorage.removeItem("whiteboard-language");
else localStorage.setItem("whiteboard-language",saved);
document.documentElement.lang = "fr";
document.documentElement.dataset.theme = "dark";
const plan = board("Carte isolée");
plan.items = [item("note",0,0,{text:"Première note"}),item("note",300,200,{text:"Dernière note"})];
let view = {x:40,y:40,z:.5};
let map;
const paint = () => map?.render(plan.items);
map = createMinimap({
 canvas:()=>document.querySelector("#canvas"),
 state:()=>({board:plan,view}),
 prepare(){}, draw:paint,
 navigate(next){view=next;paint();},
 fit(){view={x:40,y:40,z:.5};paint();}
});
map.bind(document.querySelector("#minimap"));
document.querySelector('[data-action="minimap"]').onclick=()=>{map.toggle();paint();};
const report=()=>{
 const el=document.activeElement,panel=document.querySelector('#minimap'),wrap=document.querySelector('.canvas-wrap');
 const rect=e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(n=>Math.round(n*100)/100);};
 parent.postMessage({audit:"minimap",description:JSON.stringify({focus:el.id||el.tagName,focused:rect(el),canvas:rect(wrap),panel:rect(panel),scroll:panel.scrollTop,scrollMax:panel.scrollHeight-panel.clientHeight})},location.origin);
};
addEventListener('focusin',()=>requestAnimationFrame(report));
addEventListener('scroll',()=>requestAnimationFrame(report),true);
paint();
