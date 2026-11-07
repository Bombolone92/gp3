import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "./canvas.js";
import { item, board, validateBoard } from "../src/model.js";
import {
  autoHeightLayout,
  reflowTextItems,
  clearTextLayoutCache,
} from "../src/text.js";
import { drawObject } from "../src/render.js";
import { updateConnectors } from "../src/scene.js";
import { createResizePlan, applyResize } from "../src/resize.js";
import { clipboardFormats, readFragment } from "../src/transfer.js";
import { switchShape } from "../src/shapes.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { quickConnectPlan } from "../src/quick-connect.js";

test("text height follows wrapping, explicit blank lines and typography while preserving width and legacy geometry", () => {
  const ctx = createCanvas(500, 500).getContext("2d");
  const text = item("text", 12, 34, {
    w: 420,
    autoHeight: true,
    fontSize: 20,
    text: "First  line\n\nLast\n",
  });
  const layout = autoHeightLayout(text, ctx);
  assert.deepEqual(layout.lines, ["First  line", "", "Last", ""]);
  assert.equal(layout.height, 4 * 27);
  assert.equal(reflowTextItems([text], ctx), true);
  assert.deepEqual([text.x, text.y, text.w, text.fontSize], [12, 34, 420, 20]);
  assert.equal(text.h, 108);
  text.text = "Short";
  reflowTextItems([text], ctx);
  assert.equal(text.h, 27, "Deleting content shrinks the box");
  text.text = "Word wrapping should determine the height at this width.";
  const wide = autoHeightLayout(text, ctx);
  text.w = 100;
  const narrow = autoHeightLayout(text, ctx);
  assert.ok(narrow.height > wide.height);
  assert.equal(narrow.lines.join(""), text.text);
  text.fontSize = 40;
  assert.ok(autoHeightLayout(text, ctx).height > narrow.height);
  assert.deepEqual(autoHeightLayout(text, ctx, "A\tB\r\nC").lines.slice(-1), [
    "C",
  ]);
  const legacy = item("text", 0, 0, { text: "a\nb\nc", h: 45 });
  assert.equal(reflowTextItems([legacy], ctx), false);
  assert.equal(legacy.h, 45);
});

test("automatic text height retains Unicode and reports the geometry limit without losing text", () => {
  const ctx = createCanvas(100, 100).getContext("2d");
  const i = item("text", 0, 0, {
    autoHeight: true,
    w: 60,
    text: "🪴é".repeat(3000),
    fontSize: 100,
  });
  const layout = autoHeightLayout(i, ctx);
  assert.equal(layout.lines.join(""), i.text);
  assert.ok(layout.lines.every((line) => !/[\uD800-\uDBFF]$/.test(line)));
  i.text = "\n".repeat(19999);
  const tall = autoHeightLayout(i, ctx);
  assert.equal(tall.height, 1e6);
  assert.equal(tall.overflow, true);
  assert.equal(tall.lines.length, 20000);
  reflowTextItems([i], ctx);
  validateBoard({ ...board(), items: [i] });
  assert.equal(i.text.length, 19999);
});

test("text layout caches saved and draft text and reuses all 5,000 heights without measuring on movement", () => {
  const ctx = createCanvas(500, 500).getContext("2d");
  const original = ctx.measureText.bind(ctx);
  let calls = 0;
  ctx.measureText = (value) => {
    calls++;
    return original(value);
  };
  const items = Array.from({ length: 5000 }, (_, n) =>
    item("text", n * 100, 0, {
      autoHeight: true,
      text: "A thought with several words.",
      w: 150,
    }),
  );
  reflowTextItems(items, ctx);
  assert.ok(calls > 5000);
  const saved = autoHeightLayout(items[0], ctx);
  const draft = autoHeightLayout(items[0], ctx, "Draft\nSecond line");
  calls = 0;
  for (const i of items) i.x += 10;
  assert.equal(reflowTextItems(items, ctx), false);
  assert.equal(autoHeightLayout(items[0], ctx), saved);
  assert.equal(autoHeightLayout(items[0], ctx, "Draft\nSecond line"), draft);
  assert.equal(calls, 0);
  clearTextLayoutCache();
  autoHeightLayout(items[0], ctx);
  assert.ok(calls > 0);
});

