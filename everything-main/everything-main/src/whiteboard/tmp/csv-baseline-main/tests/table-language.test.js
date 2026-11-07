import test from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { board, item, validateBoard } from "../src/model.js";
import { SharedDocument, rebase } from "../src/collaboration/document.js";
import {
  tableCellContent,
  tableLanguagePatch,
  tableTextContent,
} from "../src/table-language.js";
import { mergeTableDraft } from "../src/table-draft.js";
const table = () =>
  item("table", 0, 0, {
    lang: "en-CA",
    cells: [["Begin. Bonjour. End.", "English"]],
    cellLanguages: {
      "0,0": {
        lang: "en-GB",
        textRuns: [{ start: 7, end: 15, style: { lang: "fr-CA" } }],
      },
    },
  });
const document = (i) => ({ ...board(), items: [i] });
test("cell languages validate bounds, tags, Unicode and language-only ranges while legacy tables remain valid", () => {
  const b = document(table());
  validateBoard(b);
  const failures = [
    { "20,0": { lang: "fr" } },
    { "0,2": { lang: "fr" } },
    { "00,0": { lang: "fr" } },
    { "0,0": { lang: "bad tag" } },
    { "0,0": { textRuns: [{ start: 0, end: 50, style: { lang: "fr" } }] } },
    { "0,0": { textRuns: [{ start: 0, end: 5, style: { bold: true } }] } },
    { "0,0": { text: "wrong" } },
  ];
  for (const cellLanguages of failures)
    assert.throws(() => validateBoard(document({ ...table(), cellLanguages })));
  assert.throws(() =>
    validateBoard(
      document({
        ...table(),
        cells: [["😀", "English"]],
        cellLanguages: {
          "0,0": { textRuns: [{ start: 0, end: 1, style: { lang: "fr" } }] },
        },
      }),
    ),
  );
  validateBoard(document({ ...table(), cellLanguages: undefined }));
  assert.throws(() =>
    validateBoard(document(item("note", 0, 0, { cellLanguages: {} }))),
  );
});
test("cell overrides remain distinct from table inheritance and follow row/column changes", () => {
  const i = table();
  assert.equal(tableCellContent(i, 0, 1).lang, "en-CA");
  assert.equal(tableCellContent(i, 0, 1, false).lang, undefined);
  assert.equal(tableCellContent({ ...i, lang: "es" }, 0, 0).lang, "en-GB");
  const patch = tableLanguagePatch(i, [["", ""], ...i.cells], {
    axis: "row",
    index: 0,
    remove: 0,
    insert: 1,
  });
  assert.deepEqual(patch.cellLanguages, { "1,0": i.cellLanguages["0,0"] });
  assert.equal(
    tableLanguagePatch({ ...i, ...patch }, [["", ""]], {
      axis: "row",
      index: 1,
      remove: 1,
      insert: 0,
    }).cellLanguages,
    undefined,
  );
  assert.deepEqual(
    tableLanguagePatch(i, [["", "Begin. Bonjour. End.", "English"]], {
      axis: "column",
      index: 0,
      remove: 0,
      insert: 1,
    }).cellLanguages,
    { "0,1": i.cellLanguages["0,0"] },
  );
  assert.equal(
    tableLanguagePatch(i, i.cells, undefined, { "0,0": {} }).cellLanguages,
    undefined,
  );
  assert.equal(tableTextContent(i).text, i.cells[0].join(" · "));
  assert.deepEqual(tableTextContent(i).textRuns, [
    { start: 0, end: 7, style: { lang: "en-GB" } },
    { start: 7, end: 15, style: { lang: "fr-CA" } },
    { start: 15, end: 20, style: { lang: "en-GB" } },
  ]);
});
test("shared modern and legacy cells preserve overrides and concurrent passage insertions with undo", () => {
  for (const legacy of [false, true]) {
    const a = new SharedDocument();
    a.commit(document(table()));
    const initial = a.snapshot();
    const id = initial.items[0].id;
    if (legacy)
      a.doc.transact(() => {
        const e = a.items.get(id);
        e.set("cells", structuredClone(initial.items[0].cells));
      });
    if (legacy) a.commit(initial);
    a.undo.clear();
    const b = new SharedDocument(a.update());
    try {
      const own = a.snapshot(),
        remote = b.snapshot();
      own.items[0].cellLanguages["0,1"] = { lang: "de" };
      remote.items[0].cells[0][0] = "Hi. " + remote.items[0].cells[0][0];
      remote.items[0].cellLanguages["0,0"].textRuns = [
        { start: 11, end: 19, style: { lang: "fr-CA" } },
      ];
      a.commit(own);
      b.commit(remote);
      a.apply(b.update());
      b.apply(a.update());
      assert.deepEqual(a.snapshot(), b.snapshot());
      assert.equal(a.snapshot().items[0].cellLanguages["0,1"].lang, "de");
      assert.equal(a.snapshot().items[0].cells[0][0].slice(11, 19), "Bonjour.");
      assert.equal(
        a.snapshot().items[0].cellLanguages["0,0"].textRuns[0].start,
        11,
      );
      a.validate();
      b.validate();
      a.undo.undo();
      assert.equal(a.snapshot().items[0].cellLanguages["0,1"], undefined);
      assert.equal(
        a.snapshot().items[0].cellLanguages["0,0"].textRuns[0].start,
        11,
      );
      const next = a.snapshot();
      Object.assign(
        next.items[0],
        tableLanguagePatch(next.items[0], [["", ""], ...next.items[0].cells], {
          axis: "row",
          index: 0,
          remove: 0,
          insert: 1,
        }),
      );
      a.commit(next);
      a.undo.undo();
      a.validate();
      assert.equal(
        a.snapshot().items[0].cellLanguages["0,0"].textRuns[0].start,
        11,
      );
      a.undo.redo();
      a.validate();
      assert.equal(
        a.snapshot().items[0].cellLanguages["1,0"].textRuns[0].start,
        11,
      );
      const e = a.items.get(id),
        cell = e.get("cells").get("1,0");
      a.doc.transact(() => cell.format(0, 1, { bold: true }));
      assert.throws(() => a.validate());
    } finally {
      a.destroy();
      b.destroy();
    }
  }
});
test("property drafts retain remote cell metadata and refuse conflicting edits without mutating either draft", () => {
  const old = table(),
    own = structuredClone(old),
    remote = structuredClone(old);
  own.cells[0][1] = "Local English";
  remote.cellLanguages["0,0"].lang = "en-US";
  const merged = mergeTableDraft(own, old, remote);
  assert.equal(merged.cellLanguages["0,0"].lang, "en-US");
  assert.equal(merged.cells[0][1], "Local English");
  remote.cellLanguages["0,1"] = { lang: "es" };
  assert.throws(() => mergeTableDraft(own, old, remote), /Reopen/);
  assert.equal(own.cells[0][1], "Local English");
  const result = rebase(document(own), document(old), document(remote))
    .items[0];
  assert.equal(result.cellLanguages["0,0"].lang, "en-US");
  assert.equal(result.cellLanguages["0,1"].lang, "es");
  validateBoard(document(result));
});

