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
  fontFamilyReady,
} from "../src/fonts.js";
import { item, board, validateBoard } from "../src/model.js";
import {
  textStyle,
  autoHeightLayout,
  fitTextLayout,
  richTextLayout,
  clearTextLayoutCache,
  textLayoutVersion,
} from "../src/text.js";
import {
  copyObjectStyle,
  objectStylePatch,
  applyObjectStyle,
  readObjectStyle,
} from "../src/object-style.js";
import { SharedDocument } from "../src/collaboration/document.js";
import {
  drawObject,
  rasterRegion,
  paint,
  refreshTextLayouts,
} from "../src/render.js";
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
  assert.equal(failures, 8, "A failed load is tried again when asked");
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

test("a font load that failed is tried again instead of failing every later load", async () => {
  let calls = 0;
  const fontSet = {
    load: async (spec) => {
      calls++;
      if (calls <= 2) throw new DOMException("offline", "NetworkError");
      return [spec];
    },
  };
  await assert.rejects(loadFontFamily("caveat", fontSet), {
    name: "NetworkError",
  });
  assert.equal(calls, 2, "Caveat has two faces");
  await loadFontFamily("caveat", fontSet);
  assert.equal(calls, 4);
  // A successful load is still shared by every later request.
  await loadItemFonts([{ type: "note", fontFamily: "caveat" }], fontSet);
  assert.equal(calls, 4);
});

// paint() on a DOM canvas, with document.fonts standing in.
function paintingWindow(load) {
  const dom = new JSDOM(
    '<canvas id="a"></canvas><canvas id="b"></canvas><canvas id="c"></canvas>',
    { pretendToBeVisual: true },
  );
  const w = dom.window;
  globalThis.window = w;
  globalThis.document = w.document;
  globalThis.getComputedStyle = w.getComputedStyle.bind(w);
  globalThis.devicePixelRatio = 1;
  w.HTMLCanvasElement.prototype.getContext = function () {
    if (!this._native) this._native = createCanvas(300, 150);
    return this._native.getContext("2d");
  };
  w.document.fonts = { load };
  return {
    w,
    close() {
      dom.window.close();
      delete globalThis.window;
      delete globalThis.document;
      delete globalThis.getComputedStyle;
      delete globalThis.devicePixelRatio;
    },
  };
}

test("a font load clears the text layouts once, however often it is reported", () => {
  // A load is reported to the canvas that asked for it, to loadingdone and
  // to fonts.ready: only the first finds a face loaded since the last clear.
  const faces = [{ status: "loaded" }, { status: "loading" }];
  const fontSet = { load() {}, [Symbol.iterator]: () => faces.values() };
  const version = textLayoutVersion();
  assert.equal(refreshTextLayouts(fontSet), true);
  assert.equal(textLayoutVersion(), version + 1);
  assert.equal(refreshTextLayouts(fontSet), false, "nothing loaded since");
  assert.equal(textLayoutVersion(), version + 1, "the layouts are kept");
  faces[1].status = "loaded";
  assert.equal(refreshTextLayouts(fontSet), true, "another face loaded");
  assert.equal(refreshTextLayouts(fontSet), false);
  // A font set whose faces cannot be counted clears them every time.
  const opaque = { load() {} };
  assert.equal(refreshTextLayouts(opaque), true);
  assert.equal(refreshTextLayouts(opaque), true);
  assert.equal(textLayoutVersion(), version + 4);
});

test("a canvas painted with fonts another canvas loaded keeps the layouts and paints once", async () => {
  let loads = 0;
  const { w, close } = paintingWindow(() => {
    loads++;
    return Promise.resolve([]);
  });
  try {
    clearTextLayoutCache();
    const items = [
      item("note", 0, 0, {
        text: "hello world ".repeat(20),
        autoFontSize: true,
      }),
    ];
    const view = { x: 0, y: 0, z: 1 };
    const main = w.document.querySelector("#a");
    let mainRepaints = 0;
    paint(main, items, view, {
      width: 300,
      height: 150,
      repaint: () => mainRepaints++,
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(mainRepaints, 1, "The first canvas paints again once loaded");
    assert.equal(fontFamilyReady("dm-sans", w.document.fonts), true);
    const ctx = main.getContext("2d");
    const layout = fitTextLayout(items[0], ctx);
    assert.equal(fitTextLayout(items[0], ctx), layout, "Cached");
    let previewRepaints = 0;
    for (const id of ["#b", "#c"])
      paint(w.document.querySelector(id), items, view, {
        width: 100,
        height: 80,
        repaint: () => previewRepaints++,
      });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(previewRepaints, 0, "Loaded fonts need no second paint");
    assert.equal(fitTextLayout(items[0], ctx), layout, "Layouts kept");
    assert.equal(loads, 4, "DM Sans was requested once, for its four faces");
  } finally {
    close();
  }
});

test("a canvas asks for a font again on its next paint after a failed load", async () => {
  let calls = 0,
    offline = true;
  const { w, close } = paintingWindow(() => {
    calls++;
    return offline ? Promise.reject(Error("offline")) : Promise.resolve([]);
  });
  try {
    const items = [item("note", 0, 0, { text: "x", fontFamily: "caveat" })];
    const canvas = w.document.querySelector("#a");
    const view = { x: 0, y: 0, z: 1 };
    let repaints = 0;
    const options = { width: 300, height: 150, repaint: () => repaints++ };
    paint(canvas, items, view, options);
    await new Promise((r) => setTimeout(r, 0));
    const failed = calls;
    assert.ok(failed >= 2, "Caveat's faces were asked for");
    assert.equal(repaints, 0);
    offline = false;
    w.dispatchEvent(new w.Event("online"));
    paint(canvas, items, view, options);
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(calls > failed, "Asked for again once the load could succeed");
    assert.equal(repaints, 1, "Painted again with the loaded font");
    paint(canvas, items, view, options);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(repaints, 1, "A loaded font needs no further paints");
  } finally {
    close();
  }
});

test("a font that failed to load is asked for again after a while or once online, not on every paint", async () => {
  let calls = 0;
  const { w, close } = paintingWindow(() => {
    calls++;
    return Promise.reject(Error("offline"));
  });
  const now = Date.now;
  const settle = () => new Promise((r) => setTimeout(r, 0));
  try {
    const items = [
      item("note", 0, 0, { text: "x", fontFamily: "eb-garamond" }),
    ];
    const canvas = w.document.querySelector("#a");
    const view = { x: 0, y: 0, z: 1 };
    const options = { width: 300, height: 150, repaint: () => {} };
    paint(canvas, items, view, options);
    await settle();
    const failed = calls;
    assert.ok(failed >= 4, "EB Garamond's faces were asked for");
    for (let n = 0; n < 5; n++) {
      paint(canvas, items, view, options);
      await settle();
    }
    assert.equal(calls, failed, "Repainting does not ask for it again");
    const later = now() + 31_000;
    Date.now = () => later;
    paint(canvas, items, view, options);
    await settle();
    assert.ok(calls > failed, "Asked for again after half a minute");
    const retried = calls;
    paint(canvas, items, view, options);
    await settle();
    assert.equal(calls, retried);
    w.dispatchEvent(new w.Event("online"));
    paint(canvas, items, view, options);
    await settle();
    assert.ok(calls > retried, "Asked for again once back online");
  } finally {
    Date.now = now;
    w.dispatchEvent(new w.Event("online"));
    close();
  }
});
