import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCanvas } from "./canvas.js";
import { item, board, validateBoard } from "../src/model.js";
import {
  validateTextBlocks,
  textParagraphs,
  listRows,
  paragraphAt,
  formatTextBlocks,
  indentTextBlocks,
  spliceTextBlocks,
  listPlainText,
  readListHTML,
} from "../src/text-blocks.js";
import {
  autoHeightLayout,
  fitTextLayout,
  listTextLayout,
} from "../src/text.js";
import { createTextEditor } from "../src/text-editor.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { bindText } from "../src/collaboration/text-binding.js";
import { drawObject } from "../src/render.js";
import { clipboardFormats } from "../src/transfer.js";
const block = (start, list = "bullet", indent = 0) => ({ start, list, indent });

test("paragraph lists validate boundaries, number nested items, and keep descendants during indentation", () => {
  const text = "Alpha\nBeta\nGamma\nDelta",
    blocks = [
      block(0, "number"),
      block(6, "number", 1),
      block(11, "number", 1),
      block(17, "number"),
    ];
  validateTextBlocks(text, blocks);
  assert.deepEqual(
    listRows(text, blocks).map((r) => r.marker),
    ["1.", "1.", "2.", "2."],
  );
  assert.equal(
    listPlainText(text, blocks),
    "1. Alpha\n  1. Beta\n  2. Gamma\n2. Delta",
  );
  assert.equal(paragraphAt("\n", [block(0)], 0).start, 0);
  for (const bad of [
    [block(1)],
    [block(0), block(0)],
    [block(0, "other")],
    [block(0, "bullet", 8)],
    [block(text.length + 1)],
  ])
    assert.throws(() => validateTextBlocks(text, bad));
  const levels = [block(0), block(6), block(11, "bullet", 1), block(17)];
  assert.deepEqual(
    indentTextBlocks(text, levels, 6, 10, 1).map((b) => b.indent),
    [0, 1, 2, 0],
  );
  assert.equal(
    indentTextBlocks(text, levels, 0, 5, 1),
    levels,
    "The first list item cannot become its own child",
  );
  assert.deepEqual(
    formatTextBlocks(text, blocks, 6, 11, null),
    [blocks[0], blocks[2], blocks[3]],
    "A selection ending at the next paragraph does not format that paragraph",
  );
});

test("paragraph styles follow line endings through replacements, splits, and an empty tail", () => {
  const text = "Alpha\nBeta",
    blocks = [block(0), block(6, "number")];
  assert.deepEqual(spliceTextBlocks(text, blocks, 2, 2, "\n"), [
    block(0),
    block(3),
    block(7, "number"),
  ]);
  assert.deepEqual(spliceTextBlocks(text, blocks, 10, 10, "\n"), [
    block(0),
    block(6, "number"),
    block(11, "number"),
  ]);
  assert.deepEqual(spliceTextBlocks(text, blocks, 0, 6, ""), [
    block(0, "number"),
  ]);
  assert.deepEqual(spliceTextBlocks("", [block(0)], 0, 0, "First"), [block(0)]);
  validateBoard({
    ...board(),
    items: [item("text", 0, 0, { text: "", textBlocks: [block(0)] })],
  });
});

