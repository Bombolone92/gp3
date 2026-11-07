
for(const n of [298,299,300])
  test(`table destination previews retain complete Unicode at ${n} characters in the editor`,async()=>{
    const app=await setup();
    try {
      const text='Q'.repeat(n)+'😀',target=item('table',300,0,{cells:[[text]],lang:'fr-CA'}),source=item('note',0,0,{text:'Source',objectLink:{objectId:target.id}});
      await rotationFixture(app,[source,target]);const original=allClipboard(app),storedSource=original.find(i=>i.text==='Source');
      await app.click(`#board-outline [data-id="${storedSource.id}"]`);await app.click('[data-action="object-link"]');
      const caption=app.doc.querySelector('#object-link-current a');assert.ok(caption);assert.equal(caption.textContent.isWellFormed(),true);
      await app.click('#object-link-close');assert.deepEqual(allClipboard(app),original);await app.click('[data-action="home"]');
    }finally{app.close();}
  });
