import test from "node:test";
import assert from "node:assert/strict";
import { item } from "../src/model.js";
import {
  createDimensionIndex,
  dimensionBadge,
  dimensionBounds,
  readDimensions,
} from "../src/dimensions.js";
import { createSnapIndex, snapResize } from "../src/snapping.js";

const box = { x: -200, y: -150, w: 100, h: 80 };
const empty = { x: [], y: [] };
const target = item("rect", 500, 400, { w: 240, h: 160, locked: true });
const index = (items = [target], origin = box, viewport) =>
  createDimensionIndex(items, new Set(), viewport, origin);
const guides = (result) => result.guides.filter((g) => g.kind === "dimension");

test("dimension matching uses screen-space tolerance, negative origins, precise bypass and paired guides", () => {
  for (const zoom of [0.15, 0.5, 1, 3]) {
    const dimensions = index();
    const result = snapResize(
      empty,
      box,
      240 - 5 / zoom,
      160 + 5 / zoom,
      zoom,
      false,
      { dimensions },
    );
    assert.equal(result.w, 240);
    assert.equal(result.h, 160);
    assert.deepEqual(
      guides(result).map((g) => [g.axis, g.to - g.from, g.size]),
      [
        ["x", 240, 240],
        ["x", 240, 240],
        ["y", 160, 160],
        ["y", 160, 160],
      ],
    );
    const outside = snapResize(
      empty,
      box,
      240 - 7 / zoom,
      160 + 7 / zoom,
      zoom,
      false,
      { dimensions },
    );
    assert.equal(outside.w, 240 - 7 / zoom);
    assert.equal(guides(outside).length, 0);
    assert.deepEqual(
      snapResize(empty, box, 237, 158, zoom, true, { dimensions }),
      { w: 237, h: 158, guides: [] },
    );
  }
});

test("dimension targets respect visibility, selection, group extents and closest deterministic references", () => {
  const near = item("rect", -400, -150, { w: 240, h: 160 });
  const group = [
    item("rect", 10, 10, { w: 100, h: 80, groupId: "g" }),
    item("rect", 130, 30, { w: 60, h: 80, groupId: "g" }),
  ];
  const line = item("arrow", 0, 0, { w: 111, h: 222 });
  const selected = item("note", 0, 0, { w: 333, h: 444 });
  const far = item("rect", 9000, 0, { w: 555, h: 666 });
  const items = [target, near, ...group, line, selected, far];
  const build = (items) =>
    createDimensionIndex(
      items,
      new Set([selected.id]),
      { x: -500, y: -500, w: 1500, h: 1500 },
      box,
    );
  const dimensions = build(items);
  assert.deepEqual(
    dimensions.width.map((e) => e.position),
    [180, 240],
  );
  assert.deepEqual(
    dimensions.height.map((e) => e.position),
    [100, 160],
  );
  assert.equal(dimensions.width[1].box.x, near.x);
  assert.deepEqual(
    build(items.toReversed()),
    dimensions,
    "Stacking order must not change size matches",
  );
});

