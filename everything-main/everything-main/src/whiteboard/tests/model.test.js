import test from "node:test";
import assert from "node:assert/strict";
import {
  board,
  item,
  History,
  validateBoard,
  zoomAt,
  zoomStep,
  MIN_ZOOM,
  bounds,
  escape,
  hitTest,
  stackedItems,
  resizeHit,
  extendDrawing,
  startDrawing,
  PEN_POINTS,
  sharedCopy,
  undoCopy,
  keepUnchanged,
  assertImagePixels,
  truncate,
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
  assert.equal(zoomAt(view, point, 0).z, MIN_ZOOM);
});
test("zoom button steps return to exactly 100% after the ladder was clamped", () => {
  // Seven steps in from 100% stop at the 300% limit; six steps out then
  // land at 100.47%, which read "100%" while every later step was off.
  let z = 1;
  for (let n = 0; n < 7; n++) z = zoomStep(z, true);
  assert.equal(z, 3);
  for (let n = 0; n < 6; n++) z = zoomStep(z, false);
  assert.equal(z, 1);
  assert.equal(zoomStep(1, false), 1 / 1.2);
  assert.equal(zoomStep(1, true), 1.2);
  assert.equal(zoomStep(0.011, false), MIN_ZOOM);
  assert.ok(Math.abs(zoomStep(1.2, false) - 1) < 1e-12);
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
test("text limits never cut between the halves of a surrogate pair", () => {
  assert.equal(truncate("abc", 5), "abc");
  assert.equal(truncate("abcdef", 3), "abc");
  assert.equal(truncate("ab😀cd", 3), "ab");
  assert.equal(truncate("ab😀cd", 4), "ab😀");
  assert.equal(truncate("😀", 1), "");
  assert.equal(truncate(null, 3), "");
  for (const value of ["ab😀cd", "😀😀😀", "x😀"])
    for (let n = 0; n <= value.length; n++)
      assert.ok(truncate(value, n).isWellFormed(), `${value} at ${n}`);
});

test("Canvas wrapping breaks long words and preserves paragraph breaks", () => {
  const ctx = createCanvas(300, 200).getContext("2d");
  ctx.font = "18px sans-serif";
  const lines = wrapText(ctx, "abcdefghijklmnopqrstuvwx\nSecond paragraph", 70);
  assert.ok(lines.length > 3);
  assert.ok(lines.every((line) => ctx.measureText(line).width <= 70));
});

test("a space typed after a full line hangs past it instead of starting an empty line", () => {
  const ctx = { measureText: (text) => ({ width: text.length * 10 }) };
  assert.deepEqual(wrapText(ctx, "hello ", 50), ["hello"]);
  assert.deepEqual(wrapText(ctx, "hello w", 50), ["hello", "w"]);
  assert.deepEqual(wrapText(ctx, "hello world", 50), ["hello", "world"]);
  assert.deepEqual(wrapText(ctx, "ab   cd", 70), ["ab   cd"]);
  assert.deepEqual(wrapText(ctx, "ab cd \nef", 50), ["ab cd", "ef"]);
  assert.deepEqual(wrapText(ctx, "", 50), [""]);
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
test("a pointer far from a drawing skips its points, rotated or still being drawn", () => {
  const raw = [];
  for (let k = 0; k < 2000; k++)
    raw.push([k * 0.5, Math.sin(k / 20) * 30 + 30]);
  let reads = 0;
  const points = new Proxy(raw, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  const pen = item("pen", 0, 0, { w: 1000, h: 60, points, rotation: 30 });
  assert.equal(hitTest([pen], { x: -5000, y: -5000 }), null);
  reads = 0;
  for (let n = 0; n < 5; n++)
    assert.equal(hitTest([pen], { x: -5000, y: -5000 }), null);
  assert.equal(reads, 0);
  // Hits are unchanged, along the stroke and at the tolerance's edge.
  const flat = item("pen", 0, 0, { w: 1000, h: 60, points: raw });
  assert.equal(hitTest([flat], { x: 500, y: raw[1000][1] }), flat);
  assert.equal(hitTest([flat], { x: -7, y: 30 }), flat);
  assert.equal(hitTest([flat], { x: -9, y: 30 }), null);
  // A drawing in progress grows past its first box.
  extendDrawing(raw, 2000, 500, 1);
  assert.equal(hitTest([flat], { x: 2000, y: 500 }), flat);
  assert.equal(hitTest([pen], { x: -5000, y: -5000 }), null);
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

test("shared copies of board data are independent of the objects they copy", () => {
  const items = [
    item("pen", 0, 0, {
      points: [
        [0, 0],
        [4, 2],
      ],
    }),
    item("note", 10, 0, {
      text: "Note",
      textRuns: [{ start: 0, end: 4, style: { bold: true } }],
    }),
  ];
  const copy = sharedCopy(items);
  assert.deepEqual(copy, structuredClone(items));
  items[0].points[1][0] = 9;
  items[1].textRuns[0].style.bold = false;
  items[1].x = 50;
  assert.equal(copy[0].points[1][0], 4);
  assert.equal(copy[1].textRuns[0].style.bold, true);
  assert.equal(copy[1].x, 10);
});

test("copies and undo steps share a drawing's points, but not one still being drawn", () => {
  const points = [];
  for (let k = 0; k < 2000; k++) points.push([k * 0.5, k % 7]);
  const drawing = item("pen", 0, 0, { w: 1000, h: 6, points });
  const history = new History();
  history.push([drawing]);
  history.push([drawing]);
  // The drawing takes the packed copy its undo steps share: the same points.
  assert.deepEqual(drawing.points, points);
  assert.equal(history.past[0][0].points, drawing.points);
  assert.equal(history.past[1][0].points, drawing.points);
  assert.notEqual(history.past[0][0], drawing);
  assert.equal(undoCopy([drawing])[0].points, drawing.points);
  // Other copies, as of a shared board, stay wholly their own.
  assert.notEqual(sharedCopy(drawing).points, drawing.points);
  // Points read back from storage are shared once they are copied too.
  const stored = structuredClone(drawing);
  const step = undoCopy(stored);
  assert.deepEqual(stored.points, points);
  assert.equal(undoCopy(stored).points, step.points);
  assert.equal(stored.points, step.points);
  // A drawing in progress grows in place, so an undo step keeps what it had.
  const growing = item("pen", 0, 0, { points: startDrawing() });
  const before = undoCopy(growing);
  extendDrawing(growing.points, 10, 10, 1);
  assert.equal(before.points.length, 1);
  assert.equal(growing.points.length, 2);
  assert.notEqual(undoCopy(growing).points, growing.points);
});

test("an undo step keeps the board's own objects for those it leaves unchanged", () => {
  const runs = [{ start: 0, end: 4, style: { bold: true } }];
  const board = [
    item("note", 0, 0, { text: "Same", textRuns: runs }),
    item("note", 10, 0, { text: "Moved" }),
    item("note", 20, 0, { text: "Bold", textRuns: runs }),
    item("note", 30, 0, { text: "Reordered", color: "#fff" }),
  ];
  const history = new History();
  history.push(board);
  board[1].x = 99;
  board[2].textRuns = [{ start: 0, end: 4, style: { bold: false } }];
  const [x, y, ...rest] = Object.keys(board[3]);
  board[3] = Object.fromEntries(
    [y, x, ...rest].map((key) => [key, board[3][key]]),
  );
  const added = item("note", 40, 0, { text: "Added" });
  const step = history.undo([...board, added]);
  const restored = keepUnchanged(step, [...board, added]);
  assert.deepEqual(restored, step);
  assert.equal(restored[0], board[0], "unchanged, nested values included");
  assert.equal(restored[1], step[1], "moved since");
  assert.equal(restored[1].x, 10);
  assert.equal(restored[2], step[2], "formatted since");
  assert.equal(restored[3], step[3], "its keys in another order");
  assert.equal(restored.length, 4, "the object added since is left out");
});

test("the pixel limit applies to photos whose metadata fills their first 256 KB", () => {
  const segment = (marker, length) => {
    const bytes = Buffer.alloc(length + 2);
    bytes.writeUInt8(0xff, 0);
    bytes.writeUInt8(marker, 1);
    bytes.writeUInt16BE(length, 2);
    return bytes;
  };
  const frame = Buffer.from([
    0xff,
    0xc0,
    0,
    11,
    8,
    30000 >> 8,
    30000 & 255,
    30000 >> 8,
    30000 & 255,
    1,
    1,
    0x11,
    0,
  ]);
  const jpeg = (padding) =>
    "data:image/jpeg;base64," +
    Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      ...Array.from({ length: padding }, () => segment(0xe2, 65000)),
      frame,
      Buffer.from([0xff, 0xd9]),
    ]).toString("base64");
  for (const padding of [0, 5])
    assert.throws(
      () => assertImagePixels([item("image", 0, 0, { src: jpeg(padding) })]),
      /40 million pixels/,
      `${padding * 65} KB of metadata`,
    );
});
