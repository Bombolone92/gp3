for (const ending of ["pointercancel", "lostpointercapture"])
  test(`mind collapse owner ${ending} preserves redo and permits later keyboard activation`, async () => {
    const app = await setup();
    try {
      const { root, a, nested, nodes } = await mindDragFixture(app);
      await app.click(`[data-id="${a.id}"]`);
      await app.click(`[data-mind-collapse="${a.id}"]`);
      assert.equal(app.doc.querySelector(`[data-id="${nested.id}"]`), null);
      await app.click('[data-action="undo"]');
      await app.click(`[data-id="${a.id}"]`);
      assert.equal(app.doc.querySelector('[data-action="redo"]').disabled, false);
      const button = app.doc.querySelector(`[data-mind-collapse="${a.id}"]`);
      cropPointer(app, button, "pointerdown", 41, 350, 150);
      cropPointer(app, button, ending, 41, 350, 150);
      cropPointer(app, button, "pointerup", 41, 350, 150);
      mindPointerClick(app, button, 41);
      assert.ok(app.doc.querySelector(`[data-id="${nested.id}"]`));
      assert.equal(button.getAttribute("aria-expanded"), "true");
      assert.equal(app.doc.querySelector('[data-action="redo"]').disabled, false);
      await app.click(`[data-id="${root.id}"]`);
      assert.deepEqual(selectedClipboard(app), nodes, "Cancellation preserves the exact hierarchy and geometry");
      await app.click(`[data-id="${a.id}"]`);
      app.doc.querySelector(`[data-mind-collapse="${a.id}"]`).click();
      assert.equal(app.doc.querySelector(`[data-id="${nested.id}"]`), null, "A later keyboard click still collapses the branch");
      await app.click('[data-action="undo"]');
      await app.click(`[data-id="${root.id}"]`);
      assert.deepEqual(selectedClipboard(app), nodes, "Keyboard collapse remains one undoable edit");
      await app.click('[data-action="home"]');
    } finally { app.close(); }
  });
