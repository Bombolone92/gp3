import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as Y from "yjs";
import { createCanvas } from "./canvas.js";
import {
  FONT_FAMILIES,
  fontFamily,
  fontStack,
  loadFontFamily,
  loadItemFonts,
} from "../src/fonts.js";
import { item, board, validateBoard } from "../src/model.js";
import {
  textStyle,
  autoHeightLayout,
  fitTextLayout,
  richTextLayout,
  clearTextLayoutCache,
} from "../src/text.js";
import {
  copyObjectStyle,
  objectStylePatch,
  applyObjectStyle,
  readObjectStyle,
} from "../src/object-style.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { drawObject, rasterRegion } from "../src/render.js";
import { switchShape } from "../src/shapes.js";
import { quickConnectPlan } from "../src/quick-connect.js";

test("five bundled font families have distinct native glyph metrics and preserve the existing default", () => {
  const ctx = createCanvas(600, 200).getContext("2d"),
    widths = new Set(),
    pixels = new Set();
  assert.equal(
    textStyle(item("text", 0, 0)).font,
    '400 28px "DM Sans", system-ui, sans-serif',
  );
  for (const family of FONT_FAMILIES) {
    const i = item("text", 0, 0, {
      text: "Coffee, café & ideas 0123",
      fontFamily: family.id,
      fontSize: 28,
      w: 550,
      h: 80,
    });
    ctx.font = textStyle(i).font;
    widths.add(ctx.measureText(i.text).width.toFixed(2));
    ctx.clearRect(0, 0, 600, 200);
    drawObject(ctx, i, "#30342f");
    pixels.add(ctx.canvas.toDataURL());
    i.italic = true;
    i.bold = true;
    assert.match(textStyle(i).font, /italic 600/);
    ctx.font = textStyle(i).font;
    assert.ok(ctx.measureText("Élégant").width > 0);
    assert.equal(fontFamily(i), family.id);
    assert.ok(fontStack(family.id).includes(family.name));
    validateBoard({ ...board(), items: [i] });
  }
  assert.equal(widths.size, 5);
  assert.equal(pixels.size, 5);
  for (const value of [
    null,
    "Arial",
    "url(x)",
    "__proto__",
    42,
    {},
    "noto-sans; color:red",
  ])
    assert.throws(
      () =>
        validateBoard({
          ...board(),
          items: [item("text", 0, 0, { fontFamily: value })],
        }),
      /font family/,
    );
});

test("font loading is lazy, shared across callers, covers emphasis, and stays bounded across 5000 objects", async () => {
  const calls = [],
    fontSet = {
      load: async (query) => {
        calls.push(query);
        return [{}];
      },
    };
  const items = Array.from({ length: 5000 }, (_, n) =>
    item("text", n, 0, { fontFamily: "roboto-mono" }),
  );
  await Promise.all([
    loadItemFonts(items, fontSet),
    loadFontFamily("roboto-mono", fontSet),
  ]);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((q) => q.includes("Roboto Mono")));
  await loadItemFonts(items, fontSet);
  assert.equal(calls.length, 4);
  await loadFontFamily("caveat", fontSet);
  assert.equal(calls.length, 6);
  await loadItemFonts([item("image", 0, 0), item("pen", 0, 0)], fontSet);
  assert.equal(calls.length, 6);
  let failures = 0;
  const broken = {
    load: async () => {
      failures++;
      throw Error("Offline font");
    },
  };
  await assert.rejects(loadFontFamily("noto-sans", broken), /Offline/);
  await assert.rejects(loadFontFamily("noto-sans", broken), /Offline/);
  assert.equal(failures, 4);
});

