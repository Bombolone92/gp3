import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCanvas } from "./canvas.js";
import { item, board, validateBoard } from "../src/model.js";
import {
  textLinkURL,
  textLinks,
  textLinkRange,
  linkColor,
} from "../src/text-link-data.js";
import { validateTextRuns } from "../src/rich-text.js";
import { createTextEditor } from "../src/text-editor.js";
import { readTextHTML } from "../src/text-blocks.js";
import {
  textLinkRects,
  textLinkHit,
  createTextLinkPreview,
} from "../src/text-links.js";
import { autoHeightLayout } from "../src/text.js";
import { drawObject } from "../src/render.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { bindText } from "../src/collaboration/text-binding.js";
import { createSearchIndex, searchIndex } from "../src/board-search.js";
const url = "https://example.com/reference?q=1#detail";
const run = (start, end, style = { link: url }) => ({ start, end, style });
function setup(i = item("text", 0, 0, { text: "Read the guide today" })) {
  const dom = new JSDOM("<!doctype html><body></body>", {
      pretendToBeVisual: true,
    }),
    input = createTextEditor(dom.window.document, i);
  dom.window.document.body.append(input);
  input.focus();
  return {
    dom,
    input,
    close() {
      input.destroy();
      dom.window.close();
    },
  };
}
function transfer(app, type, data) {
  const e = new app.dom.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "clipboardData", {
    value: {
      getData: (k) => data.get(k) || "",
      setData: (k, v) => data.set(k, v),
    },
  });
  app.input.dispatchEvent(e);
}
function nativeInsert(app, value) {
  const before = new app.dom.window.InputEvent("beforeinput", {
    inputType: "insertText",
    data: value,
    bubbles: true,
    cancelable: true,
  });
  if (!app.input.dispatchEvent(before)) return;
  const s = app.dom.window.getSelection(),
    r = s.getRangeAt(0),
    node = app.dom.window.document.createTextNode(value);
  r.deleteContents();
  r.insertNode(node);
  r.setStartAfter(node);
  r.collapse(true);
  s.removeAllRanges();
  s.addRange(r);
  app.input.dispatchEvent(
    new app.dom.window.InputEvent("input", {
      inputType: "insertText",
      data: value,
      bubbles: true,
    }),
  );
}
function undo(app) {
  app.input.dispatchEvent(
    new app.dom.window.InputEvent("beforeinput", {
      inputType: "historyUndo",
      cancelable: true,
    }),
  );
}

test("inline URLs validate safe protocols and length; link ranges join adjacent style fragments", () => {
  assert.equal(
    textLinkURL("example.com/path", true),
    "https://example.com/path",
  );
  // A typed host with a port is a web address too.
  assert.equal(
    textLinkURL("example.com:8080/docs", true),
    "https://example.com:8080/docs",
  );
  assert.equal(textLinkURL("localhost:5173", true), "https://localhost:5173/");
  for (const bad of ["javascript:alert(1)", "mailto:a@b.com", "data:,x"])
    assert.equal(textLinkURL(bad, true), null, bad);
  assert.equal(textLinkURL("HTTPS://EXAMPLE.COM"), "https://example.com/");
  assert.equal(
    textLinkURL("https://example.com/a?b=1#c"),
    "https://example.com/a?b=1#c",
  );
  for (const bad of [
    "javascript:alert(1)",
    "data:text/html,bad",
    "file:///tmp/a",
    "mailto:a@b.com",
    "https://example.com\n/path",
    "https://x/" + "a".repeat(2048),
    "https://",
    "//example.com",
    {},
    false,
  ]) {
    assert.equal(textLinkURL(bad), null);
    assert.throws(() => validateTextRuns("text", [run(0, 4, { link: bad })]));
  }
  const text = "Read the guide today",
    runs = [run(5, 9), run(9, 14, { link: url, bold: true })];
  assert.deepEqual(textLinks(text, runs), [
    { start: 5, end: 14, url, text: "the guide" },
  ]);
  assert.equal(textLinkRange(text, runs, 10).start, 5);
  assert.equal(textLinkRange(text, runs, 14).end, 14);
  assert.equal(textLinkRange(text, runs, 0, 19).url, "");
  validateBoard({
    ...board(),
    items: [item("text", 0, 0, { text, textRuns: runs })],
  });
  assert.equal(
    searchIndex(
      createSearchIndex([{ text, textRuns: runs }]),
      "example.com/reference",
    ).length,
    1,
  );
});

