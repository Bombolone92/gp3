import test from "node:test";
import assert from "node:assert/strict";
import {
  item,
  board,
  bounds,
  hitTest,
  resizeHit,
  validateBoard,
} from "../src/model.js";
import {
  canRotateItem,
  centerOf,
  worldPoint,
  localPoint,
  normalizeRotation,
} from "../src/geometry.js";
import {
  rotationBox,
  rotationHandle,
  rotationHit,
  createRotationPlan,
  applyRotation,
  rotationDelta,
} from "../src/rotation.js";
import { createResizePlan, applyResize } from "../src/resize.js";
import { connectObjects } from "../src/scene.js";
import { createMarqueeIndex, marqueeSelection } from "../src/marquee.js";
import { commentThread, commentPoint } from "../src/comments.js";
import { imageLayout, cropResult } from "../src/image-crop.js";
import { quickConnectPlan } from "../src/quick-connect.js";
import { switchShape } from "../src/shapes.js";
import { reflowTextItems } from "../src/text.js";
import { textLinkRects, textLinkHit } from "../src/text-links.js";
import { drawObject } from "../src/render.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { clipboardFormats, readFragment } from "../src/transfer.js";
import { createCanvas } from "./canvas.js";
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} ≈ ${b}`);
const pointNear = (a, b) => {
  near(a.x, b.x);
  near(a.y, b.y);
};
const ids = (...items) => new Set(items.map((i) => i.id));

test("rotation validates supported types and rotates around the center with exact inverse hit geometry", () => {
  for (const type of [
    "rect",
    "ellipse",
    "text",
    "image",
    "link",
    "file",
    "pen",
  ])
    assert.ok(canRotateItem({ type }));
  for (const type of ["note", "table", "frame", "arrow"])
    assert.equal(canRotateItem({ type }), false);
  assert.equal(
    canRotateItem({ type: "rect", mindMap: { parent: null } }),
    false,
  );
  for (const angle of [-720, -181, -180, 0, 45, 180, 720])
    assert.ok(
      normalizeRotation(angle) >= -180 && normalizeRotation(angle) < 180,
    );
  const shape = item("rect", 100, 100, { w: 200, h: 100, rotation: 90 });
  assert.deepEqual(bounds([shape]), {
    x: 150,
    y: 50,
    w: 100,
    h: 200,
  });
  pointNear(localPoint(shape, worldPoint(shape, { x: 125, y: 180 })), {
    x: 125,
    y: 180,
  });
  assert.equal(hitTest([shape], { x: 200, y: 60 })?.id, shape.id);
  assert.equal(hitTest([shape], { x: 110, y: 110 }), null);
  const b = board();
  b.items = [shape];
  assert.equal(validateBoard(b), b);
  for (const rotation of [NaN, Infinity, "90", 180, -181])
    assert.throws(
      () => validateBoard({ ...b, items: [{ ...shape, rotation }] }),
      /rotation/,
    );
  assert.throws(
    () => validateBoard({ ...b, items: [{ ...shape, type: "note" }] }),
    /rotation/,
  );
  switchShape(shape, "note");
  assert.equal(shape.rotation, undefined);
});

test("group rotation preserves content, sizes, membership and attached connectors; locks and limits reject atomically", () => {
  const a = item("rect", 0, 0, { w: 100, h: 60, groupId: "g", text: "A" }),
    b = item("ellipse", 200, 0, { w: 100, h: 60, groupId: "g" });
  const items = [a, b],
    line = connectObjects(items, ids(a, b)),
    before = structuredClone(items),
    plan = createRotationPlan(items, ids(a));
  assert.equal(plan.items.length, 2);
  applyRotation(items, plan, 90);
  pointNear(centerOf(a), { x: 150, y: -70 });
  pointNear(centerOf(b), { x: 150, y: 130 });
  assert.equal(a.rotation, 90);
  assert.equal(a.w, 100);
  assert.equal(a.text, "A");
  assert.equal(a.groupId, "g");
  near(line.x, 150);
  near(line.w, 0);
  near(line.y, -20);
  near(line.h, 100);
  applyRotation(items, plan, 0);
  assert.deepEqual(items, before);
  b.locked = true;
  const locked = structuredClone(items);
  assert.throws(() => applyRotation(items, plan, 30), /Unlock/);
  assert.deepEqual(items, locked);
  b.locked = false;
  assert.throws(() => applyRotation(items, plan, NaN), /valid angle/);
  const far = [
      item("rect", -1e6, -1e6, { w: 1, h: 1 }),
      item("rect", 1e6, 1e6, { w: 1, h: 1 }),
    ],
    snapshot = structuredClone(far);
  assert.throws(
    () => applyRotation(far, createRotationPlan(far, ids(...far)), 45),
    /limits/,
  );
  assert.deepEqual(far, snapshot);
  assert.equal(createRotationPlan([item("note", 0, 0)], new Set()), null);
});

test("rotation handles follow oriented selection and Shift snaps absolute angles without cumulative rounding", () => {
  const a = item("rect", 20, 30, { w: 200, h: 100, rotation: 20 }),
    list = [a],
    plan = createRotationPlan(list, ids(a));
  const start = rotationHandle(rotationBox(list, ids(a)), 2),
    c = plan.center;
  assert.ok(rotationHit(list, ids(a), start, 2));
  assert.equal(
    rotationHit(list, ids(a), { x: start.x + 8, y: start.y + 8 }, 2),
    false,
  );
  const next = worldPoint({ ...a, rotation: 17 }, start);
  near(rotationDelta(plan, start, next), 17);
  near(rotationDelta(plan, start, next, true), 10);
  applyRotation(list, plan, 17);
  near(a.rotation, 37);
  applyRotation(list, plan, 17);
  near(a.rotation, 37);
  a.locked = true;
  assert.equal(rotationHit(list, ids(a), start, 2), false);
  assert.ok(Number.isFinite(c.x));
});

test("rotated resizing holds the opposite corner fixed, refreshes connectors and preserves group proportions", () => {
  const a = item("rect", 100, 100, { w: 200, h: 100, rotation: 35 }),
    items = [a],
    plan = createResizePlan(items, ids(a));
  const corner = worldPoint(a, a),
    handle = worldPoint(a, { x: a.x + a.w, y: a.y + a.h });
  assert.equal(resizeHit(items, ids(a), handle, 1), a.id);
  applyResize(items, plan, 300, 180);
  pointNear(worldPoint(a, a), corner);
  near(a.w, 300);
  near(a.h, 180);
  near(a.rotation, 35);
  applyResize(items, plan, 200, 100);
  pointNear(a, { x: 100, y: 100 });
  const b = item("rect", 400, 100),
    multi = createResizePlan([a, b], ids(a, b));
  assert.ok(multi.fixedProportions);
  assert.throws(
    () => applyResize([a, b], multi, multi.box.w * 2, multi.box.h),
    /proportions/,
  );
  applyResize([a, b], multi, multi.box.w * 2, multi.box.h * 2);
  near(a.rotation, 35);
});

test("rotated marquee uses occupied polygons and drawing paths, excluding empty AABB corners", () => {
  const a = item("rect", 100, 100, { w: 100, h: 100, rotation: 45 }),
    index = createMarqueeIndex([a]);
  assert.equal(marqueeSelection(index, { x: 80, y: 80, w: 5, h: 5 }).size, 0);
  assert.equal(marqueeSelection(index, { x: 148, y: 79, w: 4, h: 5 }).size, 1);
  assert.equal(
    marqueeSelection(index, { x: 85, y: 85, w: 130, h: 130 }, true).size,
    1,
  );
  const pen = item("pen", 0, 0, {
      w: 100,
      h: 0,
      points: [
        [0, 0],
        [100, 0],
      ],
      rotation: 90,
    }),
    pi = createMarqueeIndex([pen]);
  assert.equal(
    marqueeSelection(pi, { x: 49, y: -51, w: 2, h: 92 }, true).size,
    1,
  );
  assert.equal(marqueeSelection(pi, { x: 0, y: -1, w: 20, h: 2 }).size, 0);
  assert.equal(hitTest([pen], { x: 50, y: 40 })?.id, pen.id);
});

test("rotated comments, crops, quick connections and text links retain their local attachment points", () => {
  const a = item("rect", 100, 100, { w: 200, h: 100, rotation: 45 });
  const p = worldPoint(a, { x: 110, y: 120 }),
    thread = commentThread(p, { id: "a", name: "A" }, "Hi", a);
  near(thread.dx, 10);
  near(thread.dy, 20);
  a.rotation = 90;
  pointNear(
    commentPoint(thread, new Map([[a.id, a]])),
    worldPoint(a, { x: 110, y: 120 }),
  );
  const img = { ...a, type: "image" },
    full = imageLayout(img, 200, 100).full,
    crop = { x: 0.5, y: 0, w: 0.5, h: 1 },
    result = cropResult(img, full, crop);
  pointNear(centerOf(result), worldPoint(img, { x: 250, y: 150 }));
  const q = quickConnectPlan([a], a.id, "right");
  near(bounds([q.node]).x - bounds([a]).x - bounds([a]).w, 80);
  const ctx = createCanvas(500, 500).getContext("2d"),
    text = item("text", 100, 100, {
      w: 200,
      h: 70,
      text: "Read guide",
      rotation: 90,
      textRuns: [{ start: 0, end: 10, style: { link: "https://example.com" } }],
    });
  const r = textLinkRects(text, ctx)[0];
  assert.ok(
    textLinkHit(text, ctx, worldPoint(text, { x: r.x + 1, y: r.y + 1 })),
  );
  const origin = worldPoint(text, text);
  text.text += "\nMore\nLines";
  reflowTextItems([text], ctx);
  pointNear(worldPoint(text, text), origin);
});

test("rotated objects paint into their visual bounds and clipboard round trips preserve angles", () => {
  const a = item("rect", 100, 100, {
      w: 200,
      h: 80,
      rotation: 90,
      color: "#ff0000",
    }),
    canvas = createCanvas(400, 400),
    ctx = canvas.getContext("2d");
  drawObject(ctx, a, "#000000");
  assert.equal(ctx.getImageData(200, 50, 1, 1).data[3], 255);
  assert.equal(ctx.getImageData(110, 110, 1, 1).data[3], 0);
  const b = board();
  b.items = [a];
  const formats = clipboardFormats(b.items);
  const fragment = readFragment({ getData: (key) => formats[key] || "" });
  assert.equal(fragment[0].rotation, 90);
});

test("shared rotation merges with concurrent text and color and remains one locally undoable geometry edit", () => {
  const b = board();
  b.items = [item("rect", 100, 100, { text: "Start" })];
  const seed = new SharedDocument();
  seed.commit(b);
  const a = new SharedDocument(seed.update()),
    c = new SharedDocument(seed.update());
  try {
    const av = a.snapshot(),
      cv = c.snapshot();
    applyRotation(av.items, createRotationPlan(av.items, ids(...av.items)), 45);
    a.commit(av);
    cv.items[0].color = "#ff0000";
    c.commit(cv);
    c.text(cv.items[0].id, "Remote text");
    a.apply(c.update());
    c.apply(a.update());
    assert.deepEqual(a.snapshot(), c.snapshot());
    assert.equal(a.snapshot().items[0].rotation, 45);
    a.undo.undo();
    const next = a.snapshot().items[0];
    assert.equal(next.rotation, undefined);
    assert.equal(next.text, "Remote text");
    assert.equal(next.color, "#ff0000");
    a.undo.redo();
    assert.equal(a.snapshot().items[0].rotation, 45);
    const converted = c.snapshot();
    switchShape(converted.items[0], "note");
    c.commit(converted);
    a.apply(c.update());
    assert.equal(a.snapshot().items[0].rotation, undefined);
  } finally {
    for (const d of [seed, a, c]) d.destroy();
  }
});

test("rotated minimap bounds and pixels agree without inspecting drawing points or text", async () => {
  const { minimapScene, paintMinimapScene } = await import("../src/minimap.js");
  const shape = item("rect", 100, 100, {
    w: 200,
    h: 80,
    rotation: 90,
    color: "#ff0000",
  });
  const scene = minimapScene([
    new Proxy(shape, {
      get(target, key) {
        if (["text", "points", "src"].includes(key))
          throw Error("Heavy overview read");
        return target[key];
      },
    }),
  ]);
  const box = bounds([shape]);
  for (const key of ["x", "y", "w", "h"]) near(scene.box[key], box[key]);
  const ctx = createCanvas(400, 400).getContext("2d");
  paintMinimapScene(
    ctx,
    scene,
    { x: 0, y: 0, scale: 1, width: 400, height: 400 },
    { background: "#ffffff", outline: "#000000" },
  );
  assert.deepEqual([...ctx.getImageData(200, 50, 1, 1).data], [255, 0, 0, 255]);
  assert.deepEqual(
    [...ctx.getImageData(110, 110, 1, 1).data],
    [255, 255, 255, 255],
  );
});

test("rotation plans avoid heavy content and preserve exact single-object coordinates at large magnitudes", () => {
  const shape = item("rect", 999999.12345, -999999.54321, {
    w: 100.000003,
    h: 70.000003,
  });
  const proxy = new Proxy(shape, {
    get(target, key) {
      if (["text", "textRuns", "src", "points", "data"].includes(key))
        throw Error("Heavy rotation read");
      return target[key];
    },
  });
  const plan = createRotationPlan([proxy], ids(proxy));
  applyRotation([shape], plan, 1e10 + 45);
  assert.equal(shape.x, 999999.12345);
  assert.equal(shape.y, -999999.54321);
  assert.equal(shape.rotation, normalizeRotation(1e10 + 45));
  applyRotation([shape], plan, 360);
  assert.equal(shape.rotation, undefined);
  const text = item("text", 1e6, 1e6, {
    rotation: 90,
    autoHeight: true,
    text: "Line\nLine\nLine",
    w: 100,
    h: 1,
  });
  reflowTextItems([text], createCanvas(500, 500).getContext("2d"));
  const b = board();
  b.items = [text];
  assert.equal(validateBoard(b), b);
});
