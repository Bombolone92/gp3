import test from "node:test";
import assert from "node:assert/strict";
import { board, item, validateBoard } from "../src/model.js";
import {
  tableTracks,
  tableLayout,
  resizeTableTracks,
  remapTableTracks,
} from "../src/table-layout.js";
import { tableCellAt, tableCellBox } from "../src/table-cells.js";
import { fitTableTracks, sizedTableCells } from "../src/table-sizing.js";
import { SharedDocument, rebase } from "../src/collaboration/document.js";
import { createResizePlan, applyResize } from "../src/resize.js";
import { createCanvas } from "./canvas.js";

const fixture = () =>
  item("table", 50, -100, {
    w: 600,
    h: 180,
    cells: [
      ["One", "Two", "Three"],
      ["A", "B", "C"],
    ],
  });
function resize(i, axis, n, size) {
  Object.assign(i, resizeTableTracks(i, axis, [n], size));
}

test("variable table tracks determine cell geometry and remain proportional through object resizing", () => {
  const i = fixture();
  resize(i, "column", 0, 300);
  resize(i, "row", 1, 150);
  assert.deepEqual(tableTracks(i, "column"), [300, 200, 200]);
  assert.deepEqual(tableTracks(i, "row"), [90, 150]);
  assert.deepEqual(tableCellAt(i, { x: 349, y: 10 }), { r: 1, c: 0 });
  assert.deepEqual(tableCellAt(i, { x: 350, y: 10 }), { r: 1, c: 1 });
  assert.equal(tableCellAt(i, { x: 750, y: 10 }), null);
  assert.deepEqual(tableCellBox(i, { r: 1, c: 1, rows: 1, cols: 2 }), {
    x: 350,
    y: -10,
    w: 400,
    h: 150,
  });
  const plan = createResizePlan([i], new Set([i.id]));
  applyResize([i], plan, 1400, 480, { scaleText: false });
  assert.deepEqual(tableTracks(i, "column"), [600, 400, 400]);
  assert.deepEqual(tableTracks(i, "row"), [180, 300]);
  assert.equal(tableLayout(i).x.at(-1), i.w);
});

test("table sizing rejects malformed data and out-of-range dimensions while retaining legacy tables", () => {
  const b = board();
  b.items = [fixture()];
  validateBoard(b);
  for (const sizes of [
    [],
    [10, 20],
    [0, 20, 30],
    [NaN, 20, 30],
    [-5, 20, 30],
    [1e7, 20, 30],
  ]) {
    b.items[0].columnWidths = sizes;
    assert.throws(() => validateBoard(b), /table dimensions/);
  }
  b.items[0].columnWidths = [100, 200, 300];
  validateBoard(b);
  assert.throws(
    () => resizeTableTracks(b.items[0], "column", [0], 1e6),
    /limits/,
  );
  assert.throws(() => resizeTableTracks(b.items[0], "row", [9], 40), /valid/);
  assert.throws(() => resizeTableTracks(b.items[0], "row", [0], 0), /valid/);
  b.items[0].type = "rect";
  assert.throws(() => validateBoard(b), /table dimensions/);
});

test("structural edits preserve matching track sizes and content fitting grows only edited rows", () => {
  const i = fixture();
  resize(i, "column", 0, 300);
  resize(i, "row", 1, 150);
  let cells = i.cells.map((row) => [row[0], "", ...row.slice(1)]);
  let patch = remapTableTracks(i, cells, {
    axis: "column",
    index: 1,
    insert: 1,
  });
  assert.deepEqual(patch.columnWidths, [300, 200, 200, 200]);
  assert.deepEqual(patch.rowHeights, [90, 150]);
  const ctx = createCanvas(10, 10).getContext("2d");
  Object.assign(i, patch, { cells });
  cells = [i.cells[0], ["New\n".repeat(20), "", "B", "C"]];
  patch = sizedTableCells(i, cells, ctx);
  assert.equal(patch.rowHeights[0], 90);
  assert.ok(patch.rowHeights[1] > 400);
  assert.deepEqual(patch.columnWidths, [300, 200, 200, 200]);
  const fitted = fitTableTracks(i, "column", [0], ctx);
  assert.ok(fitted.columnWidths[0] < 100);
  assert.equal(fitted.columnWidths[1], 200);
});

for (const legacy of [false, true])
  test(`concurrent first row and column resizing merges each track and undo retains remote sizes (${legacy ? "legacy" : "modern"})`, () => {
    const b = board();
    b.items = [fixture()];
    const a = new SharedDocument();
    a.commit(b);
    if (legacy)
      a.doc.transact(() =>
        a.items.get(b.items[0].id).set("cells", b.items[0].cells),
      );
    a.undo.clear();
    const other = new SharedDocument(a.update());
    other.undo.clear();
    try {
      const mine = a.snapshot(),
        theirs = other.snapshot();
      resize(mine.items[0], "column", 0, 300);
      resize(theirs.items[0], "column", 1, 400);
      resize(theirs.items[0], "row", 1, 160);
      a.commit(mine);
      other.commit(theirs);
      a.apply(other.update());
      other.apply(a.update());
      assert.deepEqual(a.snapshot(), other.snapshot());
      assert.deepEqual(
        tableTracks(a.snapshot().items[0], "column"),
        [300, 400, 200],
      );
      assert.equal(a.snapshot().items[0].w, 900);
      a.undo.undo();
      assert.deepEqual(
        tableTracks(a.snapshot().items[0], "column"),
        [200, 400, 200],
      );
      assert.deepEqual(tableTracks(a.snapshot().items[0], "row"), [90, 160]);
      a.validate();
      other.validate();
    } finally {
      a.destroy();
      other.destroy();
    }
  });

