import { quickConnectPlan } from "../src/quick-connect.js";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCanvas } from "./canvas.js";
import { item, board, validateBoard } from "../src/model.js";
import {
  formatTextRuns,
  spliceTextRuns,
  textDifference,
  validateTextRuns,
  runsFromDelta,
} from "../src/rich-text.js";
import {
  richTextLayout,
  autoHeightLayout,
  fitTextLayout,
} from "../src/text.js";
import { createTextEditor } from "../src/text-editor.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { canonicalLanguage } from "../src/accessibility/language-tag.js";
import { textClipboardHTML } from "../src/text-clipboard.js";
import { readTextHTML } from "../src/text-blocks.js";

test("content language tags are validated, retained in formatted clipboard HTML, and rendered with inherited defaults", () => {
  const i = item("text", 0, 0, {
    text: "Hello bonjour",
    lang: "en",
    textRuns: [{ start: 6, end: 13, style: { lang: "fr" } }],
  });
  const app = editor(i);
  try {
    assert.equal(canonicalLanguage("fr-ca"), "fr-CA");
    for (const value of [false, 123, 'fr"bad', "not_a_tag", "f".repeat(65)]) {
      assert.equal(canonicalLanguage(value), null);
      assert.throws(
        () => validateBoard({ ...board(), items: [{ ...i, lang: value }] }),
        /content language/,
      );
      assert.throws(
        () =>
          validateTextRuns(i.text, [
            { start: 0, end: 5, style: { lang: value } },
          ]),
        /formatting/,
      );
    }
    validateBoard({ ...board(), items: [i] });
    assert.equal(app.input.querySelector('[lang="en"]').textContent, "Hello ");
    assert.equal(app.input.querySelector('[lang="fr"]').textContent, "bonjour");
    const html = textClipboardHTML(
      app.dom.window.document,
      i.text,
      i.textRuns,
      [],
    );
    const imported = readTextHTML(app.dom.window.document, html);
    assert.deepEqual(imported.runs, i.textRuns);
    app.input.setBaseStyle({ ...i, lang: "es" });
    assert.equal(app.input.querySelector('[lang="es"]').textContent, "Hello ");
    assert.equal(app.input.querySelector('[lang="fr"]').textContent, "bonjour");
    app.input.setSelectionRange(6, 13);
    app.input.format("lang", null);
    assert.equal(app.input.textRuns.length, 0);
    assert.equal(app.input.querySelectorAll('[lang="es"]').length, 1);
  } finally {
    app.close();
  }
});

test("shared content language and phrase tags survive concurrent text edits and independent undo", () => {
  const a = new SharedDocument();
  const i = item("text", 0, 0, { id: "languages", text: "Hello bonjour" });
  a.commit({ ...board(), items: [i] });
  const b = new SharedDocument(a.update());
  try {
    a.undo.clear();
    b.undo.clear();
    const first = a.snapshot();
    first.items[0].lang = "en";
    first.items[0].textRuns = [{ start: 6, end: 13, style: { lang: "fr" } }];
    a.commit(first);
    const second = b.snapshot();
    second.items[0].text += "!";
    b.commit(second);
    a.apply(b.update());
    b.apply(a.update());
    for (const shared of [a, b]) {
      shared.validate();
      assert.equal(shared.snapshot().items[0].lang, "en");
      assert.equal(shared.snapshot().items[0].text, "Hello bonjour!");
      assert.equal(shared.snapshot().items[0].textRuns[0].style.lang, "fr");
    }
    a.undo.undo();
    assert.equal(a.snapshot().items[0].lang, undefined);
    assert.equal(a.snapshot().items[0].text, "Hello bonjour!");
  } finally {
    a.destroy();
    b.destroy();
  }
});
import { bindText } from "../src/collaboration/text-binding.js";
import { drawObject } from "../src/render.js";