test("link editing retains labels and emphasis, supports caret editing/removal, safe paste, and undo", () => {
  const app = setup(),
    { input } = app;
  try {
    input.setSelectionRange(5, 14);
    input.format("bold");
    input.setLink(url);
    assert.equal(input.value, "Read the guide today");
    assert.deepEqual(input.textRuns, [run(5, 14, { bold: true, link: url })]);
    const anchor = input.querySelector("a");
    assert.equal(anchor.href, url);
    assert.equal(anchor.rel, "noopener noreferrer");
    assert.equal(anchor.textContent, "the guide");
    assert.equal(anchor.style.textDecoration, "underline");
    assert.equal(
      anchor.dispatchEvent(
        new app.dom.window.MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        }),
      ),
      false,
    );
    input.setSelectionRange(8);
    input.setLink("https://example.org/");
    assert.equal(input.textRuns[0].style.link, "https://example.org/");
    input.setSelectionRange(8);
    input.setLink(null);
    assert.deepEqual(input.textRuns, [run(5, 14, { bold: true })]);
    undo(app);
    assert.equal(input.textRuns[0].style.link, "https://example.org/");
    input.setSelectionRange(0, 4);
    transfer(app, "paste", new Map([["text/plain", url]]));
    assert.equal(input.value, "Read the guide today");
    assert.equal(input.textRuns[0].style.link, url);
    input.setSelectionRange(input.value.length);
    transfer(app, "paste", new Map([["text/plain", url]]));
    assert.ok(input.value.endsWith(url));
    assert.equal(input.textRuns.at(-1).style.link, url);
    undo(app);
    assert.equal(input.value, "Read the guide today");
    input.setSelectionRange(0, 4);
    assert.equal(input.setLink("javascript:alert(1)"), false);
    assert.equal(input.value, "Read the guide today");
  } finally {
    app.close();
  }
});

test("typing inside links preserves them and whitespace or Enter at the end stops linking new text", () => {
  const app = setup(
    item("text", 0, 0, { text: "Guide", textRuns: [run(0, 5)] }),
  );
  try {
    app.input.setSelectionRange(2);
    nativeInsert(app, "X");
    assert.equal(app.input.textRuns[0].end, 6);
    app.input.setSelectionRange(6);
    app.input.format("italic");
    nativeInsert(app, " ");
    nativeInsert(app, "plain");
    assert.equal(app.input.textRuns[0].end, 6);
    app.input.setSelectionRange(6);
    app.input.dispatchEvent(
      new app.dom.window.InputEvent("beforeinput", {
        inputType: "insertParagraph",
        cancelable: true,
      }),
    );
    nativeInsert(app, "New");
    assert.equal(app.input.textRuns[0].end, 6);
    assert.equal(app.input.querySelectorAll("a").length, 1);
  } finally {
    app.close();
  }
});

test("internal and external clipboard links preserve nested lists and labels without executable markup", () => {
  const a = setup(
      item("text", 0, 0, {
        text: "Guide\nDetail",
        textRuns: [run(0, 5)],
        textBlocks: [
          { start: 0, list: "number", indent: 0 },
          { start: 6, list: "number", indent: 1 },
        ],
      }),
    ),
    b = setup(item("text", 0, 0, { text: "" })),
    data = new Map();
  try {
    a.input.select();
    transfer(a, "copy", data);
    transfer(b, "paste", data);
    assert.equal(b.input.value, "Guide\nDetail");
    assert.equal(b.input.textRuns[0].style.link, url);
    assert.deepEqual(b.input.textBlocks, a.input.textBlocks);
    const doc = a.dom.window.document,
      el = doc.createElement("div");
    el.innerHTML = data.get("text/html");
    assert.equal(el.querySelector("ol > li > a").href, url);
    assert.equal(el.querySelector("ol > li > ol > li").textContent, "Detail");
    const imported = readTextHTML(
      doc,
      'See <a href="https://example.com/" onclick="evil()">the <b>guide</b></a> now',
    );
    assert.equal(imported.text, "See the guide now");
    assert.deepEqual(imported.runs, [
      run(4, 13, { link: "https://example.com/" }),
    ]);
    data.clear();
    data.set(
      "text/html",
      '<p><a href="javascript:alert(1)">Safe label</a><script>evil()</script><img src="bad"></p>',
    );
    data.set("text/plain", "Safe label");
    b.input.select();
    transfer(b, "paste", data);
    assert.equal(b.input.value, "Safe label");
    assert.equal(b.input.querySelector("a,script,img"), null);
    assert.equal(
      b.input.textRuns.some((r) => r.style.link),
      false,
    );
  } finally {
    a.close();
    b.close();
  }
});

