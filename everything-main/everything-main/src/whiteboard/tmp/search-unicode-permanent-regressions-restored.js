
for (const example of [
  ...[178, 179, 180].map((n) => ({
    name: `end ${n}`,
    text: "Q".repeat(n) + "😀",
    query: "Q",
  })),
  ...[48, 49, 50].map((n) => ({
    name: `start ${n}`,
    text: "😀" + "X".repeat(n) + "Q",
    query: "Q",
  })),
])
  test(`board search result previews retain complete Unicode at ${example.name}`, async () => {
    const app = await setup();
    try {
      await rotationFixture(app, [
        item("note", 0, 0, { text: example.text, lang: "fr-CA" }),
      ]);
      const original = allClipboard(app);
      await app.click('[data-action="board-search"]');
      const search = app.doc.querySelector("#board-search-input");
      search.value = example.query;
      search.dispatchEvent(new app.w.Event("input", { bubbles: true }));
      const result = app.doc.querySelector(
        "#board-search-results button > span",
      );
      assert.ok(result.textContent.includes(example.query));
      assert.equal(result.textContent.isWellFormed(), true);
      assert.equal(result.querySelector("[data-user-content]").lang, "fr-CA");
      await app.click("#search-close");
      assert.deepEqual(allClipboard(app), original);
      await app.click('[data-action="home"]');
    } finally {
      await app.close();
    }
  });

for (const locale of ["en", "fr"])
  for (const type of ["note", "table"])
    for (const boundary of ["start", "end"])
      test(`board search Unicode ${boundary} preserves note and cell passage declarations for ${type} in ${locale}`, async () => {
        const app = await setup(undefined, {
          preferences: { "whiteboard-language": locale },
        });
        try {
          const text =
            boundary === "start"
              ? "😀" + "X".repeat(49) + "Q"
              : "Q".repeat(179) + "😀";
          const at = boundary === "start" ? 0 : 179,
            runs = [{ start: at, end: at + 2, style: { lang: "en-GB" } }];
          const object =
            type === "note"
              ? item(type, 0, 0, { text, lang: "fr-CA", textRuns: runs })
              : item(type, 0, 0, {
                  text: "",
                  cells: [[text]],
                  lang: "de",
                  cellLanguages: { "0,0": { lang: "fr-CA", textRuns: runs } },
                });
          validateBoard({ ...board(), items: [object] });
          await rotationFixture(app, [object]);
          await app.click('[data-action="duplicate"]');
          await app.click('[data-action="undo"]');
          const original = allClipboard(app),
            state = () =>
              ["undo", "redo"].map(
                (key) =>
                  app.doc.querySelector(`[data-action="${key}"]`).disabled,
              ),
            history = state();
          assert.equal(history[1], false);
          await app.click('[data-action="board-search"]');
          const input = app.doc.querySelector("#board-search-input");
          input.value = "Q";
          input.dispatchEvent(new app.w.Event("input", { bubbles: true }));
          const result = app.doc.querySelector(
              "#board-search-results button > span",
            ),
            expected = boundary === "start" ? text : "Q".repeat(179) + "…";
          assert.equal(result.textContent, expected);
          assert.equal(result.textContent.isWellFormed(), true);
          const content = result.querySelector("[data-user-content]");
          assert.equal(content.lang, type === "table" ? "de" : "fr-CA");
          assert.equal(
            content.querySelector('[lang="en-GB"]')?.textContent,
            boundary === "start" ? "😀" : undefined,
          );
          if (type === "table")
            assert.equal(
              content.querySelector('[lang="fr-CA"]').textContent,
              boundary === "start" ? "X".repeat(49) + "Q" : "Q".repeat(179),
            );
          assert.equal(app.doc.documentElement.lang, locale);
          assert.deepEqual(state(), history);
          await app.click("#search-close");
          assert.deepEqual(allClipboard(app), original);
          assert.deepEqual(state(), history);
          await app.click('[data-action="home"]');
        } finally {
          await app.close();
        }
      });
