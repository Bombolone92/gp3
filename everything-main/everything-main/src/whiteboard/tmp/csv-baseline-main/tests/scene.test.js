import test from "node:test";
import assert from "node:assert/strict";
import { item, board, validateBoard, bounds } from "../src/model.js";
import {
  descendants,
  group,
  ungroup,
  createFrame,
  moveItems,
  connectObjects,
  updateConnectors,
  duplicateItems,
  inferMovedParents,
  removeItems,
  frameItems,
  safeURL,
  alignItems,
  layoutUnits,
  layoutMoves,
  reorderItems,
} from "../src/scene.js";
import { TEMPLATE_CATALOG, fromTemplate } from "../src/templates.js";

test("alignment preserves spacing inside groups and frames", () => {
  for (const container of ["group", "frame"]) {
    const items = [item("note", 200, 100), item("note", 450, 160)];
    const members = new Set(items.map((i) => i.id));
    if (container === "group") group(items, members);
    else createFrame(items, members);
    const first = items.find((i) => i.type === "note");
    const second = items.filter((i) => i.type === "note")[1];
    const offset = { x: second.x - first.x, y: second.y - first.y };
    const other = item("rect", 0, 0);
    items.push(other);
    alignItems(items, new Set(items.map((i) => i.id)), "left");
    assert.equal(
      Math.min(...items.filter((i) => i !== other).map((i) => i.x)),
      0,
    );
    assert.deepEqual({ x: second.x - first.x, y: second.y - first.y }, offset);
    assert.equal(other.x, 0);
  }
});

test("groups move atomically and ungroup without changing content", () => {
  const items = [item("note", 10, 20), item("rect", 220, 20)];
  group(items, new Set(items.map((i) => i.id)));
  moveItems(items, new Set([items[0].id]), 35, 50);
  assert.deepEqual(
    items.map((i) => [i.x, i.y]),
    [
      [45, 70],
      [255, 70],
    ],
  );
  ungroup(items, new Set([items[0].id]));
  assert.equal(descendants(items, new Set([items[0].id])).size, 1);
});
test("frames are logical containers whose content moves and duplicates with remapped membership", () => {
  const items = [
      item("note", 10, 70),
      item("table", 220, 70, { cells: [["A", "B"]] }),
    ],
    children = new Set(items.map((i) => i.id));
  const frame = createFrame(items, children, "Planning");
  assert.equal(frameItems(items, frame.id).size, 3);
  const prior = items.map((i) => [i.x, i.y]);
  moveItems(items, new Set([frame.id]), 100, 200);
  items.forEach((i, n) =>
    assert.deepEqual([i.x, i.y], [prior[n][0] + 100, prior[n][1] + 200]),
  );
  const copies = duplicateItems(items, new Set([frame.id]));
  assert.equal(copies.size, 3);
  const copiedFrame = items.find((i) => copies.has(i.id) && i.type === "frame");
  assert.equal(items.filter((i) => i.parentId === copiedFrame.id).length, 2);
  assert.equal(removeItems(items, new Set([frame.id])).length, 3);
});
test("attached connectors follow movement and resizing and clone their endpoints", () => {
  const items = [
    item("rect", 0, 0, { w: 100, h: 100 }),
    item("rect", 300, 0, { w: 100, h: 100 }),
  ];
  const first = items[0],
    second = items[1],
    line = connectObjects(items, new Set([first.id, second.id]));
  assert.deepEqual([line.x, line.y, line.w, line.h], [100, 50, 200, 0]);
  moveItems(items, new Set([second.id]), 100, 0);
  assert.equal(line.w, 300);
  first.w = 200;
  updateConnectors(items);
  assert.equal(line.x, 200);
  assert.equal(line.w, 200);
  const copies = duplicateItems(items, new Set(items.map((i) => i.id)));
  const cloned = items.find((i) => copies.has(i.id) && i.type === "arrow");
  assert.ok(copies.has(cloned.startId) && copies.has(cloned.endId));
  assert.ok(
    !removeItems(items, new Set([first.id])).some((i) => i.id === line.id),
  );
});
test("every specialist template is valid, bilingual, and uses actual editable containers", () => {
  assert.ok(TEMPLATE_CATALOG.length >= 40);
  for (const lang of ["en", "fr"])
    for (const def of TEMPLATE_CATALOG) {
      const b = fromTemplate(def.id, lang);
      assert.equal(validateBoard(b), b);
      assert.ok(b.items.length >= 4);
      assert.equal(b.title, def.name[lang === "fr" ? 1 : 0]);
      if (def.id !== "mindmap") assert.ok(b.items.some((i) => i.parentId));
    }
});
test("links, tables, attachments, and relationship imports are validated", () => {
  assert.equal(safeURL("javascript:alert(1)"), null);
  assert.equal(safeURL("https://example.com"), "https://example.com/");
  for (const i of [
    item("link", 0, 0, { url: "javascript:alert(1)" }),
    item("table", 0, 0, { cells: [["a"], ["b", "c"]] }),
    item("file", 0, 0, {
      fileName: "x.html",
      data: "data:text/html;base64,abcd",
    }),
    item("note", 0, 0, { parentId: "missing" }),
  ]) {
    const b = board();
    b.items = [i];
    assert.throws(() => validateBoard(b));
  }
});