test("wrapped and nested link hit areas match actual glyphs, clipping, alignment and cached layouts", () => {
  const canvas = createCanvas(500, 500),
    ctx = canvas.getContext("2d");
  const i = item("text", 20, 20, {
    text: "A linked phrase wraps over lines\nNext",
    w: 155,
    autoHeight: true,
    fontSize: 24,
    textRuns: [run(2, 31)],
    textBlocks: [
      { start: 0, list: "number", indent: 0 },
      { start: 32, list: "number", indent: 1 },
    ],
  });
  i.h = autoHeightLayout(i, ctx).height;
  const rects = textLinkRects(i, ctx);
  assert.ok(rects.length > 3);
  for (const rect of rects) {
    assert.equal(
      textLinkHit(i, ctx, { x: rect.x + rect.w / 2, y: rect.y + 2 }).url,
      url,
    );
    assert.ok(rect.x >= i.x && rect.x + rect.w <= i.x + i.w + 1e-6);
  }
  assert.equal(textLinkHit(i, ctx, { x: i.x, y: i.y }), undefined);
  drawObject(ctx, i, "#30342f");
  const pixels = ctx.getImageData(0, 0, 500, 500).data;
  let blue = 0;
  for (let p = 0; p < pixels.length; p += 4)
    if (pixels[p + 2] > pixels[p] + 80 && pixels[p + 3] > 180) blue++;
  assert.ok(blue > 50);
  assert.notEqual(linkColor("#eeeeee"), linkColor("#30342f"));
  for (const type of ["note", "ellipse", "rect", "arrow", "frame"]) {
    const shape = item(type, 10, 10, {
      text: "Linked words",
      textRuns: [run(0, 12)],
      textAlign: "right",
      w: 240,
      h: 160,
      ...(type === "rect" ? { shape: "diamond" } : {}),
      ...(["note", "rect", "ellipse"].includes(type)
        ? { autoFontSize: true }
        : {}),
    });
    assert.ok(textLinkRects(shape, ctx).length, type);
  }
  const measure = ctx.measureText.bind(ctx);
  let calls = 0;
  ctx.measureText = (text) => {
    calls++;
    return measure(text);
  };
  const many = Array.from({ length: 5000 }, (_, n) =>
    item("text", n, 0, {
      text: "Linked idea",
      textRuns: [run(0, 6)],
      w: 200,
      autoHeight: true,
    }),
  );
  for (const object of many) textLinkRects(object, ctx);
  calls = 0;
  for (const object of many) {
    object.x++;
    textLinkRects(object, ctx);
  }
  assert.equal(calls, 0);
});

test("shared links follow concurrent text insertions, retain independent styles, and undo separately", () => {
  const i = item("text", 0, 0, { id: "linked", text: "Read guide" }),
    a = new SharedDocument();
  a.commit({ ...board(), items: [i] });
  a.undo.clear();
  const b = new SharedDocument(a.update()),
    app = setup(i),
    unbind = bindText(
      { shared: a, publish: async () => {} },
      i.id,
      app.input,
      () => {},
    );
  try {
    app.input.setSelectionRange(5, 10);
    app.input.setLink(url);
    b.text(i.id, "NEW Read guide", [run(0, 3, { bold: true })]);
    const update = b.update();
    b.apply(a.update());
    a.apply(update);
    assert.deepEqual(a.snapshot().items, b.snapshot().items);
    assert.equal(textLinks(app.input.value, app.input.textRuns)[0].start, 9);
    a.undo.undo();
    assert.equal(app.input.value, "NEW Read guide");
    assert.equal(
      app.input.textRuns.some((r) => r.style.link),
      false,
    );
    assert.equal(app.input.textRuns[0].style.bold, true);
    a.validate();
    b.validate();
  } finally {
    unbind();
    app.close();
    a.destroy();
    b.destroy();
  }
});

