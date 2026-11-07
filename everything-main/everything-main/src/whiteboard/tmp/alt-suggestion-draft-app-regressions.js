for (const [locale, draft] of [
  ["en", "Description typed while waiting."],
  ["fr", ""],
])
  test(`pending image description keeps the author's ${locale} draft through Save, Undo and reopening`, async () => {
    const src = createCanvas(4, 4).toDataURL();
    class BlobImage extends NativeImage {
      set src(value) {
        super.src = value === "blob:test" ? src : value;
      }
      get src() {
        return super.src;
      }
    }
    let release, request;
    const app = await setup({
      env: "web",
      auth: {
        isSignedIn: () => true,
        getUser: async () => ({ username: "local-description-fixture" }),
      },
      ai: { chat: (...args) => {
        request = args;
        return new Promise(resolve => release = resolve);
      } },
    }, { imageClass: BlobImage, preferences: { "whiteboard-language": locale } });
    const {doc,w,click} = app;
    try {
      w.fetch = async url => {
        assert.match(url, /^data:image\/(png|jpeg);base64,/);
        return new Response(Buffer.from(url.split(",")[1],"base64"), {
          headers: { "Content-Type": url.match(/^data:([^;]+);/)[1] },
        });
      };
      await rotationFixture(app, [item("image",0,0,{src,w:4,h:4,alt:"Saved description.",lang:"fr-CA"})]);
      const original = selectedClipboard(app)[0];
      await click('[data-action="commands"]');
      paletteQuery(app,"Alternative text");
      await click('[data-command="alt-text"]');
      const field=doc.querySelector("#alt-text"), suggest=doc.querySelector("#alt-suggest");
      await click("#alt-suggest");
      const requestedDeadline=Date.now()+3000;
      while (!release && Date.now()<requestedDeadline) await app.tick();
      assert.ok(release,"The actual image-description request reached the local AI handler.");
      assert.match(request[0],/in fr-CA\./);
      assert.equal(suggest.disabled,true);
      field.value=draft;
      field.dispatchEvent(new w.Event("input",{bubbles:true}));
      release(' "Suggested description." ');
      const reviewedDeadline=Date.now()+3000;
      while(suggest.disabled && Date.now()<reviewedDeadline)await app.tick();
      assert.equal(suggest.disabled,false);
      assert.equal(field.value,draft,"The later reply must keep the user's changed draft.");
      assert.equal(field.lang,"fr-CA");
      assert.equal(doc.querySelector("#alt-count").textContent,`${draft.length} / 1000`);
      assert.match(doc.querySelector("#alt-status").textContent,locale==="fr"?/conservée/:/kept/);
      assert.ok(doc.querySelector(`#board-outline [data-id="${original.id}"]`).textContent.includes("Saved description."));
      doc.querySelector("#alt-form").dispatchEvent(new w.Event("submit",{cancelable:true}));
      await app.tick();
      assert.equal(doc.querySelector("#alt-form"),null);
      const expected={...original};
      if(draft)expected.alt=draft;else delete expected.alt;
      assert.deepEqual(allClipboard(app),[expected]);
      await click('[data-action="undo"]');
      assert.deepEqual(allClipboard(app),[original]);
      await click('[data-action="redo"]');
      assert.deepEqual(allClipboard(app),[expected]);
      await click('[data-action="home"]');
      await click('[data-open]');
      assert.deepEqual(allClipboard(app),[expected]);
      assert.equal(doc.documentElement.lang,locale);
    } finally {
      release?.(' "Suggested description." ');
      await app.close();
    }
  });
