import test from "node:test";
import assert from "node:assert/strict";
import { item, bounds } from "../src/model.js";
import { createSnapIndex, snapMove, snapResize } from "../src/snapping.js";

test("snapping aligns edges and centers with a constant six-screen-pixel tolerance", () => {
  const fixed = item("rect", 300, 200, { w: 100, h: 80 });
  const index = createSnapIndex([fixed], new Set());
  const box = { x: 0, y: 0, w: 100, h: 80 };
  for (const zoom of [0.15, 0.5, 1, 3]) {
    // Use the rightmost edge to avoid overlapping candidate ranges at low zoom.
    const result = snapMove(index, box, 400 + 5 / zoom, 280 + 5 / zoom, zoom);
    assert.equal(result.dx, 400);
    assert.equal(result.dy, 280);
    assert.equal(result.guides.length, 2);
    const outside = snapMove(index, box, 400 + 7 / zoom, 400, zoom);
    assert.equal(outside.dx, 400 + 7 / zoom);
    assert.equal(outside.guides.filter((g) => g.axis === "x").length, 0);
  }
  const centered = snapMove(
    index,
    { x: -200, y: -100, w: 40, h: 20 },
    529,
    329,
    1,
  );
  assert.equal(centered.dx, 530);
  assert.equal(centered.dy, 330);
  assert.deepEqual(
    centered.guides.map((g) => g.position),
    [350, 240],
  );
});

test("snap targets exclude the selection, invisible content, and connector/path bounds; locked objects remain targets", () => {
  const moving = item("rect", 100, 100),
    locked = item("rect", 300, 200, { locked: true });
  const far = item("rect", 9000, 9000),
    arrow = item("arrow", 180, 180),
    pen = item("pen", 20, 20, {
      points: [
        [0, 0],
        [30, 30],
      ],
    });
  const index = createSnapIndex(
    [moving, locked, far, arrow, pen],
    new Set([moving.id]),
    { x: 0, y: 0, w: 1000, h: 800 },
  );
  assert.deepEqual(
    index.x.map((entry) => entry.position),
    [locked.x, locked.x + locked.w / 2, locked.x + locked.w],
  );
  const raw = snapMove(index, bounds([moving]), 195, 95, 1, true);
  assert.deepEqual(raw, { dx: 195, dy: 95, guides: [] });
  assert.deepEqual(snapMove(index, null, 1, 2, 1), {
    dx: 1,
    dy: 2,
    guides: [],
  });
});

test("resize snapping changes only dragged edges, respects minimum size, and bypass remains precise", () => {
  const index = createSnapIndex(
    [item("rect", 300, 200, { w: 100, h: 100 })],
    new Set(),
  );
  const box = { x: 100, y: 50, w: 100, h: 100 };
  assert.deepEqual(snapResize(index, box, 195, 147, 1), {
    w: 200,
    h: 150,
    guides: [
      { axis: "x", position: 300, from: 50, to: 300 },
      { axis: "y", position: 200, from: 100, to: 400 },
    ],
  });
  assert.deepEqual(snapResize(index, box, 195, 147, 1, true), {
    w: 195,
    h: 147,
    guides: [],
  });
  const tiny = createSnapIndex(
    [item("rect", 50, 30, { w: 4, h: 4 })],
    new Set(),
  );
  assert.deepEqual(snapResize(tiny, { x: 0, y: 0, w: 100, h: 100 }, 5, 5, 1), {
    w: 60,
    h: 45,
    guides: [],
  });
});

test("indices merge duplicate coordinates and lookup work stays bounded for large boards", () => {
  const repeated = Array.from({ length: 5000 }, (_, n) =>
    item("rect", 0, n * 100),
  );
  const index = createSnapIndex(repeated, new Set());
  assert.equal(index.x.length, 3);
  assert.equal(index.x[0].to, repeated.at(-1).y + repeated.at(-1).h);
  let reads = 0;
  const counted = (entries) =>
    new Proxy(entries, {
      get(target, key) {
        if (/^\d+$/.test(String(key))) reads++;
        return target[key];
      },
    });
  snapMove(
    { x: counted(index.x), y: counted(index.y) },
    { x: 0, y: 0, w: 100, h: 80 },
    204,
    10504,
    1,
  );
  assert.ok(
    reads < 150,
    `Only neighboring targets should be examined (${reads} reads)`,
  );
});
