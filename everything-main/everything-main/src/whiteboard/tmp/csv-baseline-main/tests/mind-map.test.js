import test from "node:test";
import assert from "node:assert/strict";
import { board, item, validateBoard } from "../src/model.js";
import { descendants, removeItems, duplicateItems } from "../src/scene.js";
import { planDuplication } from "../src/duplication.js";
import { selectionFragment, placeFragment } from "../src/transfer.js";
import {
  mindIndex,
  mindBranch,
  mindRoot,
  mindLayout,
  applyMindLayout,
  mindLines,
  repairMindTrees,
  mindNavigate,
} from "../src/mind-map.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { hasLocked } from "../src/locking.js";
import { paint } from "../src/render.js";
import { createCanvas } from "./canvas.js";
const fixture = () => board("Mind map", "mindmap");

test("mind map layout handles both axes and mixed branches without overlapping differently sized nodes", () => {
  const b = fixture(),
    [root, a, sibling, c] = b.items;
  const nested = item("rect", 0, 0, {
    w: 330,
    h: 140,
    text: "Nested",
    mindMap: { ...a.mindMap, parent: a.id },
  });
  b.items.push(nested);
  c.mindMap.direction = "left";
  applyMindLayout(b.items, root.id);
  assert.equal(root.x, 340);
  assert.equal(a.x, root.x + root.w + 80);
  assert.ok(c.x + c.w < root.x);
  assert.ok(a.y + a.h < sibling.y);
  assert.equal(nested.x, a.x + a.w + 80);
  const index = mindIndex(b.items);
  assert.equal(mindRoot(index, nested.id), root);
  assert.deepEqual([...mindBranch(index, a.id)], [a.id, nested.id]);
  assert.equal(mindNavigate(index, a.id, "ArrowRight"), nested);
  assert.equal(mindNavigate(index, nested.id, "ArrowLeft"), a);
  for (const i of b.items) i.mindMap.direction = "down";
  applyMindLayout(b.items, root.id);
  assert.equal(a.y, root.y + root.h + 80);
  assert.ok(a.x + a.w < sibling.x);
  assert.ok(nested.y > a.y + a.h);
  validateBoard(b);
});

test("mind map validation rejects malformed metadata, missing parents and cycles; shared projection repairs concurrent cycles deterministically", () => {
  for (const metadata of [
    null,
    {},
    { parent: null, direction: "sideways", auto: true, line: "curved" },
    {
      parent: null,
      direction: "right",
      auto: true,
      line: "curved",
      extra: true,
    },
  ]) {
    const b = fixture();
    b.items[0].mindMap = metadata;
    assert.throws(() => validateBoard(b), /mind map/);
  }
  const b = fixture(),
    [root, child] = b.items;
  root.mindMap.parent = child.id;
  assert.throws(() => validateBoard(b), /cycles/);
  const reverse = structuredClone(b.items).reverse();
  repairMindTrees(b.items);
  repairMindTrees(reverse);
  assert.deepEqual(
    new Map(b.items.map((i) => [i.id, i.mindMap])),
    new Map(reverse.map((i) => [i.id, i.mindMap])),
  );
  validateBoard(b);
  child.mindMap.parent = "missing";
  assert.throws(() => validateBoard(b), /parent/);
  repairMindTrees(b.items);
  assert.equal(child.mindMap.parent, null);
});

test("mind map copies remap a full hierarchy, partial branches detach, deletion and locks include descendants", () => {
  const b = fixture(),
    [root, child] = b.items;
  assert.equal(descendants(b.items, new Set([root.id])).size, 4);
  child.locked = true;
  assert.equal(hasLocked(b.items, new Set([root.id])), true);
  assert.throws(() => removeItems(b.items, new Set([root.id])), /Unlock/);
  delete child.locked;
  const copy = planDuplication(b.items, new Set([root.id]), {
    direction: "right",
  });
  assert.equal(copy.copies.length, 4);
  const copyRoot = copy.copies.find((i) => !i.mindMap.parent);
  assert.ok(
    copy.copies
      .filter((i) => i !== copyRoot)
      .every((i) => i.mindMap.parent === copyRoot.id),
  );
  const fragment = selectionFragment(b.items, new Set([child.id]));
  assert.equal(fragment[0].mindMap.parent, null);
  validateBoard({ ...b, items: placeFragment(fragment, { x: 0, y: 0 }) });
  const duplicates = duplicateItems(b.items, new Set([root.id]));
  assert.equal(duplicates.size, 4);
  validateBoard(b);
  assert.equal(removeItems(b.items, new Set([root.id])).length, 4);
});

