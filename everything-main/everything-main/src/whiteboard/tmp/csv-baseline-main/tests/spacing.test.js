import test from "node:test";
import assert from "node:assert/strict";
import { item } from "../src/model.js";
import { createSnapIndex, snapMove } from "../src/snapping.js";
import { spacingIndex, spacingMatch } from "../src/spacing.js";

const box = (x, y, w = 80, h = 80) => ({ x, y, w, h });
const spacing = (result) => result.guides.filter((g) => g.kind === "spacing");
const transpose = (b) => box(b.y, b.x, b.h, b.w);
const indexFor = (boxes, options) =>
  createSnapIndex(
    boxes.map((b) => item("rect", b.x, b.y, b)),
    new Set(),
    options,
  );

test("unequal objects snap to equal gaps between neighbors on both axes", () => {
  for (const vertical of [false, true]) {
    const transform = vertical ? transpose : (b) => b;
    const index = indexFor([box(0, 0), box(320, 10, 120)].map(transform));
    const moving = transform(box(0, 15, 60, 50));
    const result = snapMove(
      index,
      moving,
      vertical ? 0 : 168,
      vertical ? 168 : 0,
      1,
    );
    assert.equal(vertical ? result.dy : result.dx, 170);
    assert.deepEqual(
      spacing(result).map((g) => [g.axis, g.from, g.to, g.gap]),
      [
        [vertical ? "y" : "x", 80, 170, 90],
        [vertical ? "y" : "x", 230, 320, 90],
      ],
    );
    assert.ok(
      spacing(result).every((g) => g.position >= 15 && g.position <= 65),
    );
  }
});

test("spacing extends rows and columns before or after an existing unequal pair", () => {
  for (const vertical of [false, true])
    for (const before of [false, true]) {
      const transform = vertical ? transpose : (b) => b;
      const index = indexFor([box(0, 0), box(140, 0, 120)].map(transform));
      const intended = before ? -120 : 320;
      const result = snapMove(
        index,
        transform(box(0, 0, 60)),
        vertical ? 0 : intended - 3,
        vertical ? intended - 3 : 0,
        1,
      );
      assert.equal(vertical ? result.dy : result.dx, intended);
      assert.equal(spacing(result).length, 2);
      assert.ok(
        spacing(result).every((g) => g.gap === 60 && g.to - g.from === 60),
      );
    }
});

test("spacing tolerance stays in screen pixels and the closer edge snap keeps priority", () => {
  const index = indexFor([box(0, 0), box(300, 0, 80)]);
  for (const zoom of [0.15, 0.5, 1, 3]) {
    const inside = snapMove(index, box(0, 0, 60), 600 + 5 / zoom, 0, zoom);
    assert.equal(inside.dx, 600);
    assert.equal(spacing(inside).length, 2);
    const outside = snapMove(index, box(0, 0, 60), 600 + 7 / zoom, 0, zoom);
    assert.equal(outside.dx, 600 + 7 / zoom);
    assert.equal(spacing(outside).length, 0);
  }
  const conflict = indexFor([box(0, 0), box(140, 0, 120), box(318, 300)]);
  const closerEdge = snapMove(conflict, box(0, 0, 60), 317, 0, 1);
  assert.equal(closerEdge.dx, 318);
  assert.equal(spacing(closerEdge).length, 0);
  assert.deepEqual(snapMove(index, box(0, 0, 60), 597, 0, 1, true), {
    dx: 597,
    dy: 0,
    guides: [],
  });
});

test("only immediate visible neighbors in the same lane suggest gaps, never overlapping targets", () => {
  const tree = spacingIndex([
    box(0, 0),
    box(140, 0, 100),
    box(348, 0),
    box(300, 300),
  ]);
  assert.equal(
    spacingMatch(tree, box(294, 0, 50), 0, 6),
    null,
    "Do not extend into the next object",
  );
  assert.equal(
    spacingMatch(
      spacingIndex([box(0, 0, 200), box(150, 0, 150)]),
      box(400, 0),
      0,
      6,
    ),
    null,
  );
  assert.equal(
    spacingMatch(
      spacingIndex([box(0, 0), box(140, 100)]),
      box(320, 0, 60),
      0,
      6,
    ),
    null,
  );
  assert.equal(
    spacingMatch(spacingIndex([box(0, 0), box(80, 0)]), box(160, 0), 0, 6),
    null,
    "Zero gaps use edge alignment",
  );
  const hidden = indexFor([box(0, 0), box(140, 0, 120)], box(130, 0, 500, 100));
  assert.equal(spacing(snapMove(hidden, box(0, 0, 60), 317, 0, 1)).length, 0);
  const blocked = spacingIndex([box(0, 0), box(140, 0, 120), box(275, 0, 10)]);
  assert.equal(
    spacingMatch(blocked, box(317, 0, 60), 0, 6),
    null,
    "An intervening object interrupts the pattern",
  );
});

