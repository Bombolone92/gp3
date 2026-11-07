import {createFeatures} from "../src/features.js";
import {board,item,validateBoard} from "../src/model.js";
import {setLanguage,translateUI,t} from "../src/i18n.js";
import "../src/style.css";
const lang=new URLSearchParams(location.search).get("lang")==="fr"?"fr":"en";
const previous=localStorage.getItem("whiteboard-language");setLanguage(lang);
if(previous===null)localStorage.removeItem("whiteboard-language");else localStorage.setItem("whiteboard-language",previous);
document.documentElement.lang=lang;document.documentElement.dataset.theme=lang==="fr"?"dark":"light";
const plan=board("Isolated presentation focus");
const white=item("frame",0,0,{w:500,h:320,text:"Cadre blanc",lang:"fr",order:0}),black=item("frame",700,0,{w:500,h:320,text:"Cadre noir",lang:"fr",order:1});
plan.items=[white,black,item("rect",700,0,{w:500,h:320,color:"#000000",parentId:black.id,stroke:"#000000"})];validateBoard(plan);
const features=createFeatures({board:()=>plan,selection:()=>new Set(),modal(title,html,ready){
 const previous=document.activeElement,d=document.createElement("dialog");d.setAttribute("aria-label",t(title));
 d.innerHTML='<div class="dialog-header"><h2>'+t(title)+'</h2><button class="icon-btn" type="button" aria-label="'+t("Close dialog")+'">×</button></div>'+html;
 document.body.append(d);d.querySelector(".dialog-header button").onclick=()=>d.close();d.addEventListener("close",()=>{d.remove();if(previous?.isConnected)previous.focus();else document.getElementById("open").focus();});d.showModal();ready?.(d);translateUI(d);return d;
},toast(message){document.getElementById("status").textContent=t(message);}});
document.getElementById("open").onclick=()=>features.actions.present();features.actions.present();