const run = (start, end, style) => ({ start, end, style });
test("range formatting composes sparse styles, preserves offsets through replacements, and rejects corrupt input", () => {
  const text = "One 🪴 two";
  let runs = formatTextRuns(text, [], 0, 3, { bold: true });
  runs = formatTextRuns(text, runs, 2, 6, { italic: true });
  assert.deepEqual(runs, [
    run(0, 2, { bold: true }),
    run(2, 3, { bold: true, italic: true }),
    run(3, 6, { italic: true }),
  ]);
  runs = formatTextRuns(text, runs, 0, 6, { bold: null });
  assert.deepEqual(runs, [run(2, 6, { italic: true })]);
  assert.deepEqual(spliceTextRuns(runs, 3, 6, "green", { underline: true }), [
    run(2, 3, { italic: true }),
    run(3, 8, { underline: true }),
  ]);
  assert.deepEqual(textDifference("🪴", "🪵"), {
    start: 0,
    end: 2,
    insert: "🪵",
  });
  for (const invalid of [
    [run(4, 5, { bold: true })],
    [run(0, 20, {})],
    [run(0, 2, { fontSize: 200 })],
    [run(0, 2, { bold: "yes" })],
    [run(0, 2, { highlight: "url(x)" })],
    [run(0, 3, {}), run(2, 5, {})],
  ])
    assert.throws(() => validateTextRuns(text, invalid));
  validateBoard({
    ...board(),
    items: [item("text", 0, 0, { text, textRuns: runs })],
  });
});

test("rich text wraps across run boundaries, preserves Unicode and blank lines, caches movement, and renders colors/highlights", () => {
  const canvas = createCanvas(500, 200),
    ctx = canvas.getContext("2d");
  const i = item("text", 0, 0, {
    w: 400,
    fontSize: 30,
    text: "Red green\n\nLast",
    autoHeight: true,
    textRuns: [
      run(0, 3, { bold: true, textColor: "#ff0000" }),
      run(4, 9, { highlight: "#00ff00", underline: true }),
    ],
  });
  const lines = richTextLayout(i, ctx, 400);
  assert.deepEqual(
    lines.map((l) => l.text),
    ["Red green", "", "Last"],
  );
  assert.equal(lines[0].segments[0].style.bold, true);
  assert.equal(autoHeightLayout(i, ctx).height, Math.ceil(3 * 30 * 1.35));
  const original = ctx.measureText.bind(ctx);
  let calls = 0;
  ctx.measureText = (s) => {
    calls++;
    return original(s);
  };
  i.x = 10;
  assert.equal(richTextLayout(i, ctx, 400), lines);
  assert.equal(calls, 0);
  drawObject(ctx, i, "#30342f");
  const pixels = ctx.getImageData(0, 0, 500, 200).data;
  let red = 0,
    green = 0;
  for (let n = 0; n < pixels.length; n += 4) {
    if (pixels[n] > 200 && pixels[n + 1] < 50 && pixels[n + 3] > 200) red++;
    if (pixels[n + 1] > 200 && pixels[n] < 50 && pixels[n + 3] > 200) green++;
  }
  assert.ok(
    red > 50 && green > 300,
    `Expected colored glyphs and highlight pixels: ${red}, ${green}`,
  );
  const long = item("note", 0, 0, {
    text: "🪴a".repeat(4000),
    textRuns: [run(0, 12000, { bold: true })],
    autoFontSize: true,
  });
  calls = 0;
  const fitted = fitTextLayout(long, ctx);
  assert.equal(fitted.lines.join(""), long.text);
  assert.ok(fitted.lines.every((l) => !/[\uD800-\uDBFF]$/.test(l)));
  assert.ok(calls < 60000, `Long-word measurement is bounded (${calls})`);
});

