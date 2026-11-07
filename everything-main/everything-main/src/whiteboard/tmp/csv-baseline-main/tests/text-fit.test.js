import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "./canvas.js";
import { item, board, validateBoard } from "../src/model.js";
import {
  fitTextLayout,
  textStyle,
  wrapText,
  clearTextLayoutCache,
} from "../src/text.js";
import { drawObject } from "../src/render.js";
import { CUSTOM_SHAPES, shapeContains, switchShape } from "../src/shapes.js";
import { createResizePlan, applyResize } from "../src/resize.js";
import { clipboardFormats, readFragment } from "../src/transfer.js";
import { SharedDocument } from "../src/collaboration/document.js";

test("fitting chooses a readable size within the chosen maximum without changing content or geometry", () => {
  const ctx = createCanvas(500, 500).getContext("2d");
  const note = item("note", 10, 20, {
    text: "An idea with enough detail to need several lines. ".repeat(3),
    bold: true,
    italic: true,
    underline: true,
    textAlign: "right",
    textColor: "#923355",
    fontSize: 30,
  });
  const before = structuredClone(note);
  const layout = fitTextLayout(note, ctx);
  assert.equal(layout.overflow, false);
  assert.ok(layout.style.size >= 8 && layout.style.size < 30);
  assert.equal(layout.style.color, note.textColor);
  assert.equal(layout.style.align, "right");
  assert.equal(layout.style.decoration, "underline");
  assert.match(layout.style.font, /italic 600/);
  assert.ok(
    layout.lines.length * layout.style.size * 1.35 + layout.style.padding * 2 <=
      note.h,
  );
  // Independently verify the next quarter-pixel size no longer fits.
  const size = layout.style.size + 0.25;
  ctx.font = textStyle({ ...note, fontSize: size }).font;
  const lines = wrapText(ctx, note.text, note.w - layout.style.padding * 2);
  assert.ok(lines.length * size * 1.35 + layout.style.padding * 2 > note.h);
  assert.deepEqual(note, before);
  note.text = "Short";
  assert.equal(fitTextLayout(note, ctx).style.size, 30);
  note.text = "";
  assert.equal(fitTextLayout(note, ctx).style.size, 30);
  note.text = "First\nSecond\nThird\nFourth";
  note.fontSize = 25.5;
  assert.equal(fitTextLayout(note, ctx).lines.length, 4);
});

test("shape fitting stays in safe interiors, changes after resizing, and paints the last line", () => {
  for (const shape of ["rectangle", "ellipse", ...CUSTOM_SHAPES]) {
    const canvas = createCanvas(500, 500),
      ctx = canvas.getContext("2d");
    const node = item(shape === "ellipse" ? "ellipse" : "rect", 0, 0, {
      w: 450,
      h: 400,
      fontSize: 100,
      autoFontSize: true,
      text: "FIRST\nSECOND\nLAST",
      textColor: "#ff0000",
      color: "#ffffff",
      ...(CUSTOM_SHAPES.has(shape) ? { shape } : {}),
    });
    const layout = fitTextLayout(node, ctx);
    assert.equal(layout.overflow, false, shape);
    if (CUSTOM_SHAPES.has(shape)) {
      const b = layout.box;
      for (const x of [b.x + 1, b.x + b.w - 1])
        for (const y of [b.y + 1, b.y + b.h - 1])
          assert.ok(shapeContains(node, x, y), shape);
    }
    drawObject(ctx, node);
    const from = Math.floor(
      layout.box.y + layout.top + 2 * layout.style.size * 1.35,
    );
    const pixels = ctx.getImageData(
      0,
      from,
      450,
      Math.ceil(layout.style.size * 1.35),
    ).data;
    let ink = 0;
    for (let p = 0; p < pixels.length; p += 4)
      if (
        pixels[p] > 200 &&
        pixels[p + 1] < 100 &&
        pixels[p + 2] < 100 &&
        pixels[p + 3]
      )
        ink++;
    assert.ok(
      ink > 10,
      `${shape}: final line remains visible in raster exports`,
    );
    const plan = createResizePlan([node], new Set([node.id]));
    applyResize([node], plan, 225, 200, false);
    const smaller = fitTextLayout(node, ctx);
    assert.ok(smaller.style.size < layout.style.size, shape);
    assert.equal(node.fontSize, 100);
    assert.equal(node.autoFontSize, true);
  }
});

