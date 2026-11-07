import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCanvas } from "./canvas.js";
import { wrapText } from "../src/text.js";
import { clipboardFormats } from "../src/transfer.js";
import {
  createBulkContent,
  parseCells,
  cellsText,
  readCells,
  bulkLines,
  pasteTable,
  cellObjects,
  tableHeight,
} from "../src/bulk-content.js";
import { fontStack } from "../src/fonts.js";
import { board } from "../src/model.js";
import { language, setLanguage } from "../src/i18n.js";

const data = (formats) => ({ getData: (type) => formats[type] || "" });

test("spreadsheet TSV preserves quotes, multiline cells, empty positions and terminal newlines", () => {
  const text =
    'Name\tDescription\t\r\n"Ada"\t"First\r\nSecond \"\"quote\"\"\tend"\t\r\n';
  const cells = [
    ["Name", "Description", ""],
    ["Ada", 'First\nSecond "quote"\tend', ""],
  ];
  assert.deepEqual(parseCells(text), cells);
  assert.deepEqual(parseCells(cellsText(cells)), cells);
  assert.deepEqual(parseCells("a\tb\n\t\n"), [
    ["a", "b"],
    ["", ""],
  ]);
  assert.deepEqual(parseCells("a\tb\nc"), [
    ["a", "b"],
    ["c", ""],
  ]);
  assert.deepEqual(parseCells('"line\n"'), [["line\n"]]);
  assert.deepEqual(parseCells("\t"), [["", ""]]);
  for (const range of [[["A"], [""]], [[""], [""]], [[""]]])
    assert.deepEqual(parseCells(cellsText(range)), range);
  assert.throws(() => parseCells('"unfinished\tvalue'), /quotes/);
  assert.throws(() => parseCells('"closed"oops\tvalue'), /quotes/);
});

test("inert HTML tables preserve single-column and merged-cell layouts without executing markup", () => {
  const dom = new JSDOM("", {
    runScripts: "dangerously",
    url: "https://whiteboard.test",
  });
  try {
    const cells = readCells(
      data({
        "text/html":
          '<table><tr><th colspan="2">Heading</th></tr><tr><td rowspan="2"><b>A</b><br>B<img src="https://example.com/x" onerror="window.bad=1"><script>window.bad=2</script></td><td>&lt;script&gt;literal&lt;/script&gt;</td></tr><tr><td>=SUM(A1:A2)</td></tr></table>',
      }),
      dom.window.document,
    );
    assert.deepEqual(cells, [
      ["Heading", ""],
      ["A\nB", "<script>literal</script>"],
      ["", "=SUM(A1:A2)"],
    ]);
    assert.equal(dom.window.bad, undefined);
    assert.equal(dom.window.document.querySelector("table,img,script"), null);
    assert.deepEqual(
      readCells(
        data({
          "text/html":
            "<table><tr><td><div>One</div><div>Two<br></div></td><td><p>Only</p></td></tr></table>",
        }),
        dom.window.document,
      ),
      [["One\nTwo\n", "Only"]],
    );
    assert.deepEqual(
      readCells(
        data({
          "text/html":
            "<table><tr><td>One</td></tr><tr><td>Two</td></tr></table>",
        }),
        dom.window.document,
      ),
      [["One"], ["Two"]],
    );
    assert.equal(
      readCells(data({ "text/plain": "Ordinary\nprose" }), dom.window.document),
      null,
    );
    assert.equal(
      readCells(
        data({ "text/html": "<b>Rich prose</b>", "text/plain": "Rich prose" }),
        dom.window.document,
      ),
      null,
    );
    assert.throws(
      () =>
        readCells(
          data({
            "text/html": '<table><tr><td colspan="101">wide</td></tr></table>',
          }),
          dom.window.document,
        ),
      /100 columns/,
    );
    // Two tables are no spreadsheet range: without tabbed text, no cells.
    assert.equal(
      readCells(
        data({ "text/html": "<table></table><table></table>" }),
        dom.window.document,
      ),
      null,
    );
  } finally {
    dom.window.close();
  }
});

test("HTML with several tables or a nested table is pasted as its text", () => {
  const dom = new JSDOM("");
  try {
    const doc = dom.window.document;
    const page = data({
      "text/html":
        "<p>Intro</p><table><tr><td>a</td><td>b</td></tr></table><table><tr><td>c</td></tr></table>",
      "text/plain": "Intro\na\tb\nc",
    });
    assert.deepEqual(readCells(page, doc), [
      ["Intro", ""],
      ["a", "b"],
      ["c", ""],
    ]);
    const nested = data({
      "text/html":
        "<table><tr><td>Outer<table><tr><td>Inner</td></tr></table></td></tr></table>",
      "text/plain": "Outer Inner",
    });
    assert.equal(readCells(nested, doc), null);
    assert.deepEqual(
      readCells(
        data({
          "text/html": "<table><tr><td>a</td><td>b</td></tr></table>",
          "text/plain": "a\tb",
        }),
        doc,
      ),
      [["a", "b"]],
    );
  } finally {
    dom.window.close();
  }
});

