for (const language of ["en", "fr"])
  test(`built PowerPoint export retains authored title, note and cell languages in ${language}`, async () => {
    const app = await setup(undefined, {
      preferences: { "whiteboard-language": language },
    });
    const { w, doc, click, tick, downloads } = app;
    try {
      assert.equal(doc.querySelector("#language").value, language);
      const frame = item("frame", 0, 0, {
        w: 900,
        h: 620,
        text: "Hello bonjour",
        lang: "en-CA",
        textRuns: [{ start: 6, end: 13, style: { lang: "fr-CA" } }],
      });
      await rotationFixture(app, [
        frame,
        item("note", 20, 70, {
          text: "Bonjour hello",
          lang: "fr",
          textRuns: [{ start: 8, end: 13, style: { lang: "en-GB" } }],
          parentId: frame.id,
        }),
        item("table", 20, 300, {
          cells: [["Bonjour", "hello"]],
          lang: "fr",
          cellLanguages: { "0,1": { lang: "en-GB" } },
          parentId: frame.id,
        }),
      ]);
      const before = selectedClipboard(app);
      assert.equal(before.find((i) => i.type === "frame").lang, "en-CA");
      assert.equal(before.find((i) => i.type === "frame").textRuns[0].style.lang, "fr-CA");
      assert.equal(before.find((i) => i.type === "note").textRuns[0].style.lang, "en-GB");
      assert.equal(before.find((i) => i.type === "table").cellLanguages["0,1"].lang, "en-GB");
      await click('[data-action="export"]');
      for (const [id, value] of [["export-format", "pptx"], ["export-scope", "frames"]]) {
        const field = doc.querySelector(`#${id}`);
        field.value = value;
        field.dispatchEvent(new w.Event("change", { bubbles: true }));
      }
      await click('dialog [type="submit"]');
      for (let n = 0; n < 200 && !downloads.length; n++) await tick();
      assert.equal(downloads.length, 1);
      const bytes = await new Promise((resolve, reject) => {
        const reader = new w.FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(downloads[0]);
      });
      const { readZip } = await import("../src/unzip.js");
      const zip = readZip(bytes);
      const runs = async (path) => {
        const xml = new w.DOMParser().parseFromString(await zip.text(path), "application/xml");
        assert.equal(xml.querySelector("parsererror"), null);
        return [...xml.getElementsByTagNameNS("*", "r")].map((run) => ({
          text: run.getElementsByTagNameNS("*", "t")[0].textContent,
          lang: run.getElementsByTagNameNS("*", "rPr")[0].getAttribute("lang"),
        }));
      };
      assert.deepEqual(await runs("ppt/slides/slide1.xml"), [
        { text: "Hello ", lang: "en-CA" },
        { text: "bonjour", lang: "fr-CA" },
      ]);
      assert.deepEqual(await runs("ppt/notesSlides/notesSlide1.xml"), [
        { text: "Bonjour ", lang: "fr" },
        { text: "hello", lang: "en-GB" },
        { text: "Bonjour | ", lang: "fr" },
        { text: "hello", lang: "en-GB" },
      ]);
      assert.deepEqual(selectedClipboard(app), before, "export retains objects and their metadata");
    } finally {
      app.close();
    }
  });
