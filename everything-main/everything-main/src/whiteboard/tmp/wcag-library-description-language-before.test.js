import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createOrganizationLibrary } from "../src/organization/library-ui.js";
import { language, setLanguage, translateUI } from "../src/i18n.js";
import { board } from "../src/model.js";
import { adminCall } from "../worker/admin.js";
import { environment, owner } from "../tests/collaboration-helpers.js";

test("WCAG organization library description language audit", async () => {
  const env=environment(),service=env.service,org=service.org;
  await adminCall(org,service,owner,{op:"org.setup",name:"Local description audit"});
  const dom=new JSDOM('<html lang="fr"><body></body></html>',{url:"https://whiteboard.test",pretendToBeVisual:true});
  const previous=Object.fromEntries(["document","localStorage","NodeFilter","HTMLElement","Event","Node"].map(key=>[key,globalThis[key]])),oldLanguage=language;
  for(const key of Object.keys(previous)) globalThis[key]=dom.window[key];
  const doc=dom.window.document,requests=[];let submitted;
  const lib=createOrganizationLibrary({
    org:{isAdmin:true,request:async(op,input={})=>{requests.push({op,...structuredClone(input)});const result=await adminCall(org,service,owner,{op,...input});if(op==="library.submit") submitted=result.item;return result;}},
    modal:(title,html,ready)=>{const d=doc.createElement("dialog");d.setAttribute("aria-label",title);d.innerHTML=html;d.close=()=>{d.dispatchEvent(new dom.window.Event("close"));d.remove();};doc.body.append(d);ready(d);translateUI(d);return d;},
    toast:()=>{},icon:()=>"",shareable:()=>board("Description audit"),useBoard:()=>{},
  });
  const until=async(condition)=>{const deadline=Date.now()+3000;while(!condition() && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,1));assert.ok(condition());};
  try {
    setLanguage("fr");lib.share();const field=doc.querySelector("#org-library-description"),sentence="Veuillez utiliser ce modèle pour choisir les prochaines étapes.";field.value=sentence;
    console.log(JSON.stringify({phase:"authoring",pageLanguage:doc.documentElement.lang,field:field.outerHTML,languageControls:[...doc.querySelectorAll("dialog button")].filter(button=>/Langue du contenu|Content language/.test(button.textContent)).map(button=>button.outerHTML)}));
    // When a declaration control exists, the diagnostic follows that actual
    // authoring route; the original component currently has no such control.
    const choice=doc.querySelector("#org-library-description-language-options");
    if(choice){field.setSelectionRange(0,0);choice.click();doc.querySelector("#org-library-description-language-tag").value="fr-CA";doc.querySelector("#org-library-description-language-save").click();}
    doc.querySelector("form").dispatchEvent(new dom.window.Event("submit",{cancelable:true}));await until(()=>submitted);
    const saved=await org.kv.get("org:lib:"+submitted.id);
    setLanguage("en");lib.open();await until(()=>doc.querySelector("[data-item] small[data-user-content]"));
    const rendered=doc.querySelector("[data-item] small[data-user-content]");
    console.log(JSON.stringify({phase:"saved",request:requests.find(request=>request.op==="library.submit"),saved,pageLanguage:doc.documentElement.lang,rendered:rendered.outerHTML}));
    assert.equal(saved.description,sentence);assert.equal(rendered.textContent,sentence);
    assert.ok(rendered.matches('[lang="fr-CA"]') || rendered.querySelector('[lang="fr-CA"]'),"the ordinary French description needs its declaration in the English library view");
  }finally{setLanguage(oldLanguage);for(const [key,value] of Object.entries(previous)){if(value===undefined) delete globalThis[key];else globalThis[key]=value;}dom.window.close();}
});