function setup(i = item("text", 0, 0, { text: "Alpha\nBeta" })) {
  const dom = new JSDOM("<!doctype html><body></body>", {
    pretendToBeVisual: true,
  });
  const input = createTextEditor(dom.window.document, i);
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
const before = (app, type, data) =>
  app.input.dispatchEvent(
    new app.dom.window.InputEvent("beforeinput", {
      inputType: type,
      data,
      bubbles: true,
      cancelable: true,
    }),
  );
function insert(app, text) {
  if (!before(app, "insertText", text)) return;
  const sel = app.dom.window.getSelection(),
    range = sel.getRangeAt(0),
    node = app.dom.window.document.createTextNode(text);
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  app.input.dispatchEvent(
    new app.dom.window.InputEvent("input", {
      inputType: "insertText",
      data: text,
      bubbles: true,
    }),
  );
}

test("list editing supports empty items, Enter, soft breaks, indentation, Backspace, markdown and undo", () => {
  const app = setup(),
    { input, dom } = app;
  try {
    input.select();
    input.setList("number");
    assert.deepEqual(input.textBlocks, [
      block(0, "number"),
      block(6, "number"),
    ]);
    assert.deepEqual(
      [...input.querySelectorAll("[data-list-marker]")].map(
        (n) => n.dataset.listMarker,
      ),
      ["1.", "2."],
    );
    input.setSelectionRange(6, 10);
    input.format("bold");
    assert.equal(input.selectionStart, 6);
    assert.equal(input.selectionEnd, 10);
    input.indentList(1);
    assert.equal(input.textBlocks[1].indent, 1);
    input.setSelectionRange(10);
    const softBreak = new dom.window.KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(softBreak);
    assert.equal(softBreak.defaultPrevented, true);
    insert(app, "more");
    assert.equal(input.value, "Alpha\nBeta\u2028more");
    assert.equal(input.querySelectorAll("[role=listitem]").length, 2);
    before(app, "insertParagraph");
    assert.equal(input.textBlocks.at(-1).indent, 1);
    before(app, "insertParagraph");
    assert.equal(
      input.textBlocks.at(-1).indent,
      0,
      "An empty nested item exits one level",
    );
    before(app, "insertParagraph");
    assert.equal(
      input.textBlocks.length,
      2,
      "A second Enter finishes the list",
    );
    insert(app, "plain");
    assert.equal(input.listStyle(), false);
    input.setSelectionRange(6);
    before(app, "deleteContentBackward");
    assert.equal(input.textBlocks[1].indent, 0);
    before(app, "deleteContentBackward");
    assert.equal(input.textBlocks.length, 1);
    before(app, "historyUndo");
    assert.equal(input.textBlocks[1].list, "number");
    input.value = "";
    input.setRichText("", [], []);
    input.setSelectionRange(0);
    insert(app, "-");
    insert(app, " ");
    assert.equal(input.value, "");
    assert.deepEqual(input.textBlocks, [block(0)]);
    insert(app, "Idea");
    assert.equal(input.value, "Idea");
    before(app, "insertParagraph");
    insert(app, "Next");
    assert.equal(input.value, "Idea\nNext");
    assert.deepEqual(input.textBlocks, [block(0), block(5)]);
    const tab = new dom.window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(tab);
    assert.equal(tab.defaultPrevented, true);
    assert.equal(input.textBlocks[1].indent, 1);
  } finally {
    app.close();
  }
});

test("legacy composition keys leave list indentation, soft breaks, and edit history to the IME", () => {
  for (const options of [
    { key: "Tab" },
    { key: "Enter", shiftKey: true },
    { key: "z", ctrlKey: true },
  ]) {
    const app = setup();
    try {
      app.input.select();
      app.input.setList("bullet");
      app.input.setSelectionRange(app.input.value.length);
      const value = app.input.value,
        blocks = structuredClone(app.input.textBlocks),
        range = [app.input.selectionStart, app.input.selectionEnd];
      const event = new app.dom.window.KeyboardEvent("keydown", {
        ...options,
        keyCode: 229,
        bubbles: true,
        cancelable: true,
      });
      app.input.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false);
      assert.equal(app.input.value, value);
      assert.deepEqual(app.input.textBlocks, blocks);
      assert.deepEqual(
        [app.input.selectionStart, app.input.selectionEnd],
        range,
      );
      app.input.dispatchEvent(
        new app.dom.window.KeyboardEvent("keydown", {
          ...options,
          bubbles: true,
          cancelable: true,
        }),
      );
      assert.ok(
        app.input.value !== value ||
          JSON.stringify(app.input.textBlocks) !== JSON.stringify(blocks),
      );
    } finally {
      app.close();
    }
  }
});

