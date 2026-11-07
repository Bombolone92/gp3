import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "./canvas.js";
import { item, board, validateBoard } from "../src/model.js";
import {
  fitTextLayout,
  textStyle,
  wrapText,
  clearTextLayoutCache,
  cachedWrapText,
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
      "Questions? Write to jean.tremblay@operations.contoso.test before Friday",
      {
        w: 190,
      },
    ).style.size >= 16,
  );
  assert.equal(fitted("雇用保険の申請").style.size, 24);
});

test("repaints reuse wrapped text for thousands of visible table cells", () => {
  let calls = 0;
  const ctx = {
    font: "15px Repaint",
    measureText: (text) => (calls++, { width: text.length * 7 }),
  };
  const cells = Array.from({ length: 6000 }, (_, n) => `Cell ${n}`);
  for (const text of cells) cachedWrapText(ctx, text, 100);
  calls = 0;
  for (const text of cells) cachedWrapText(ctx, text, 100);
  assert.equal(calls, 0);
});

test("long words break between grapheme clusters, not inside an emoji sequence", () => {
  const ctx = createCanvas(10, 10).getContext("2d");
  ctx.font = "16px 'DM Sans'";
  const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
  const word = family.repeat(6);
  const lines = wrapText(ctx, word, 40);
  assert.ok(lines.length > 1, "the word is too wide for one line");
  for (const line of lines) {
    assert.equal(line.length % family.length, 0, JSON.stringify(line));
    assert.ok(!line.startsWith("\u200D") && !line.endsWith("\u200D"));
  }
  assert.equal(lines.join(""), word);
});

test("sticky notes and shapes hold their text at the top, middle or bottom, everywhere it is laid out", async () => {
  const { textBlock } = await import("../src/export-layout.js");
  const { copyObjectStyle, readObjectStyle, objectStylePatch } =
    await import("../src/object-style.js");
  const ctx = createCanvas(500, 500).getContext("2d");
  const firstLine = (i) => textBlock(i, ctx).lines[0].y;
  for (const autoFontSize of [false, true]) {
    const note = (textValign) =>
      item("note", 0, 0, {
        w: 200,
        h: 200,
        text: "Short",
        fontSize: 20,
        autoFontSize,
        ...(textValign ? { textValign } : {}),
      });
    const top = firstLine(note()),
      middle = firstLine(note("middle")),
      bottom = firstLine(note("bottom"));
    // Unset keeps an existing note's text at the top.
    assert.equal(top, firstLine(note("top")));
    assert.equal(top, 16);
    assert.ok(Math.abs(middle - (200 - 27) / 2) < 0.5, `${middle}`);
    assert.ok(Math.abs(bottom - (200 - 27 - 16)) < 0.5, `${bottom}`);
    assert.equal(
      fitTextLayout(note("middle"), ctx).top,
      autoFontSize ? middle : fitTextLayout(note("middle"), ctx).top,
    );
  }
  // Text that does not fit starts at the top, as before.
  const long = item("note", 0, 0, {
    w: 120,
    h: 60,
    text: "A long idea that needs several lines",
    textValign: "middle",
    autoFontSize: false,
  });
  assert.equal(firstLine(long), 16);
  // Library shapes stay centred unless set otherwise.
  const shape = item("rect", 0, 0, {
    w: 200,
    h: 200,
    shape: "diamond",
    text: "Mid",
    fontSize: 20,
  });
  assert.ok(firstLine(shape) > 60);
  assert.ok(firstLine({ ...shape, textValign: "top" }) < firstLine(shape));
  // Only notes and shapes take it, and only the three values.
  assert.throws(() =>
    validateBoard({
      version: 1,
      title: "t",
      items: [item("text", 0, 0, { textValign: "middle" })],
    }),
  );
  assert.throws(() =>
    validateBoard({
      version: 1,
      title: "t",
      items: [item("note", 0, 0, { textValign: "center" })],
    }),
  );
  // Copied styles carry it to notes and shapes, never to plain text.
  const copied = readObjectStyle(
    JSON.stringify(
      copyObjectStyle(item("note", 0, 0, { textValign: "bottom" })),
    ),
  );
  assert.equal(copied.text.textValign, "bottom");
  assert.equal(
    objectStylePatch(item("rect", 0, 0, {}), copied).textValign,
    "bottom",
  );
  assert.equal(
    objectStylePatch(item("text", 0, 0, { text: "x" }), copied)?.textValign,
    undefined,
  );
});