function editor(
  i = item("text", 0, 0, { text: "One two three" }),
  options = {},
) {
  const dom = new JSDOM("<!doctype html><body></body>", {
    pretendToBeVisual: true,
  });
  const input = createTextEditor(dom.window.document, i, options);
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
test("plain-text fields retain language markup without importing rich clipboard formatting", () => {
  const app = editor(
    item("text", 0, 0, {
      text: "Hello bonjour",
      lang: "en",
      bold: true,
      textRuns: [
        {
          start: 6,
          end: 13,
          style: { lang: "fr", bold: true, link: "https://example.com/" },
        },
      ],
      textBlocks: [{ start: 0, list: "bullet", indent: 0 }],
    }),
    { plainTextOnly: true },
  );
  try {
    const { input, dom } = app;
    assert.equal(input.querySelector('[lang="en"]').textContent, "Hello ");
    assert.equal(input.querySelector('[lang="fr"]').textContent, "bonjour");
    assert.equal(input.querySelector("a"), null);
    assert.equal(input.querySelector('[role="list"]'), null);
    assert.equal(input.querySelector("span").style.fontWeight, "400");
    const before = structuredClone(input.textRuns);
    input.select();
    input.format("bold", false);
    assert.deepEqual(input.textRuns, before);
    assert.equal(input.setLink("https://other.example/"), false);
    const paste = new dom.window.Event("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData(type) {
          return type === "text/plain"
            ? "https://example.com/"
            : type === "text/html"
              ? '<b lang="de">https://example.com/</b>'
              : "";
        },
      },
    });
    input.dispatchEvent(paste);
    assert.equal(input.value, "https://example.com/");
    assert.equal(input.querySelector("a"), null);
    assert.equal(input.querySelector('[lang="de"]'), null);
    input.select();
    const copied = {};
    const copy = new dom.window.Event("copy", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(copy, "clipboardData", {
      value: { setData: (type, value) => (copied[type] = value) },
    });
    input.dispatchEvent(copy);
    assert.deepEqual(copied, { "text/plain": input.value });
    input.value = "😀".repeat(10001);
    assert.equal(input.value.length, 20000);
    assert.equal(input.value.at(-1).charCodeAt(0), 0xde00);
  } finally {
    app.close();
  }
});
function edit(app, type, data) {
  return app.input.dispatchEvent(
    new app.dom.window.InputEvent("beforeinput", {
      inputType: type,
      data,
      bubbles: true,
      cancelable: true,
    }),
  );
}
test("single-line authored fields keep language ranges, input limits and Enter submission", () => {
  const app = editor(
    item("text", 0, 0, {
      text: "Hello\nbonjour",
      lang: "en",
      textRuns: [run(6, 13, { lang: "fr" })],
    }),
    { plainTextOnly: true, maxLength: 200, multiline: false },
  );
  try {
    const { input, dom } = app;
    assert.equal(input.value, "Hellobonjour");
    assert.equal(input.querySelector('[lang="fr"]').textContent, "bonjour");
    assert.equal(input.getAttribute("aria-multiline"), "false");
    input.setSelectionRange(5, 5);
    edit(app, "insertParagraph");
    assert.equal(input.value, "Hellobonjour");
    const paste = (text) => {
      const event = new dom.window.Event("paste", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "clipboardData", {
        value: {
          getData: (type) => (type === "text/plain" ? text : "<b>Ignored</b>"),
        },
      });
      input.dispatchEvent(event);
    };
    input.select();
    // Lines pasted into a single-line field are joined by spaces, as a
    // browser pastes them into an input.
    paste("First\r\nSecond\nThird");
    assert.equal(input.value, "First Second Third");
    input.value = "x".repeat(199);
    input.setSelectionRange(199, 199);
    paste("😀");
    assert.equal(
      input.value,
      "x".repeat(199),
      "a partial surrogate is not inserted",
    );
    input.setSelectionRange(198, 199);
    paste("😀");
    assert.equal(input.value, "x".repeat(198) + "😀");
    assert.equal(input.value.length, 200);
    const form = dom.window.document.createElement("form");
    dom.window.document.body.append(form);
    form.append(input);
    let submissions = 0;
    form.onsubmit = (e) => {
      e.preventDefault();
      submissions++;
    };
    input.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(submissions, 0, "composition Enter does not submit");
    input.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(submissions, 1);
    assert.equal(input.value.includes("\n"), false);
  } finally {
    app.close();
  }
  const long = editor(item("text", 0, 0, { text: "x".repeat(240) }), {
    plainTextOnly: true,
    maxLength: 200,
    multiline: false,
  });
  try {
    long.input.setSelectionRange(0, 1);
    nativeInsert(long, "");
    assert.equal(
      long.input.value,
      "x".repeat(239),
      "deleting from an imported long label keeps its remaining text",
    );
  } finally {
    long.close();
  }
});
function nativeInsert(app, text) {
  edit(app, "insertText", text);
  const selection = app.dom.window.getSelection(),
    range = selection.getRangeAt(0);
  range.deleteContents();
  const node = app.dom.window.document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  app.input.dispatchEvent(
    new app.dom.window.InputEvent("input", {
      inputType: "insertText",
      data: text,
      bubbles: true,
    }),
  );
}

