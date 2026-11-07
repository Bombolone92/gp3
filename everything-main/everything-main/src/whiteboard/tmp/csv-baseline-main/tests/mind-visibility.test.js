import test from "node:test";
import assert from "node:assert/strict";
import {
  board,
  item,
  validateBoard,
  hitTest,
  resizeBounds,
} from "../src/model.js";
import {
  mindVisibility,
  visibleMindItems,
  mindAncestors,
} from "../src/mind-visibility.js";
import { createMindView } from "../src/mind-view.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { exportRegions } from "../src/export.js";
import { minimapScene } from "../src/minimap.js";
import { selectionFragment } from "../src/transfer.js";
import { removeItems } from "../src/scene.js";
import { planMindReparent } from "../src/mind-map-drag.js";

function fixture() {
  const b = board("Collapse", "mindmap");
  const [root, a, sibling] = b.items;
  const nested = item("rect", 1400, 800, {
    text: "Nested",
    mindMap: { ...a.mindMap, parent: a.id },
  });
  b.items.push(nested);
  return { b, root, a, sibling, nested };
}

test("nested collapse hides nodes, connections and active anchored comments without changing data", () => {
  const { b, root, a, nested } = fixture();
  const arrow = item("arrow", 0, 0, { startId: nested.id, endId: root.id });
  b.items.push(arrow);
  a.mindCollapsed = true;
  const comments = [
    { anchorId: nested.id, messages: [{ deleted: false }] },
    { anchorId: arrow.id, messages: [{ deleted: false }] },
    { anchorId: nested.id, messages: [{ deleted: false }], resolved: true },
    { anchorId: nested.id, messages: [{ deleted: true }] },
    { anchorId: a.id, messages: [{ deleted: false }] },
  ];
  const before = structuredClone(b);
  let scene = mindVisibility(b.items, comments);
  assert.equal(scene.hidden.get(nested.id), a.id);
  assert.equal(scene.hidden.get(arrow.id), a.id);
  assert.deepEqual(scene.counts.get(a.id), { nodes: 1, comments: 2, total: 3 });
  assert.deepEqual(b, before);
  root.mindCollapsed = true;
  scene = mindVisibility(b.items, comments);
  assert.deepEqual(scene.visible, [root]);
  assert.deepEqual(scene.counts.get(root.id), {
    nodes: 4,
    comments: 3,
    total: 7,
  });
  assert.equal(scene.counts.has(a.id), false);
  root.mindCollapsed = false;
  assert.equal(mindVisibility(b.items).hidden.get(nested.id), a.id);
  assert.deepEqual(mindAncestors(b.items, nested.id), [a, root]);
});

test("collapsed geometry is excluded from hit testing, selection bounds, minimap and visual exports, while copies and backups retain it", () => {
  const { b, root, nested } = fixture();
  root.mindCollapsed = true;
  const ids = new Set(b.items.map((i) => i.id));
  assert.equal(hitTest(b.items, { x: nested.x + 10, y: nested.y + 10 }), null);
  assert.deepEqual(resizeBounds(b.items, ids), {
    x: root.x,
    y: root.y,
    w: root.w,
    h: root.h,
  });
  assert.equal(minimapScene(b.items).entries.length, 1);
  assert.equal(exportRegions(b)[0].items.length, 1);
  assert.equal(exportRegions(b)[0].mindCounts.get(root.id).nodes, 4);
  assert.equal(exportRegions(b, { includeHidden: true })[0].items.length, 5);
  const frame = item("frame", nested.x - 10, nested.y - 10, { w: 500, h: 300 });
  nested.parentId = frame.id;
  b.items.push(frame);
  assert.deepEqual(
    exportRegions(b, { scope: "frames", frameIds: [frame.id] })[0].items.map(
      (i) => i.id,
    ),
    [frame.id],
  );
  const copied = selectionFragment(b.items, new Set([root.id]));
  assert.equal(copied.length, 5);
  assert.equal(copied[0].mindCollapsed, true);
  assert.equal(removeItems(b.items, new Set([root.id])).length, 1);
  validateBoard(b);
  root.mindCollapsed = "yes";
  assert.throws(() => validateBoard(b), /collapse/);
  delete root.mindCollapsed;
  frame.mindCollapsed = true;
  assert.throws(() => validateBoard(b), /collapse/);
});

test("collapse and concurrent reassignment use independent shared fields, including undo", () => {
  const { b, a, sibling, nested } = fixture();
  const left = new SharedDocument();
  left.commit(b);
  left.undo.clear();
  const right = new SharedDocument(left.update());
  try {
    const mine = left.snapshot(),
      theirs = right.snapshot();
    mine.items.find((i) => i.id === a.id).mindCollapsed = true;
    theirs.items.find((i) => i.id === a.id).mindMap.parent = sibling.id;
    theirs.items.find((i) => i.id === nested.id).text = "Remote draft";
    left.commit(mine);
    right.commit(theirs);
    left.apply(right.update());
    right.apply(left.update());
    assert.deepEqual(left.snapshot(), right.snapshot());
    let node = left.snapshot().items.find((i) => i.id === a.id);
    assert.equal(node.mindCollapsed, true);
    assert.equal(node.mindMap.parent, sibling.id);
    left.undo.undo();
    node = left.snapshot().items.find((i) => i.id === a.id);
    assert.equal(!!node.mindCollapsed, false);
    assert.equal(node.mindMap.parent, sibling.id);
    assert.equal(
      left.snapshot().items.find((i) => i.id === nested.id).text,
      "Remote draft",
    );
  } finally {
    left.destroy();
    right.destroy();
  }
});

