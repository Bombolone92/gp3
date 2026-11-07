
for (const foreign of ["pointerdown", "pointercancel", "lostpointercapture", "click"])
  test(`mind collapse presses survive another pointer's ${foreign} with atomic history and saved hierarchy`, async () => {
    const app = await setup();
    try {
      const { root, a, nested, nodes } = await mindDragFixture(app);
      await app.click(`[data-id="${a.id}"]`);
      const button = app.doc.querySelector(`[data-mind-collapse="${a.id}"]`);
      cropPointer(app, button, "pointerdown", 41, 350, 150);
      if (foreign !== "click") cropPointer(app, button, foreign, 42, 350, 150);
      cropPointer(app, button, "pointerup", 41, 350, 150);
      cropPointer(app, button, "lostpointercapture", 41, 350, 150);
      if (foreign === "click") {
        mindPointerClick(app, button, 42);
        assert.ok(app.doc.querySelector(`[data-id="${nested.id}"]`), "A foreign click cannot collapse the owner's branch");
      }
      mindPointerClick(app, button, 41);
      assert.equal(app.doc.querySelector(`[data-id="${nested.id}"]`), null, "Owner click still collapses its branch");
      assert.equal(button.getAttribute("aria-expanded"), "false");
      await app.click(`[data-id="${root.id}"]`);
      const after = selectedClipboard(app);
      assert.equal(after.length, 4, "Hidden descendants remain in the copied hierarchy");
      assert.equal(after.find(i=>i.id === a.id).mindCollapsed, true);
      assert.deepEqual(after.map(i=>[i.id,i.x,i.y,i.w,i.h]), nodes.map(i=>[i.id,i.x,i.y,i.w,i.h]), "Collapsing preserves node geometry");
      await app.click('[data-action="undo"]');
      await app.click(`[data-id="${root.id}"]`);
      assert.deepEqual(selectedClipboard(app), nodes);
      assert.ok(app.doc.querySelector(`[data-id="${nested.id}"]`));
      await app.click('[data-action="redo"]');
      await app.click(`[data-id="${root.id}"]`);
      assert.deepEqual(selectedClipboard(app), after);
      assert.equal(app.doc.querySelector(`[data-id="${nested.id}"]`), null);
      await app.click('[data-action="home"]');
      await app.click('[data-open]');
      await app.click(`[data-id="${root.id}"]`);
      assert.deepEqual(selectedClipboard(app), after);
      assert.equal(app.doc.querySelector(`[data-id="${nested.id}"]`), null);
      await app.click('[data-action="home"]');
    } finally { app.close(); }
  });
