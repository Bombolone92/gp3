import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import assert from 'node:assert/strict';
for (const name of ['task-planning','task-planning-spacing']) {
 const errors=[];const virtualConsole = new VirtualConsole();virtualConsole.on('jsdomError',error=>errors.push(error.message));
 const dom=new JSDOM(readFileSync(`tmp/wcag-${name}-native.html`,'utf8'),{
   url:'https://whiteboard.test',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole,
   beforeParse(window) {
     window.TextEncoder=TextEncoder;window.TextDecoder=TextDecoder;
     window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
     window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
   }
 });
 const { document }=dom.window;
 assert.equal(errors.length,0,errors.join('\n'));
 const dialog=document.querySelector('dialog.tasks-modal');assert.ok(dialog);
 dialog.querySelector('#tasks-frame').open=true;
 assert.equal(dialog.querySelectorAll('.task-frame-choice').length,2);
 assert.ok(dialog.querySelector('.task-frame-choice[value]:not([value="*"])').closest('label').querySelector('[lang="fr-CA"]'));
 dialog.querySelector('#tasks-tab-timeline').click();
 const bar=dialog.querySelector('.timeline-bar');assert.ok(bar);bar.focus();
 const preview=dialog.querySelector('#tasks-title-preview');assert.equal(preview.hidden,false);assert.ok(preview.querySelector('[lang]'));
 const computed=dom.window.getComputedStyle(preview);assert.equal(computed.display,'block');assert.equal(computed.overflow,'auto');
 preview.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(preview.hidden,true);assert.equal(dom.window.getComputedStyle(preview).display,'none');
 dialog.close();dom.window.close();console.log(name,'local component/stylesheet sanity check passed; native geometry not tested');
}
