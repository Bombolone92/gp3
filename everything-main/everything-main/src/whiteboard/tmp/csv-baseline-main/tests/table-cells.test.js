import test from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { board, item } from "../src/model.js";
import { SharedDocument, rebase } from "../src/collaboration/document.js";
import {
  tableCellAt,
  tableCellBox,
  tableRange,
  tableRangeClipboard,
  pasteTableRange,
  fillTableRange,
  mergeCellDraft,
  rebaseCells,
} from "../src/table-cells.js";

test("table cell hit testing, ranges and spreadsheet clipboard preserve geometry and literal content", () => {
  const i = item("table", -200, 100, {
    w: 300,
    h: 120,
    cells: [
      ["A", "B", "C"],
      ["<script>", "line\nbreak", "é"],
    ],
  });
  assert.deepEqual(tableCellAt(i, { x: -99, y: 170 }), { r: 1, c: 1 });
  assert.equal(tableCellAt(i, { x: 100, y: 160 }), null);
  assert.deepEqual(tableCellAt(i, { x: 400, y: 0 }, true), { r: 0, c: 2 });
  const range = tableRange({ r: 1, c: 2 }, { r: 0, c: 1 });
  assert.deepEqual(tableCellBox(i, range), { x: -100, y: 100, w: 200, h: 120 });
  const clipboard = tableRangeClipboard(i.cells, {
    r: 1,
    c: 0,
    rows: 1,
    cols: 2,
  });
  assert.equal(clipboard["text/plain"], '<script>\t"line\nbreak"');
  assert.ok(clipboard["text/html"].includes("&lt;script&gt;"));
  assert.deepEqual(fillTableRange(i.cells, range), [
    ["A", "", ""],
    ["<script>", "", ""],
  ]);
  assert.deepEqual(pasteTableRange(i.cells, [["X"]], range), [
    ["A", "X", "X"],
    ["<script>", "X", "X"],
  ]);
  assert.equal(i.cells[0][1], "B");
});

test("shared table cells merge independent and concurrent character edits and undo only local edits", () => {
  const b = board();
  b.items = [
    item("table", 0, 0, {
      cells: [
        ["Alpha", "Beta"],
        ["", ""],
      ],
    }),
  ];
  const a = new SharedDocument();
  a.commit(b);
  a.undo.clear();
  const remote = new SharedDocument(a.update());
  try {
    const initial = a.snapshot(),
      mine = structuredClone(initial),
      theirs = structuredClone(initial);
    mine.items[0].cells[0][0] += " Alice";
    theirs.items[0].cells[0][1] += " Bob";
    assert.deepEqual(rebase(mine, initial, theirs).items[0].cells[0], [
      "Alpha Alice",
      "Beta Bob",
    ]);
    a.commit(mine);
    remote.commit(theirs);
    a.apply(remote.update());
    remote.apply(a.update());
    assert.deepEqual(a.snapshot(), remote.snapshot());
    assert.deepEqual(a.snapshot().items[0].cells[0], [
      "Alpha Alice",
      "Beta Bob",
    ]);
    a.undo.undo();
    assert.deepEqual(a.snapshot().items[0].cells[0], ["Alpha", "Beta Bob"]);
    remote.apply(a.update());
    const left = a.snapshot(),
      right = remote.snapshot();
    left.items[0].cells[1][0] = "Left";
    right.items[0].cells[1][0] = "Right";
    a.commit(left);
    remote.commit(right);
    a.apply(remote.update());
    remote.apply(a.update());
    assert.deepEqual(a.snapshot(), remote.snapshot());
    assert.match(a.snapshot().items[0].cells[1][0], /Left/);
    assert.match(a.snapshot().items[0].cells[1][0], /Right/);
    a.validate();
    remote.validate();
  } finally {
    a.destroy();
    remote.destroy();
  }
});

