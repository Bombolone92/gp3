import test from "node:test";
import assert from "node:assert/strict";
import {
  board,
  item,
  History,
  validateBoard,
  zoomAt,
  bounds,
  escape,
  hitTest,
  stackedItems,
  resizeHit,
  extendDrawing,
  PEN_POINTS,
} from "../src/model.js";
import { drawObject, wrapText } from "../src/render.js";
import { createCanvas } from "./canvas.js";

test("drawings accept bounded text alternatives and reject invalid descriptions", () => {
  const b = board("Drawing");
  const drawing = item("pen", 0, 0, {
    points: [
      [0, 0],
      [100, 100],
    ],
    alt: "Sales rise in the second quarter",
  });
  b.items = [drawing];
  assert.equal(validateBoard(b), b);
  for (const alt of ["a".repeat(1001), 42, null, {}]) {
    drawing.alt = alt;
    assert.throws(() => validateBoard(b), /Invalid alternative text/);
  }
  drawing.alt = "";
  assert.equal(validateBoard(b), b);
  b.items = [item("note", 0, 0, { alt: "Not an image or drawing" })];
  assert.throws(() => validateBoard(b), /Invalid alternative text/);
});

test("each template is a valid independent editable document", () => {
  for (const template of ["blank", "brainstorm", "kanban", "mindmap"]) {
    const a = board("Test", template),
      b = board("Test", template);
    assert.equal(validateBoard(a), a);
    assert.notEqual(a.id, b.id);
    assert.equal(new Set(a.items.map((i) => i.id)).size, a.items.length);
  }
});
test("history snapshots are isolated; a new edit invalidates redo", () => {
  const h = new History(),
    items = [item("note", 0, 0)];
  h.push(items);
  items[0].text = "Changed";
  const previous = h.undo(items);
  assert.equal(previous[0].text, "");
  const next = h.redo(previous);
  assert.equal(next[0].text, "Changed");
  h.undo(next);
  h.push(previous);
  assert.equal(h.future.length, 0);
});
test("history is bounded to prevent unlimited memory growth", () => {
  const h = new History();
  for (let n = 0; n < 100; n++) h.push([item("note", n, 0)]);
  assert.equal(h.past.length, 80);
});
test("zoom preserves the world point under the cursor and clamps scale", () => {
  const view = { x: 70, y: -20, z: 0.5 },
    point = { x: 320, y: 250 };
  const next = zoomAt(view, point, 1.4);
  assert.ok(
    Math.abs((point.x - view.x) / view.z - (point.x - next.x) / next.z) < 1e-9,
  );
  assert.ok(
    Math.abs((point.y - view.y) / view.z - (point.y - next.y) / next.z) < 1e-9,
  );
  assert.equal(zoomAt(view, point, 100).z, 3);
  assert.equal(zoomAt(view, point, 0).z, 0.15);
});
test("bounds include reverse direction arrows and negative coordinates", () => {
  assert.deepEqual(bounds([item("arrow", 20, 30, { w: -100, h: -60 })]), {
    x: -80,
    y: -30,
    w: 100,
    h: 60,
  });
});
test("untrusted imports reject script images, malformed paths, duplicates, and nonfinite geometry", () => {
  for (const modify of [
    (b) => (b.items[0].x = Infinity),
    (b) => (b.items[0].color = "url(javascript:alert(1))"),
    (b) => b.items.push({ ...b.items[0] }),
    (b) => (b.items[0].fontSize = "1 onload=alert(1)"),
    (b) => (b.items[0].textColor = "url(javascript:alert(1))"),
    (b) => (b.items[0].textAlign = "start;position:fixed"),
    (b) => (b.items[0].bold = "true"),
    (b) => (b.items[0].italic = 1),
    (b) => (b.items[0].underline = {}),
    (b) => (b.items[0].strike = []),
    (b) => (b.items[0] = item("image", 0, 0, { src: "javascript:alert(1)" })),
    (b) =>
      (b.items[0] = item("pen", 0, 0, {
        points: [['0" onload="alert(1)', 0]],
      })),
  ]) {
    const b = board("Test", "brainstorm");
    modify(b);
    assert.throws(() => validateBoard(b));
  }
});
test("Canvas renderer paints note pixels and renders user content as text", () => {
  const canvas = createCanvas(300, 250),
    ctx = canvas.getContext("2d");
  drawObject(
    ctx,
    item("note", 10, 10, { text: "<script>hello</script>", color: "#f6e7a4" }),
    "#30342f",
    () => {},
  );
  assert.deepEqual(
    [...ctx.getImageData(20, 150, 1, 1).data],
    [246, 231, 164, 255],
  );
  assert.equal(escape('"<&'), "&quot;&lt;&amp;");
});
test("Canvas wrapping breaks long words and preserves paragraph breaks", () => {
  const ctx = createCanvas(300, 200).getContext("2d");
  ctx.font = "18px sans-serif";
  const lines = wrapText(ctx, "abcdefghijklmnopqrstuvwx\nSecond paragraph", 70);
  assert.ok(lines.length > 3);
  assert.ok(lines.every((line) => ctx.measureText(line).width <= 70));
});