test("editor preserves selected words across toolbar focus, pending typing styles, native input, undo, redo, and literal clipboard text", () => {
  const app = editor(),
    { input, dom } = app;
  try {
    input.setSelectionRange(4, 7, "backward");
    const button = dom.window.document.createElement("button");
    dom.window.document.body.append(button);
    button.focus();
    input.format("bold");
    input.format("highlight", "#fff099");
    assert.deepEqual(input.textRuns, [
      run(4, 7, { bold: true, highlight: "#fff099" }),
    ]);
    assert.equal(input.selectionStart, 4);
    assert.equal(input.selectionEnd, 7);
    assert.equal(input.selectionDirection, "backward");
    input.select();
    assert.equal(input.rangeStyle("bold"), "mixed");
    input.setSelectionRange(7, 7);
    input.format("italic");
    nativeInsert(app, "!");
    assert.equal(input.value, "One two! three");
    assert.deepEqual(
      input.textRuns.at(-1),
      run(7, 8, { bold: true, highlight: "#fff099", italic: true }),
    );
    edit(app, "historyUndo");
    assert.equal(input.value, "One two three");
    edit(app, "historyRedo");
    assert.equal(input.value, "One two! three");
    edit(app, "insertParagraph");
    assert.equal(input.value, "One two!\n three");
    const event = new dom.window.Event("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "clipboardData", {
      value: {
        getData: (type) =>
          type === "text/plain" ? "<img src=x onerror=alert(1)>" : "",
      },
    });
    input.dispatchEvent(event);
    assert.equal(input.querySelector("img"), null);
    assert.ok(input.value.includes("<img src=x onerror=alert(1)>"));
  } finally {
    app.close();
  }
});

test("Y.Text formatting follows concurrent inserts, supports independent undo, and reaches an already-open editor", () => {
  const source = new SharedDocument(),
    i = item("text", 0, 0, { id: "rich", text: "One two three" });
  source.commit({ ...board(), items: [i] });
  source.undo.clear();
  const peer = new SharedDocument(source.update());
  const app = editor(i);
  let latest;
  const unbind = bindText(
    { shared: source, publish: async () => {} },
    i.id,
    app.input,
    (text, runs) => {
      latest = { text, runs };
    },
  );
  try {
    app.input.setSelectionRange(4, 7);
    app.input.format("bold");
    peer.text(i.id, "NEW One two three");
    const remote = peer.update();
    peer.apply(source.update());
    source.apply(remote);
    assert.deepEqual(source.snapshot().items, peer.snapshot().items);
    assert.deepEqual(latest.runs, [run(8, 11, { bold: true })]);
    assert.equal(app.input.value, "NEW One two three");
    assert.equal(app.input.selectionStart, 8);
    assert.equal(app.input.selectionEnd, 11);
    source.undo.undo();
    assert.equal(app.input.value, "NEW One two three");
    assert.deepEqual(app.input.textRuns, []);
    // A style chosen for the next typed text survives a remote edit.
    app.input.setSelectionRange(17, 17);
    app.input.format("bold");
    peer.apply(source.update(peer.vector()));
    peer.text(i.id, "Hi! NEW One two three");
    source.apply(peer.update(source.vector()));
    assert.equal(app.input.value, "Hi! NEW One two three");
    assert.equal(app.input.selectionStart, 21);
    assert.equal(app.input.rangeStyle("bold"), true);
    nativeInsert(app, "!");
    assert.deepEqual(app.input.textRuns, [run(21, 22, { bold: true })]);
    assert.throws(() =>
      runsFromDelta([{ insert: "bad", attributes: { href: "javascript:x" } }]),
    );
    source.validate();
    peer.validate();
  } finally {
    unbind();
    app.close();
    source.destroy();
    peer.destroy();
  }
});

test("5,000 styled objects reuse layout measurements during navigation and update after a style changes", () => {
  const ctx = createCanvas(300, 300).getContext("2d");
  const measure = ctx.measureText.bind(ctx);
  let calls = 0;
  ctx.measureText = (text) => {
    calls++;
    return measure(text);
  };
  const items = Array.from({ length: 5000 }, (_, n) =>
    item("text", n, 0, {
      text: "One important idea",
      w: 140,
      autoHeight: true,
      textRuns: [run(4, 13, { bold: true })],
    }),
  );
  for (const i of items) autoHeightLayout(i, ctx);
  calls = 0;
  for (const i of items) {
    i.x += 10;
    autoHeightLayout(i, ctx);
  }
  assert.equal(calls, 0);
  items[0].textRuns = [run(4, 13, { italic: true })];
  autoHeightLayout(items[0], ctx);
  assert.ok(calls > 0);
});