test("list clipboard uses semantic HTML and readable plain text, imports nested external lists without executable markup", () => {
  const source = setup(),
    target = setup(item("text", 0, 0, { text: "" })),
    data = new Map();
  const transfer = (app, type) => {
    const event = new app.dom.window.Event(type, {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "clipboardData", {
      value: {
        getData: (k) => data.get(k) || "",
        setData: (k, v) => data.set(k, v),
      },
    });
    app.input.dispatchEvent(event);
  };
  try {
    source.input.select();
    source.input.setList("number");
    source.input.setSelectionRange(6, 10);
    source.input.indentList(1);
    source.input.format("italic");
    source.input.select();
    transfer(source, "copy");
    assert.equal(data.get("text/plain"), "1. Alpha\n  1. Beta");
    const markup = source.dom.window.document.createElement("div");
    markup.innerHTML = data.get("text/html");
    assert.equal(markup.querySelector("ol > li > ol > li").textContent, "Beta");
    assert.equal(
      markup.querySelector("ol > li").firstChild.textContent,
      "Alpha",
    );
    transfer(target, "paste");
    assert.equal(target.input.value, source.input.value);
    assert.deepEqual(target.input.textBlocks, source.input.textBlocks);
    assert.ok(
      target.input.textRuns.some((r) => r.start === 6 && r.style.italic),
    );
    const html =
      '<ol><li onclick="evil()">First<ul><li>Nested<br>continued</li></ul></li><li>Last<script>evil()</script><img src="bad" onerror="evil()"></li></ol>';
    const parsed = readListHTML(target.dom.window.document, html);
    assert.deepEqual(parsed, {
      text: "First\nNested\u2028continued\nLast",
      blocks: [block(0, "number"), block(6, "bullet", 1), block(23, "number")],
    });
    data.clear();
    data.set("text/html", html);
    data.set("text/plain", "External list");
    target.input.select();
    transfer(target, "paste");
    assert.equal(target.input.value, parsed.text);
    assert.deepEqual(target.input.textBlocks, parsed.blocks);
    assert.equal(target.input.querySelector("script,img"), null);
    // Mixed plain/list paragraphs must not inherit the destination's list.
    data.clear();
    data.set("text/html", "<p>Intro</p><ul><li>Idea</li></ul><p>End</p>");
    data.set("text/plain", "Intro\nIdea\nEnd");
    target.input.select();
    transfer(target, "paste");
    assert.equal(target.input.value, "Intro\nIdea\nEnd");
    assert.deepEqual(target.input.textBlocks, [block(6)]);
    assert.equal(
      clipboardFormats([
        {
          ...item("text", 0, 0),
          text: target.input.value,
          textBlocks: target.input.textBlocks,
        },
      ])["text/plain"],
      "Intro\n• Idea\nEnd",
    );
    assert.equal(
      readListHTML(target.dom.window.document, "x".repeat(1000001)),
      null,
    );
  } finally {
    source.close();
    target.close();
  }
});

test("list wrapping reserves a hanging indent, draws markers and final lines, and caches 5,000 unchanged objects", () => {
  const canvas = createCanvas(300, 300),
    ctx = canvas.getContext("2d");
  const i = item("text", 0, 0, {
    text: "Alpha is long enough to wrap\nLast",
    w: 170,
    h: 200,
    fontSize: 24,
    textBlocks: [block(0, "number"), block(29, "number")],
  });
  i.textBlocks[1].start = i.text.indexOf("\n") + 1;
  const lines = listTextLayout(i, ctx, i.w);
  assert.ok(lines.length >= 3);
  assert.equal(lines[0].marker, "1.");
  assert.equal(lines.at(-1).marker, "2.");
  assert.ok(
    lines.slice(1, -1).every((l) => !l.marker && l.indent === lines[0].indent),
  );
  drawObject(ctx, i, "#30342f");
  const count = (x, y, w, h) => {
    const data = ctx.getImageData(x, y, w, h).data;
    let n = 0;
    for (let a = 3; a < data.length; a += 4) if (data[a]) n++;
    return n;
  };
  assert.ok(count(0, 0, 30, 32) > 10, "The marker is actually painted");
  assert.ok(
    count(36, Math.floor((lines.length - 1) * 24 * 1.35), 100, 32) > 10,
    "Manual-height text paints the final wrapped item",
  );
  i.type = "note";
  i.autoFontSize = true;
  i.h = 95;
  const fitted = fitTextLayout(i, ctx);
  assert.ok(fitted.style.size < 24);
  const hundred = item("text", 0, 0, {
    text: Array(100).fill("X").join("\n"),
    textBlocks: Array.from({ length: 100 }, (_, n) => block(n * 2, "number")),
  });
  const numbered = listTextLayout(hundred, ctx, 200);
  assert.equal(numbered.at(-1).marker, "100.");
  assert.ok(numbered.at(-1).indent >= numbered.at(-1).markerWidth + 12);
  let calls = 0;
  const measure = ctx.measureText.bind(ctx);
  ctx.measureText = (text) => {
    calls++;
    return measure(text);
  };
  const many = Array.from({ length: 5000 }, (_, n) =>
    item("text", n, 0, {
      text: "First\nSecond",
      autoHeight: true,
      textBlocks: [block(0), block(6)],
    }),
  );
  for (const row of many) autoHeightLayout(row, ctx);
  calls = 0;
  for (const row of many) {
    row.x += 5;
    autoHeightLayout(row, ctx);
  }
  assert.equal(calls, 0);
});

test("shared paragraph attributes follow concurrent inserted text and preserve an empty final item and independent undo", () => {
  const a = new SharedDocument(),
    i = item("text", 0, 0, {
      id: "list",
      text: "First\nSecond\n",
      textBlocks: [block(0), block(6), block(13)],
    });
  a.commit({ ...board(), items: [i] });
  a.undo.clear();
  const b = new SharedDocument(a.update()),
    app = setup(i);
  const unbind = bindText(
    { shared: a, publish: async () => {} },
    i.id,
    app.input,
    () => {},
  );
  try {
    app.input.setSelectionRange(6, 12);
    app.input.setList("number");
    b.text(i.id, "NEW First\nSecond\n");
    const remote = b.update();
    b.apply(a.update());
    a.apply(remote);
    assert.deepEqual(a.snapshot().items, b.snapshot().items);
    assert.deepEqual(app.input.textBlocks, [
      block(0),
      block(10, "number"),
      block(17),
    ]);
    a.undo.undo();
    assert.equal(app.input.value, "NEW First\nSecond\n");
    assert.deepEqual(app.input.textBlocks, [block(0), block(10), block(17)]);
    app.input.setSelectionRange(17);
    app.input.setList("number");
    assert.equal(a.snapshot().items[0].textBlocks.at(-1).list, "number");
    b.apply(a.update());
    assert.equal(b.snapshot().items[0].textBlocks.at(-1).list, "number");
    a.validate();
    b.validate();
  } finally {
    unbind();
    app.close();
    a.destroy();
    b.destroy();
  }
});

test("early list edits survive deferred shared creation and composition merges remote paragraph styles", () => {
  const i = item("text", 0, 0, { id: "deferred-list", text: "Alpha\nBeta" }),
    app = setup(i),
    a = new SharedDocument(),
    session = { shared: a, readOnly: false, publish: async () => {} },
    unbind = bindText(session, i.id, app.input, () => {});
  let remote;
  try {
    app.input.select();
    app.input.setList("number");
    app.input.setSelectionRange(10);
    before(app, "insertParagraph");
    insert(app, "Third");
    assert.equal(a.items.size, 0);
    a.commit({ ...board(), items: [i] });
    assert.equal(a.snapshot().items[0].text, "Alpha\nBeta\nThird");
    assert.deepEqual(a.snapshot().items[0].textBlocks, [
      block(0, "number"),
      block(6, "number"),
      block(11, "number"),
    ]);
    remote = new SharedDocument(a.update());
    app.input.dispatchEvent(new app.dom.window.Event("compositionstart"));
    const span = app.input.querySelectorAll("[data-paragraph] span")[2];
    span.firstChild.appendData("日本");
    app.input.dispatchEvent(
      new app.dom.window.InputEvent("input", {
        isComposing: true,
        inputType: "insertCompositionText",
      }),
    );
    remote.text(i.id, "NEW Alpha\nBeta\nThird", undefined, [
      block(0),
      block(10, "number"),
      block(15, "number"),
    ]);
    a.apply(remote.update());
    app.input.dispatchEvent(new app.dom.window.Event("compositionend"));
    assert.equal(app.input.value, "NEW Alpha\nBeta\nThird日本");
    assert.deepEqual(app.input.textBlocks, [
      block(0),
      block(10, "number"),
      block(15, "number"),
    ]);
    a.validate();
  } finally {
    unbind();
    app.close();
    a.destroy();
    remote?.destroy();
  }
});

test("HTML list import bounds markup depth and text size without splitting Unicode", () => {
  const app = setup();
  try {
    const doc = app.dom.window.document;
    assert.equal(
      readListHTML(
        doc,
        `${"<div>".repeat(100)}<ul><li>A</li></ul>${"</div>".repeat(100)}`,
      ),
      null,
    );
    const large = readListHTML(
      doc,
      `<ul><li>${"a".repeat(19999)}😀${"x".repeat(10000)}</li><li>tail</li></ul>`,
    );
    assert.equal(large.text.length, 20000);
    assert.equal(large.text.endsWith("\n"), true);
    assert.equal(/[\uD800-\uDBFF]/.test(large.text), false);
    validateTextBlocks(large.text, large.blocks);
  } finally {
    app.close();
  }
});
test("pasting inline text or a link into a list item keeps its bullet", () => {
  const app = setup(
    item("text", 0, 0, { text: "Title\nbeta", textBlocks: [block(6)] }),
  );
  const data = new Map();
  const transfer = (type) => {
    const event = new app.dom.window.Event(type, {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "clipboardData", {
      value: {
        getData: (k) => data.get(k) || "",
        setData: (k, v) => data.set(k, v),
      },
    });
    app.input.dispatchEvent(event);
  };
  try {
    app.input.setSelectionRange(0, 5);
    transfer("copy");
    app.input.setSelectionRange(10, 10);
    transfer("paste");
    assert.equal(app.input.value, "Title\nbetaTitle");
    assert.deepEqual(app.input.textBlocks, [block(6)]);
    data.clear();
    data.set("text/html", '<a href="https://example.com/">see docs</a>');
    data.set("text/plain", "see docs");
    app.input.setSelectionRange(6, 6);
    transfer("paste");
    assert.equal(app.input.value, "Title\nsee docsbetaTitle");
    assert.deepEqual(app.input.textBlocks, [block(6)]);
  } finally {
    app.close();
  }
});
