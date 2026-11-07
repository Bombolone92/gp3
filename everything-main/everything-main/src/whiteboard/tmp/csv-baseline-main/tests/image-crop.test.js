import test from "node:test";
import assert from "node:assert/strict";
import { Image } from "@napi-rs/canvas";
import { createCanvas } from "./canvas.js";
import { board, item, validateBoard, hitTest, History } from "../src/model.js";
import {
  FULL_CROP,
  validCrop,
  imageLayout,
  cropResult,
  aspectCrop,
  dragCrop,
} from "../src/image-crop.js";
import { drawObject, imageFor } from "../src/render.js";
import { createResizePlan, applyResize } from "../src/resize.js";
import { selectionFragment } from "../src/transfer.js";
import { updateConnectors } from "../src/scene.js";
import { SharedDocument, rebase } from "../src/collaboration/document.js";

const picture = (extra = {}) =>
  item("image", 100, 80, {
    w: 400,
    h: 240,
    src: "data:image/png;base64,AA==",
    ...extra,
  });
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≈ ${expected}`);

test("crop validation rejects malformed data and metadata on non-images", () => {
  const i = picture({
    crop: { x: 0.2, y: 0.1, w: 0.6, h: 0.7, mask: "ellipse" },
  });
  validateBoard({ ...board(), items: [i] });
  for (const crop of [
    null,
    [],
    {},
    { ...FULL_CROP, x: -0.01 },
    { ...FULL_CROP, w: 0 },
    { ...FULL_CROP, w: Number.MIN_VALUE },
    { ...FULL_CROP, h: Infinity },
    { ...FULL_CROP, x: 0.1 },
    { ...FULL_CROP, mask: "script" },
    { ...FULL_CROP, sourceAspect: -1 },
    { ...FULL_CROP, sourceAspect: Infinity },
    { ...FULL_CROP, extra: true },
  ]) {
    assert.throws(
      () => validateBoard({ ...board(), items: [{ ...i, crop }] }),
      /Invalid image crop/,
    );
  }
  assert.throws(
    () => validateBoard({ ...board(), items: [{ ...i, type: "note" }] }),
    /Invalid image crop/,
  );
});

test("crop geometry preserves source scale, letterboxing, no-ops and the original extent", () => {
  const i = picture({ w: 400, h: 400 }),
    original = structuredClone(i);
  const layout = imageLayout(i, 400, 240);
  assert.deepEqual(layout.box, { x: 100, y: 160, w: 400, h: 240 });
  assert.equal(cropResult(i, layout.full, { ...FULL_CROP }), null);
  const crop = { x: 0.5, y: 0, w: 0.5, h: 0.5 };
  const next = { ...i, ...cropResult(i, layout.full, crop) };
  assert.deepEqual([next.x, next.y, next.w, next.h], [300, 160, 200, 120]);
  assert.equal(next.src, original.src);
  assert.deepEqual(i, original);
  const after = imageLayout(next, 400, 240);
  assert.deepEqual(after.full, layout.full);
  const reset = cropResult(next, after.full, FULL_CROP);
  assert.deepEqual(reset, { ...layout.full, crop: undefined });
  assert.throws(
    () => cropResult(i, { x: 0, y: 0, w: 1e10, h: 1e10 }, crop),
    /size limits/,
  );
});

test("all crop handles clamp to the image and preserve anchors and aspect ratios", () => {
  const c = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
  for (const handle of ["nw", "n", "ne", "e", "se", "s", "sw", "w", "move"]) {
    for (const dx of [-10, -0.05, 0, 0.05, 10])
      for (const dy of [-10, -0.05, 0, 0.05, 10]) {
        for (const ratio of [0, 1]) {
          const next = dragCrop(c, handle, dx, dy, ratio, 0.01, 0.01);
          assert.ok(validCrop(next), JSON.stringify({ handle, dx, dy, next }));
          assert.ok(next.w >= 0.01 - 1e-9 && next.h >= 0.01 - 1e-9);
          if (ratio) near(next.w / next.h, ratio);
          if (handle.includes("w")) near(next.x + next.w, 0.7);
          if (handle.includes("n")) near(next.y + next.h, 0.7);
          if (handle.includes("e") && handle !== "move") near(next.x, 0.2);
          if (handle.includes("s")) near(next.y, 0.2);
        }
      }
  }
  const square = aspectCrop(FULL_CROP, 240 / 400);
  near(square.w * 400, square.h * 240);
  near(square.x, 0.2);
  const widescreen = aspectCrop(FULL_CROP, ((16 / 9) * 240) / 400);
  near((widescreen.w * 400) / (widescreen.h * 240), 16 / 9);
});

test("cropped pixels and oval transparency agree on the canvas and scaled raster output", async () => {
  globalThis.window = { Image };
  const source = createCanvas(400, 240),
    ctx = source.getContext("2d");
  for (const [color, x, y] of [
    ["#ff0000", 0, 0],
    ["#00ff00", 200, 0],
    ["#0000ff", 0, 120],
    ["#ffff00", 200, 120],
  ]) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 200, 120);
  }
  const i = picture({
    x: 0,
    y: 0,
    src: source.toDataURL(),
    w: 200,
    h: 120,
    crop: { x: 0.5, y: 0, w: 0.5, h: 0.5 },
  });
  await imageFor(i.src).ready;
  const output = createCanvas(400, 240),
    out = output.getContext("2d");
  out.scale(2, 2);
  drawObject(out, i, "#000000");
  assert.deepEqual(
    [...out.getImageData(200, 120, 1, 1).data],
    [0, 255, 0, 255],
  );
  assert.deepEqual([...out.getImageData(1, 1, 1, 1).data], [0, 255, 0, 255]);
  out.clearRect(0, 0, 200, 120);
  i.crop.mask = "ellipse";
  drawObject(out, i, "#000000");
  assert.equal(out.getImageData(1, 1, 1, 1).data[3], 0);
  assert.deepEqual(
    [...out.getImageData(200, 120, 1, 1).data],
    [0, 255, 0, 255],
  );
  assert.equal(hitTest([i], { x: 1, y: 1 }), null);
  assert.equal(hitTest([i], { x: 100, y: 60 }), i);
});

test("fractional aspect ratios stay inside source edges at every handle", () => {
  for (const ratio of [0.01, 0.6, 1.0666666666666667, 4 / 3, 100]) {
    const c = aspectCrop(FULL_CROP, ratio);
    for (const handle of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
      for (const [dx, dy] of [
        [-2, -2],
        [2, 2],
        [-2, 2],
        [2, -2],
        [0.001, -0.003],
      ]) {
        const next = dragCrop(c, handle, dx, dy, ratio, 0.0001, 0.0001);
        assert.ok(validCrop(next), JSON.stringify({ ratio, handle, next }));
        near(next.w / next.h, ratio);
      }
    }
  }
});

test("free resizing keeps cropped-image hit areas and connector ends on visible pixels", async () => {
  globalThis.window = { Image };
  const source = createCanvas(400, 240),
    sourceContext = source.getContext("2d");
  sourceContext.fillStyle = "#0088ff";
  sourceContext.fillRect(0, 0, 400, 240);
  const i = picture({
    x: 0,
    y: 0,
    w: 400,
    h: 400,
    src: source.toDataURL(),
    crop: {
      x: 0.5,
      y: 0,
      w: 0.5,
      h: 0.5,
      mask: "ellipse",
      sourceAspect: 400 / 240,
    },
  });
  await imageFor(i.src).ready;
  const out = createCanvas(420, 420),
    ctx = out.getContext("2d");
  drawObject(ctx, i, "#000000");
  assert.equal(ctx.getImageData(200, 20, 1, 1).data[3], 0);
  assert.equal(hitTest([i], { x: 200, y: 20 }), null);
  assert.equal(ctx.getImageData(200, 100, 1, 1).data[3], 255);
  assert.equal(hitTest([i], { x: 200, y: 100 }), i);
  const node = item("rect", 140, 600, { w: 120, h: 100 }),
    line = item("arrow", 0, 0, { startId: i.id, endId: node.id });
  updateConnectors([i, node, line]);
  near(line.x, 200);
  near(line.y, 320);
  delete i.crop.mask;
  assert.equal(hitTest([i], { x: 20, y: 20 }), null);
  assert.equal(hitTest([i], { x: 20, y: 100 }), i);
});

test("crop survives resize, clipboard, history, and connector geometry", () => {
  const i = picture({
    crop: { x: 0.5, y: 0, w: 0.5, h: 1, mask: "ellipse" },
    w: 200,
  });
  const node = item("rect", 650, 400),
    line = item("arrow", 0, 0, { startId: i.id, endId: node.id });
  const items = [i, node, line],
    history = new History();
  updateConnectors(items);
  const before = structuredClone(line);
  history.push(items);
  const plan = createResizePlan(items, new Set([i.id]));
  applyResize(items, plan, 100, 120);
  updateConnectors(items);
  assert.notDeepEqual(line, before);
  const copied = selectionFragment(items, new Set([i.id]));
  assert.deepEqual(copied[0].crop, i.crop);
  assert.equal(copied[0].src, i.src);
  const undone = history.undo(items);
  assert.equal(undone[0].w, 200);
  assert.equal(history.redo(undone)[0].w, 100);
});

test("shared cropping is atomic with image geometry and merges independent fields", () => {
  const initial = { ...board(), items: [picture()] },
    seed = new SharedDocument();
  seed.commit(initial);
  const a = new SharedDocument(seed.update()),
    b = new SharedDocument(seed.update());
  try {
    const left = a.snapshot(),
      right = b.snapshot();
    Object.assign(
      left.items[0],
      cropResult(left.items[0], imageLayout(left.items[0], 400, 240).full, {
        x: 0.5,
        y: 0,
        w: 0.5,
        h: 1,
      }),
    );
    a.commit(left);
    right.items[0].locked = true;
    b.commit(right);
    const au = a.update(),
      bu = b.update();
    a.apply(bu);
    b.apply(au);
    assert.deepEqual(a.snapshot(), b.snapshot());
    assert.equal(a.snapshot().items[0].locked, true);
    assert.equal(a.snapshot().items[0].w, 200);
    assert.equal(a.snapshot().items[0].crop.x, 0.5);
    a.undo.undo();
    assert.equal(a.snapshot().items[0].w, 400);
    assert.equal(a.snapshot().items[0].crop, undefined);
    assert.equal(a.snapshot().items[0].locked, true);
    const resized = structuredClone(initial);
    resized.items[0].w = 800;
    const merged = rebase(resized, initial, left);
    assert.equal(merged.items[0].w, 800);
    assert.equal(merged.items[0].x, 100);
    assert.equal(
      merged.items[0].crop,
      undefined,
      "A concurrent crop cannot mismatch the queued resize",
    );
  } finally {
    seed.destroy();
    a.destroy();
    b.destroy();
  }
});
test("loading images repaint each canvas once instead of replaying earlier paints", async () => {
  const previous = globalThis.window;
  let created = 0;
  const loads = [];
  class DelayedImage {
    constructor() {
      this.complete = false;
      this.naturalWidth = this.naturalHeight = 0;
      this.index = created++;
    }
    set src(value) {
      this.value = value;
      loads.push(
        new Promise((resolve) =>
          setTimeout(
            () => {
              this.complete = true;
              this.naturalWidth = this.naturalHeight = 1;
              this.onload();
              resolve();
            },
            5 + this.index * 5,
          ),
        ),
      );
    }
  }
  globalThis.window = { Image: DelayedImage };
  try {
    const ctx = createCanvas(20, 20).getContext("2d");
    ctx.drawImage = () => {};
    const items = Array.from({ length: 10 }, (_, n) =>
      picture({
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        src: `data:image/png;base64,RELAYED${n}AA==`,
      }),
    );
    let paints = 0;
    const repaint = () => {
      paints++;
      for (const i of items) drawObject(ctx, i, "#000000", repaint);
    };
    repaint();
    await Promise.all(loads);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(paints, 11);
  } finally {
    globalThis.window = previous;
  }
});
test("boards with more than 64 visible images reuse their decoded images", () => {
  const previous = globalThis.window;
  let created = 0;
  class CountedImage {
    constructor() {
      created++;
      this.complete = true;
      this.naturalWidth = this.naturalHeight = 1;
    }
    set src(value) {
      this.value = value;
    }
  }
  globalThis.window = { Image: CountedImage };
  try {
    const sources = Array.from(
      { length: 80 },
      (_, n) => `data:image/png;base64,UkVVU0U${n}AA==`,
    );
    for (const src of sources) imageFor(src);
    const first = created;
    assert.equal(first, 80);
    for (let pass = 0; pass < 3; pass++)
      for (const src of sources) imageFor(src);
    assert.equal(created, first);
  } finally {
    globalThis.window = previous;
  }
});