test("fixed groups use their outer bounds; selections, paths and connectors do not become spacing targets", () => {
  const a = item("note", 0, 0, { w: 30, h: 80, groupId: "a" });
  const b = item("rect", 50, 0, { w: 30, h: 80, groupId: "a" });
  const c = item("note", 140, 0, { w: 50, h: 80, groupId: "b", locked: true });
  const d = item("rect", 230, 0, { w: 30, h: 80, groupId: "b", locked: true });
  const moving = item("note", 315, 0, { w: 60, h: 80 });
  const connector = item("arrow", 275, 0, { w: 10, h: 80 });
  const drawing = item("pen", 285, 0, {
    w: 10,
    h: 80,
    points: [
      [0, 0],
      [10, 80],
    ],
  });
  const index = createSnapIndex(
    [a, b, c, d, moving, connector, drawing],
    new Set([moving.id]),
  );
  const result = snapMove(index, moving, 2, 0, 1);
  assert.equal(result.dx, 5);
  assert.deepEqual(
    spacing(result).map((g) => [g.from, g.to]),
    [
      [80, 140],
      [260, 320],
    ],
  );
});

test("large-board spacing lookup prunes unrelated lanes and does not create quadratic pairs", () => {
  const boxes = Array.from({ length: 5000 }, (_, n) =>
    box((n % 100) * 140, Math.floor(n / 100) * 140),
  );
  const tree = spacingIndex(boxes);
  let nodes = 0,
    inspected = 0;
  const instrument = (node) => {
    nodes++;
    if (node.boxes)
      node.boxes = new Proxy(node.boxes, {
        get(target, key) {
          if (/^\d+$/.test(String(key))) inspected++;
          return target[key];
        },
      });
    else node.children.forEach(instrument);
  };
  instrument(tree);
  assert.ok(nodes < boxes.length, `Linear index size: ${nodes}`);
  const match = spacingMatch(tree, box(14000 - 3, 20 * 140), 0, 6);
  assert.equal(match.delta, 3);
  assert.equal(match.gap, 60);
  assert.ok(
    inspected < 100,
    `Inspect local neighbors, not all 5,000 targets: ${inspected}`,
  );
});

test("overlapping obstacles suppress misleading gap guides while background frames do not", () => {
  const targets = [box(0, 0, 100), box(150, 0, 100)];
  assert.equal(
    spacingMatch(
      spacingIndex([...targets, box(130, 0, 50)]),
      box(297, 0, 60),
      0,
      6,
    ),
    null,
  );
  const frame = item("frame", -100, -100, { w: 600, h: 400 });
  const index = createSnapIndex(
    [...targets.map((b) => item("note", b.x, b.y, b)), frame],
    new Set(),
  );
  const result = snapMove(index, box(0, 0, 60), 297, 0, 1);
  assert.equal(result.dx, 300);
  assert.equal(spacing(result).length, 2);
});

test("group bounds include free drawings and exclude attached connections", () => {
  const group = [
    item("rect", 0, 0, { w: 60, h: 80, groupId: "a" }),
    item("pen", 70, 0, {
      w: 30,
      h: 80,
      groupId: "a",
      points: [
        [0, 0],
        [30, 80],
      ],
    }),
    item("arrow", 0, 0, { w: 500, h: 500, groupId: "a", startId: "attached" }),
    item("rect", 150, 0, { w: 100, h: 80 }),
  ];
  const result = snapMove(
    createSnapIndex(group, new Set()),
    box(0, 0, 60),
    297,
    0,
    1,
  );
  assert.equal(result.dx, 300);
  assert.deepEqual(
    spacing(result).map((g) => [g.from, g.to]),
    [
      [100, 150],
      [250, 300],
    ],
  );
});

test("equally close spacing targets remain stable when stacking order changes", () => {
  const boxes = [
    box(0, 0, 80, 40),
    box(140, 60, 120, 40),
    box(0, 60, 80, 40),
    box(140, 0, 120, 40),
  ];
  const first = snapMove(indexFor(boxes), box(0, 0, 60, 100), 317, 0, 1);
  const reordered = snapMove(
    indexFor([...boxes].reverse()),
    box(0, 0, 60, 100),
    317,
    0,
    1,
  );
  assert.equal(first.dx, 320);
  assert.deepEqual(spacing(first), spacing(reordered));
  assert.ok(spacing(first).every((g) => g.position === 20));
});