test("link previews use bounded keyboard-accessible pages and close when their text or permission changes", () => {
  const dom = new JSDOM('<div><canvas tabindex="0"></canvas></div>', {
      pretendToBeVisual: true,
    }),
    canvas = dom.window.document.querySelector("canvas");
  const i = item("text", 0, 0, {
      text: "X ".repeat(1000),
      textRuns: Array.from({ length: 1000 }, (_, n) => run(n * 2, n * 2 + 1)),
    }),
    b = { items: [i] };
  let writable = false;
  const state = { board: b, view: { x: 0, y: 0, z: 1 } };
  const preview = createTextLinkPreview({
    state: () => state,
    canvas: () => canvas,
    writable: () => writable,
    edit: () => assert.fail("Viewer edit"),
  });
  try {
    preview.show(i);
    const panel = dom.window.document.querySelector("#text-link-preview");
    assert.equal(panel.querySelectorAll("a").length, 50);
    assert.equal(panel.querySelector("a").target, "_blank");
    assert.ok(panel.querySelector("a").rel.includes("noopener"));
    assert.equal(
      [...panel.querySelectorAll("button")].some(
        (b) => b.textContent === "Edit link",
      ),
      false,
    );
    [...panel.querySelectorAll("button")]
      .find((b) => b.textContent === "Next")
      .click();
    assert.equal(panel.querySelectorAll("a").length, 50);
    writable = true;
    preview.update();
    assert.equal(panel.isConnected, false);
    preview.show(i);
    i.text = "Changed";
    preview.update();
    assert.equal(dom.window.document.querySelector("#text-link-preview"), null);
  } finally {
    preview.close();
    dom.window.close();
  }
});

test("read-only text link previews close and cannot reopen when their object becomes concealed", () => {
  const dom = new JSDOM('<div><canvas tabindex="0"></canvas></div>'),
    canvas = dom.window.document.querySelector("canvas"),
    i = item("note", 0, 0, {
      text: "Confidential reference",
      textRuns: [run(0, 22)],
    }),
    state = {
      board: { items: [i] },
      view: { x: 0, y: 0, z: 1 },
      concealed: new Set(),
    },
    preview = createTextLinkPreview({
      state: () => state,
      canvas: () => canvas,
      writable: () => false,
      edit: () => assert.fail("Viewer edit"),
    });
  try {
    preview.show(i);
    const panel = dom.window.document.querySelector("#text-link-preview");
    assert.equal(panel.querySelector("a").href, url);
    state.concealed.add(i.id);
    preview.update();
    assert.equal(
      panel.isConnected,
      false,
      "Hidden content is removed immediately",
    );
    Object.defineProperty(i, "text", {
      get: () => assert.fail("Concealed content must not be read"),
    });
    preview.show(i);
    assert.equal(dom.window.document.querySelector("#text-link-preview"), null);
    preview.show(i, { start: 0, end: 22, text: "Confidential reference", url });
    assert.equal(dom.window.document.querySelector("#text-link-preview"), null);
  } finally {
    preview.close();
    dom.window.close();
  }
});

test("link hit areas on tagged notes stop at the tag footer", () => {
  const ctx = createCanvas(400, 400).getContext("2d");
  const text = "word ".repeat(80).trim();
  const note = item("note", 0, 0, {
    w: 200,
    h: 200,
    text,
    tagIds: ["t1"],
    autoFontSize: false,
    textRuns: [
      { start: 0, end: text.length, style: { link: "https://example.com/" } },
    ],
  });
  const rects = textLinkRects(note, ctx);
  assert.ok(rects.length);
  assert.ok(Math.max(...rects.map((r) => r.y + r.h)) <= 170);
});

test("a link in a connector's label is clickable where it is drawn", () => {
  const canvas = createCanvas(700, 300),
    ctx = canvas.getContext("2d");
  const text = "Read the reference docs here";
  const arrow = item("arrow", 50, 150, {
    w: 600,
    h: 0,
    text,
    textRuns: [run(text.indexOf("here"), text.length)],
  });
  drawObject(ctx, arrow, "#30342f");
  const pixels = ctx.getImageData(0, 0, 700, 300).data;
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (let p = 0; p < pixels.length; p += 4)
    if (pixels[p + 2] > pixels[p] + 80 && pixels[p + 3] > 180) {
      const x = (p / 4) % 700,
        y = Math.floor(p / 4 / 700);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  assert.ok(right > left, "the link is drawn");
  const [rect] = textLinkRects(arrow, ctx);
  const tolerance = 3;
  assert.ok(
    rect.x <= left + tolerance &&
      rect.x + rect.w >= right - tolerance &&
      rect.y <= top + tolerance &&
      rect.y + rect.h >= bottom - tolerance,
    `hit area ${JSON.stringify(rect)} covers the drawn link ${[left, top, right, bottom]}`,
  );
  const middle = { x: (left + right) / 2, y: (top + bottom) / 2 };
  assert.equal(textLinkHit(arrow, ctx, middle)?.url, url);
});
