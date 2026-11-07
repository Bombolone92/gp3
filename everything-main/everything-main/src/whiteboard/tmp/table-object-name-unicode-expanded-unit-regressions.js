
for(const locale of ['en','fr'])
  test(`table object names keep complete Unicode, translated prefixes and cell languages in ${locale}`,()=>{
    const dom=new JSDOM('<main></main>'),previous=globalThis.document,previousLanguage=language;globalThis.document=dom.window.document;
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
    }finally{setLanguage(previousLanguage);globalThis.document=previous;dom.window.close();}
  });
