import {readFileSync} from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import assert from 'node:assert/strict';
for(const spacing of [false,true])for(const mode of ['summary','notes','themes','named']){
 const name=spacing?'ai-review-spacing':'ai-review',errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>errors.push(error.message));
 const dom=new JSDOM(readFileSync(`tmp/wcag-${name}-native.html`,'utf8'),{url:`https://whiteboard.test/?mode=${mode}`,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole,beforeParse(w){w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.structuredClone=structuredClone;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};}});
 try{
  await dom.window.wcagAIReviewReady;assert.deepEqual(errors,[]);
  const doc=dom.window.document,id=mode==='notes'?'ai-notes':mode==='themes'?'ai-theme-0':mode==='named'?'cluster-name':'ai-summary',d=doc.querySelector('dialog'),input=d.querySelector('#'+id);
  assert.equal(input.fieldLanguage(),'fr-CA');assert.equal(input.querySelector('[lang="en-CA"]').textContent,'Read first.');assert.equal(d.querySelector('#'+id+'-language-controls').hidden,false);
  const tag=d.querySelector('#'+id+'-language-tag');tag.value='sh-x-a1234567-b1234567-c1234567-d1234567-e1234567-f1234567-g123';d.querySelector('#'+id+'-language-save').click();assert.equal(input.fieldLanguage(),'fr-CA');assert.equal(tag.getAttribute('aria-invalid'),'true');assert.equal(d.querySelector('#'+id+'-language-error').hidden,false);
  console.log(name,mode,'loads and preserves declarations with overflow feedback; native geometry/AT not tested');
 }finally{dom.window.close();}
}