test("extreme text is retained at the minimum size and caching avoids repeated fitting work", () => {
  const canvas = createCanvas(300, 300),
    ctx = canvas.getContext("2d");
  const measure = ctx.measureText.bind(ctx);
  let calls = 0;
  ctx.measureText = (text) => {
    calls++;
    return measure(text);
  };
  const note = item("note", 0, 0, {
    text: "🪴é".repeat(5000),
    w: 60,
    h: 45,
    fontSize: 100,
  });
  const layout = fitTextLayout(note, ctx);
  assert.equal(layout.style.size, 8);
  assert.equal(layout.overflow, true);
  assert.equal(layout.lines.join(""), note.text);
  assert.ok(calls < 150000, "Long tokens have bounded measurement work");
  calls = 0;
  for (let n = 0; n < 100; n++) {
    note.x += 10;
    assert.equal(fitTextLayout(note, ctx), layout);
  }
  assert.equal(calls, 0, "Panning/moving does not invalidate text metrics");
  note.w = 400;
  assert.notEqual(fitTextLayout(note, ctx), layout);
  calls = 0;
  clearTextLayoutCache();
  fitTextLayout(note, ctx);
  assert.ok(calls > 0, "Newly loaded fonts invalidate cached measurements");
  const tiny = fitTextLayout({ ...note, w: 1, h: 1 }, ctx);
  assert.ok(tiny.overflow && Number.isFinite(tiny.style.size));
});

test("automatic sizing validates, survives clipboard and concurrent edits, and is removed for plain text", () => {
  const note = item("note", 0, 0, { text: "Shared" });
  const initial = { ...board(), items: [note] };
  assert.equal(note.autoFontSize, true);
  for (const bad of ["yes", 1, {}, []])
    assert.throws(
      () =>
        validateBoard({ ...initial, items: [{ ...note, autoFontSize: bad }] }),
      /text style/,
    );
  assert.throws(
    () => validateBoard({ ...initial, items: [{ ...note, type: "text" }] }),
    /text style/,
  );
  const legacy = { ...note };
  delete legacy.autoFontSize;
  validateBoard({ ...initial, items: [legacy] });
  const formats = clipboardFormats([note]);
  const fragment = readFragment({
    getData: (key) => formats[key] || "",
    types: Object.keys(formats),
  });
  assert.equal(fragment[0].autoFontSize, true);
  const seed = new SharedDocument();
  seed.commit(initial);
  const a = new SharedDocument(seed.update()),
    b = new SharedDocument(seed.update());
  try {
    const changed = a.snapshot();
    changed.items[0].autoFontSize = false;
    a.commit(changed);
    b.text(note.id, "A longer shared idea");
    const au = a.update(),
      bu = b.update();
    a.apply(bu);
    b.apply(au);
    a.validate();
    b.validate();
    assert.deepEqual(a.snapshot(), b.snapshot());
    assert.equal(a.snapshot().items[0].autoFontSize, false);
    assert.equal(a.snapshot().items[0].text, "A longer shared idea");
    const converted = a.snapshot(),
      fitted = b.snapshot();
    switchShape(converted.items[0], "text");
    fitted.items[0].autoFontSize = true;
    a.commit(converted);
    b.commit(fitted);
    const av = a.update(),
      bv = b.update();
    a.apply(bv);
    b.apply(av);
    a.validate();
    b.validate();
    assert.deepEqual(a.snapshot(), b.snapshot());
    assert.equal(a.snapshot().items[0].type, "text");
    assert.equal(a.snapshot().items[0].autoFontSize, undefined);
  } finally {
    for (const doc of [seed, a, b]) doc.destroy();
  }
});

test("a 5,000-note board reuses fitted layouts without remeasuring unchanged text", () => {
  const ctx = createCanvas(300, 300).getContext("2d");
  const measure = ctx.measureText.bind(ctx);
  let calls = 0;
  ctx.measureText = (text) => {
    calls++;
    return measure(text);
  };
  const notes = Array.from({ length: 5000 }, (_, n) =>
    item("note", n * 220, 0, { text: `Idea ${n}` }),
  );
  for (const note of notes) fitTextLayout(note, ctx);
  assert.ok(calls <= 30000, "Initial fitting stays linear for ordinary notes");
  calls = 0;
  for (const note of notes) fitTextLayout(note, ctx);
  assert.equal(calls, 0);
  notes[2345].text = "One changed idea";
  for (const note of notes) fitTextLayout(note, ctx);
  assert.ok(calls > 0 && calls < 20, "Only the changed object is remeasured");
});

test("fitting shrinks text rather than breaking a word that fits whole", () => {
  const ctx = createCanvas(500, 500).getContext("2d");
  const fitted = (text, extra = {}) =>
    fitTextLayout(
      item("note", 0, 0, {
        text,
        w: 160,
        h: 160,
        fontSize: 24,
        autoFontSize: true,
        ...extra,
      }),
      ctx,
      text,
    );
  const layout = fitted("Multidisciplinary team");
  assert.ok(layout.style.size < 24);
  assert.ok(layout.lines.includes("Multidisciplinary"), layout.lines.join("|"));
  // Words too long for any size, and scripts without spaces, still wrap at
  // a readable size instead of shrinking to the minimum.
  assert.ok(fitted("https://" + "x".repeat(30)).style.size > 20);
  // Nor does one address that would fit whole only at a tiny size.
  assert.ok(
    fitted(
      "Questions? Write to jean.tremblay@hrsdc-rhdcc.gc.ca before Friday",
      {
        w: 190,
      },
    ).style.size >= 16,
  );
  assert.equal(fitted("雇用保険の申請").style.size, 24);
});
