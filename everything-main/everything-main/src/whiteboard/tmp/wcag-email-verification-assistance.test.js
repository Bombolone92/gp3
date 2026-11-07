import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createOrganizationHome } from "../src/organization/home-ui.js";
import { language as currentLanguage, setLanguage, translateUI, t } from "../src/i18n.js";
import "../src/worker-strings.js";
import { adminCall } from "../worker/admin.js";
import { environment, owner } from "../tests/collaboration-helpers.js";

for (const language of ["en", "fr"]) test(`organization verification assistance and recovery ${language}`,async()=>{
 const dom=new JSDOM('<!doctype html><html><body><button id="opener">Verify email</button></body></html>',{url:"https://whiteboard.test",runScripts:"outside-only",pretendToBeVisual:true}),w=dom.window,doc=w.document;
 const keys=["document","localStorage","NodeFilter","HTMLElement","Node","Event"],previous=Object.fromEntries(keys.map(key=>[key,globalThis[key]])),oldLanguage=currentLanguage;
 for(const key of keys)globalThis[key]=w[key];
 const env=environment(),service=env.service,org=service.org,messages=[],calls=[],toasts=[];
 org.puter.email={async sendTransactional(message){messages.push(message);return {failed:[]};}};
 const until=async(fn,message)=>{for(let n=0;n<100&&!fn();n++)await new Promise(r=>setTimeout(r,5));assert.ok(fn(),message);};
 try{
  await adminCall(org,service,owner,{op:"org.setup",name:"Local assistance audit",domains:["example.org"]});
  await org.saveUser({...owner,email:"fixture@example.org",emailVerified:false,status:"active",created:org.now(),teams:[]});
  const client={info:await adminCall(org,service,owner,{op:"org.info"}),onChange(){},async request(op,input){calls.push({op,...input});return adminCall(org,service,owner,{op,...input});},async refresh(){this.info=await adminCall(org,service,owner,{op:"org.info"});}};
  setLanguage(language);
  const home=createOrganizationHome({org:client,modal(title,html,ready){const d=doc.createElement("dialog");d.setAttribute("aria-label",t(title));d.setAttribute("open","");d.innerHTML=html;d.close=()=>{d.remove();doc.querySelector("#opener").focus();};doc.body.append(d);ready(d);translateUI(d);return d;},toast:message=>toasts.push(message),icon:()=>"",rerender(){}});
  home.verifyDialog();const d=doc.querySelector("dialog"),email=d.querySelector("#verify-email"),code=d.querySelector("#verify-value"),status=d.querySelector("#verify-status");
  assert.equal(email.value,client.info.user.email);assert.equal(email.autocomplete,"email");assert.equal(email.type,"email");assert.equal(code.autocomplete,"one-time-code");assert.equal(code.inputMode,"numeric");assert.equal(code.maxLength,6);assert.equal(code.readOnly,false);assert.equal(code.disabled,false);assert.equal(code.closest("label").textContent,t("Six-digit code"));assert.equal(status.getAttribute("role"),"status");
  d.querySelector("#verify-start").requestSubmit();await until(()=>messages.length===1&&!d.querySelector("#verify-code").hidden,"Actual local worker delivers code to isolated in-memory capture");assert.equal(doc.activeElement,code);assert.equal(status.textContent,t("We sent a code. It expires in 15 minutes."));
  const expected=/code is (\d{6})/.exec(messages[0].text)[1],wrong=expected==="000000"?"111111":"000000";
  const paste=value=>{const event=new w.Event("paste",{bubbles:true,cancelable:true});Object.defineProperty(event,"clipboardData",{value:{types:["text/plain"],getData:()=>value}});code.dispatchEvent(event);assert.equal(event.defaultPrevented,false,"Production verification component does not cancel full-code paste");code.value=value;code.dispatchEvent(new w.Event("input",{bubbles:true}));assert.equal(code.checkValidity(),true);};
  paste(wrong);d.querySelector("#verify-code").requestSubmit();await until(()=>status.textContent===t("That code is not correct."),"Actual worker wrong-code error appears in the retained status");assert.equal(code.value,wrong);await new Promise(r=>setTimeout(r,4700));assert.equal(status.textContent,t("That code is not correct."));assert.equal(d.hasAttribute("open"),true);assert.equal(code.value,wrong);assert.equal(email.value,client.info.user.email);
  paste(expected);d.querySelector("#verify-code").requestSubmit();await until(()=>!doc.querySelector("dialog"),"Corrected assisted value completes actual local worker verification");assert.equal(client.info.user.emailVerified,true);assert.equal(calls.filter(c=>c.op==="email.start").length,1);assert.equal(calls.filter(c=>c.op==="email.confirm").length,2);assert.equal(messages.length,1);assert.equal(toasts.length,1);
  console.log(JSON.stringify({language,knownEmailPrefilled:true,autocomplete:"one-time-code",singleCodeInput:true,pasteDispatchCancelled:false,persistentActualWorkerError:true,correctedValueVerified:true,scope:"production component + real isolated worker; native paste/autofill and external authentication unverified; no real message sent"}));
 }finally{setLanguage(oldLanguage);for(const key of keys){if(previous[key]===undefined)delete globalThis[key];else globalThis[key]=previous[key];}w.close();}
});