test("tab stops in Word or web text stay text; spreadsheet tables and plain TSV become cells", () => {
  const dom = new JSDOM("");
  try {
    const doc = dom.window.document,
      word = "<html><body><p class=MsoNormal>Body</p></body></html>";
    // Word writes list markers and tab stops into its plain text.
    for (const plain of [
      '\u2022\t"Tell us once" for address changes\r\n\u2022\tPublish a guide\r\n',
      Array.from({ length: 60 }, (_, n) => `${n + 1}.\tAction ${n + 1}`).join(
        "\r\n",
      ),
      "\u2022\tReduce wait times",
    ])
      assert.equal(
        readCells(data({ "text/html": word, "text/plain": plain }), doc),
        null,
      );
    // Plain text alone is still a range, and a malformed one is reported.
    assert.deepEqual(readCells(data({ "text/plain": "a\tb\nc\td" }), doc), [
      ["a", "b"],
      ["c", "d"],
    ]);
    assert.throws(
      () => readCells(data({ "text/plain": 'Note\t"Quoted" text' }), doc),
      /quotes/,
    );
    // Excel and Google Sheets describe the range as an HTML table.
    const rows = Array.from({ length: 3 }, (_, n) => [`Item ${n}`, `${n}`]);
    assert.deepEqual(
      readCells(
        data({
          "text/html": `<table>${rows.map((row) => `<tr>${row.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</table>`,
          "text/plain": rows.map((row) => row.join("\t")).join("\r\n"),
        }),
        doc,
      ),
      rows,
    );
    assert.throws(
      () =>
        readCells(
          data({
            "text/html": `<table>${"<tr><td>a</td><td>b</td></tr>".repeat(51)}</table>`,
            "text/plain": Array(51).fill("a\tb").join("\n"),
          }),
          doc,
        ),
      /50 rows/,
    );
  } finally {
    dom.window.close();
  }
});

test("bulk limits fail explicitly and accept the maximum spreadsheet range", () => {
  const cells = parseCells(
    Array.from({ length: 50 }, () => Array(100).fill("cell").join("\t")).join(
      "\n",
    ),
  );
  assert.equal(cells.flat().length, 5000);
  assert.throws(() => parseCells(Array(51).fill("a\tb").join("\n")), /50 rows/);
  assert.throws(
    () => parseCells(Array(101).fill("a").join("\t")),
    /100 columns/,
  );
  assert.throws(() => parseCells("x".repeat(1_000_001)), /1 million/);
  assert.deepEqual(bulkLines("First\r\n\n  \n Second \nThird", 2), [
    ["First", " Second "],
    ["Third"],
  ]);
  assert.equal(bulkLines(Array(5000).fill("idea").join("\n"), 10).length, 500);
  assert.throws(() => bulkLines(Array(5001).fill("idea").join("\n")), /5,000/);
});

test("table range replacement expands atomically, preserves neighbors, and rejects overflow", () => {
  const original = [
    ["keep", "old"],
    ["below", "also old"],
  ];
  assert.deepEqual(
    pasteTable(
      original,
      [
        ["new", "right"],
        ["next", "last"],
      ],
      1,
      1,
    ),
    [
      ["keep", "old", ""],
      ["below", "new", "right"],
      ["", "next", "last"],
    ],
  );
  assert.deepEqual(original, [
    ["keep", "old"],
    ["below", "also old"],
  ]);
  assert.throws(() => pasteTable(original, [["a", "b"]], 0, 11), /12 columns/);
  assert.throws(() => pasteTable(original, [["a"], ["b"]], 19, 0), /20 rows/);
  assert.throws(
    () => pasteTable(original, [["x".repeat(2001)]], 0, 0),
    /2,000/,
  );
});

test("imported notes and tables expose all text with no overlapping rows and round-trip TSV", () => {
  const ctx = createCanvas(1, 1).getContext("2d");
  const cells = [
    ["A", "long text ".repeat(100)],
    ["", "D"],
  ];
  const notes = cellObjects(
    cells,
    "notes",
    { x: -500, y: -300 },
    ctx,
    "#dce5f7",
  );
  assert.deepEqual(
    notes.map((i) => i.text),
    cells.flat(),
  );
  assert.equal(notes[0].x, -500);
  assert.equal(notes[1].y, -300);
  assert.equal(notes[2].y, notes[3].y);
  assert.ok(notes[2].y >= notes[1].y + notes[1].h + 24);
  assert.ok(notes.every((i) => i.color === "#dce5f7"));
  ctx.font = '400 19px "DM Sans", system-ui, sans-serif';
  assert.ok(
    notes[1].h >= wrapText(ctx, notes[1].text, 158).length * 19 * 1.35 + 32,
  );
  const table = cellObjects(
    [["Tab\tcell", 'Quote " and\nline']],
    "table",
    { x: 0, y: 0 },
    ctx,
  )[0];
  assert.deepEqual(
    parseCells(clipboardFormats([table])["text/plain"]),
    table.cells,
  );
  assert.throws(
    () => cellObjects([["x".repeat(20001)]], "notes", { x: 0, y: 0 }, ctx),
    /20,000/,
  );
  assert.throws(
    () => cellObjects([["x".repeat(2001)]], "table", { x: 0, y: 0 }, ctx),
    /2,000/,
  );
});

test("a table's height fits its text in the table's own font", () => {
  const ctx = createCanvas(10, 10).getContext("2d");
  const text =
    "A long sentence that wraps across many lines inside one narrow table cell to show how wide each font is.";
  const cells = [
    ["Heading", "Other"],
    [text, ""],
  ];
  for (const family of ["dm-sans", "roboto-mono", "eb-garamond"]) {
    const height = tableHeight(cells, 300, ctx, { fontFamily: family });
    ctx.font = `400 15px ${fontStack(family)}`;
    const lines = wrapText(ctx, text, 150 - 18).length;
    // Each of the two rows takes the tallest cell's height.
    assert.equal(height, 2 * Math.max(75, lines * 15 * 1.35 + 18), family);
  }
  assert.ok(
    tableHeight(cells, 300, ctx, { fontFamily: "roboto-mono" }) >
      tableHeight(cells, 300, ctx),
    "wider letters wrap to more lines",
  );
});

for (const locale of ["en", "fr"])
  for (const spreadsheet of [false, true])
    for (const length of [178, 179, 180])
      test(`bulk previews retain complete Unicode at ${length} characters for ${spreadsheet ? "cells" : "ideas"} in ${locale}`, () => {
        const dom = new JSDOM('<body><canvas id="canvas"></canvas></body>'),
          previous = globalThis.document,
          previousLanguage = language;
        globalThis.document = dom.window.document;
        try {
          setLanguage(locale);
          const value = board(),
            text = "Q".repeat(length) + "😀",
            cells = [[text]],
            metadata = {
              "0,0": {
                lang: "fr-CA",
                textRuns: [
                  { start: length, end: length + 2, style: { lang: "en-GB" } },
                ],
              },
            },
            original = structuredClone({ value, cells, metadata });
          let inserts = 0;
          const ui = createBulkContent({
            board: () => value,
            canAdd: () => true,
            center: () => ({ x: 0, y: 0 }),
            insert() {
              inserts++;
            },
            modal(_title, content, ready) {
              const dialog = document.createElement("dialog");
              dialog.innerHTML = content;
              dialog.open = true;
              dialog.close = () => dialog.remove();
              document.body.append(dialog);
              ready(dialog);
              return dialog;
            },
          });
          ui.open(
            spreadsheet ? cells : undefined,
            undefined,
            undefined,
            spreadsheet ? metadata : undefined,
          );
          if (!spreadsheet) {
            const field = document.querySelector("#bulk-ideas");
            field.value = text;
            field.dispatchEvent(
              new dom.window.Event("input", { bubbles: true }),
            );
          }
          const preview = document.querySelector(".bulk-preview > div");
          assert.equal(
            preview.textContent,
            "Q".repeat(length) + (length === 178 ? "😀" : ""),
          );
          assert.equal(preview.textContent.isWellFormed(), true);
          if (spreadsheet) {
            assert.equal(
              preview.querySelector("[data-user-content]").lang,
              "fr-CA",
            );
            assert.equal(
              preview.querySelector('[lang="en-GB"]')?.textContent,
              length === 178 ? "😀" : undefined,
            );
          }
          document.querySelector("#bulk-cancel").click();
          assert.equal(inserts, 0);
          assert.deepEqual({ value, cells, metadata }, original);
        } finally {
          setLanguage(previousLanguage);
          globalThis.document = previous;
          dom.window.close();
        }
      });
