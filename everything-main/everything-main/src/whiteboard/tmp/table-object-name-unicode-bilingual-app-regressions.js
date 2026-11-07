for (const locale of ['en','fr'])
  for (const length of [298,299,300])
    test(`table destination caption keeps Unicode and original cells at ${length} characters in ${locale}`,async()=>{
      const app=await setup(undefined,{preferences:{'whiteboard-language':locale}});
      try{
        const text='Q'.repeat(length)+'😀',target=item('table',300,0,{cells:[[text]],lang:'fr-CA',cellLanguages:{'0,0':{lang:'fr-CA',textRuns:[{start:length,end:length+2,style:{lang:'en-GB'}}]}}}),source=item('note',0,0,{text:'Source',objectLink:{objectId:target.id}});
        await rotationFixture(app,[source,target]);await app.click('[data-action="duplicate"]');await app.click('[data-action="undo"]');
        const original=allClipboard(app),storedSource=original.find(i=>i.text==='Source'),history=()=>['undo','redo'].map(key=>app.doc.querySelector(`[data-action="${key}"]`).disabled),before=history();assert.equal(before[1],false);
        await app.click(`#board-outline [data-id="${storedSource.id}"]`);await app.click('[data-action="object-link"]');
        const caption=app.doc.querySelector('#object-link-current a');assert.ok(caption);assert.equal(caption.textContent,(locale==='en'?'Table: ':'tableau de données: ')+'Q'.repeat(length)+(length===298?'😀':''));assert.equal(caption.textContent.isWellFormed(),true);
        await app.click('#object-link-close');assert.deepEqual(allClipboard(app),original);assert.deepEqual(history(),before);assert.equal(app.doc.documentElement.lang,locale);
        await app.click('[data-action="home"]');await app.click('[data-open]');assert.deepEqual(allClipboard(app),original);
      }finally{await app.close();}
    });