test("dimension matching respects limits, proportional resize, automatic height and alignment/grid priority", () => {
  const dimensions = index();
  const limited = snapResize(empty, box, 237, 158, 1, false, {
    dimensions,
    maxW: 238,
    maxH: 159,
  });
  assert.equal(limited.w, 237);
  assert.equal(limited.h, 158);
  assert.equal(guides(limited).length, 0);
  const ratio = snapResize(empty, box, 239, 191.2, 1, false, {
    dimensions,
    proportional: true,
  });
  assert.equal(ratio.w, 240);
  assert.equal(ratio.h, 192);
  assert.equal(ratio.w / ratio.h, box.w / box.h);
  assert.equal(guides(ratio).length, 2);
  const auto = snapResize(empty, box, 237, 158, 1, false, {
    dimensions,
    dimensionY: false,
  });
  assert.equal(auto.h, 158);
  assert.ok(guides(auto).every((g) => g.axis === "x"));
  const edge = { x: [{ position: 38, from: 500, to: 600 }], y: [] };
  assert.equal(
    snapResize(edge, box, 237, 120, 1, false, { dimensions }).w,
    238,
    "Closer edge wins",
  );
  assert.equal(
    snapResize(edge, box, 239.5, 120, 1, false, { dimensions }).w,
    240,
    "Closer size wins",
  );
  assert.equal(
    snapResize(edge, box, 239, 120, 1, false, { dimensions }).w,
    238,
    "Tied edge wins",
  );
  assert.equal(
    snapResize(empty, box, 237, 120, 1, false, { dimensions, gridStep: 24 }).w,
    240,
    "Size wins over grid",
  );
  const alignedTarget = item("rect", box.x, 500, { w: 240, h: 160 });
  const aligned = snapResize(
    createSnapIndex([alignedTarget], new Set()),
    box,
    237,
    120,
    1,
    false,
    { dimensions: index([alignedTarget]) },
  );
  assert.equal(aligned.w, 240);
  assert.equal(
    guides(aligned).length,
    2,
    "Matching sizes stay visible when edge alignment produces the same size",
  );
});

test("dimension indexing and pointer lookups remain bounded on a 5000-object board without reading content", () => {
  const items = Array.from({ length: 5000 }, (_, n) =>
    item("rect", n, n, { w: 60 + n, h: 80 }),
  );
  for (const i of items)
    Object.defineProperty(i, "text", {
      get() {
        throw Error("Do not inspect text");
      },
    });
  const dimensions = index(items);
  assert.equal(dimensions.height.length, 1);
  let reads = 0;
  for (const axis of ["width", "height"])
    dimensions[axis] = new Proxy(dimensions[axis], {
      get(target, key) {
        if (/^\d+$/.test(String(key))) reads++;
        return target[key];
      },
    });
  const result = snapResize(empty, box, 2123.4, 81, 1, false, { dimensions });
  assert.equal(result.w, 2123);
  assert.equal(result.h, 80);
  assert.ok(reads < 100, `Expected logarithmic lookups, got ${reads} reads`);
});

test("dimension labels measure frames independently, include drawings, hide lines and stay within a narrow viewport", () => {
  assert.equal(readDimensions("true"), true);
  for (const value of [null, "false", "1", "garbage"])
    assert.equal(readDimensions(value), false);
  const frame = item("frame", 0, 0, { w: 800, h: 600 }),
    child = item("note", 50, 50, { parentId: frame.id });
  assert.deepEqual(
    dimensionBounds([frame, child], new Set([frame.id, child.id]), frame.id),
    { x: 0, y: 0, w: 800, h: 600 },
  );
  const pen = item("pen", 0, 0, {
    w: 20,
    h: 0,
    points: [
      [0, 0],
      [20, 0],
    ],
  });
  assert.equal(dimensionBounds([pen], new Set([pen.id])).w, 20);
  const line = item("arrow", 0, 0);
  assert.equal(dimensionBounds([line], new Set([line.id])), null);
  const view = { x: 0, y: 0, z: 1 },
    viewport = { width: 360, height: 600 };
  const badge = dimensionBadge(
    { x: 330, y: 500, w: 100.24, h: 80.36 },
    view,
    viewport,
  );
  assert.equal(badge.label, "100.2 × 80.4 px");
  assert.equal(badge.x, 270);
  assert.equal(badge.y, 410);
  const full = dimensionBadge({ x: 0, y: 0, w: 360, h: 600 }, view, viewport);
  assert.equal(
    full.y,
    410,
    "A full-height selection must leave room for the narrow drawing toolbar",
  );
  const atTop = dimensionBadge({ x: 0, y: -10, w: 100, h: 50 }, view, viewport);
  assert.equal(
    atTop.y,
    220,
    "The badge must stay below the selection controls",
  );
  assert.equal(
    dimensionBadge({ x: 9000, y: 0, w: 20, h: 20 }, view, viewport),
    null,
  );
  assert.equal(dimensionBadge(box, view, { width: 100, height: 100 }), null);
});
