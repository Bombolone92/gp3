
function mindPointerClick(app, button, pointerId) {
  const e = new app.w.MouseEvent("click", { detail: 1, bubbles: true });
  Object.defineProperty(e, "pointerId", { value: pointerId });
  button.dispatchEvent(e);
}
for (const foreign of ["pointerdown", "pointercancel", "lostpointercapture", "click"])
  test(`mind map plus presses survive another pointer's ${foreign} with atomic history and saved hierarchy`, async () => {
    const app = await setup();
    try {
      const { root, nodes } = await mindDragFixture(app);
      await app.click(`[data-id="${root.id}"]`);
      const button = app.doc.querySelector('[data-mind-direction="right"]');
      cropPointer(app, button, "pointerdown", 41, 350, 150);
      if (foreign !== "click") cropPointer(app, button, foreign, 42, 350, 150);
      cropPointer(app, button, "pointerup", 41, 350, 150);
      cropPointer(app, button, "lostpointercapture", 41, 350, 150);
      if (foreign === "click") {
        mindPointerClick(app, button, 42);
        assert.equal(app.doc.querySelector("#canvas-text-editor"), null, "Foreign release cannot activate the owner's branch");
      }
      mindPointerClick(app, button, 41);
      const editor = app.doc.querySelector("#canvas-text-editor");
      assert.ok(editor, "Owner click still creates its child");
      mindKey(app, "Enter", { ctrlKey: true });
      await app.click(`[data-id="${root.id}"]`);
      const after = selectedClipboard(app);
      assert.equal(after.length, 5);
      const child = after.find(i=>!nodes.some(before=>before.id === i.id));
      assert.equal(child.mindMap.parent, root.id);
      assert.equal(child.mindMap.direction, "right");
      await app.click('[data-action="undo"]');
      await app.click(`[data-id="${root.id}"]`);
      assert.deepEqual(selectedClipboard(app), nodes, "One Undo restores the original hierarchy and layout");
      await app.click('[data-action="redo"]');
      await app.click(`[data-id="${root.id}"]`);
      assert.deepEqual(selectedClipboard(app), after);
      await app.click('[data-action="home"]');
      await app.click('[data-open]');
      await app.click(`[data-id="${root.id}"]`);
      assert.deepEqual(selectedClipboard(app), after, "The created branch survives reopening");
      await app.click('[data-action="home"]');
    } finally { app.close(); }
  });

for (const ending of ["pointercancel", "lostpointercapture"])
  test(`mind map plus owner ${ending} preserves redo and permits a later keyboard branch`, async () => {
    const app = await setup();
    try {
      const { root, nodes } = await mindDragFixture(app);
      await app.click(`[data-id="${root.id}"]`);
      await app.click('[data-mind-direction="right"]');
      mindKey(app, "Enter", { ctrlKey: true });
      await app.click('[data-action="undo"]');
      await app.click(`[data-id="${root.id}"]`);
      assert.equal(app.doc.querySelector('[data-action="redo"]').disabled, false);
      const button = app.doc.querySelector('[data-mind-direction="right"]');
      cropPointer(app, button, "pointerdown", 41, 350, 150);
      cropPointer(app, button, ending, 41, 350, 150);
      cropPointer(app, button, "pointerup", 41, 350, 150);
      mindPointerClick(app, button, 41);
      assert.equal(app.doc.querySelector("#canvas-text-editor"), null);
      assert.deepEqual(selectedClipboard(app), nodes);
      assert.equal(app.doc.querySelector('[data-action="redo"]').disabled, false, "Cancellation does not consume redo");
      button.click();
      assert.ok(app.doc.querySelector("#canvas-text-editor"), "Keyboard activation remains available after cancellation");
      mindKey(app, "Enter", { ctrlKey: true });
      await app.click(`[data-id="${root.id}"]`);
      assert.equal(selectedClipboard(app).length, 5);
      await app.click('[data-action="undo"]');
      await app.click(`[data-id="${root.id}"]`);
      assert.deepEqual(selectedClipboard(app), nodes);
      await app.click('[data-action="home"]');
    } finally { app.close(); }
  });
