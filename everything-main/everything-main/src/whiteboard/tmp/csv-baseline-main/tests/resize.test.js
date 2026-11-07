import test from "node:test";
import assert from "node:assert/strict";
import {
  item,
  board,
  validateBoard,
  resizeBounds,
  resizeHit,
} from "../src/model.js";
import { createResizePlan, resizeLimits, applyResize } from "../src/resize.js";
import { createFrame, connectObjects, updateConnectors } from "../src/scene.js";
import { createSnapIndex, snapResize } from "../src/snapping.js";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=";
test("mixed selections resize from one snapshot, scaling positions, text, drawings, and reverse arrows without losing data", () => {
  const items = [
    item("note", -200, -100, { text: "Note", groupId: "g" }),
    item("text", 30, 40, { text: "Text", bold: true }),
    item("image", 350, 70, { w: 160, h: 80, src: png }),
    item("table", -100, 250, {
      w: 280,
      h: 130,
      cells: [
        ["A", "B"],
        ["C", "D"],
      ],
    }),
    item("link", 350, 300, { url: "https://example.com", text: "Link" }),
    item("pen", -150, 500, {
      w: 100,
      h: 50,
      points: [
        [0, 0],
        [40, 20],
        [100, 50],
      ],
    }),
    item("arrow", 400, 500, { w: -80, h: -100 }),
  ];
  const original = structuredClone(items),
    plan = createResizePlan(items, new Set(items.map((i) => i.id)));
  assert.equal(plan.proportional, true);
  applyResize(items, plan, plan.box.w * 2, plan.box.h * 2);
  for (let n = 0; n < items.length; n++) {
    assert.equal(items[n].x, plan.box.x + (original[n].x - plan.box.x) * 2);
    assert.equal(items[n].y, plan.box.y + (original[n].y - plan.box.y) * 2);
    assert.equal(items[n].w, original[n].w * 2);
    assert.equal(items[n].h, original[n].h * 2);
  }
  assert.equal(items[0].fontSize, 38);
  assert.equal(items[1].fontSize, 56);
  assert.equal(items[3].fontSize, 30);
  assert.equal(items[4].fontSize, 36);
  assert.deepEqual(items[5].points, [
    [0, 0],
    [80, 40],
    [200, 100],
  ]);
  assert.equal(items[2].src, png);
  assert.deepEqual(items[3].cells, original[3].cells);
  assert.equal(items[4].url, original[4].url);
  assert.equal(items[1].bold, true);
  const b = board();
  b.items = items;
  assert.equal(validateBoard(b), b);
  applyResize(items, plan, plan.box.w * 1.5, plan.box.h * 1.5);
  assert.equal(items[0].w, original[0].w * 1.5);
  applyResize(items, plan, plan.box.w, plan.box.h);
  assert.deepEqual(items, original);
});

test("frame-only sizing preserves content; selecting the frame and contents scales everything; locks protect both", () => {
  const child = item("note", 100, 100, { text: "Inside" }),
    items = [child];
  const frame = createFrame(items, new Set([child.id]));
  const before = structuredClone(child);
  const only = createResizePlan(items, new Set([frame.id]), frame.id);
  assert.equal(only.frameOnly, true);
  assert.equal(only.items.length, 1);
  applyResize(items, only, only.box.w * 2, only.box.h * 2);
  assert.deepEqual(child, before);
  const all = createResizePlan(items, new Set(items.map((i) => i.id)));
  assert.equal(all.items.length, 2);
  applyResize(items, all, all.box.w * 1.5, all.box.h * 1.5);
  assert.equal(child.w, before.w * 1.5);
  assert.equal(child.parentId, frame.id);
  child.locked = true;
  assert.throws(
    () => createResizePlan(items, new Set([frame.id]), frame.id),
    /Unlock protected/,
  );
  const locked = structuredClone(items);
  assert.throws(
    () => applyResize(items, all, all.box.w, all.box.h),
    /Unlock protected/,
  );
  assert.deepEqual(items, locked);
});

