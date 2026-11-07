import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { objectNameHTML } from "./unicode-combined-object-content.js";
import { objectName, objectKind, t, setLanguage } from "./unicode-combined-i18n.js";

for (const language of ["en", "fr"])
  test(`bounded object captions retain complete Unicode and authored languages in ${language}`, () => {
    const dom = new JSDOM("<main></main>"), previous = globalThis.document;
    globalThis.document = dom.window.document;
    try {
      setLanguage(language);
      for (const [type, field] of [["rect", "text"], ["note", "text"], ["ellipse", "text"], ["image", "alt"], ["file", "fileName"]])
        for (const locked of [false, true]) {
          const value = 'A<&"' + "😀" + "é" + "🧠" + "Z";
          const node = { type, locked, [field]: value, lang: "fr-CA", ...(field === "text" ? {textRuns:[{start:4,end:6,style:{lang:"en-GB"}}]} : {}) };
          const before = structuredClone(node), full = objectName(node), prefix = full.slice(0,full.length-value.length);
          for (const limit of [0,prefix.length-1,...Array.from({length:value.length+2},(_,n)=>prefix.length+n), Infinity]) {
            let expected = prefix;
            for(const character of value) {
              if(expected.length+character.length>limit)break;
              expected+=character;
            }
            const host = dom.window.document.querySelector("main");
            host.innerHTML = objectNameHTML(node, limit);
            assert.equal(host.textContent, expected, `${type}/${field}/${locked}/${limit}`);
            assert.equal(host.textContent.isWellFormed(), true);
            assert.equal(host.querySelectorAll("[data-user-content]").length, 1);
            assert.equal(host.querySelector("[data-user-content]").getAttribute("lang"), "fr-CA");
            const passage = host.querySelector('[lang="en-GB"]');
            if(field === "text" && limit>=prefix.length+6)assert.equal(passage?.textContent,"😀");
            assert.equal(host.querySelector("script,img,a"),null,"Authored markup remains text");
            assert.deepEqual(node,before);
          }
        }
    } finally { setLanguage("en"); globalThis.document=previous; dom.window.close(); }
  });

for(const locale of ['en','fr'])
  test(`table object names keep complete Unicode, translated prefixes and cell languages in ${locale}`,()=>{
    const dom=new JSDOM('<main></main>'),previous=globalThis.document;globalThis.document=dom.window.document;
    try {
      setLanguage(locale);
      for(const n of [298,299,300])
        for(const shape of ['single','multiple','empty'])
          for(const locked of [false,true]) {
            const length=shape==='multiple'?n-8:n,cell='Q'.repeat(length)+'😀',cells=shape==='single'?[[cell]]:shape==='multiple'?[['Intro',cell]]:[['',cell]],column=shape==='single'?0:1;
            const node={type:'table',locked,cells,lang:'de',cellLanguages:{['0,'+column]:{lang:'fr-CA',textRuns:[{start:length,end:length+2,style:{lang:'en-GB'}}]}}},original=structuredClone(node);
            const full=cells.flat().filter(Boolean).join(' · ');let expected='';for(const character of full){if(expected.length+character.length>300)break;expected+=character;}
            const prefix=(locked?t('Locked')+' · ':'')+objectKind(node)+': ',name=objectName(node);
            assert.equal(name,prefix+expected);assert.equal(name.isWellFormed(),true);
            const host=dom.window.document.querySelector('main');host.innerHTML=objectNameHTML(node);
            assert.equal(host.textContent,prefix+expected);assert.equal(host.querySelector('[data-user-content]').lang,'de');
            assert.equal(host.querySelector('[lang="en-GB"]')?.textContent,n===298?'😀':undefined);
            assert.ok(host.querySelector('[lang="fr-CA"]'));assert.deepEqual(node,original);
          }
    }finally{setLanguage('en');globalThis.document=previous;dom.window.close();}
  });

for(const locale of ['en','fr'])
  test(`combined finite table captions preserve Unicode at every boundary in ${locale}`,()=>{
    const dom=new JSDOM('<main></main>'),previous=globalThis.document;globalThis.document=dom.window.document;
    try {
      setLanguage(locale);
      for(const n of [298,299,300])for(const locked of [false,true]) {
        const text='Q'.repeat(n)+'😀',node={type:'table',locked,cells:[[text]],lang:'de',cellLanguages:{'0,0':{lang:'fr-CA',textRuns:[{start:n,end:n+2,style:{lang:'en-GB'}}]}}};
        const before=structuredClone(node),prefix=(locked?t('Locked')+' · ':'')+objectKind(node)+': ';
        for(const limit of [0,prefix.length-1,prefix.length,100,120,300,prefix.length+298,prefix.length+299,prefix.length+300,Infinity]) {
          let expected=prefix;for(const character of text){if(expected.length+character.length>Math.min(prefix.length+300,limit))break;expected+=character;}
          const host=dom.window.document.querySelector('main');host.innerHTML=objectNameHTML(node,limit);
          assert.equal(host.textContent,expected);assert.equal(host.textContent.isWellFormed(),true);assert.deepEqual(node,before);
        }
      }
    }finally{setLanguage('en');globalThis.document=previous;dom.window.close();}
  });
