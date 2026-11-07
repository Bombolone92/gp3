import {createOrganizationHome} from "../src/organization/home-ui.js";
import {setLanguage,translateUI,t} from "../src/i18n.js";
import "../src/worker-strings.js";
import "../src/style.css";
import "../src/organization/organization.css";
const lang=new URLSearchParams(location.search).get("lang")==="fr"?"fr":"en";
const previous=localStorage.getItem("whiteboard-language");
setLanguage(lang);
if(previous===null)localStorage.removeItem("whiteboard-language");
else localStorage.setItem("whiteboard-language",previous);
document.documentElement.lang=lang;
document.documentElement.dataset.theme=lang==="fr"?"dark":"light";
const scenario=new URLSearchParams(location.search).get("scenario")==="expiry"?"expiry":"assistance";
const url=path=>"http://127.0.0.1:5183"+path+"?lang="+lang+"&scenario="+scenario;
const send=async(path,input)=>{
 const response=await fetch(url(path),input?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)}:{});
 const result=await response.json();
 if(!response.ok)throw new Error(result.error);
 return result;
};
const client={
 info:await send("/info"),onChange(){},
 async request(op,input){
  const result=await send("/request",{op,...input});
  if(op==="email.start"){
   const captured=await send("/captured");
   parent.postMessage({audit:"email-assistance",description:"Captured local worker email code: "+captured.code+"; messages="+captured.count+"; language="+lang},location.origin);
  }
  return result;
 },
 async refresh(){this.info=await send("/info");}
};
const home=createOrganizationHome({
 org:client,
 modal(title,html,ready){
  const dialog=document.createElement("dialog");
  dialog.setAttribute("aria-label",t(title));
  dialog.innerHTML='<div class="dialog-header"><h2>'+t(title)+'</h2><button id="close" type="button">'+t("Close dialog")+'</button></div>'+html;
  document.body.append(dialog);
  dialog.querySelector("#close").onclick=()=>dialog.close();
  dialog.addEventListener("close",()=>{dialog.remove();document.getElementById("open").focus();});
  dialog.showModal();ready(dialog);translateUI(dialog);return dialog;
 },
 toast(message){document.getElementById("status").textContent=t(message);},
 icon:()=>"",rerender(){document.getElementById("state").textContent="Actual isolated worker emailVerified="+client.info.user.emailVerified;}
});
document.getElementById("open").onclick=()=>home.verifyDialog();
home.verifyDialog();