test("long pasted tokens wrap with bounded measurements and preserve Unicode code points", () => {
  let calls = 0;
  const ctx = {
    measureText(text) {
      calls++;
      return { width: Array.from(text).length * 10 };
    },
  };
  const text = "🪴".repeat(5000);
  const lines = wrapText(ctx, text, 420);
  assert.equal(lines.join(""), text);
  assert.ok(lines.every((line) => Array.from(line).length <= 42));
  assert.ok(calls < 5000, `Unexpected measurement growth: ${calls}`);
});

test("styled text renders aligned colored glyphs and decorations, including exported canvas content", () => {
  const canvas = createCanvas(240, 140),
    ctx = canvas.getContext("2d");
  const i = item("text", 0, 0, {
    w: 240,
    h: 140,
    text: "Canvas",
    fontSize: 28,
    bold: true,
    italic: true,
    underline: true,
    strike: true,
    textAlign: "right",
    textColor: "#ff0000",
  });
  const b = board();
  b.items = [i];
  assert.equal(
    validateBoard(JSON.parse(JSON.stringify(b))).items[0].textColor,
    "#ff0000",
  );
  const redPixels = () => {
    const pixels = ctx.getImageData(0, 0, 240, 140).data;
    const points = [];
    for (let n = 0; n < pixels.length; n += 4)
      if (pixels[n] > 200 && pixels[n + 1] < 50 && pixels[n + 3] > 100)
        points.push({ x: (n / 4) % 240, y: Math.floor(n / 4 / 240) });
    return points;
  };
  drawObject(ctx, i, "#30342f", () => {});
  const points = redPixels();
  assert.ok(points.length > 200);
  assert.ok(
    Math.min(...points.map((p) => p.x)) > 100,
    "text is aligned to the right",
  );
  assert.ok(
    points.filter((p) => p.y >= 28 && p.y <= 31).length > 80,
    "underline is rendered",
  );
  ctx.clearRect(0, 0, 240, 140);
  drawObject(ctx, i, "#30342f", () => {}, true);
  assert.equal(
    redPixels().length,
    0,
    "native editor replaces the canvas text without duplicating it",
  );
});
test("Canvas hit testing respects stacking, ellipse boundaries, strokes, and frame interiors", () => {
  const note = item("note", 0, 0),
    top = item("note", 20, 20);
  assert.equal(hitTest([note, top], { x: 30, y: 30 }).id, top.id);
  const ellipse = item("ellipse", 0, 0, { w: 100, h: 100 });
  assert.equal(hitTest([ellipse], { x: 0, y: 0 }), null);
  assert.equal(hitTest([ellipse], { x: 50, y: 50 }).id, ellipse.id);
  const arrow = item("arrow", 100, 100, { w: -100, h: -100 });
  assert.equal(hitTest([arrow], { x: 50, y: 52 }, 4).id, arrow.id);
  assert.equal(hitTest([arrow], { x: 50, y: 70 }, 4), null);
  const frame = item("frame", 0, 0, { w: 300, h: 300 });
  assert.equal(hitTest([frame], { x: 150, y: 150 }), null);
  assert.equal(hitTest([frame], { x: 2, y: 150 }).id, frame.id);
});
test("resize handles keep a usable screen-space target across zoom levels", () => {
  const note = item("note", 0, 0, { w: 100, h: 100 });
  assert.equal(
    resizeHit([note], new Set([note.id]), { x: 115, y: 100 }, 0.5),
    note.id,
  );
  assert.equal(
    resizeHit([note], new Set([note.id]), { x: 115, y: 100 }, 2),
    null,
  );
});