test("shared mind maps retain independent branches, text, remote children on local undo, and repair deleted parents", () => {
  const b = fixture(),
    root = b.items[0];
  const a = new SharedDocument();
  a.commit(b);
  a.undo.clear();
  const remote = new SharedDocument(a.update());
  try {
    const mine = a.snapshot(),
      theirs = remote.snapshot();
    const left = item("rect", 0, 0, {
      text: "Alice",
      mindMap: { ...root.mindMap, parent: root.id },
    });
    const right = item("rect", 0, 0, {
      text: "Bob",
      mindMap: { ...root.mindMap, parent: root.id },
    });
    mine.items.push(left);
    theirs.items.push(right);
    a.commit(mine);
    remote.commit(theirs);
    a.apply(remote.update());
    remote.apply(a.update());
    assert.deepEqual(a.snapshot(), remote.snapshot());
    assert.equal(a.snapshot().items.length, 6);
    const merged = a.snapshot().items;
    assert.notEqual(
      merged.find((i) => i.id === left.id).y,
      merged.find((i) => i.id === right.id).y,
    );
    a.undo.undo();
    assert.ok(!a.snapshot().items.some((i) => i.id === left.id));
    assert.ok(a.snapshot().items.some((i) => i.id === right.id));
    remote.apply(a.update());
    const removed = a.snapshot();
    removed.items = removed.items.filter((i) => i.id !== root.id);
    // A raw remote parent deletion can race a branch creation. Projection detaches surviving children.
    a.doc.transact(() => a.items.delete(root.id));
    a.validate();
    remote.apply(a.update());
    remote.validate();
    assert.ok(remote.snapshot().items.every((i) => i.mindMap.parent === null));
  } finally {
    a.destroy();
    remote.destroy();
  }
});

test("concurrent mind map reassignment converges without a cyclic document", () => {
  const b = fixture(),
    [, x, y] = b.items;
  const a = new SharedDocument();
  a.commit(b);
  const other = new SharedDocument(a.update());
  try {
    const left = a.snapshot(),
      right = other.snapshot();
    left.items.find((i) => i.id === x.id).mindMap.parent = y.id;
    right.items.find((i) => i.id === y.id).mindMap.parent = x.id;
    a.commit(left);
    other.commit(right);
    a.apply(other.update());
    other.apply(a.update());
    a.validate();
    other.validate();
    assert.deepEqual(a.snapshot(), other.snapshot());
  } finally {
    a.destroy();
    other.destroy();
  }
});

test("deep 5,000-node maps use iterative layout and relationship traversal without reading text", () => {
  const rows = [];
  for (let n = 0; n < 5000; n++) {
    const i = item("rect", 0, 0, {
      id: String(n),
      w: 20,
      h: 20,
      mindMap: {
        parent: n ? String(n - 1) : null,
        direction: "right",
        auto: true,
        line: "curved",
      },
    });
    Object.defineProperty(i, "text", {
      get() {
        throw Error("Unrelated content read");
      },
    });
    rows.push(i);
  }
  rows.reverse();
  const plan = mindLayout(rows, "0");
  assert.equal(plan.size, 4999);
  assert.equal(plan.get("4999").x, 499900);
  assert.equal(descendants(rows, new Set(["0"])).size, 5000);
  assert.equal(mindLines(rows).length, 4999);
});

