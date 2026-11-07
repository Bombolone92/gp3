const pptxRuns = (doc) =>
  [...doc.getElementsByTagNameNS("*", "r")].map((run) => ({
    text: run.getElementsByTagNameNS("*", "t")[0].textContent,
    lang: run.getElementsByTagNameNS("*", "rPr")[0].getAttribute("lang"),
  }));
const pptxParagraphs = (doc) =>
  [...doc.getElementsByTagNameNS("*", "p")].map(pptxRuns);

test("PPTX titles and notes preserve authored object, passage and table cell languages", async () => {
  const b = board("Bilingual board");
  const frame = item("frame", 0, 0, {
    w: 900,
    h: 620,
    text: "Hello bonjour",
    lang: "en-CA",
    textRuns: [{ start: 6, end: 13, style: { lang: "FR-ca" } }],
  });
  const note = item("note", 20, 70, {
    text: "Bonjour hello\nMerci",
    lang: "fr-CA",
    textRuns: [{ start: 8, end: 13, style: { lang: "en-GB", bold: true } }],
    parentId: frame.id,
  });
  const table = item("table", 20, 300, {
    cells: [["Bonjour", "hello"], ["", "Salut 😀"]],
    lang: "de",
    cellLanguages: {
      "0,0": { lang: "fr" },
      "0,1": { lang: "en-GB" },
      "1,1": {
        lang: "fr-CA",
        textRuns: [{ start: 6, end: 8, style: { lang: "es" } }],
      },
    },
    parentId: frame.id,
  });
  const image = item("image", 400, 70, {
    src: png,
    alt: "Schéma & <rôles>",
    lang: "fr-CA",
    parentId: frame.id,
  });
  const file = item("file", 400, 300, {
    fileName: "rapport.pdf",
    data: "data:application/octet-stream;base64,",
    lang: "fr",
    parentId: frame.id,
  });
  b.items = [frame, note, table, image, file];
  validateBoard(b);
  const original = structuredClone(b);
  for (const lang of ["en", "fr"]) {
    const entries = readZip(await blobBytes(await exportPPTX(
      b,
      exportRegions(b, { scope: "frames" }),
      { lang, rasterizer },
    )));
    const text = checkPackage(entries);
    assert.deepEqual(pptxRuns(parseXML(text("ppt/slides/slide1.xml"))), [
      { text: "Hello ", lang: "en-CA" },
      { text: "bonjour", lang: "fr-CA" },
    ]);
    assert.deepEqual(pptxParagraphs(parseXML(text("ppt/notesSlides/notesSlide1.xml"))), [
      [
        { text: "Bonjour ", lang: "fr-CA" },
        { text: "hello", lang: "en-GB" },
      ],
      [{ text: "Merci", lang: "fr-CA" }],
      [{ text: "Schéma & <rôles>", lang: "fr-CA" }],
      [
        { text: "Bonjour", lang: "fr" },
        { text: " | ", lang: "de" },
        { text: "hello", lang: "en-GB" },
      ],
      [
        { text: "| ", lang: "de" },
        { text: "Salut ", lang: "fr-CA" },
        { text: "😀", lang: "es" },
      ],
      [{ text: "rapport.pdf", lang: "fr" }],
    ]);
    assert.deepEqual(b, original, "export does not mutate authored metadata");
  }
});

test("PPTX note language ranges follow CRLF, tabs, trimming and export limits", async () => {
  const b = board("Whitespace");
  const text = "  Début\tHello\r\n\tbonjour  \rFin\r\n\r\n";
  const start = text.indexOf("Hello");
  b.items = [item("note", 0, 0, {
    text,
    lang: "fr",
    textRuns: [{ start, end: text.indexOf("bonjour") + 7, style: { lang: "en-GB" } }],
  })];
  validateBoard(b);
  const region = exportRegions(b)[0];
  const { regionNotes } = await import(EXPORT_PPTX_IMPORT);
  assert.deepEqual(regionNotes(region), ["Début | Hello", "| bonjour", "Fin"]);
  let entries = readZip(await blobBytes(await exportPPTX(b, [region], { rasterizer })));
  let xmlText = checkPackage(entries);
  assert.deepEqual(pptxParagraphs(parseXML(xmlText("ppt/notesSlides/notesSlide1.xml"))), [
    [{ text: "Début | ", lang: "fr" }, { text: "Hello", lang: "en-GB" }],
    [{ text: "| bonjour", lang: "en-GB" }],
    [{ text: "Fin", lang: "fr" }],
  ]);
  const long = "a".repeat(1999) + "bonjour";
  b.items = [item("note", 0, 0, {
    text: long + "\n" + Array.from({ length: 501 }, (_, n) => `line ${n}`).join("\n"),
    lang: "fr",
    textRuns: [{ start: 1999, end: 2006, style: { lang: "en" } }],
  })];
  validateBoard(b);
  entries = readZip(await blobBytes(await exportPPTX(b, exportRegions(b), { rasterizer })));
  xmlText = checkPackage(entries);
  const paragraphs = pptxParagraphs(parseXML(xmlText("ppt/notesSlides/notesSlide1.xml")));
  assert.equal(paragraphs.length, 500);
  assert.deepEqual(paragraphs[0], [
    { text: "a".repeat(1999), lang: "fr" },
    { text: "b", lang: "en" },
  ]);
  assert.equal(paragraphs.at(-1)[0].text, "line 498");
});

test("PPTX untagged content and generated titles retain the interface language fallback", async () => {
  const b = board("Plain board");
  b.items = [item("note", 0, 0, { text: "Legacy text", textRuns: [{start:0,end:6,style:{bold:true}}] })];
  for (const lang of ["en", "fr"]) {
    for (const regions of [exportRegions(b), exportRegions(b, {scope:"selection",selection:new Set([b.items[0].id])})]) {
      const entries = readZip(await blobBytes(await exportPPTX(b, regions, { lang, rasterizer })));
      const text = checkPackage(entries), expected = lang === "fr" ? "fr-CA" : "en-CA";
      assert.deepEqual(pptxRuns(parseXML(text("ppt/slides/slide1.xml"))), [{text:regions[0].name,lang:expected}]);
      assert.deepEqual(pptxRuns(parseXML(text("ppt/notesSlides/notesSlide1.xml"))), [{text:"Legacy text",lang:expected}]);
    }
  }
});
