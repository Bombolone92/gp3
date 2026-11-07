for (const locale of ['en','fr'])
  for (const length of [118,119,120])
    test(`PNG fallback filename retains complete Unicode at ${length} characters in ${locale}`,async()=>{
      const app=await setup(undefined,{preferences:{'whiteboard-language':locale}});
      try{
        await rotationFixture(app,[item('note',0,0,{text:'Original 😀',lang:'fr-CA',textRuns:[{start:9,end:11,style:{lang:'en-GB'}}]})]);
        const title='Q'.repeat(length)+'😀',field=app.doc.querySelector('#board-title');
        field.value=title;field.dispatchEvent(new app.w.Event('change'));await app.tick();
        const original=allClipboard(app),state=()=>['undo','redo'].map(key=>app.doc.querySelector(`[data-action="${key}"]`).disabled),before=state();
        app.w.ClipboardItem=undefined;
        await app.click('[data-action="copy-image"]');
        assert.ok(app.doc.querySelector('.image-copy-preview img'));
        assert.equal(app.doc.querySelector('#retry-image-copy'),null);
        await app.click('#download-selection-image');
        const expected='Q'.repeat(length)+(length===118?'😀':'')+'-selection.png';
        assert.equal(app.names.at(-1),expected);
        assert.equal(app.names.at(-1).isWellFormed(),true);
        assert.equal(app.downloads.at(-1).type,'image/png');
        assert.equal(app.doc.querySelector('dialog'),null);
        assert.equal(field.value,title);assert.deepEqual(allClipboard(app),original);assert.deepEqual(state(),before);assert.equal(app.doc.documentElement.lang,locale);
        await app.click('[data-action="home"]');await app.click('[data-open]');
        assert.equal(app.doc.querySelector('#board-title').value,title);assert.deepEqual(allClipboard(app),original);
      }finally{await app.close();}
    });