test("family changes invalidate fitted and flowing text caches while unchanged fonts reuse measurements", () => {
  const ctx = createCanvas(400, 400).getContext("2d");
  let calls = 0;
  const measure = ctx.measureText.bind(ctx);
  ctx.measureText = (s) => {
    calls++;
    return measure(s);
  };
  const i = item("text", 0, 0, {
    text: "WWWW narrow iiiiii style\nAnother line",
    w: 150,
    autoHeight: true,
    textRuns: [{ start: 0, end: 4, style: { bold: true } }],
  });
  const old = autoHeightLayout(i, ctx),
    count = calls;
  assert.equal(autoHeightLayout(i, ctx), old);
  assert.equal(calls, count);
  i.fontFamily = "roboto-mono";
  const changed = autoHeightLayout(i, ctx);
  assert.notEqual(changed, old);
  assert.ok(calls > count);
  assert.notEqual(changed.richLines[0].width, old.richLines[0].width);
  const note = item("note", 0, 0, {
    text: i.text,
    w: 130,
    h: 90,
    textBlocks: [{ start: 0, list: "number", indent: 1 }],
  });
  const first = fitTextLayout(note, ctx);
  note.fontFamily = "caveat";
  const second = fitTextLayout(note, ctx);
  assert.notEqual(first, second);
  assert.match(second.style.font, /Caveat/);
  assert.match(second.richLines[0].segments[0].style.font, /Caveat/);
  const rich = richTextLayout(i, ctx, 150);
  assert.ok(
    rich.every((l) =>
      l.segments.every((s) => s.style.font.includes("Roboto Mono")),
    ),
  );
});

test("family metadata survives conversion, connected creation, style transfer and collaborative undo", () => {
  const source = item("note", 0, 0, {
    text: "Source",
    fontFamily: "eb-garamond",
  });
  const copied = copyObjectStyle(source);
  assert.equal(copied.text.fontFamily, "eb-garamond");
  assert.ok(readObjectStyle(JSON.stringify(copied)));
  assert.equal(
    readObjectStyle(
      JSON.stringify({
        ...copied,
        text: { ...copied.text, fontFamily: "Unknown" },
      }),
    ),
    null,
  );
  const target = item("text", 300, 0, {
    text: "Keep",
    fontFamily: "roboto-mono",
  });
  applyObjectStyle(target, objectStylePatch(target, copied));
  assert.equal(target.fontFamily, "eb-garamond");
  switchShape(source, "text");
  assert.equal(source.fontFamily, "eb-garamond");
  const plan = quickConnectPlan([source], source.id, "right");
  assert.equal(plan.node.fontFamily, "eb-garamond");
  const a = new SharedDocument();
  a.commit({ ...board(), items: [target] });
  a.undo.clear();
  const b = new SharedDocument(Y.encodeStateAsUpdate(a.doc));
  const left = a.snapshot(),
    right = b.snapshot();
  left.items[0].fontFamily = "caveat";
  a.commit(left);
  right.items[0].text = "Keep concurrent words";
  b.commit(right);
  Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc), "remote");
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), "remote");
  assert.equal(b.snapshot().items[0].fontFamily, "caveat");
  a.undo.undo();
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), "remote");
  assert.equal(b.snapshot().items[0].fontFamily, "eb-garamond");
  assert.equal(b.snapshot().items[0].text, "Keep concurrent words");
  a.doc.destroy();
  b.doc.destroy();
});

test("raster exports await the requested fonts and propagate font failures instead of exporting fallback metrics", async () => {
  const dom = new JSDOM("<!doctype html><body></body>"),
    old = {
      document: globalThis.document,
      window: globalThis.window,
      getComputedStyle: globalThis.getComputedStyle,
    };
  let release;
  const gate = new Promise((r) => (release = r)),
    calls = [];
  Object.defineProperty(dom.window.document, "fonts", {
    configurable: true,
    value: {
      ready: Promise.resolve(),
      load: async (q) => {
        calls.push(q);
        await gate;
        return [{}];
      },
    },
  });
  dom.window.HTMLCanvasElement.prototype.getContext = function () {
    return (this._native ??= createCanvas(this.width, this.height)).getContext(
      "2d",
    );
  };
  Object.assign(globalThis, {
    document: dom.window.document,
    window: dom.window,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  });
  try {
    let done = false;
    const b = {
      ...board(),
      items: [
        item("text", 0, 0, {
          text: "Export family",
          fontFamily: "eb-garamond",
          autoHeight: true,
        }),
      ],
    };
    const result = rasterRegion(b, null).then((c) => {
      done = true;
      return c;
    });
    await Promise.resolve();
    assert.equal(done, false);
    assert.equal(calls.length, 4);
    release();
    const canvas = await result;
    assert.ok(canvas.width > 0);
    assert.equal(done, true);
    Object.defineProperty(document, "fonts", {
      value: {
        ready: Promise.resolve(),
        load: async () => {
          throw Error("Font failed");
        },
      },
    });
    await assert.rejects(rasterRegion(b, null), /Font failed/);
  } finally {
    Object.assign(globalThis, old);
    clearTextLayoutCache();
    dom.window.close();
  }
});
