for(const example of [
  ...[178,179,180].map(n=>({name:`end ${n}`,text:"Q".repeat(n)+"😀",query:"Q"})),
  ...[48,49,50].map(n=>({name:`start ${n}`,text:"😀"+"X".repeat(n)+"Q",query:"Q"})),
])
  test(`board search result previews retain complete Unicode at ${example.name}`,async()=>{
    const app=await setup();
    try {
      await rotationFixture(app,[item("note",0,0,{text:example.text,lang:"fr-CA"})]);
      const original=allClipboard(app);
      await app.click('[data-action="board-search"]');
      const search=app.doc.querySelector('#board-search-input');search.value=example.query;search.dispatchEvent(new app.w.Event('input',{bubbles:true}));
      const result=app.doc.querySelector('#board-search-results button > span');
      assert.ok(result.textContent.includes(example.query));
      assert.equal(result.textContent.isWellFormed(),true);
      assert.equal(result.querySelector('[data-user-content]').lang,"fr-CA");
      await app.click('#search-close');
      assert.deepEqual(allClipboard(app),original);
      await app.click('[data-action="home"]');
    }finally{app.close();}
  });
