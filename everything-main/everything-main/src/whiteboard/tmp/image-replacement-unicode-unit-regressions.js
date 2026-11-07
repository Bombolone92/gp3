for (const locale of ["en", "fr"])
  for (const length of [98, 99, 100])
    test(`image replacement labels retain complete Unicode at ${length} characters in ${locale}`, () => {
      const dom = new JSDOM("<body></body>"),
        previous = globalThis.document,
        previousLanguage = language;
      globalThis.document = dom.window.document;
      let ui;
      try {
        setLanguage(locale);
        const value = board(),
          target = item("image", 0, 0, { src: "data:image/png;base64,AA==" }),
          source = item("image", 300, 0, {
            src: "data:image/png;base64,AA==",
            text: "Q".repeat(length) + "😀",
            lang: "fr-CA",
            textRuns: [{ start: length, end: length + 2, style: { lang: "en-GB" } }],
          });
        value.items = [target, source];
        const original = structuredClone(value);
        let commits = 0;
        ui = createImageReplacement({
          board: () => value,
          selection: () => new Set([target.id]),
          canEdit: () => true,
          readOnly: () => false,
          toast() {},
          commit() { commits++; },
          fileInput() {},
          modal(_title, content, ready) {
            const dialog = document.createElement("dialog");
            dialog.innerHTML = content;
            dialog.open = true;
            dialog.close = () => {
              dialog.open = false;
              dialog.dispatchEvent(new dom.window.Event("close"));
              dialog.remove();
            };
            document.body.append(dialog);
            ready(dialog);
            return dialog;
          },
        });
        ui.open();
        document.querySelector("#replacement-board").click();
        const choice = document.querySelector(`[data-replacement-source="${source.id}"]`);
        assert.equal(choice.textContent, "Q".repeat(length) + (length === 98 ? "😀" : ""));
        assert.equal(choice.textContent.isWellFormed(), true);
        assert.equal(choice.querySelector("[data-user-content]").lang, "fr-CA");
        assert.equal(choice.querySelector('[lang="en-GB"]')?.textContent, length === 98 ? "😀" : undefined);
        document.querySelector("#replacement-cancel").click();
        assert.equal(commits, 0);
        assert.deepEqual(value, original);
      } finally {
        ui?.close();
        setLanguage(previousLanguage);
        globalThis.document = previous;
        dom.window.close();
      }
    });
