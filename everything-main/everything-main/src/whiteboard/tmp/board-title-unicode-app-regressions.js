for (const locale of ["en", "fr"])
  for (const mode of ["import", "copy"])
    for (const offset of [-2, -1, 0])
      test(`board title ${mode} preserves complete Unicode at offset ${offset} in ${locale}`, async () => {
        const app = await setup(undefined, { preferences: { "whiteboard-language": locale } });
        try {
          const suffix = mode === "copy" ? (locale === "fr" ? " (copie)" : " (copy)") : (locale === "fr" ? " (importé)" : " (imported)"),
            cap = 200 - suffix.length,
            title = "Q".repeat(cap + offset) + "😀",
            expected = "Q".repeat(cap + offset) + (offset === -2 ? "😀" : "") + suffix,
            content = item("note", 0, 0, { text: "ABC 😀", lang: "fr-CA", textRuns: [{ start: 4, end: 6, style: { lang: "en-GB" } }] });
          validateBoard({ ...board(), title, items: [content] });
          if (mode === "import") {
            let field;
            const nativeClick = app.w.HTMLInputElement.prototype.click;
            app.w.HTMLInputElement.prototype.click = function () { if (this.type === "file") field = this; else nativeClick.call(this); };
            await app.click('[data-action="import"]');
            const payload = { ...board(), title, items: [content] }, file = new app.w.File([JSON.stringify(payload)], 'Unicode.json');
            file.text = async () => app.w.JSON.stringify(payload);
            Object.defineProperty(field, 'files', { value: [file] });
            field.dispatchEvent(new app.w.Event('change'));
            for(let n = 0; n < 40 && !app.doc.querySelector('#canvas'); n++) await app.tick();
          } else {
            await rotationFixture(app, [content]);
            const field = app.doc.querySelector('#board-title');
            field.value = title; field.dispatchEvent(new app.w.Event('change'));
            await app.tick();
            assert.equal(field.value, title);
            await app.click('[data-action="home"]');
            await app.click('[data-more]');
            await app.click('#copy-board');
            const cards = [...app.doc.querySelectorAll('.board-card')], copy = cards.find(x => x.querySelector('h3').textContent.endsWith(suffix));
            assert.ok(cards.some(x => x.querySelector('h3').textContent === title), 'The source board title stays intact');
            assert.equal(copy.querySelector('h3').textContent, expected);
            await app.click(`[data-open="${copy.querySelector('[data-open]').dataset.open}"]`);
          }
          const name = app.doc.querySelector('#board-title').value;
          assert.equal(name, expected);
          assert.equal(name.isWellFormed(), true);
          assert.ok(name.length <= 200);
          const saved = allClipboard(app);
          assert.equal(saved[0].text, content.text);
          assert.equal(saved[0].lang, content.lang);
          assert.deepEqual(saved[0].textRuns, content.textRuns);
          await app.click('[data-action="home"]');
        } finally { await app.close(); }
      });
