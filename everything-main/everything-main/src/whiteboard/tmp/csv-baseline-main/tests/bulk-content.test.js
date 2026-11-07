import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCanvas } from "./canvas.js";
import { wrapText } from "../src/text.js";
import { clipboardFormats } from "../src/transfer.js";
import {
  parseCells,
  cellsText,
  readCells,
  bulkLines,
  pasteTable,
  cellObjects,
  tableHeight,
} from "../src/bulk-content.js";
import { fontStack } from "../src/fonts.js";

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
    assert.throws(
      () =>
        readCells(
          data({ "text/html": "<table></table><table></table>" }),
          dom.window.document,
        ),
      /one spreadsheet/,
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
    const height = tableHeight(cells, 300, ctx, 15, family);
    ctx.font = `400 15px ${fontStack(family)}`;
    const lines = wrapText(ctx, text, 150 - 18).length;
    // Each of the two rows takes the tallest cell's height.
    assert.equal(height, 2 * Math.max(75, lines * 15 * 1.35 + 18), family);
  }
  assert.ok(
    tableHeight(cells, 300, ctx, 15, "roboto-mono") >
      tableHeight(cells, 300, ctx, 15),
    "wider letters wrap to more lines",
  );
});