test("canvas raster includes derived mind map branches between nodes without storing connector objects", () => {
  const b = fixture();
  applyMindLayout(b.items, b.items[0].id);
  const [line] = mindLines(b.items);
  const canvas = createCanvas(1000, 700);
  const prior = {
    window: globalThis.window,
    document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle,
  };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  canvas.getBoundingClientRect = () => ({ width: 1000, height: 700 });
  try {
    paint(
      canvas,
      b.items,
      { x: 0, y: 0, z: 1 },
      { background: "#ffffff", dpr: 1 },
    );
    const data = canvas
      .getContext("2d")
      .getImageData(
        line.x + 10,
        Math.min(line.y, line.y + line.h) - 5,
        60,
        Math.abs(line.h) + 12,
      ).data;
    assert.ok(
      Array.from(data).some((v, n) => n % 4 !== 3 && v < 180),
      "Branch pixels exist in the gap between nodes",
    );
    assert.ok(b.items.every((i) => i.type !== "arrow"));
  } finally {
    for (const [k, v] of Object.entries(prior))
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
  }
});

test("manual branch placement survives later edits, while whole-map translation retains automatic layout", async () => {
  const { preserveManualMindMoves, autoLayoutMindMaps } =
    await import("../src/mind-map.js");
  const b = fixture();
  applyMindLayout(b.items, b.items[0].id);
  const before = structuredClone(b.items);
  for (const i of b.items) {
    i.x += 80;
    i.y -= 45;
  }
  preserveManualMindMoves(before, b.items);
  assert.equal(b.items[0].mindMap.auto, true);
  const translated = structuredClone(b.items);
  b.items[1].y += 300;
  preserveManualMindMoves(translated, b.items);
  assert.equal(b.items[0].mindMap.auto, false);
  const positions = b.items.map((i) => [i.x, i.y]);
  autoLayoutMindMaps(b.items);
  assert.deepEqual(
    b.items.map((i) => [i.x, i.y]),
    positions,
  );
  const fragment = selectionFragment(b.items, new Set([b.items[1].id]));
  assert.equal(fragment[0].mindMap.auto, false);
});

test("mind map commands guard capacity and protected layout changes and reorder siblings atomically", async () => {
  const { createMindMapUI } = await import("../src/mind-map-ui.js");
  const b = fixture();
  applyMindLayout(b.items, b.items[0].id);
  let selected = b.items[1].id,
    writes = 0,
    message = "",
    readonly = false;
  const ui = createMindMapUI({
    board: () => b,
    source: () => b.items.find((i) => i.id === selected),
    canEdit: (ids) => !readonly && !hasLocked(b.items, ids),
    finish() {},
    center: () => ({ x: 0, y: 0 }),
    mutate(fn) {
      writes++;
      fn();
    },
    select: (ids) => (selected = [...ids][0]),
    reveal() {},
    edit() {},
    focus() {},
    draw() {},
    toast: (text) => (message = text),
  });
  ui.reorder(1);
  assert.equal(writes, 1);
  assert.equal(mindIndex(b.items).children.get(b.items[0].id)[1].id, selected);
  const snapshot = structuredClone(b.items);
  b.items[2].locked = true;
  ui.layout("down");
  assert.equal(writes, 1);
  assert.deepEqual(
    b.items.map((i) => [i.x, i.y, i.mindMap]),
    snapshot.map((i) => [i.x, i.y, i.mindMap]),
  );
  delete b.items[2].locked;
  readonly = true;
  ui.add();
  assert.equal(writes, 1);
  readonly = false;
  while (b.items.length < 5000) b.items.push(item("note", 0, 0));
  ui.add();
  assert.equal(writes, 1);
  assert.equal(b.items.length, 5000);
  assert.match(message, /5,000/);
});

