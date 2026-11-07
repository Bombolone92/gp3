for (const locale of ["en", "fr"])
  for (const length of [98, 99, 100])
    test(`image replacement Unicode preview preserves authored data at ${length} characters in ${locale}`, async () => {
      const app = await setup(undefined, { preferences: { "whiteboard-language": locale } });
      try {
        const target = { ...cropFixture(), text: "Target" },
          source = { ...replacementFixture(), text: "Q".repeat(length) + "😀", lang: "fr-CA", textRuns: [{ start: length, end: length + 2, style: { lang: "en-GB" } }] };
        await rotationFixture(app, [target, source]);
        const original = allClipboard(app), t = original.find(x => x.text === "Target"), s = original.find(x => x.text.startsWith("Q"));
        await app.click(`[data-id="${t.id}"]`);
        await app.click('[data-action="duplicate"]');
        await app.click('[data-action="undo"]');
        const history = () => ["undo", "redo"].map(k => app.doc.querySelector(`[data-action="${k}"]`).disabled), before = history();
        assert.equal(before[1], false);
        await app.click(`[data-id="${t.id}"]`);
        await app.click('[data-action="replace-image"]');
        await app.click('#replacement-board');
        const choice = app.doc.querySelector(`[data-replacement-source="${s.id}"]`);
        assert.equal(choice.textContent, "Q".repeat(length) + (length === 98 ? "😀" : ""));
        assert.equal(choice.textContent.isWellFormed(), true);
        assert.equal(choice.querySelector('[data-user-content]').lang, "fr-CA");
        assert.equal(choice.querySelector('[lang="en-GB"]')?.textContent, length === 98 ? "😀" : undefined);
        await app.click('#replacement-cancel');
        assert.deepEqual(allClipboard(app), original);
        assert.deepEqual(history(), before);
        assert.equal(app.doc.documentElement.lang, locale);
        await app.click('[data-action="home"]');
      } finally { await app.close(); }
    });
