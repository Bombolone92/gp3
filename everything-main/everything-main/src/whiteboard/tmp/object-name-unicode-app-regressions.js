for (const language of ["en", "fr"])
  for (const length of [87,88,89])
    test(`connection endpoint previews preserve Unicode and authored passages at ${length} characters in ${language}`, async () => {
      const app = await setup(undefined, { preferences: { "whiteboard-language": language } });
      try {
        const node = item("rect",0,0,{text:"Q".repeat(length)+"😀",lang:"fr-CA",textRuns:[{start:length,end:length+2,style:{lang:"en-GB"}}]});
        await rotationFixture(app,[node,item("arrow",250,0,{w:200,h:0,startId:node.id})]);
        const original=allClipboard(app),source=original.find(i=>i.type==="rect"),line=original.find(i=>i.type==="arrow");
        await app.click(`[data-id="${line.id}"]`);
        await app.click('[data-action="duplicate"]');
        await app.click('[data-action="undo"]');
        assert.deepEqual(allClipboard(app),original);
        const history=["undo","redo"].map(key=>app.doc.querySelector(`[data-action="${key}"]`).disabled);
        assert.equal(history[1],false);
        await app.click(`[data-id="${line.id}"]`);
        await app.click('[data-action="connection-endpoints"]');
        for(const end of ["start","end"]) {
          const label=app.doc.querySelector(`#connection-${end} input[value="${source.id}"]`).closest("label");
          const prefix=language==="fr"?"rectangle: ":"Rectangle: ";
          assert.equal(label.textContent,prefix+"Q".repeat(length)+(length===87?"😀":""));
          assert.equal(label.textContent.isWellFormed(),true);
          assert.equal(label.querySelector('[data-user-content][lang="fr-CA"]').textContent,"Q".repeat(length)+(length===87?"😀":""));
          const passage=label.querySelector('[lang="en-GB"]');
          if(length===87)assert.equal(passage.textContent,"😀");
          else assert.equal(passage,null,"A truncated character cannot create a partial authored passage");
        }
        app.doc.querySelector("dialog").close();await app.tick();
        assert.deepEqual(allClipboard(app),original);
        assert.deepEqual(["undo","redo"].map(key=>app.doc.querySelector(`[data-action="${key}"]`).disabled),history);
        assert.equal(app.doc.documentElement.lang,language);
        await app.click('[data-action="home"]');
      } finally { app.close(); }
    });
