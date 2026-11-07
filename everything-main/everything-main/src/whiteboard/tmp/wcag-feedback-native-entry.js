import '../src/style.css';
import '../src/organization/organization.css';
import {createHelpCenter} from '../src/help/help-center.js';
import {createAdminConsole} from '../src/organization/admin-ui.js';
import {setLanguage,translateUI,t} from '../src/i18n.js';
import report from './wcag-feedback-native-report.json';
const refresh=()=>translateUI();
const modal=(title,content,ready)=>{
 const previous=document.activeElement,d=document.createElement('dialog');
 d.setAttribute('aria-label',t(title));
 d.innerHTML=`<div class="dialog-header"><h2>${t(title)}</h2><button class="icon-btn" type="button" aria-label="${t('Close dialog')}">×</button></div>${content}`;
 document.body.append(d);d.querySelector('.dialog-header button').onclick=()=>d.close();
 d.addEventListener('close',()=>{d.remove();previous?.focus();});d.showModal();ready?.(d);refresh();return d;
};
const org={info:{role:'owner'},isAdmin:true,server:'offline-layout-fixture',async request(op,input){
 if(op==='feedback.submit'){
  const record={at:Date.now(),ease:input.ease,role:'owner',comment:input.comment,...(input.lang?{lang:input.lang}:{}),...(input.textRuns?{textRuns:structuredClone(input.textRuns)}:{})};
  report.feedback.responses++;report.feedback.distribution[input.ease-1]++;report.feedback.recent.unshift(record);report.feedback.averageEase=input.ease;return{ok:true};
 }
 if(op==='org.reports')return structuredClone(report);
 throw Error('This offline fixture has no external service.');
}};
const help=createHelpCenter({org,modal,icon:()=>'',refresh,tour(){},shortcuts(){},toast(){}});
const admin=createAdminConsole({org,modal,icon:()=>'',refresh,toast(){},download(){}});
document.querySelector('#fixture-help').onclick=()=>help.open();
document.querySelector('#fixture-report').onclick=()=>admin.open();
document.querySelector('#fixture-language').onchange=(event)=>{setLanguage(event.target.value);refresh();};
document.querySelector('#fixture-theme').onchange=(event)=>document.documentElement.setAttribute('data-theme',event.target.value);
help.open();
