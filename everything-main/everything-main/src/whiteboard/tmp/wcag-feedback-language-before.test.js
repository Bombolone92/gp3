import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {adminCall} from '../worker/admin.js';
import {environment,owner} from '../tests/collaboration-helpers.js';

test('French authored feedback retains its declared language through the real worker and admin report',async()=>{
 const env=environment(),org=env.service.org;
 await adminCall(org,env.service,owner,{op:'org.setup',name:'Feedback audit'});
 const dom=new JSDOM('<!doctype html><html lang="fr"><body></body></html>',{url:'https://whiteboard.test'});
 const keys=['document','localStorage','NodeFilter','HTMLElement','Node','Event'];for(const key of keys)globalThis[key]=dom.window[key];
 try{
  const {createHelpCenter}=await import('../src/help/help-center.js');
  const {createAdminConsole}=await import('../src/organization/admin-ui.js');
  const {setLanguage,translateUI}=await import('../src/i18n.js');setLanguage('fr');
  const modal=(title,html,ready)=>{const d=document.createElement('dialog');d.setAttribute('aria-label',title);d.innerHTML=html;document.body.append(d);ready?.(d);return d;};
  let request;
  createHelpCenter({modal,icon:()=>'',tour(){},shortcuts(){},refresh:()=>translateUI(),org:{info:{role:'owner'},async request(op,data){request={op,...data};return adminCall(org,env.service,owner,request);}}}).open();
  const sentence='Veuillez faciliter la navigation entre les tableaux.';
  document.querySelector('#help-comment').value=sentence;
  document.querySelector('[name="help-ease"][value="4"]').checked=true;
  document.querySelector('#help-feedback').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  for(let i=0;i<50&&document.querySelector('#help-feedback');i++)await new Promise(r=>setTimeout(r,2));
  assert.equal(document.querySelector('#help-feedback'),null);
  const records=[...env.data].filter(([key])=>key.startsWith('org:feedback:')).map(([,value])=>value);assert.equal(records[0].comment,sentence);
  const report=await adminCall(org,env.service,owner,{op:'org.reports',days:30});assert.equal(report.feedback.recent[0].comment,sentence);
  setLanguage('en');
  const admin=createAdminConsole({org:{isAdmin:true,server:'https://whiteboard.test',request:async(op,data)=>adminCall(org,env.service,owner,{op,...data})},modal,toast(){},icon:()=>'',download(){},refresh:()=>translateUI()});
  const d=admin.open();for(let i=0;i<50&&!d.querySelector('.feedback-comments');i++)await new Promise(r=>setTimeout(r,2));
  const feedback=d.querySelector('.feedback-comments li [data-user-content]');
  console.log(JSON.stringify({request,saved:records[0],reported:report.feedback.recent[0],html:feedback.outerHTML,pageLanguage:document.documentElement.lang}));
  assert.equal(feedback.closest('[lang]')?.getAttribute('lang'),'fr');
 }finally{const {setLanguage}=await import('../src/i18n.js');setLanguage('en');for(const key of keys)delete globalThis[key];dom.window.close();}
});