test("legacy shared table arrays migrate on edit and structural changes remain coherent", () => {
  const b = board();
  b.items = [item("table", 0, 0, { cells: [["Old", "Value"]] })];
  const a = new SharedDocument();
  a.commit(b);
  try {
    const entry = a.items.get(b.items[0].id);
    a.doc.transact(() => entry.set("cells", [["Old", "Value"]]));
    a.validate();
    a.commit(b);
    assert.ok(
      Array.isArray(entry.get("cells")),
      "Unchanged legacy tables need no migration",
    );
    b.items[0].cells[0][0] = "New";
    a.commit(b);
    assert.ok(entry.get("cell:0,0") instanceof Y.Text);
    a.undo.clear();
    b.items[0].cells.push(["Row", "Two"]);
    a.commit(b);
    assert.deepEqual(a.snapshot().items[0].cells, b.items[0].cells);
    a.undo.undo();
    assert.deepEqual(a.snapshot().items[0].cells, [["New", "Value"]]);
    a.validate();
    entry.set("cell:25,0", new Y.Text("bad"));
    assert.throws(() => a.validate(), /shared object property/);
  } finally {
    a.destroy();
  }
});

test("simultaneous first edits to different cells in a legacy shared table both survive", () => {
  const b = board();
  b.items = [item("table", 0, 0, { cells: [["A", "B"]] })];
  const a = new SharedDocument();
  a.commit(b);
  a.doc.transact(() => a.items.get(b.items[0].id).set("cells", [["A", "B"]]));
  const other = new SharedDocument(a.update());
  try {
    const mine = a.snapshot(),
      theirs = other.snapshot();
    mine.items[0].cells[0][0] = "One";
    theirs.items[0].cells[0][1] = "Two";
    a.commit(mine);
    other.commit(theirs);
    a.apply(other.update());
    other.apply(a.update());
    assert.deepEqual(a.snapshot().items[0].cells, [["One", "Two"]]);
    assert.deepEqual(a.snapshot(), other.snapshot());
    a.validate();
    other.validate();
  } finally {
    a.destroy();
    other.destroy();
  }
});

test("table properties merge untouched remote cells and reject competing or structural drafts", () => {
  const before = [
      ["A", "B"],
      ["C", "D"],
    ],
    draft = [
      ["Mine", "B"],
      ["C", "D"],
    ],
    remote = [
      ["A", "Theirs"],
      ["C", "D"],
    ];
  assert.deepEqual(mergeCellDraft(draft, before, remote), [
    ["Mine", "Theirs"],
    ["C", "D"],
  ]);
  assert.throws(
    () =>
      mergeCellDraft(draft, before, [
        ["Conflict", "B"],
        ["C", "D"],
      ]),
    /table changed/,
  );
  assert.throws(
    () => mergeCellDraft([...draft, ["", ""]], before, remote),
    /table changed/,
  );
  assert.deepEqual(mergeCellDraft(before, before, remote), remote);
});

test("a cell edit rebased over rows or columns someone else added or removed keeps their table", () => {
  const before = [
    ["A", "B"],
    ["C", "D"],
    ["E", "F"],
  ];
  const local = structuredClone(before);
  local[1][1] = "Mine";
  // A row inserted above the edited one: the edit follows its row.
  assert.deepEqual(rebaseCells(local, before, [["new", "row"], ...before]), [
    ["new", "row"],
    ["A", "B"],
    ["C", "Mine"],
    ["E", "F"],
  ]);
  // A column inserted before the edited one: the edit follows its column.
  assert.deepEqual(
    rebaseCells(
      local,
      before,
      before.map((row) => [row[0], "", row[1]]),
    ),
    [
      ["A", "", "B"],
      ["C", "", "Mine"],
      ["E", "", "F"],
    ],
  );
  // The edited row was removed: their table stands.
  assert.deepEqual(rebaseCells(local, before, [before[0], before[2]]), [
    ["A", "B"],
    ["E", "F"],
  ]);
  // Rows and columns both changed: their table stands.
  const both = [
    ["A", "B", ""],
    ["", "", ""],
  ];
  assert.deepEqual(rebaseCells(local, before, both), both);
  // Rows that look alike cannot be told apart, so the edit is left out.
  const empty = [
    ["", ""],
    ["", ""],
  ];
  const typed = structuredClone(empty);
  typed[1][0] = "x";
  assert.deepEqual(rebaseCells(typed, empty, [["", ""], ...empty]), [
    ["", ""],
    ["", ""],
    ["", ""],
  ]);
  // A structure changed here still wins, as before.
  const grown = [...structuredClone(before), ["G", "H"]];
  assert.deepEqual(rebaseCells(grown, before, before), grown);
});