test("attached connectors do not inflate selection bounds and follow resized endpoints", () => {
  const a = item("rect", 0, 0),
    b = item("rect", 300, 0),
    outside = item("rect", 2000, 1000);
  const items = [a, b, outside],
    arrow = connectObjects(items, new Set([a.id, outside.id]));
  const ids = new Set([a.id, b.id, arrow.id]);
  const plan = createResizePlan(items, ids);
  assert.equal(plan.box.w, 490);
  assert.equal(plan.items.length, 2);
  applyResize(items, plan, 980, 320);
  assert.equal(outside.x, 2000);
  assert.equal(arrow.startId, a.id);
  assert.equal(arrow.endId, outside.id);
  const line = structuredClone(arrow);
  updateConnectors(items);
  assert.deepEqual(arrow, line);
  assert.equal(createResizePlan(items, new Set([arrow.id])), null);
});

test("proportional snapping preserves aspect ratio and rejects misleading guides after clamping", () => {
  const box = { x: 0, y: 0, w: 200, h: 100 };
  const index = createSnapIndex(
    [item("rect", 300, 210, { w: 100, h: 100 })],
    new Set(),
  );
  const result = snapResize(index, box, 298, 149, 1, false, {
    proportional: true,
  });
  assert.equal(result.w, 300);
  assert.equal(result.h, 150);
  assert.equal(result.w / result.h, 2);
  assert.equal(result.guides.length, 1);
  assert.equal(result.guides[0].axis, "x");
  const free = snapResize(index, box, 298, 209, 1, false, {
    proportional: false,
  });
  assert.equal(free.w, 300);
  assert.equal(free.h, 210);
  const limited = snapResize(index, box, 298, 149, 1, false, {
    proportional: true,
    maxW: 250,
    maxH: 125,
  });
  assert.equal(limited.w, 250);
  assert.equal(limited.h, 125);
  assert.deepEqual(limited.guides, []);
});

test("resize limits keep fonts valid and out-of-range transforms fail atomically", () => {
  const a = item("text", 0, 0, { fontSize: 50 }),
    b = item("note", 400, 100, { fontSize: 10 }),
    items = [a, b];
  const plan = createResizePlan(items, new Set([a.id, b.id]));
  const limits = resizeLimits(plan);
  assert.equal(limits.minW / plan.box.w, 0.8);
  assert.equal(limits.maxW / plan.box.w, 2);
  const before = structuredClone(items);
  assert.throws(
    () => applyResize(items, plan, plan.box.w * 3, plan.box.h * 3),
    /text/,
  );
  assert.deepEqual(items, before);
  assert.throws(
    () => applyResize(items, plan, Infinity, plan.box.h),
    /dimensions/,
  );
  const far = item("rect", 999900, 0),
    first = item("rect", 0, 0),
    scene = [first, far];
  const overflow = createResizePlan(scene, new Set(scene.map((i) => i.id))),
    prior = structuredClone(scene);
  assert.throws(
    () =>
      applyResize(
        scene,
        overflow,
        overflow.box.w * 2,
        overflow.box.h * 2,
        false,
      ),
    /board limits/,
  );
  assert.deepEqual(scene, prior);
});

test("multi-object resize handles use shared geometry and stay usable across zoom levels", () => {
  const items = [
    item("note", 0, 0, { w: 100, h: 100 }),
    item("note", 200, 0, { w: 100, h: 100 }),
  ];
  const ids = new Set(items.map((i) => i.id));
  assert.deepEqual(resizeBounds(items, ids), { x: 0, y: 0, w: 300, h: 100 });
  assert.ok(resizeHit(items, ids, { x: 315, y: 100 }, 0.5));
  assert.equal(resizeHit(items, ids, { x: 315, y: 100 }, 2), null);
  items[1].locked = true;
  assert.equal(resizeHit(items, ids, { x: 300, y: 100 }, 1), null);
});
