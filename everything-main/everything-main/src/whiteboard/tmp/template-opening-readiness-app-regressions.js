function heldTemplateStorage() {
  const indexedDB = new IDBFactory(), open = indexedDB.open.bind(indexedDB);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const reached = new Promise(resolve => { entered = resolve; });
  indexedDB.open = (...args) => {
    const request = open(...args);
    request.addEventListener('success', () => {
      const db = request.result, transaction = db.transaction.bind(db);
      db.transaction = (...args) => {
        const tx = transaction(...args);
        if (args[0] === 'templates' && args[1] === 'readonly') {
          let completed;
          Object.defineProperty(tx, 'oncomplete', {
            configurable: true,
            get: () => completed,
            set: handler => {
              completed = async event => {
                entered();
                await gate;
                handler.call(tx, event);
              };
            }
          });
        }
        return tx;
      };
    });
    return request;
  };
  return { indexedDB, reached, release };
}
for (const launcher of ['library', 'editor'])
  test(`test clicks wait for ${launcher} template content to finish loading`, async () => {
    const held = heldTemplateStorage();
    const app = await setup(undefined, { indexedDB: held.indexedDB });
    let opening;
    try {
      if (launcher === 'editor') {
        await app.click('[data-action="new"]');
        await app.click('[data-action="more-tools"]');
      }
      let finished = false;
      opening = app.click(launcher === 'library' ? '[data-action="templates"]' : '[data-feature="templates"]').then(() => { finished = true; });
      await held.reached;
      await app.tick();
      assert.equal(app.doc.querySelectorAll('[data-use]').length, 0);
      assert.equal(finished, false, 'The test click is still waiting for the held template read');
      held.release();
      await opening;
      assert.equal(app.doc.querySelectorAll('[data-use]').length, TEMPLATE_CATALOG.length);
      assert.ok(app.doc.querySelector('[data-use="journey"]'));
      assert.equal(app.doc.querySelectorAll('#board-outline [data-id]').length, 0);
      if (launcher === 'editor') {
        assert.equal(app.doc.querySelector('[data-action="undo"]').disabled, true);
        assert.equal(app.doc.querySelector('[data-action="redo"]').disabled, true);
      }
    } finally {
      held.release();
      await opening;
      for (let n = 0; n < 40 && !app.doc.querySelector('#library-panel'); n++) await app.tick();
      await app.close();
    }
  });