test("cell languages survive clipboard HTML, safe spreadsheet import, note conversion and quoted TSV", async () => {
  const { JSDOM } = await import("jsdom"),
    { createCanvas } = await import("./canvas.js"),
    { tableRangeClipboard } = await import("../src/table-cells.js"),
    { readTableContent, cellObjects, tableTSVContent, cellsText } =
      await import("../src/bulk-content.js"),
    { objectNameHTML } = await import("../src/accessibility/object-content.js");
  const dom = new JSDOM(""),
    doc = dom.window.document,
    i = table();
  try {
    const formats = tableRangeClipboard(
        i.cells,
        { r: 0, c: 0, rows: 1, cols: 2 },
        i,
      ),
      content = readTableContent(
        { getData: (type) => formats[type] || "" },
        doc,
      );
    assert.deepEqual(content.cells, i.cells);
    assert.deepEqual(content.cellLanguages, {
      "0,0": i.cellLanguages["0,0"],
      "0,1": { lang: "en-CA" },
    });
    const ctx = createCanvas(200, 200).getContext("2d"),
      notes = cellObjects(
        content.cells,
        "notes",
        { x: 0, y: 0 },
        ctx,
        undefined,
        content.cellLanguages,
      );
    assert.equal(notes[0].lang, "en-GB");
    assert.deepEqual(notes[0].textRuns, i.cellLanguages["0,0"].textRuns);
    assert.equal(notes[1].lang, "en-CA");
    const copied = cellObjects(
      content.cells,
      "table",
      { x: 0, y: 0 },
      ctx,
      undefined,
      content.cellLanguages,
    )[0];
    validateBoard(document(copied));
    const name = doc.createElement("div");
    name.innerHTML = objectNameHTML(i);
    assert.equal(name.querySelector('[lang="fr-CA"]').textContent, "Bonjour.");
    assert.equal(name.firstChild.nodeType, 3);
    const quoted = {
      ...i,
      cells: [['Begin. Bonjour. End.\n"quote"', "English"]],
    };
    const tsv = tableTSVContent(quoted);
    assert.equal(tsv.text, cellsText(quoted.cells));
    assert.ok(
      tsv.textRuns.some(
        (run) =>
          tsv.text.slice(run.start, run.end) === "Bonjour." &&
          run.style.lang === "fr-CA",
      ),
    );
    const imported = readTableContent(
      {
        getData: (type) =>
          type === "text/html"
            ? '<div lang="en-CA"><table><tr><td>Begin. <span lang="fr-ca">Bonjour.</span> End.<script>bad</script><img src="bad"></td><td lang="de">Guten Tag.</td></tr></table></div>'
            : "",
      },
      doc,
    );
    assert.deepEqual(imported.cellLanguages, {
      "0,0": {
        lang: "en-CA",
        textRuns: [{ start: 7, end: 15, style: { lang: "fr-CA" } }],
      },
      "0,1": { lang: "de" },
    });
    assert.equal(doc.querySelector("table,img,script"), null);
  } finally {
    dom.window.close();
  }
});
test("SVG cell and passage languages match the saved metadata across wrapping and default changes", async () => {
  const { JSDOM } = await import("jsdom"),
    { createCanvas } = await import("./canvas.js"),
    { exportSVG } = await import("../src/export-svg.js"),
    { exportRegions } = await import("../src/export.js");
  const i = table(),
    b = document(i),
    ctx = createCanvas(400, 300).getContext("2d");
  i.w = 240;
  i.h = 200;
  const read = () =>
    new JSDOM(exportSVG(b, exportRegions(b), { ctx }), {
      contentType: "image/svg+xml",
    });
  for (const tag of ["en-CA", "es"]) {
    i.lang = tag;
    const dom = read();
    try {
      const texts = [...dom.window.document.querySelectorAll("text")];
      assert.equal(
        texts
          .filter((n) => n.getAttribute("xml:lang") === "fr-CA")
          .map((n) => n.textContent)
          .join(""),
        "Bonjour.",
      );
      assert.equal(
        texts
          .filter((n) => n.getAttribute("xml:lang") === tag)
          .map((n) => n.textContent)
          .join(""),
        "English",
      );
      assert.ok(texts.some((n) => n.getAttribute("xml:lang") === "en-GB"));
    } finally {
      dom.window.close();
    }
  }
});
