for (const locale of ['en','fr'])

for (const length of [118,119,120])
  for (const phase of ['preview','history'])
    test(`voting ${phase} labels keep Unicode complete at ${length} characters in ${locale}`,async()=>{
      const app=await setup(undefined,{preferences:{'whiteboard-language':locale}});
      try {
        const text='Q'.repeat(length)+'😀';
        await rotationFixture(app,[item('note',0,0,{text,lang:'fr-CA',textRuns:[{start:length,end:length+2,style:{lang:'en-GB'}}]})]);
        const original=allClipboard(app);
        const state=()=>['undo','redo'].map(key=>app.doc.querySelector(`[data-action="${key}"]`).disabled);
        const history=state();
        await app.click('[data-action="facilitation"]');await app.click('#fac-tab-vote');
        app.doc.querySelector('#fac-vote-form').dispatchEvent(new app.w.Event('submit',{cancelable:true}));await app.tick();
        if(phase==='history'){await app.click('[data-fac="vote-end"]');await app.click('#fac-tab-history');}
        const caption=app.doc.querySelector(phase==='preview'?'.fac-vote-list [data-user-content]':'.fac-result-label [data-user-content]');
        assert.ok(caption);assert.equal(caption.textContent.isWellFormed(),true);assert.equal(caption.lang,'fr-CA');
        assert.equal(caption.textContent,length===118?text:'Q'.repeat(Math.min(length,120)));
        assert.equal(caption.querySelector('[lang="en-GB"]')?.textContent,length===118?'😀':undefined);
        assert.deepEqual(state(),history);
        await app.click('#facilitation-close');assert.deepEqual(allClipboard(app),original);assert.equal(app.doc.documentElement.lang,locale);
        await app.click('[data-action="home"]');await app.click('[data-open]');
        assert.deepEqual(allClipboard(app),original);
        if(phase==='history'){await app.click('[data-action="facilitation"]');await app.click('#fac-tab-history');assert.equal(app.doc.querySelector('.fac-result-label [data-user-content]').textContent,caption.textContent);}
        await app.click('[data-action="home"]');
      }finally{await app.close();}
    });
