test("test window disposal waits for the exact pending local save before releasing its document", async () => {
  const factory = new IDBFactory();
  let armed = false, release, reached;
  const gated = new Promise(resolve => { reached = resolve; });
  const indexedDB = {
    open(...args) {
      const request = factory.open(...args);
      request.addEventListener("success", () => {
        const database = request.result, transaction = database.transaction.bind(database);
        database.transaction = (...args) => {
          const tx = transaction(...args);
          if (armed && args[0] === "boards" && args[1] === "readwrite") {
            armed = false;
            const dispatch = tx.dispatchEvent.bind(tx);
            tx.dispatchEvent = event => {
              if (event.type !== "complete") return dispatch(event);
              release = () => dispatch(event);
              reached();
              return true;
            };
          }
          return tx;
        };
      });
      return request;
    },
  };
  const app = await setup(undefined, { indexedDB });
  try {
    await app.click('[data-action="new"]');
    armed = true;
    const title = app.doc.querySelector('#board-title');
    title.value = "A save that is still pending";
    title.dispatchEvent(new app.w.Event('change'));
    await gated;
    let disposed = false;
    const closing = Promise.resolve(app.close()).then(() => { disposed = true; });
    await Promise.resolve();
    assert.equal(disposed, false, "Disposal must await the pending save, independent of elapsed time");
    assert.equal(app.w.document, app.doc, "The save callback still has its live document");
    release();
    await closing;
    assert.equal(app.w.document, undefined);
    const request = factory.open('whiteboard-v1', 3);
    const saved = await new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result, tx = database.transaction('boards', 'readonly'), read = tx.objectStore('boards').getAll();
        tx.oncomplete = () => { database.close(); resolve(read.result); };
        tx.onerror = () => reject(tx.error);
      };
    });
    assert.ok(saved.some(b => b.title === 'A save that is still pending'));
  } finally {
    release?.();
    if (app.w.document) await app.close();
  }
});

test("test window disposal closes shared sessions before releasing both documents", async () => {
  const room = "disposal-leaves-shared-sessions", shared = await sharedEditors(room, [item("note", 100, 100, { text: "Keep this shared content." })]);
  try {
    const before = shared.env.calls.filter(call => call.room === room && call.op === "leave").length;
    await shared.close();
    await shared.until(() => shared.env.calls.filter(call => call.room === room && call.op === "leave").length === before + shared.apps.length, "Both closed test sessions leave the shared room");
    assert.ok(shared.apps.every(app => app.w.document === undefined));
    const document = new SharedDocument();
    document.apply(Buffer.from((await shared.env.service.call(owner, { op: "sync", room })).update, "base64"));
    assert.equal(document.snapshot(room).items[0].text, "Keep this shared content.");
    document.destroy();
  } finally {
    for (const app of shared.apps) if (app.w.document) await app.close();
  }
});
