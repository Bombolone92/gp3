for (const locale of ['en','fr'])
  for (const length of [98,99,100])
    test(`mind drag target caption preserves Unicode and authored languages at ${length} characters in ${locale}`,async()=>{
      const app=await setup(undefined,{preferences:{'whiteboard-language':locale}});
      let fixture;
      try{
        const text='Q'.repeat(length)+'😀';
        fixture=await mindDragFixture(app,{text,lang:'fr-CA',textRuns:[{start:length,end:length+2,style:{lang:'en-GB'}}]});
        const {root,a,b,pointer,nodes}=fixture;
        await app.click('[data-action="duplicate"]');await app.click('[data-action="undo"]');
        await app.click(`[data-id="${root.id}"]`);assert.deepEqual(selectedClipboard(app),nodes);
        const state=()=>['undo','redo'].map(key=>app.doc.querySelector(`[data-action="${key}"]`).disabled),before=state();assert.equal(before[1],false);
        pointer('pointerdown',a);pointer('pointermove',b);
        const hint=app.doc.querySelector('#mind-drop-hint');assert.equal(hint.hidden,false);
        const caption=hint.querySelector('[data-user-content]');assert.ok(caption);
        assert.equal(caption.textContent,'Q'.repeat(length)+(length===98?'😀':''));assert.equal(caption.textContent.isWellFormed(),true);assert.equal(caption.lang,'fr-CA');
        assert.equal(caption.querySelector('[lang="en-GB"]')?.textContent,length===98?'😀':undefined);
        pointer('pointercancel',b);assert.equal(hint.hidden,true);
        await app.click(`[data-id="${root.id}"]`);assert.deepEqual(selectedClipboard(app),nodes);assert.deepEqual(state(),before);assert.equal(app.doc.documentElement.lang,locale);
        await app.click('[data-action="home"]');await app.click('[data-open]');await app.click(`[data-id="${root.id}"]`);assert.deepEqual(selectedClipboard(app),nodes);
      }finally{if(fixture)fixture.pointer('pointercancel',fixture.b);await app.close();}
    });