test("parent search pages 5,000 nodes with bounded DOM and refuses stale branch submissions", async () => {
  const { JSDOM } = await import("jsdom"),
    { createMindMapUI } = await import("../src/mind-map-ui.js");
  const dom = new JSDOM("<body></body>"),
    oldDocument = globalThis.document;
  globalThis.document = dom.window.document;
  const b = fixture(),
    selected = b.items[1].id;
  while (b.items.length < 5000)
    b.items.push(
      item("rect", 0, 0, {
        text: "Same idea",
        mindMap: {
          parent: null,
          direction: "right",
          auto: true,
          line: "curved",
        },
      }),
    );
  let writes = 0,
    message = "";
  const ui = createMindMapUI({
    board: () => b,
    source: () => b.items.find((i) => i.id === selected),
    finish() {},
    canEdit: () => true,
    mutate(fn) {
      writes++;
      fn();
    },
    select() {},
    reveal() {},
    edit() {},
    focus() {},
    draw() {},
    toast: (text) => (message = text),
    modal(title, html, ready) {
      const d = dom.window.document.createElement("dialog");
      d.innerHTML = html;
      dom.window.document.body.append(d);
      d.close = () => d.remove();
      ready(d);
    },
  });
  try {
    ui.moveDialog();
    const doc = dom.window.document;
    assert.equal(doc.querySelectorAll("[data-mind-parent]").length, 50);
    const first = doc.querySelector("[data-mind-parent]").dataset.mindParent;
    doc.querySelector("#mind-parent-next").click();
    assert.equal(doc.querySelectorAll("[data-mind-parent]").length, 50);
    assert.notEqual(
      doc.querySelector("[data-mind-parent]").dataset.mindParent,
      first,
    );
    assert.match(doc.querySelector("#mind-parent-count").textContent, /51–100/);
    doc.querySelector("input").value = "Same idea";
    doc.querySelector("input").dispatchEvent(new dom.window.Event("input"));
    assert.match(doc.querySelector("#mind-parent-count").textContent, /1–50/);
    b.items.find((i) => i.id === selected).mindMap.parent = null;
    doc.querySelector("[data-mind-parent]").click();
    assert.equal(writes, 0);
    assert.match(message, /changed/);
    assert.ok(doc.querySelector("dialog"));
  } finally {
    dom.window.close();
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  }
});
test("mind map arrows stay within a map and follow each branch side", () => {
  const node = (id, parent, direction = "right", order) => ({
    id,
    type: "note",
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    order,
    mindMap: { parent, direction, auto: true, line: "curved" },
  });
  const index = mindIndex([
    node("root", null),
    node("r1", "root", "right", 1),
    node("l1", "root", "left", 2),
    node("r2", "root", "right", 3),
    node("u1", "root", "up", 4),
    node("deep", "r1", "right", 1),
    node("other", null),
  ]);
  const go = (id, key) => mindNavigate(index, id, key)?.id ?? null;
  assert.equal(go("root", "ArrowRight"), "r1");
  assert.equal(go("root", "ArrowLeft"), "l1");
  assert.equal(go("root", "ArrowUp"), "u1");
  assert.equal(go("root", "ArrowDown"), null, "Never jumps to another map");
  assert.equal(go("r1", "ArrowDown"), "r2", "Siblings stay on their side");
  assert.equal(go("r2", "ArrowUp"), "r1");
  assert.equal(go("l1", "ArrowDown"), null);
  assert.equal(go("l1", "ArrowRight"), "root");
  assert.equal(go("u1", "ArrowDown"), "root");
  assert.equal(go("r1", "ArrowRight"), "deep");
  assert.equal(go("deep", "ArrowLeft"), "r1");
  assert.equal(go("root", "Enter"), null);
});

test("in a manual layout a new child appears beside its moved parent", async () => {
  const { createMindMapUI } = await import("../src/mind-map-ui.js");
  const b = fixture();
  const root = b.items[0];
  applyMindLayout(b.items, root.id);
  root.mindMap.auto = false;
  const parent = b.items[1];
  parent.x += 1500;
  parent.y += 900;
  let selected = parent.id,
    added;
  const ui = createMindMapUI({
    board: () => b,
    source: () => b.items.find((i) => i.id === selected),
    canEdit: () => true,
    finish() {},
    center: () => ({ x: 0, y: 0 }),
    mutate(fn) {
      fn();
    },
    select: (ids) => (selected = [...ids][0]),
    reveal() {},
    edit() {},
    focus() {},
    draw() {},
    toast() {},
  });
  const before = new Set(b.items.map((i) => i.id));
  ui.add();
  added = b.items.find((i) => !before.has(i.id));
  assert.equal(added.mindMap.parent, parent.id);
  const moved = b.items.find((i) => i.id === parent.id);
  assert.ok(
    Math.abs(added.x - (moved.x + moved.w)) < 300 &&
      Math.abs(added.y - moved.y) < 300,
    `the child at ${added.x},${added.y} is beside the parent at ${moved.x},${moved.y}`,
  );
});