test("the final text line paints inside its derived box and connected objects follow width changes", () => {
  const canvas = createCanvas(600, 600),
    ctx = canvas.getContext("2d");
  const i = item("text", 0, 0, {
    autoHeight: true,
    text: "FIRST\nSECOND\nLAST",
    fontSize: 40,
    textColor: "#ff0000",
    w: 200,
  });
  const target = item("rect", 400, 100),
    line = item("arrow", 0, 0, { startId: i.id, endId: target.id });
  const items = [i, target, line];
  reflowTextItems(items, ctx);
  updateConnectors(items);
  const before = structuredClone(line);
  drawObject(ctx, i);
  const pixels = ctx.getImageData(0, 108, 200, 54).data;
  assert.ok(
    pixels.some((v, n) => n % 4 === 3 && v > 0),
    "Final line is visible in raster output",
  );
  const plan = createResizePlan(items, new Set([i.id]));
  assert.equal(plan.autoHeight, true);
  applyResize(items, plan, 90, i.h, false);
  reflowTextItems(items, ctx);
  updateConnectors(items);
  assert.ok(i.h > 162);
  assert.equal(i.fontSize, 40);
  assert.notDeepEqual(line, before);
  assert.equal(autoHeightLayout(i, ctx).height, i.h);
  const quick = quickConnectPlan([i], i.id, "right");
  assert.equal(
    quick.node.h,
    54,
    "A blank connected text box starts with one line",
  );
  assert.equal(quick.node.y + quick.node.h / 2, i.y + i.h / 2);
});

test("height mode survives validation, clipboard and concurrent text/width updates and is removed on shape conversion", () => {
  const ctx = createCanvas(600, 600).getContext("2d");
  const i = item("text", 10, 20, { autoHeight: true, text: "Original" });
  const initial = { ...board(), items: [i] };
  validateBoard(initial);
  for (const autoHeight of [1, "yes", {}, []])
    assert.throws(
      () => validateBoard({ ...initial, items: [{ ...i, autoHeight }] }),
      /text style/,
    );
  assert.throws(
    () => validateBoard({ ...initial, items: [{ ...i, type: "rect" }] }),
    /text style/,
  );
  const formats = clipboardFormats([i]);
  const fragment = readFragment({
    types: Object.keys(formats),
    getData: (key) => formats[key] || "",
  });
  assert.equal(fragment[0].autoHeight, true);
  const a = new SharedDocument();
  a.commit(initial);
  const b = new SharedDocument(a.update());
  try {
    a.text(
      i.id,
      "A shared thought that occupies several lines in a narrow box.",
    );
    const changed = b.snapshot();
    changed.items[0].w = 100;
    changed.items[0].x = 200;
    b.commit(changed);
    a.apply(b.update());
    b.apply(a.update());
    a.validate();
    b.validate();
    const first = a.snapshot(),
      second = b.snapshot();
    reflowTextItems(first.items, ctx);
    reflowTextItems(second.items, ctx);
    assert.deepEqual(first, second);
    assert.equal(first.items[0].w, 100);
    assert.equal(first.items[0].x, 200);
    assert.ok(first.items[0].h > 60);
    a.undo.undo();
    assert.equal(a.snapshot().items[0].text, "Original");
    assert.equal(
      a.snapshot().items[0].w,
      100,
      "Undoing text preserves the other editor’s width",
    );
    switchShape(i, "diamond");
    assert.equal(i.autoHeight, undefined);
    switchShape(i, "text");
    assert.equal(i.autoHeight, true);
  } finally {
    a.destroy();
    b.destroy();
  }
});