test("all six alignments use outer bounds, including reverse arrows", () => {
  for (const mode of ["left", "center", "right", "top", "middle", "bottom"]) {
    const a = item("rect", -100, -80, { w: 40, h: 60 });
    const b = item("arrow", 160, 140, { w: -60, h: -40 });
    const items = [a, b];
    const before = structuredClone(items);
    alignItems(items, new Set(items.map((i) => i.id)), mode);
    const boxes = items.map((i) => bounds([i]));
    const coordinate = (box) =>
      ({
        left: box.x,
        center: box.x + box.w / 2,
        right: box.x + box.w,
        top: box.y,
        middle: box.y + box.h / 2,
        bottom: box.y + box.h,
      })[mode];
    assert.equal(coordinate(boxes[0]), coordinate(boxes[1]));
    assert.equal(coordinate(boxes[0]), coordinate(bounds(before)));
    items.forEach((i, n) => {
      assert.equal(i.w, before[n].w);
      assert.equal(i.h, before[n].h);
      assert.equal(
        ["top", "middle", "bottom"].includes(mode) ? i.x : i.y,
        ["top", "middle", "bottom"].includes(mode) ? before[n].x : before[n].y,
      );
    });
    assert.equal(
      layoutMoves(items, new Set(items.map((i) => i.id)), mode).length,
      0,
    );
  }
});

test("distribution keeps endpoints fixed and gives unequal-size objects equal gaps on either axis", () => {
  for (const mode of ["horizontal", "vertical"]) {
    for (const overlap of [false, true]) {
      const step = overlap ? 20 : 200;
      const items = [
        item("rect", -100, -100, { w: 80, h: 50 }),
        item("rect", -90, -90, { w: 120, h: 90 }),
        item("rect", -80, -80, { w: 60, h: 70 }),
        item("rect", step, step, { w: 40, h: 30 }),
      ];
      const before = structuredClone(items);
      alignItems(items, new Set(items.map((i) => i.id)), mode);
      assert.deepEqual(items[0], before[0]);
      assert.deepEqual(items.at(-1), before.at(-1));
      const axis = mode === "horizontal" ? "x" : "y";
      const size = mode === "horizontal" ? "w" : "h";
      const gaps = items
        .slice(1)
        .map((i, n) => i[axis] - items[n][axis] - items[n][size]);
      assert.ok(gaps.every((gap) => Math.abs(gap - gaps[0]) < 1e-9));
    }
  }
});

test("layout treats connected group/frame relationships atomically and updates connectors once", () => {
  const items = [item("note", 100, 80), item("note", 320, 120)];
  const first = items[0],
    second = items[1];
  const frame = createFrame(items, new Set([first.id]));
  group(items, new Set([first.id, second.id]));
  const outside = item("rect", 900, 300),
    far = item("rect", 1400, 600);
  items.push(outside, far);
  const arrow = connectObjects(items, new Set([first.id, outside.id]));
  const ids = new Set(items.map((i) => i.id));
  assert.equal(layoutUnits(items, ids).length, 3);
  const relative = [
    first.x - frame.x,
    first.y - frame.y,
    second.x - first.x,
    second.y - first.y,
  ];
  alignItems(items, ids, "middle");
  assert.deepEqual(
    [
      first.x - frame.x,
      first.y - frame.y,
      second.x - first.x,
      second.y - first.y,
    ],
    relative,
  );
  const snapshot = structuredClone(arrow);
  updateConnectors(items);
  assert.deepEqual(arrow, snapshot);
  assert.equal(layoutMoves(items, new Set([arrow.id]), "horizontal").length, 0);
  assert.equal(
    layoutMoves(items, new Set([outside.id, far.id]), "horizontal").length,
    0,
  );
});

test("layer actions preserve selected order, skip frames, respect groups, and stop at stack boundaries", () => {
  const items = ["a", "b", "c", "d", "e"].map((id) =>
    item("note", 0, 0, { id }),
  );
  const ids = new Set(["b", "c"]);
  const names = (items) =>
    items
      .filter((i) => i.type !== "frame")
      .map((i) => i.id)
      .join("");
  assert.equal(names(reorderItems(items, ids, "front")), "adebc");
  assert.equal(names(reorderItems(items, ids, "back")), "bcade");
  assert.equal(names(reorderItems(items, ids, "forward")), "adbce");
  assert.equal(names(reorderItems(items, ids, "backward")), "bcade");
  assert.equal(
    names(reorderItems(items, new Set(["b", "d"]), "forward")),
    "acbed",
  );
  assert.equal(reorderItems(items, new Set(["e"]), "front"), items);
  assert.equal(reorderItems(items, new Set(["a"]), "backward"), items);
  assert.equal(reorderItems(items, new Set(), "front"), items);
  group(items, ids);
  const frame = item("frame", 0, 0);
  items.splice(2, 0, frame);
  const result = reorderItems(items, new Set(["b"]), "front");
  assert.equal(names(result), "adebc");
  assert.equal(result[2], frame);
  assert.equal(reorderItems(items, new Set([frame.id]), "front"), items);
  assert.equal(names(items), "abcde");
});

test("moved objects join the frame they land in unless their own frame moved too", () => {
  const f = item("frame", 0, 0, { w: 300, h: 200 }),
    g = item("frame", 1000, 0, { w: 300, h: 300 }),
    child = item("note", 250, 20, { w: 100, h: 100, parentId: f.id }),
    loose = item("note", 1100, 100, { w: 100, h: 100 });
  const items = [f, g, child, loose];
  // The frame, its child reaching past its edge, and a loose note moved
  // together: the note lands in the other frame; the child stays.
  inferMovedParents(items, new Set([f.id, child.id, loose.id]));
  assert.equal(loose.parentId, g.id);
  assert.equal(child.parentId, f.id);
  assert.equal(f.parentId, undefined);
  // Moved on its own out of every frame, the child leaves its frame.
  child.x = 500;
  inferMovedParents(items, new Set([child.id]));
  assert.equal(child.parentId, undefined);
});
