for (const locale of ['en','fr'])
  for (const type of ['image','pen'])
    test(`Find includes authored ${type} descriptions with filters, navigation and preserved redo in ${locale}`,async()=>{
      const app=await setup(undefined,{preferences:{'whiteboard-language':locale}});
      try {
        const source=item(type,100,100,{text:'',alt:'Résumé 😀',lang:'fr-CA',...(type==='image'?{src:cropFixture().src}:{points:[[0,0],[150,80]]})});
        validateBoard({...board(),items:[source]});
        await rotationFixture(app,[source,item('note',400,100,{text:'Résumé 😀',lang:'fr-CA'})]);
        await app.click('[data-action="duplicate"]');await app.click('[data-action="undo"]');
        const original=allClipboard(app),described=original.find(i=>i.type===type),history=()=>['undo','redo'].map(key=>app.doc.querySelector(`[data-action="${key}"]`).disabled),before=history();
        assert.equal(before[1],false);
        await app.click('[data-action="board-search"]');
        const input=app.doc.querySelector('#board-search-input'),filter=app.doc.querySelector('#board-search select');
        filter.value=type;filter.dispatchEvent(new app.w.Event('change',{bubbles:true}));
        let results=app.doc.querySelectorAll('#board-search-results button');
        assert.equal(results.length,1);
        assert.equal(results[0].querySelector('span').textContent,source.alt);
        assert.equal(results[0].querySelector('[lang="fr-CA"]').textContent,source.alt);
        input.value='  RESUME  ';input.dispatchEvent(new app.w.Event('input',{bubbles:true}));
        results=app.doc.querySelectorAll('#board-search-results button');assert.equal(results.length,1);
        assert.equal(results[0].querySelector('span').textContent,source.alt);
        filter.value='';filter.dispatchEvent(new app.w.Event('change',{bubbles:true}));
        assert.equal(app.doc.querySelectorAll('#board-search-results button').length,2);
        filter.value=type;filter.dispatchEvent(new app.w.Event('change',{bubbles:true}));
        await app.click('#board-search-results button');await app.click('#search-select');
        assert.equal(app.doc.querySelector('#board-search'),null);
        assert.deepEqual(selectedClipboard(app),[described]);
        assert.deepEqual(history(),before);
        assert.deepEqual(allClipboard(app),original);
        assert.equal(app.doc.documentElement.lang,locale);
        await app.click('[data-action="home"]');await app.click('[data-open]');
        assert.deepEqual(allClipboard(app),original);
      }finally{await app.close();}
    });