test("frames render and hit-test behind objects even when created last", () => {
  const note = item("note", 0, 0);
  const frame = item("frame", 0, 0);
  const objects = [note, frame];
  assert.deepEqual([...stackedItems(objects)], [frame, note]);
  assert.deepEqual([...stackedItems(objects, true)], [note, frame]);
  assert.equal(hitTest(objects, { x: 10, y: 10 }), note);
  assert.equal(hitTest([frame], { x: 10, y: 10 }), frame);
  assert.deepEqual(objects, [note, frame]);
});
test("validation rejects table cells on other objects, and unnamed file cards still draw", () => {
  const b = board("Malformed");
  b.items = [item("note", 0, 0, { text: "", cells: "x" })];
  assert.throws(() => validateBoard(b), /Invalid table/);
  b.items = [item("note", 0, 0, { cells: [["Hidden"]] })];
  assert.throws(() => validateBoard(b), /Invalid table/);
  const file = item("file", 0, 0, {
    w: 240,
    h: 90,
    text: "",
    fileName: "",
    data: "data:application/octet-stream;base64,",
  });
  b.items = [file];
  assert.doesNotThrow(() => validateBoard(b));
  const ctx = createCanvas(300, 200).getContext("2d");
  assert.doesNotThrow(() => drawObject(ctx, file));
});
test("table, card and shape text reuse wrapped lines between repaints", async () => {
  const { clearTextLayoutCache } = await import("../src/text.js");
  const ctx = createCanvas(400, 400).getContext("2d");
  let calls = 0;
  const measure = ctx.measureText.bind(ctx);
  ctx.measureText = (text) => {
    calls++;
    return measure(text);
  };
  const words = "lorem ipsum dolor sit amet ".repeat(6).trim();
  const objects = [
    item("table", 0, 0, {
      w: 600,
      h: 300,
      cells: [
        [words, words],
        [words, "Short"],
      ],
    }),
    item("rect", 0, 0, { w: 200, h: 120, text: words }),
    item("link", 0, 0, {
      w: 280,
      h: 115,
      text: words,
      url: "https://example.com/",
    }),
  ];
  for (const i of objects) drawObject(ctx, i, "#000000");
  assert.ok(calls > 0);
  calls = 0;
  for (const i of objects) drawObject(ctx, i, "#000000");
  assert.equal(calls, 0);
  clearTextLayoutCache();
  for (const i of objects) drawObject(ctx, i, "#000000");
  assert.ok(calls > 0, "Font loads clear the cache");
});
test("undo history shares embedded image data instead of copying it", async () => {
  const v8 = await import("node:v8"),
    vm = await import("node:vm");
  v8.setFlagsFromString("--expose_gc");
  const gc = vm.runInNewContext("gc");
  const src = "data:image/png;base64," + "A".repeat(10_000_000);
  const items = [item("image", 0, 0, { src })];
  const h = new History();
  gc();
  const before = process.memoryUsage().heapUsed;
  for (let n = 0; n < 20; n++) h.push({ items, tags: [] });
  gc();
  assert.ok(process.memoryUsage().heapUsed - before < 50_000_000);
  // Snapshots stay independent of later edits.
  items[0].x = 99;
  const restored = h.undo({ items, tags: [] });
  assert.equal(restored.items[0].x, 0);
  assert.equal(restored.items[0].src, src);
  restored.items[0].y = 5;
  assert.equal(h.redo(restored).items[0].y, 0);
});

test("a drawing in progress keeps within the points a board can load", () => {
  const points = [[0, 0]];
  assert.equal(extendDrawing(points, 0.2, 0, 1), true);
  assert.equal(points.length, 1, "under half a pixel adds nothing");
  assert.equal(extendDrawing(points, 0.2, 0, 4), true);
  assert.equal(points.length, 2, "half a pixel or more at 4x zoom is seen");
  while (extendDrawing(points, points.length, 0, 1));
  assert.equal(points.length, PEN_POINTS);
  const drawing = item("pen", 0, 0, { points, w: PEN_POINTS, h: 0 });
  assert.doesNotThrow(() =>
    validateBoard({ version: 1, title: "Long", items: [drawing] }),
  );
  assert.equal(extendDrawing(points, 1e5, 0, 1), false);
  assert.equal(points.length, PEN_POINTS);
});