test("queued table resizes retain remote track and cell edits; structural replacement keeps dimensions coherent", () => {
  const before = board();
  before.items = [fixture()];
  const mine = structuredClone(before),
    remote = structuredClone(before);
  resize(mine.items[0], "column", 0, 300);
  resize(remote.items[0], "column", 1, 400);
  remote.items[0].cells[1][1] = "Remote";
  let merged = rebase(mine, before, remote);
  assert.deepEqual(tableTracks(merged.items[0], "column"), [300, 400, 200]);
  assert.equal(merged.items[0].cells[1][1], "Remote");
  validateBoard(merged);
  remote.items[0].cells.forEach((row) => row.push("New"));
  remote.items[0].columnWidths.push(100);
  remote.items[0].w += 100;
  merged = rebase(mine, before, remote);
  validateBoard(merged);
  assert.deepEqual(
    tableTracks(merged.items[0], "column"),
    [200, 400, 200, 100],
  );
});

test("shared structural replacement and whole-object scaling carry custom sizes through undo and cell edits", () => {
  const b = board();
  b.items = [fixture()];
  resize(b.items[0], "column", 0, 300);
  const doc = new SharedDocument();
  doc.commit(b);
  doc.undo.clear();
  try {
    let next = doc.snapshot();
    const i = next.items[0];
    i.w *= 2;
    i.h *= 2;
    doc.commit(next);
    assert.deepEqual(
      tableTracks(doc.snapshot().items[0], "column"),
      [600, 400, 400],
    );
    next = doc.snapshot();
    next.items[0].cells[0][2] = "Edited";
    doc.commit(next);
    assert.deepEqual(
      tableTracks(doc.snapshot().items[0], "column"),
      [600, 400, 400],
    );
    next = doc.snapshot();
    const cells = next.items[0].cells.map((row) => row.slice(1));
    Object.assign(
      next.items[0],
      remapTableTracks(next.items[0], cells, {
        axis: "column",
        index: 0,
        remove: 1,
      }),
      { cells },
    );
    doc.commit(next);
    doc.validate();
    assert.deepEqual(
      tableTracks(doc.snapshot().items[0], "column"),
      [400, 400],
    );
    doc.undo.undo();
    doc.validate();
    assert.deepEqual(
      tableTracks(doc.snapshot().items[0], "column"),
      [600, 400, 400],
    );
  } finally {
    doc.destroy();
  }
});

test("shared table sizes reject forged dimensions and bound concurrent extreme resizes", () => {
  const b = board();
  b.items = [fixture()];
  const a = new SharedDocument();
  a.commit(b);
  const other = new SharedDocument(a.update());
  try {
    const mine = a.snapshot(),
      theirs = other.snapshot();
    resize(mine.items[0], "column", 0, 800000);
    resize(theirs.items[0], "column", 1, 800000);
    a.commit(mine);
    other.commit(theirs);
    a.apply(other.update());
    other.apply(a.update());
    assert.deepEqual(a.snapshot(), other.snapshot());
    assert.equal(a.snapshot().items[0].w, 1e6);
    a.validate();
    assert.equal(rebase(mine, b, theirs).items[0].w, 1e6);
    const map = a.items.get(b.items[0].id).get("cells");
    for (const [key, value] of [
      ["column:3", 100],
      ["column:0", -10],
      ["row:0", "100"],
      ["row:99", 10],
    ]) {
      const old = map.get(key);
      map.set(key, value);
      assert.throws(() => a.validate());
      if (old === undefined) map.delete(key);
      else map.set(key, old);
    }
  } finally {
    a.destroy();
    other.destroy();
  }
});

test("structural replacement discards stale resize indices and undo restores its prior matrix", () => {
  const b = board();
  b.items = [fixture()];
  const a = new SharedDocument();
  a.commit(b);
  a.undo.clear();
  const other = new SharedDocument(a.update());
  try {
    const mine = a.snapshot(),
      theirs = other.snapshot();
    resize(mine.items[0], "column", 0, 300);
    a.commit(mine);
    const i = theirs.items[0],
      cells = i.cells.map((row) => row.slice(1));
    Object.assign(
      i,
      remapTableTracks(i, cells, { axis: "column", index: 0, remove: 1 }),
      { cells },
    );
    other.commit(theirs);
    a.apply(other.update());
    other.apply(a.update());
    assert.deepEqual(a.snapshot(), other.snapshot());
    assert.deepEqual(tableTracks(a.snapshot().items[0], "column"), [200, 200]);
    other.undo.undo();
    assert.deepEqual(
      tableTracks(other.snapshot().items[0], "column"),
      [200, 200, 200],
    );
    other.validate();
  } finally {
    a.destroy();
    other.destroy();
  }
});
