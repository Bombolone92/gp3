import {readFileSync} from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import assert from 'node:assert/strict';
for(const spacing of [false,true])for(const lang of ['en','fr'])for(const theme of ['light','dark']){
 const name=spacing?'live-embed-spacing':'live-embed';
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(readFileSync(`tmp/wcag-${name}-native.html`,'utf8'),{url:`https://fixture.test/?lang=${lang}&theme=${theme}`,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.structuredClone=structuredClone;w.HTMLCanvasElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:320,height:280});}});
 await dom.window.wcagLiveCaptionReady;
 const d=dom.window.document,f=d.querySelector('.embed-live iframe');
 assert.deepEqual(errors,[]);assert.ok(f);assert.equal(f.getAttribute('src'),'about:blank');
 assert.equal(f.lang,'fr-CA');assert.match(f.dataset.fixtureSource,/youtube-nocookie/);
 const label=d.getElementById(f.getAttribute('aria-labelledby'));
 assert.equal(label.querySelector('[lang="en-CA"]').textContent,'Read first.');
 assert.equal(label.querySelector('[lang="fr-CA"]').textContent,'Veuillez lire les prochaines étapes. Read first.');
 for(const node of d.querySelectorAll('[aria-labelledby]'))for(const id of node.getAttribute('aria-labelledby').split(/\s+/))assert.ok(d.getElementById(id));
 assert.equal(d.documentElement.lang,lang);assert.equal(d.documentElement.dataset.theme,theme);
 dom.window.close();console.log(`${name} ${lang}/${theme}: actual local captions and references load; external player, native geometry and AT not assessed`);
}