test("rich clipboard, empty lines, the length limit, and editing-history boundaries retain styles and content", () => {
  const a = editor(),
    b = editor(
      item("text", 0, 0, {
        text: "",
        textColor: "#ff0000",
        highlight: "#ffff00",
      }),
    );
  const data = new Map();
  const transfer = (app, type) => {
    const event = new app.dom.window.Event(type, {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "clipboardData", {
      value: {
        getData: (key) => data.get(key) || "",
        setData: (key, value) => data.set(key, value),
      },
    });
    app.input.dispatchEvent(event);
  };
  try {
    a.input.setSelectionRange(4, 7);
    a.input.format("italic");
    transfer(a, "copy");
    transfer(b, "paste");
    assert.equal(b.input.value, "two");
    assert.deepEqual(b.input.textRuns, [
      run(0, 3, {
        textColor: false,
        highlight: false,
        bold: false,
        italic: true,
        underline: false,
        strike: false,
      }),
    ]);
    assert.equal(b.input.querySelector("span").style.color, "rgb(48, 52, 47)");
    assert.equal(b.input.querySelector("span").style.backgroundColor, "");
    edit(b, "insertParagraph");
    edit(b, "insertParagraph");
    nativeInsert(b, "last");
    assert.equal(b.input.value, "two\n\nlast");
    b.input.value = "x".repeat(19999);
    b.input.setSelectionRange(19999, 19999);
    data.clear();
    data.set("text/plain", "🪴");
    transfer(b, "paste");
    assert.equal(
      b.input.value.length,
      19999,
      "Truncation never inserts half an emoji",
    );
    b.input.select();
    edit(b, "insertParagraph");
    assert.equal(b.input.value, "\n");
    b.input.setSelectionRange(0, 0);
    nativeInsert(b, "first");
    assert.equal(b.input.value, "first\n");
  } finally {
    a.close();
    b.close();
  }
});

test("IME merges a remote prefix and formatting without publishing an unfinished composition", () => {
  const shared = new SharedDocument(),
    i = item("text", 0, 0, {
      id: "ime",
      text: "One two",
      textRuns: [run(4, 7, { bold: true })],
    });
  shared.commit({ ...board(), items: [i] });
  const peer = new SharedDocument(shared.update()),
    app = editor(i);
  const unbind = bindText(
    { shared, publish: async () => {} },
    i.id,
    app.input,
    () => {},
  );
  try {
    app.input.setSelectionRange(7, 7);
    app.input.dispatchEvent(new app.dom.window.Event("compositionstart"));
    nativeInsert(app, "文");
    assert.equal(shared.snapshot().items[0].text, "One two");
    peer.text(i.id, "NEW One two", [
      run(0, 3, { italic: true }),
      run(8, 11, { bold: true }),
    ]);
    shared.apply(peer.update());
    app.input.dispatchEvent(new app.dom.window.Event("compositionend"));
    assert.equal(app.input.value, "NEW One two文");
    assert.deepEqual(app.input.textRuns, [
      run(0, 3, { italic: true }),
      run(8, 12, { bold: true }),
    ]);
    assert.equal(app.input.selectionEnd, 12);
  } finally {
    unbind();
    app.close();
    shared.destroy();
    peer.destroy();
  }
});

test("ranges can clear inherited colors/highlights and follow the theme without changing glyph layout", () => {
  const i = item("text", 0, 0, {
    text: "Clear Red",
    bold: true,
    textColor: "#ff0000",
    highlight: "#ffff00",
    fontSize: 30,
    w: 400,
    autoHeight: true,
  });
  const app = editor(i);
  try {
    app.input.setBaseStyle(i, "#ffffff");
    app.input.setSelectionRange(0, 5);
    app.input.format("textColor", null);
    app.input.format("highlight", null);
    app.input.format("bold", false);
    assert.deepEqual(app.input.textRuns, [
      run(0, 5, { textColor: false, highlight: false, bold: false }),
    ]);
    assert.equal(
      app.input.querySelector("span").style.color,
      "rgb(255, 255, 255)",
    );
    assert.equal(app.input.querySelector("span").style.backgroundColor, "");
    i.textRuns = app.input.textRuns;
    const connected = quickConnectPlan([i], i.id, "right");
    assert.equal(
      connected.node.textRuns,
      undefined,
      "A new blank node has no stale character ranges",
    );
    const shared = new SharedDocument();
    shared.commit({ ...board(), items: [i] });
    assert.deepEqual(shared.snapshot().items[0].textRuns, i.textRuns);
    shared.validate();
    shared.destroy();
    validateBoard({ ...board(), items: [i] });
    const canvas = createCanvas(400, 80),
      ctx = canvas.getContext("2d");
    drawObject(ctx, i, "#ffffff");
    const pixels = ctx.getImageData(0, 0, 70, 45).data;
    let white = 0,
      yellow = 0;
    for (let n = 0; n < pixels.length; n += 4) {
      if (
        pixels[n] > 220 &&
        pixels[n + 1] > 220 &&
        pixels[n + 2] > 220 &&
        pixels[n + 3] > 200
      )
        white++;
      if (
        pixels[n] > 220 &&
        pixels[n + 1] > 220 &&
        pixels[n + 2] < 50 &&
        pixels[n + 3] > 200
      )
        yellow++;
    }
    assert.ok(white > 50);
    assert.equal(yellow, 0);
  } finally {
    app.close();
  }
});

test("IME final DOM mutations commit as one local undo step and failed/empty clipboard operations preserve text", () => {
  const app = editor(),
    { input, dom } = app;
  try {
    input.setSelectionRange(4, 7);
    input.format("bold");
    input.setSelectionRange(7, 7);
    input.dispatchEvent(new dom.window.Event("compositionstart"));
    nativeInsert(app, "中");
    const walker = dom.window.document.createTreeWalker(input, 4);
    while (walker.nextNode()) {
      if (walker.currentNode.data === "中") {
        walker.currentNode.data = "中文";
        break;
      }
    }
    input.dispatchEvent(new dom.window.Event("compositionend"));
    assert.equal(input.value, "One two中文 three");
    edit(app, "historyUndo");
    assert.equal(input.value, "One two three");
    assert.deepEqual(input.textRuns, [run(4, 7, { bold: true })]);
    input.select();
    for (const type of ["paste", "cut"]) {
      const event = new dom.window.Event(type, {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "clipboardData", {
        value: {
          getData: () => "",
          setData: () => {
            throw Error("Unavailable");
          },
        },
      });
      input.dispatchEvent(event);
      assert.equal(input.value, "One two three");
    }
  } finally {
    app.close();
  }
});

test("text dragging moves styled words in one undo step and external HTML is literal", () => {
  const app = editor(),
    { input, dom } = app;
  const data = new Map();
  const transfer = {
    getData: (key) => data.get(key) || "",
    setData: (key, value) => data.set(key, value),
    dropEffect: "move",
  };
  const dispatch = (type) => {
    const event = new dom.window.Event(type, {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    input.dispatchEvent(event);
  };
  try {
    input.setSelectionRange(4, 7);
    input.format("bold");
    dispatch("dragstart");
    dom.window.document.caretPositionFromPoint = () => ({
      offsetNode: input.lastChild.firstChild,
      offset: input.lastChild.textContent.length,
    });
    dispatch("drop");
    assert.equal(input.value, "One  threetwo");
    assert.equal(input.textRuns.at(-1).start, 10);
    assert.equal(input.textRuns.at(-1).style.bold, true);
    edit(app, "historyUndo");
    assert.equal(input.value, "One two three");
    assert.deepEqual(input.textRuns, [run(4, 7, { bold: true })]);
    data.clear();
    data.set("text/plain", "<script>literal</script>");
    dispatch("drop");
    assert.equal(input.querySelector("script"), null);
    assert.ok(input.value.endsWith("<script>literal</script>"));
  } finally {
    app.close();
  }
});

test("early formatted input survives deferred shared-object creation without losing its first characters", () => {
  const shared = new SharedDocument(),
    i = item("text", 0, 0, { id: "early", text: "" }),
    app = editor(i);
  const unbind = bindText(
    { shared, publish: async () => {} },
    i.id,
    app.input,
    () => {},
  );
  try {
    nativeInsert(app, "First thought");
    app.input.setSelectionRange(0, 5);
    app.input.format("bold");
    app.input.format("textColor", "#2244aa");
    shared.commit({ ...board(), items: [i] });
    assert.equal(shared.snapshot().items[0].text, "First thought");
    assert.deepEqual(shared.snapshot().items[0].textRuns, [
      run(0, 5, { bold: true, textColor: "#2244aa" }),
    ]);
    const copy = new SharedDocument(shared.update());
    assert.deepEqual(copy.snapshot().items, shared.snapshot().items);
    copy.validate();
    copy.destroy();
  } finally {
    unbind();
    app.close();
    shared.destroy();
  }
});

test("typed text takes the style where the caret was, even beside the same character", () => {
  const typed = (text, textRuns, at, insert, format) => {
    const app = editor(item("text", 0, 0, { text, textRuns }));
    try {
      app.input.setSelectionRange(at, at);
      if (format) app.input.format(format);
      for (const character of insert) nativeInsert(app, character);
      return { text: app.input.value, runs: app.input.textRuns };
    } finally {
      app.close();
    }
  };
  // Continuing a bold word before a plain space keeps it bold.
  assert.deepEqual(typed("bold next", [run(0, 4, { bold: true })], 4, " me"), {
    text: "bold me next",
    runs: [run(0, 7, { bold: true })],
  });
  // Bold typed at the start goes on the new letter, not the old one.
  assert.deepEqual(typed("Lorem", [], 0, "L", "bold"), {
    text: "LLorem",
    runs: [run(0, 1, { bold: true })],
  });
  // Plain text typed after a plain letter stays before a bold one.
  assert.deepEqual(typed("xx", [run(1, 2, { bold: true })], 1, "x"), {
    text: "xxx",
    runs: [run(2, 3, { bold: true })],
  });
  // Backspace removes the letter before the caret, not its bold twin.
  const app = editor(
    item("text", 0, 0, { text: "xx", textRuns: [run(1, 2, { bold: true })] }),
  );
  try {
    app.input.setSelectionRange(1, 1);
    edit(app, "deleteContentBackward", null);
    const selection = app.dom.window.getSelection(),
      range = selection.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType === 3 && range.startOffset > 0)
      range.setStart(node, range.startOffset - 1);
    else {
      const text = app.input.querySelector("span, *")?.firstChild;
      range.setStart(text, 0);
      range.setEnd(text, 1);
    }
    range.deleteContents();
    app.input.dispatchEvent(
      new app.dom.window.InputEvent("input", {
        inputType: "deleteContentBackward",
        bubbles: true,
      }),
    );
    assert.equal(app.input.value, "x");
    assert.deepEqual(app.input.textRuns, [run(0, 1, { bold: true })]);
  } finally {
    app.close();
  }
});

test("plain editors allow selected language changes with undo while retaining plain formatting and paste", () => {
  const app = editor(
    item("text", 0, 0, { text: "Hello. Bonjour.", lang: "en" }),
    { plainTextOnly: true },
  );
  try {
    app.input.setSelectionRange(7, 15);
    app.input.format("lang", "fr-CA");
    assert.equal(
      app.input.querySelector('[lang="fr-CA"]').textContent,
      "Bonjour.",
    );
    app.input.format("bold", true);
    assert.deepEqual(app.input.textRuns, [
      { start: 7, end: 15, style: { lang: "fr-CA" } },
    ]);
    app.input.dispatchEvent(
      new app.dom.window.InputEvent("beforeinput", {
        inputType: "historyUndo",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(app.input.querySelector('[lang="fr-CA"]'), null);
    app.input.dispatchEvent(
      new app.dom.window.InputEvent("beforeinput", {
        inputType: "historyRedo",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(
      app.input.querySelector('[lang="fr-CA"]').textContent,
      "Bonjour.",
    );
  } finally {
    app.close();
  }
});

test("generated language ranges stay on retained prompt text while replacement typing has no inferred language", () => {
  const prompt = item("text", 0, 0, {
    text: "Votre texte",
    textRuns: [run(0, 11, { lang: "fr" })],
  });
  const app = editor(prompt, { inheritLanguage: false });
  try {
    assert.equal(
      app.input.querySelector('[lang="fr"]').textContent,
      prompt.text,
    );
    app.input.select();
    nativeInsert(app, "An authored heading");
    assert.equal(app.input.value, "An authored heading");
    assert.deepEqual(app.input.textRuns, []);
    edit(app, "historyUndo");
    assert.equal(app.input.value, prompt.text);
    assert.deepEqual(app.input.textRuns, prompt.textRuns);
    app.input.setSelectionRange(6, 11);
    nativeInsert(app, "heading");
    assert.equal(app.input.value, "Votre heading");
    assert.deepEqual(app.input.textRuns, [run(0, 6, { lang: "fr" })]);
    app.input.select();
    app.input.value = "日本語";
    assert.deepEqual(app.input.textRuns, []);
  } finally {
    app.close();
  }
});

test("generated prompts retain explicit language choices, formatting, pasted declarations and ordinary editor inheritance", () => {
  const prompt = item("text", 0, 0, {
    text: "Your text",
    textRuns: [run(0, 9, { lang: "en" })],
  });
  const app = editor(prompt, { inheritLanguage: false });
  const ordinary = editor(prompt);
  try {
    app.input.setSelectionRange(9, 9);
    app.input.format("bold", true);
    nativeInsert(app, " heading");
    assert.deepEqual(app.input.textRuns, [
      run(0, 9, { lang: "en" }),
      run(9, 17, { bold: true }),
    ]);
    app.input.select();
    app.input.format("lang", "fr-CA");
    nativeInsert(app, "Bonjour à tous.");
    assert.equal(app.input.textRuns[0].style.lang, "fr-CA");
    app.input.select();
    app.input.format("lang", null);
    nativeInsert(app, "Undeclared replacement");
    assert.ok(app.input.textRuns.every((r) => r.style.lang === undefined));
    app.input.select();
    const paste = new app.dom.window.Event("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData: (type) =>
          type === "text/html"
            ? '<span lang="de">Guten Morgen.</span>'
            : type === "text/plain"
              ? "Guten Morgen."
              : "",
      },
    });
    app.input.dispatchEvent(paste);
    assert.equal(app.input.value, "Guten Morgen.");
    assert.equal(app.input.textRuns[0].style.lang, "de");
    ordinary.input.select();
    nativeInsert(ordinary, "Existing declared text");
    assert.deepEqual(ordinary.input.textRuns, [run(0, 22, { lang: "en" })]);
  } finally {
    app.close();
    ordinary.close();
  }
});

test("new generated prompt declarations survive shared undo and IME replacement does not declare an unknown language", () => {
  const shared = new SharedDocument();
  const prompt = item("text", 0, 0, {
    id: "generated-prompt",
    text: "Votre texte",
    textRuns: [run(0, 11, { lang: "fr" })],
  });
  shared.commit({ ...board(), items: [prompt] });
  const peer = new SharedDocument(shared.update());
  const app = editor(prompt, { inheritLanguage: false });
  const unbind = bindText(
    { shared, publish: async () => {} },
    prompt.id,
    app.input,
    () => {},
  );
  try {
    shared.undo.clear();
    app.input.select();
    app.input.dispatchEvent(new app.dom.window.Event("compositionstart"));
    nativeInsert(app, "日本語");
    assert.equal(shared.snapshot().items[0].text, prompt.text);
    app.input.dispatchEvent(new app.dom.window.Event("compositionend"));
    shared.validate();
    assert.equal(shared.snapshot().items[0].text, "日本語");
    assert.ok(!shared.snapshot().items[0].textRuns?.length);
    peer.apply(shared.update());
    assert.deepEqual(peer.snapshot().items, shared.snapshot().items);
    shared.undo.undo();
    assert.equal(shared.snapshot().items[0].text, prompt.text);
    assert.deepEqual(shared.snapshot().items[0].textRuns, prompt.textRuns);
    assert.equal(
      app.input.querySelector('[lang="fr"]').textContent,
      prompt.text,
    );
    shared.undo.redo();
    assert.equal(app.input.value, "日本語");
    assert.deepEqual(app.input.textRuns, []);
  } finally {
    unbind();
    app.close();
    shared.destroy();
    peer.destroy();
  }
});

test("formatted text keeps words joined by no-break spaces on one line, as plain text does", async () => {
  const { wrapText, textStyle } = await import("../src/text.js");
  const ctx = createCanvas(10, 10).getContext("2d");
  for (const space of [" ", " "]) {
    const text = `Quelle surprise${space}!`;
    const plain = item("note", 0, 0, { text, fontSize: 20 });
    ctx.font = textStyle(plain).font;
    // Wide enough for "Quelle surprise" but not for the whole sentence.
    const width = ctx.measureText("Quelle surprise").width + 4;
    const rich = item("note", 0, 0, {
      text,
      fontSize: 20,
      textRuns: [{ start: 0, end: 6, style: { bold: true } }],
    });
    assert.deepEqual(wrapText(ctx, text, width), [
      "Quelle",
      `surprise${space}!`,
    ]);
    assert.deepEqual(
      richTextLayout(rich, ctx, width).map((line) => line.text.trimEnd()),
      ["Quelle", `surprise${space}!`],
    );
  }
});

test("lines pasted into a single-line field are joined with spaces, not run together", () => {
  const app = editor(item("text", 0, 0, { text: "" }), {
    plainTextOnly: true,
    multiline: false,
  });
  try {
    const paste = new app.dom.window.Event("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData: (type) =>
          type === "text/plain" ? "First line\r\nSecond line\n\nThird " : "",
      },
    });
    app.input.dispatchEvent(paste);
    assert.equal(app.input.value, "First line Second line Third ");
  } finally {
    app.close();
  }
});
