for (const locale of ["en", "fr"])
  for (const spreadsheet of [false, true])
    for (const length of [178, 179, 180])
      test(`bulk Unicode preview preserves authored data at ${length} characters for ${spreadsheet ? "cells" : "ideas"} in ${locale}`, async () => {
        const app = await setup(undefined, { preferences: { "whiteboard-language": locale } });
        try {
          await rotationFixture(app, [item("note", 0, 0, { text: "Existing" })]);
          await app.click('[data-action="duplicate"]');
          await app.click('[data-action="undo"]');
          const original = allClipboard(app), history = () => ["undo", "redo"].map(k => app.doc.querySelector(`[data-action="${k}"]`).disabled), before = history(), text = "Q".repeat(length) + "😀";
          assert.equal(before[1], false);
          if (spreadsheet) dispatchTransfer(app, "paste", transferData({ "text/html": `<table><tr><td lang="fr-CA">${"Q".repeat(length)}<span lang="en-GB">😀</span></td></tr></table>`, "text/plain": text }));
          else {
            app.doc.querySelector('#canvas').dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'N', shiftKey: true, bubbles: true, cancelable: true }));
            const field = app.doc.querySelector('#bulk-ideas'); field.value = text; field.dispatchEvent(new app.w.Event('input', { bubbles: true }));
          }
          const preview = app.doc.querySelector('.bulk-preview > div');
          assert.equal(preview.textContent, "Q".repeat(length) + (length === 178 ? "😀" : ""));
          assert.equal(preview.textContent.isWellFormed(), true);
          if (spreadsheet) {
            assert.equal(preview.querySelector('[data-user-content]').lang, 'fr-CA');
            assert.equal(preview.querySelector('[lang="en-GB"]')?.textContent, length === 178 ? "😀" : undefined);
          }
          await app.click('#bulk-cancel');
          assert.deepEqual(allClipboard(app), original);
          assert.deepEqual(history(), before);
          assert.equal(app.doc.documentElement.lang, locale);
          await app.click('[data-action="home"]');
        } finally { await app.close(); }
      });