test("a note turned into text drops its vertical alignment, so the board stays valid", () => {
  const note = item("note", 0, 0, { text: "Idea", textValign: "middle" });
  switchShape(note, "text");
  assert.equal(note.type, "text");
  assert.equal(note.textValign, undefined);
  validateBoard({ version: 1, title: "t", items: [note] });
  // A shared board whose note became text elsewhere stays valid too.
  const doc = new SharedDocument();
  const shared = item("note", 0, 0, { text: "Shared", textValign: "bottom" });
  doc.commit({ version: 1, id: "b", title: "t", items: [shared] });
  const changed = { ...shared, type: "text", autoHeight: true };
  doc.commit({ version: 1, id: "b", title: "t", items: [changed] });
  const [after] = doc.snapshot().items;
  assert.equal(after.textValign, undefined);
  validateBoard(doc.snapshot());
  doc.destroy();
});

test("ellipses saved before vertical alignment keep their text where it was", async () => {
  const { textBlock } = await import("../src/export-layout.js");
  const ctx = createCanvas(500, 500).getContext("2d");
  const ellipse = (extra) =>
    item("ellipse", 0, 0, { w: 300, h: 200, text: "Hello world", ...extra });
  // Without auto-fit, an ellipse's text always started at the top.
  assert.equal(textBlock(ellipse({}), ctx).lines[0].y, 16);
  // With it, the fitted text was always centred.
  assert.ok(textBlock(ellipse({ autoFontSize: true }), ctx).lines[0].y > 60);
  assert.ok(textBlock(ellipse({ textValign: "middle" }), ctx).lines[0].y > 60);
});

test("a shape too small for a line of text is not reported as overflowing while it has none", () => {
  const ctx = createCanvas(100, 100).getContext("2d");
  // A tab bar icon slot or BPMN marker: smaller than one line at 8 px.
  const marker = item("rect", 0, 0, {
    w: 24,
    h: 12,
    text: "",
    autoFontSize: true,
  });
  assert.equal(fitTextLayout(marker, ctx).overflow, false);
  assert.equal(fitTextLayout(marker, ctx, "Label").overflow, true);
});

test("accents on capitals in a text box's first line are drawn, not clipped", async () => {
  const { exportSVG } = await import("../src/export-svg.js");
  const { exportRegions } = await import("../src/export.js");
  const ctx = createCanvas(400, 200).getContext("2d");
  const text = item("text", 20, 60, {
    w: 300,
    h: 40,
    text: "Élevé À propos",
    fontSize: 28,
    textColor: "#000000",
  });
  drawObject(ctx, text);
  // The accents rise above the box's top edge, where nothing else is drawn.
  const pixels = ctx.getImageData(20, 48, 300, 12).data;
  let ink = 0;
  for (let p = 3; p < pixels.length; p += 4) if (pixels[p] > 64) ink++;
  assert.ok(ink > 5, `${ink} accent pixels`);
  // Vector exports clip the same way.
  const b = board();
  b.items = [text];
  const svg = exportSVG(b, exportRegions(b), { ctx });
  const clip = svg.match(
    /<clipPath id="[^"]+"><rect x="([\d.-]+)" y="([\d.-]+)"/,
  );
  assert.ok(clip, "text clip");
  assert.ok(Number(clip[2]) < 60 - 28 * 0.3, `clip top ${clip[2]}`);
});

test("a new slider's or progress bar's label shrinks to stay whole beside it", async () => {
  const { SHAPE_SPECS } = await import("../src/shape-specs.js");
  const ctx = createCanvas(10, 10).getContext("2d");
  for (const [shape, text] of [
    ["wf-progress", "Upload 60%"],
    ["wf-slider", "Label text"],
  ]) {
    const control = item("rect", 0, 0, {
      shape,
      ...SHAPE_SPECS[shape].defaults,
      text,
    });
    assert.equal(control.autoFontSize, true);
    const layout = fitTextLayout(control, ctx);
    assert.equal(layout.lines.length, 1, `${shape}: ${layout.lines}`);
    assert.ok(layout.style.size <= SHAPE_SPECS[shape].defaults.fontSize);
    assert.ok(layout.style.size >= 8);
  }
});