test("viewer expansion is local, editing stays visible through remote collapse, and explicit reveal opens the full path", () => {
  const { b, root, a, nested } = fixture();
  root.mindCollapsed = a.mindCollapsed = true;
  let readOnly = true,
    editing,
    writes = 0;
  const ui = createMindView({
    board: () => b,
    readOnly: () => readOnly,
    editing: () => editing,
    redraw() {},
    persist(fn) {
      writes++;
      fn();
    },
  });
  assert.equal(ui.scene().visible.length, 1);
  const cached = ui.scene();
  assert.equal(ui.scene(), cached);
  ui.toggle(root.id);
  assert.equal(ui.scene().visible.length, 4);
  assert.equal(root.mindCollapsed, true);
  ui.reveal(nested.id);
  assert.equal(ui.scene().visible.length, 5);
  assert.equal(writes, 0);
  assert.equal(
    exportRegions({ ...b, items: ui.scene().items })[0].items.length,
    5,
    "Visual exports use the viewer's current expansion",
  );
  assert.equal(
    exportRegions(b)[0].items.length,
    1,
    "Shared board data keeps its own collapse state",
  );
  readOnly = false;
  assert.equal(
    ui.scene().visible.length,
    1,
    "Viewer overrides do not modify shared editor state",
  );
  editing = nested.id;
  assert.equal(ui.scene().visible.length, 5);
  assert.equal(writes, 0);
  editing = null;
  assert.equal(ui.scene().visible.length, 1);
  ui.reveal(nested.id);
  assert.equal(ui.scene().visible.length, 5);
  assert.equal(writes, 1);
  assert.equal(root.mindCollapsed, false);
  assert.equal(a.mindCollapsed, false);
});

test("reassigning into a collapsed parent opens the destination in the same atomic plan", () => {
  const { b, root, a, sibling } = fixture();
  root.mindCollapsed = true;
  sibling.mindCollapsed = true;
  const plan = planMindReparent(b, a.id, sibling.id);
  assert.equal(
    plan.items.find((i) => i.id === sibling.id).mindCollapsed,
    false,
  );
  assert.ok(plan.patch.some((i) => i.id === sibling.id));
  assert.equal(plan.items.find((i) => i.id === root.id).mindCollapsed, false);
  assert.ok(plan.patch.some((i) => i.id === root.id));
  assert.equal(sibling.mindCollapsed, true);
});

test("5,000-node collapse, count and ancestor traversal remain iterative and avoid text/assets", () => {
  const items = Array.from({ length: 5000 }, (_, n) => ({
    id: String(n),
    type: "rect",
    x: n,
    y: n,
    w: 1,
    h: 1,
    mindCollapsed: n === 0,
    mindMap: { parent: n ? String(n - 1) : null },
  }));
  for (const i of items)
    for (const key of ["text", "src", "points"])
      Object.defineProperty(i, key, {
        get() {
          throw Error("Content read");
        },
      });
  const scene = mindVisibility(items.reverse());
  assert.equal(scene.visible.length, 1);
  assert.equal(scene.counts.get("0").nodes, 4999);
  assert.equal(mindAncestors(items, "4999").length, 4999);
  assert.equal(visibleMindItems(items).length, 1);
  items.find((i) => i.id === "0").mindMap.parent = "4999";
  assert.doesNotThrow(() => mindVisibility(items));
});

test("native raster omits hidden branches and paints the collapsed count in scoped exports", async () => {
  const { paint } = await import("../src/render.js");
  const { createCanvas } = await import("./canvas.js");
  const root = item("rect", 50, 100, {
    w: 150,
    h: 60,
    mindCollapsed: true,
    color: "#dce5f7",
    text: "Root",
    mindMap: {
      parent: null,
      direction: "right",
      auto: false,
      line: "straight",
    },
  });
  const child = item("rect", 350, 100, {
    w: 150,
    h: 60,
    text: "Hidden",
    mindMap: { ...root.mindMap, parent: root.id },
  });
  const b = { title: "Raster", items: [root, child] };
  const [region] = exportRegions(b);
  const canvas = createCanvas(600, 300);
  const prior = {
    window: globalThis.window,
    document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle,
  };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  canvas.getBoundingClientRect = () => ({ width: 600, height: 300 });
  try {
    paint(
      canvas,
      region.items,
      { x: 0, y: 0, z: 1 },
      { background: "#ffffff", mindCounts: region.mindCounts },
    );
    const ctx = canvas.getContext("2d");
    assert.ok(
      Array.from(ctx.getImageData(230, 90, 280, 85).data).every(
        (v) => v === 255,
      ),
      "Neither hidden child nor its branch is drawn",
    );
    const badge = ctx.getImageData(
      root.x + root.w - 12,
      root.y - 12,
      24,
      24,
    ).data;
    assert.ok(
      Array.from(badge).some((v, n) => n % 4 !== 3 && v < 180),
      "Scoped rendering retains the hidden count",
    );
  } finally {
    for (const [key, value] of Object.entries(prior))
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
  }
});

test("tidying a collapsed map fits visible nodes without expanding hidden descendants", async () => {
  const { createMindMapUI } = await import("../src/mind-map-ui.js");
  const { b, root } = fixture();
  root.mindCollapsed = true;
  let revealed;
  const ui = createMindMapUI({
    board: () => b,
    source: () => root,
    canEdit: () => true,
    finish() {},
    mutate: (fn) => fn(),
    select() {},
    reveal: (box) => {
      revealed = box;
    },
    focus() {},
    toast: (message) => assert.fail(message),
  });
  ui.layout("down");
  assert.deepEqual(revealed, { x: root.x, y: root.y, w: root.w, h: root.h });
  assert.equal(root.mindCollapsed, true);
});
