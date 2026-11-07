for (const locale of ["en", "fr"])
  for (const length of [158, 159, 160])
    test(`version copy titles retain complete Unicode at ${length} characters in ${locale}`, async () => {
      const app = await setup(undefined, { preferences: { "whiteboard-language": locale } });
      try {
        const content = item("note", 0, 0, { text: "ABC 😀", lang: "fr-CA", textRuns: [{ start: 4, end: 6, style: { lang: "en-GB" } }] }), title = "Q".repeat(length) + "😀";
        await rotationFixture(app, [content]);
        const field = app.doc.querySelector('#board-title'); field.value = title; field.dispatchEvent(new app.w.Event('change')); await app.tick();
        await app.click('[data-action="more-tools"]');
        await app.click('[data-feature="history"]');
        await app.click('#checkpoint-create');
        for (let n = 0; n < 40 && !app.doc.querySelector('#local-revisions [data-revision-options]'); n++) await app.tick();
        await app.click('#local-revisions [data-revision-options]');
        for (let n = 0; n < 40 && !app.doc.querySelector('[data-part="copy"]'); n++) await app.tick();
        await app.click('[data-part="copy"]');
        for (let n = 0; n < 40 && (!app.doc.querySelector('#board-title') || app.doc.querySelector('#board-title').value === title); n++) await app.tick();
        const name = app.doc.querySelector('#board-title').value, prefix = "Q".repeat(length) + (length === 158 ? "😀" : "");
        assert.equal(name.isWellFormed(), true, JSON.stringify(name));
        assert.ok(name.startsWith(prefix + " ("), JSON.stringify(name));
        assert.ok(name.endsWith(")"));
        assert.ok(name.length <= 200);
        const copied = allClipboard(app)[0];
        assert.equal(copied.text, content.text);
        assert.equal(copied.lang, content.lang);
        assert.deepEqual(copied.textRuns, content.textRuns);
        await app.click('[data-action="home"]');
        assert.ok([...app.doc.querySelectorAll('.board-card h3')].some(x => x.textContent === title), 'The source title stays intact');
      } finally { await app.close(); }
    });
