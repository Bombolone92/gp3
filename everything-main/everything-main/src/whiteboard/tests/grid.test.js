import test from "node:test";
import assert from "node:assert/strict";
import {
  readGrid,
  gridSettings,
  gridStep,
  snapGridPoint,
  snapGridMove,
  drawGrid,
} from "../src/grid.js";
import { snapResize } from "../src/snapping.js";
import { createCanvas } from "./canvas.js";

test("grid preferences validate stored data and use the same spacing at every supported zoom", () => {
  for (const value of [
    null,
    "{}",
    "not JSON",
    '"lines"',
    '{"mode":"invalid","snap":"true"}',
  ])
    assert.deepEqual(readGrid(value), { mode: "dots", snap: false });
  assert.deepEqual(gridSettings({ mode: "none", snap: true }), {
    mode: "none",
    snap: false,
  });
  assert.deepEqual(readGrid('{"mode":"lines","snap":true}'), {
    mode: "lines",
    snap: true,
  });
  for (const [z, step] of [
    [0.15, 96],
    [0.25, 48],
    [0.5, 24],
    [1, 24],
    [3, 24],
  ]) {
    assert.equal(gridStep(z), step);
    assert.ok(step * z >= 12);
    const p = snapGridPoint({ x: -101, y: 103 }, step);
    assert.equal(Math.abs(p.x % step), 0);
    assert.equal(p.y % step, 0);
  }
});

test("grid movement preserves offsets, negative coordinates and the precedence of object guides", () => {
  const box = { x: -53, y: -29, w: 123, h: 77 },
    raw = { dx: 20, dy: 31, guides: [] };
  assert.deepEqual(snapGridMove(box, raw, 24), { dx: 29, dy: 29, guides: [] });
  const aligned = { ...raw, guides: [{ axis: "x", position: -33 }] };
  assert.deepEqual(snapGridMove(box, aligned, 24), { ...aligned, dy: 29 });
  const spaced = {
    ...raw,
    guides: [{ kind: "spacing", axis: "x", position: 4 }],
  };
  assert.equal(
    snapGridMove(box, spaced, 24),
    spaced,
    "A grid adjustment must not leave an equal-spacing lane",
  );
  assert.equal(snapGridMove(box, raw, 0), raw);
  assert.equal(snapGridMove(null, raw, 24), raw);
  const before = { ...box };
  for (let n = 0; n < 5000; n++) snapGridMove(box, raw, 24);
  assert.deepEqual(
    box,
    before,
    "Repeated samples never accumulate into the starting geometry",
  );
});

test("grid resize respects off-grid origins, limits, proportions, auto-height and object guides", () => {
  const empty = { x: [], y: [] },
    box = { x: 5, y: -7, w: 100, h: 80 };
  assert.deepEqual(
    snapResize(empty, box, 140, 111, 1, true, { gridStep: 24 }),
    { w: 139, h: 103, guides: [] },
  );
  const limited = snapResize(empty, box, 400, 400, 1, true, {
    gridStep: 24,
    maxW: 160,
    maxH: 130,
  });
  assert.equal(limited.w, 139);
  assert.equal(limited.h, 127);
  const proportion = snapResize(empty, box, 150, 120, 1, true, {
    gridStep: 24,
    proportional: true,
  });
  assert.ok(Math.abs(proportion.w / proportion.h - 1.25) < 1e-9);
  assert.ok(
    Math.abs((box.x + proportion.w) % 24) < 1e-9 ||
      Math.abs((box.y + proportion.h) % 24) < 1e-9,
  );
  assert.equal(
    snapResize(empty, box, 140, 111, 1, true, { gridStep: 24, gridY: false }).h,
    111,
  );
  const guided = snapResize(
    { x: [{ position: 147, from: 0, to: 100 }], y: [] },
    box,
    140,
    111,
    1,
    false,
    { gridStep: 24 },
  );
  assert.equal(guided.w, 142);
  assert.equal(guided.guides[0].position, 147);
  assert.deepEqual(snapResize(empty, box, 140, 111, 1, true), {
    w: 140,
    h: 111,
    guides: [],
  });
});

test("line and dot grids paint the same world anchors through pan and zoom and never leak into no-grid output", () => {
  const canvas = createCanvas(120, 96),
    ctx = canvas.getContext("2d");
  const alpha = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
  const view = { x: 5, y: -7, z: 1 };
  drawGrid(ctx, view, 120, 96, "dots", "#000000");
  assert.ok(alpha(5, 17));
  assert.equal(alpha(5, 30), 0);
  ctx.clearRect(0, 0, 120, 96);
  drawGrid(ctx, view, 120, 96, "lines", "#000000");
  assert.ok(alpha(5, 30));
  assert.ok(alpha(40, 17));
  assert.equal(alpha(40, 30), 0);
  ctx.clearRect(0, 0, 120, 96);
  drawGrid(ctx, { x: -9, y: 4, z: 0.25 }, 120, 96, "dots", "#000000");
  assert.ok(alpha(3, 4));
  assert.ok(alpha(15, 16));
  ctx.clearRect(0, 0, 120, 96);
  drawGrid(ctx, view, 120, 96, "none", "#000000");
  assert.equal(ctx.getImageData(0, 0, 120, 96).data.some(Boolean), false);
});

test("grid rendering work depends on the viewport and fills dots one row per path at minimum zoom", () => {
  let marks = 0,
    fills = 0,
    strokes = 0;
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {
      marks++;
    },
    arc() {
      marks++;
    },
    fill() {
      fills++;
    },
    stroke() {
      strokes++;
    },
  };
  drawGrid(ctx, { x: -1e6, y: 1e6, z: 0.15 }, 1000, 800, "dots", "black");
  assert.ok(marks < 4000);
  // One path per row of dots: fewer fills than dots, none spanning rows.
  const step = gridStep(0.15) * 0.15;
  assert.ok(fills > 1 && fills < marks);
  assert.ok(marks / fills <= Math.ceil(1000 / step) + 1);
  marks = 0;
  drawGrid(ctx, { x: -1e6, y: 1e6, z: 0.15 }, 1000, 800, "lines", "black");
  assert.ok(marks < 150);
  assert.equal(strokes, 1);
});
