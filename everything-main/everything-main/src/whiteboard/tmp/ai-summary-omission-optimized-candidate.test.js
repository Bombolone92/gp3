import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { JSDOM } from "jsdom";
import { board, item, validateBoard } from "../src/model.js";
import { createAI, boardText } from "./ai-summary-omission-optimized-candidate.js";
import { language, setLanguage } from "../src/i18n.js";
import { fieldContent } from "../src/facilitation/authored-field.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { clipboardFormats, readFragment } from "../src/transfer.js";
import { readTextHTML } from "../src/text-blocks.js";

function setup(text = "Veuillez lire cette étape. Read first.") {
  const dom = new JSDOM(
    '<dialog open><div id="ai-work"></div><p id="ai-status"></p></dialog>',
    { url: "https://whiteboard.test" },
  );
  const globals = Object.fromEntries(
    ["document", "localStorage", "navigator", "ClipboardItem"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const previousLanguage = language;
  const copied = [];
  for (const [key, value] of Object.entries({
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    navigator: {
      clipboard: {
        async write(values) {
          copied.push(...values);
        },
      },
    },
    ClipboardItem: class {
      constructor(data) {
        this.data = data;
      }
    },
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  setLanguage("en");
  const b = board("Summary declarations");
  b.items = [
    item("note", 0, 0, { text: "Visible source.", id: "visible" }),
    item("note", 0, 0, { text: "Private source.", id: "private" }),
  ];
  const d = dom.window.document.querySelector("dialog");
  d.close = () => {
    d.open = false;
    d.dispatchEvent(new dom.window.Event("close"));
    d.remove();
  };
  let handler = async () => ({ text }),
    editable = true,
    refused = false,
    writes = 0;
  let shown = new Set(["visible"]),
    chosen = new Set();
  const prompts = [],
    toasts = [];
  const ai = createAI({
    org: {
      info: { role: "member" },
      allows: () => true,
      async request(op, data) {
        prompts.push(data);
        return handler(data);
      },
    },
    session: () => null,
    board: () => b,
    view: () => ({ ...b, items: b.items.filter((i) => shown.has(i.id)) }),
    selection: () => chosen,
    canEdit: () => editable,
    mutate(fn) {
      writes++;
      const before = structuredClone(b.items);
      fn();
      if (refused) b.items = before;
    },
    select() {},
    center: () => ({ x: 0, y: 0 }),
    toast: (message) => toasts.push(message),
    refresh() {},
    puter: () => null,
  });
  return {
    dom,
    doc: dom.window.document,
    d,
    b,
    ai,
    prompts,
    copied,
    toasts,
    show(ids) {
      shown = new Set(ids);
    },
    choose(ids) {
      chosen = new Set(ids);
    },
    get input() {
      return d.querySelector("#ai-summary");
    },
    response(fn) {
      handler = fn;
    },
    editable(value) {
      editable = value;
    },
    refused(value) {
      refused = value;
    },
    writes: () => writes,
    declare(tag, scope = "field", start = 0, end = start) {
      const input = this.input;
      input.setSelectionRange(start, end);
      d.querySelector("#ai-summary-language-options").click();
      d.querySelector("#ai-summary-language-scope").value = scope;
      d.querySelector("#ai-summary-language-tag").value = tag;
      d.querySelector("#ai-summary-language-save").click();
    },
    close() {
      d.close();
      setLanguage(previousLanguage);
      dom.window.close();
      for (const [key, descriptor] of Object.entries(globals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test("reviewed summary whole/passage declarations reach safe clipboard HTML, saved objects and shared storage", async () => {
  const text = 'Début. Read first. <img id="summary-injection"> Fin.';
  const a = setup(text);
  try {
    await a.ai.summarize(a.d);
    assert.match(a.prompts[0].prompt, /Visible source/);
    assert.doesNotMatch(a.prompts[0].prompt, /Private source/);
    a.input.value = ` \n${text} \n`;
    a.declare("fr-ca");
    const start = a.input.value.indexOf("Read first.");
    a.declare("en-ca", "text", start, start + 11);
    assert.equal(
      a.input.querySelector('[lang="en-CA"]').textContent,
      "Read first.",
    );
    assert.equal(a.input.getAttribute("aria-labelledby"), "ai-summary-label");
    assert.equal(a.input.getAttribute("role"), "textbox");
    assert.equal(a.doc.querySelector("#summary-injection"), null);
    a.d.querySelector("#ai-copy").click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(await a.copied[0].data["text/plain"].text(), ` \n${text} \n`);
    const html = await a.copied[0].data["text/html"].text();
    const imported = readTextHTML(a.doc, html);
    const english = imported.runs.find((r) => r.style.lang === "en-CA");
    assert.equal(
      imported.text.slice(english.start, english.end),
      "Read first.",
    );
    assert.ok(imported.runs.some((r) => r.style.lang === "fr-CA"));
    const pasted = new JSDOM(html);
    try {
      assert.ok(pasted.window.document.querySelector('[lang="fr-CA"]'));
      assert.equal(
        pasted.window.document.querySelector('[lang="en-CA"]').textContent,
        "Read first.",
      );
      assert.equal(pasted.window.document.querySelector("img"), null);
    } finally {
      pasted.window.close();
    }
    a.d.querySelector("#ai-add").click();
    const note = a.b.items.find((i) => i.type === "text");
    assert.equal(note.text, text);
    assert.equal(note.lang, "fr-CA");
    assert.deepEqual(note.textRuns, [
      { start: 7, end: 18, style: { lang: "en-CA" } },
    ]);
    validateBoard(a.b);
    const shared = new SharedDocument();
    let peer;
    try {
      shared.commit(a.b);
      peer = new SharedDocument(shared.update());
      const restored = peer
        .snapshot(a.b.id)
        .items.find((i) => i.id === note.id);
      assert.equal(restored.lang, "fr-CA");
      assert.deepEqual(restored.textRuns, note.textRuns);
      const formats = clipboardFormats([note]);
      for (const types of [Object.keys(formats), ["text/html"]]) {
        const saved = readFragment({
          getData: (type) => (types.includes(type) ? formats[type] || "" : ""),
        })[0];
        assert.equal(saved.lang, "fr-CA");
        assert.deepEqual(saved.textRuns, note.textRuns);
      }
    } finally {
      shared.destroy();
      peer?.destroy();
    }
  } finally {
    a.close();
  }
});

test("summary review keeps the requested language across delayed responses and later interface changes", async () => {
  const a = setup();
  let release;
  try {
    setLanguage("fr");
    a.response(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = a.ai.summarize(a.d);
    assert.match(a.prompts[0].prompt, /Canadian French/);
    setLanguage("en");
    release({ text: "Veuillez lire cette étape." });
    await pending;
    assert.equal(fieldContent(a.input).lang, "fr");
    assert.equal(
      a.input.querySelector('[lang="fr"]').textContent,
      "Veuillez lire cette étape.",
    );
    a.d.querySelector("#ai-add").click();
    assert.equal(a.b.items.find((i) => i.type === "text").lang, "fr");
  } finally {
    a.close();
  }
});

test("summary authors can clear defaults, retain only a passage and reject invalid or stale declarations", async () => {
  const a = setup();
  try {
    await a.ai.summarize(a.d);
    a.declare('fr"bad');
    assert.equal(a.d.querySelector("#ai-summary-language-error").hidden, false);
    assert.equal(fieldContent(a.input).lang, "en");
    a.d.querySelector("#ai-summary-language-cancel").click();
    a.declare("fr-CA");
    const start = a.input.value.indexOf("Read first.");
    a.declare("en-CA", "text", start, start + 11);
    a.declare("");
    assert.equal(fieldContent(a.input).lang, undefined);
    a.input.setSelectionRange(0, 7);
    a.d.querySelector("#ai-summary-language-options").click();
    a.d.querySelector("#ai-summary-language-tag").value = "es";
    a.input.value = "Updated. " + a.input.value;
    a.d.querySelector("#ai-summary-language-save").click();
    assert.equal(a.d.querySelector("#ai-summary-language-error").hidden, false);
    assert.equal(
      fieldContent(a.input).textRuns.some((r) => r.style.lang === "es"),
      false,
    );
    a.d.querySelector("#ai-summary-language-cancel").click();
    a.d.querySelector("#ai-add").click();
    const saved = a.b.items.find((i) => i.type === "text");
    assert.equal(saved.lang, undefined);
    assert.ok(saved.textRuns.every((r) => r.style.lang === "en-CA"));
    validateBoard(a.b);
  } finally {
    a.close();
  }
});

test("summary insertion clips language ranges and the existing text cap at complete Unicode characters", async () => {
  const a = setup("x".repeat(19999) + "😀 Read first.");
  try {
    await a.ai.summarize(a.d);
    assert.ok(
      a.input.value.length > 20000,
      "the complete response is available for review",
    );
    a.declare("fr-CA");
    a.declare("en-CA", "text", 19998, a.input.value.length);
    a.d.querySelector("#ai-add").click();
    const note = a.b.items.find((i) => i.type === "text");
    assert.equal(note.text, "x".repeat(19999));
    assert.equal(note.lang, "fr-CA");
    assert.deepEqual(note.textRuns, [
      { start: 19998, end: 19999, style: { lang: "en-CA" } },
    ]);
    validateBoard(a.b);
  } finally {
    a.close();
  }
});

test("replacing or closing summary review destroys editors and late replies do not recreate them", async () => {
  const a = setup();
  let release;
  try {
    await a.ai.summarize(a.d);
    a.declare("fr-CA");
    const first = a.input,
      destroy = first.destroy;
    let destroyed = 0;
    first.destroy = () => {
      destroyed++;
      destroy();
    };
    a.response(async () => {
      throw Error("Request failed");
    });
    await a.ai.summarize(a.d);
    assert.equal(a.input, first);
    assert.equal(fieldContent(a.input).lang, "fr-CA");
    a.ai.generate(a.d);
    assert.equal(destroyed, 1);
    a.response(async () => ({ text: "Another summary." }));
    await a.ai.summarize(a.d);
    const last = a.input,
      destroyLast = last.destroy;
    last.destroy = () => {
      destroyed++;
      destroyLast();
    };
    a.response(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = a.ai.summarize(a.d);
    a.d.close();
    assert.equal(destroyed, 2);
    release({ text: "A late summary." });
    await pending;
    assert.equal(
      a.input,
      last,
      "the closed dialog never receives a replacement editor",
    );
    assert.equal(a.doc.querySelector("#ai-summary"), null);
    const count = a.prompts.length;
    await a.ai.summarize(a.d);
    assert.equal(a.prompts.length, count);
  } finally {
    a.close();
  }
});

test("summary copy retains plain-text fallback and focuses the editor after clipboard refusal", async () => {
  const a = setup("Please read this step.");
  try {
    await a.ai.summarize(a.d);
    const plain = [];
    globalThis.navigator.clipboard = {
      async writeText(text) {
        plain.push(text);
      },
    };
    a.d.querySelector("#ai-copy").click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(plain, [a.input.value]);
    globalThis.navigator.clipboard = {
      async writeText() {
        throw Error("Clipboard refused");
      },
    };
    const copy = a.d.querySelector("#ai-copy");
    copy.focus();
    copy.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(a.doc.activeElement, a.input);
    assert.equal(a.input.selectionStart, 0);
    assert.equal(a.input.selectionEnd, a.input.value.length);
  } finally {
    a.close();
  }
});

test("revoked edit access or a refused save preserves the reviewed summary and its declarations", async () => {
  const a = setup();
  try {
    await a.ai.summarize(a.d);
    a.declare("fr-CA");
    const draft = fieldContent(a.input),
      original = structuredClone(a.b);
    a.editable(false);
    a.d.querySelector("#ai-add").click();
    assert.equal(a.writes(), 0);
    assert.deepEqual(a.b, original);
    assert.deepEqual(fieldContent(a.input), draft);
    a.editable(true);
    a.refused(true);
    a.d.querySelector("#ai-add").click();
    assert.equal(a.writes(), 1);
    assert.deepEqual(a.b, original);
    assert.deepEqual(fieldContent(a.input), draft);
    assert.equal(a.d.open, true);
    assert.equal(a.toasts.length, 0);
  } finally {
    a.close();
  }
});

function declareNotes(a, tag, scope = "field", start = 0, end = start) {
  const input = a.d.querySelector("#ai-notes");
  input.setSelectionRange(start, end);
  a.d.querySelector("#ai-notes-language-options").click();
  a.d.querySelector("#ai-notes-language-scope").value = scope;
  a.d.querySelector("#ai-notes-language-tag").value = tag;
  a.d.querySelector("#ai-notes-language-save").click();
}
function insertedNotes(a) {
  return a.b.items.filter((i) => !["visible", "private"].includes(i.id));
}

test("reviewed sticky-note languages are rebased per trimmed line and retained in shared/object clipboard data", () => {
  const a = setup();
  try {
    a.ai.review(
      a.d,
      [
        { text: "Veuillez lire cette étape.", color: "green" },
        { text: 'Read first. <img id="notes-injection">', color: "blue" },
      ],
      "Review",
    );
    const input = a.d.querySelector("#ai-notes");
    assert.equal(a.doc.activeElement, input);
    declareNotes(a, "fr-ca");
    const start = input.value.indexOf("Read first.");
    declareNotes(a, "en-ca", "text", start, input.value.length);
    input.value = " \n" + input.value;
    input.value += " \n";
    assert.equal(a.doc.querySelector("#notes-injection"), null);
    a.d.querySelector("#ai-insert").click();
    const notes = insertedNotes(a);
    assert.equal(notes.length, 2);
    assert.equal(notes[0].text, "Veuillez lire cette étape.");
    assert.equal(notes[0].lang, "fr-CA");
    assert.equal(notes[0].textRuns, undefined);
    assert.equal(notes[1].lang, "fr-CA");
    assert.deepEqual(notes[1].textRuns, [
      { start: 0, end: notes[1].text.length, style: { lang: "en-CA" } },
    ]);
    assert.notEqual(notes[0].color, notes[1].color);
    validateBoard(a.b);
    const shared = new SharedDocument();
    let peer;
    try {
      shared.commit(a.b);
      peer = new SharedDocument(shared.update());
      const saved = peer
        .snapshot(a.b.id)
        .items.filter((i) => notes.some((n) => n.id === i.id));
      assert.deepEqual(saved, notes);
      const formats = clipboardFormats(notes);
      for (const types of [Object.keys(formats), ["text/html"]]) {
        const copied = readFragment({
          getData: (type) => (types.includes(type) ? formats[type] || "" : ""),
        });
        assert.equal(copied[0].lang, "fr-CA");
        assert.equal(copied[1].lang, "fr-CA");
        assert.deepEqual(copied[1].textRuns, notes[1].textRuns);
      }
    } finally {
      shared.destroy();
      peer?.destroy();
    }
  } finally {
    a.close();
  }
});

test("generated note review captures the requested authoring context across a delayed reply", async () => {
  const a = setup();
  let release;
  try {
    setLanguage("fr");
    a.response(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await a.ai.generate(a.d);
    a.d.querySelector("#ai-prompt").value = "Explain the review step.";
    a.d.querySelector("#ai-count").value = "1";
    a.d
      .querySelector("#ai-generate")
      .dispatchEvent(
        new a.dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
    assert.equal(typeof release, "function");
    assert.match(a.prompts[0].prompt, /Canadian French/);
    setLanguage("en");
    release({
      text: JSON.stringify({ notes: [{ text: "Veuillez lire cette étape." }] }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    const input = a.d.querySelector("#ai-notes");
    assert.equal(input.fieldLanguage(), "fr");
    assert.equal(input.querySelector('[lang="fr"]').textContent, input.value);
    a.d.querySelector("#ai-insert").click();
    assert.equal(insertedNotes(a)[0].lang, "fr");
  } finally {
    a.close();
  }
});

test("transcription review leaves unknown language undeclared until authors explicitly tag a passage", () => {
  const a = setup();
  try {
    a.ai.review(
      a.d,
      [
        {
          text: "Veuillez lire cette étape.",
          lang: "fr",
          textRuns: [{ start: 0, end: 7, style: { lang: "fr" } }],
        },
        { text: "Read first." },
      ],
      "Review the transcription.",
    );
    const input = a.d.querySelector("#ai-notes");
    assert.equal(input.fieldLanguage(), null);
    assert.equal(input.getAttribute("lang"), null);
    assert.equal(
      input.querySelector("[lang]"),
      null,
      "model-provided metadata is not an author declaration",
    );
    declareNotes(a, "fr-ca", "text", 0, input.value.indexOf("\n"));
    declareNotes(a, "en-ca");
    declareNotes(a, "");
    a.d.querySelector("#ai-insert").click();
    const notes = insertedNotes(a);
    assert.equal(notes[0].lang, undefined);
    assert.deepEqual(notes[0].textRuns, [
      { start: 0, end: notes[0].text.length, style: { lang: "fr-CA" } },
    ]);
    assert.equal(notes[1].lang, undefined);
    assert.equal(notes[1].textRuns, undefined);
    validateBoard(a.b);
  } finally {
    a.close();
  }
});

test("note review keeps large drafts and clips each inserted line with complete Unicode language ranges", () => {
  const a = setup();
  try {
    a.ai.review(
      a.d,
      [
        { text: "x".repeat(1999) + "😀 Continue.", color: "green" },
        { text: "y".repeat(21000), color: "blue" },
      ],
      "Review",
    );
    const input = a.d.querySelector("#ai-notes");
    declareNotes(a, "fr-ca");
    declareNotes(a, "en-ca", "text", 1998, input.value.indexOf("\n"));
    const length = input.value.length;
    input.value = " \n" + input.value;
    assert.equal(
      input.value.length,
      length + 2,
      "editing must not impose a whole-draft 20,000-character cap",
    );
    a.d.querySelector("#ai-insert").click();
    const notes = insertedNotes(a);
    assert.equal(notes[0].text, "x".repeat(1999));
    assert.equal(notes[0].lang, "fr-CA");
    assert.deepEqual(notes[0].textRuns, [
      { start: 1998, end: 1999, style: { lang: "en-CA" } },
    ]);
    assert.equal(notes[1].text, "y".repeat(2000));
    assert.equal(notes[1].lang, "fr-CA");
    validateBoard(a.b);
  } finally {
    a.close();
  }
});

test("notes review retains declarations after denied insertion and destroys replaced or closed editors", async () => {
  const a = setup();
  try {
    a.ai.review(a.d, [{ text: "Veuillez lire cette étape." }], "Review");
    let input = a.d.querySelector("#ai-notes");
    declareNotes(a, "fr-ca");
    const draft = fieldContent(input),
      before = structuredClone(a.b);
    a.editable(false);
    a.d.querySelector("#ai-insert").click();
    assert.equal(a.writes(), 0);
    assert.deepEqual(a.b, before);
    assert.deepEqual(fieldContent(input), draft);
    a.editable(true);
    a.refused(true);
    a.d.querySelector("#ai-insert").click();
    assert.equal(a.writes(), 1);
    assert.deepEqual(a.b, before);
    assert.deepEqual(fieldContent(input), draft);
    assert.equal(a.d.open, true);
    let destroyed = 0;
    const destroy = input.destroy;
    input.destroy = () => {
      destroyed++;
      destroy();
    };
    await a.ai.summarize(a.d);
    assert.equal(destroyed, 1);
    a.ai.review(a.d, [{ text: "Another note." }], "Review");
    input = a.d.querySelector("#ai-notes");
    const lastDestroy = input.destroy;
    input.destroy = () => {
      destroyed++;
      lastDestroy();
    };
    a.d.close();
    assert.equal(destroyed, 2);
    a.ai.review(a.d, [{ text: "A late note." }], "Review");
    assert.equal(a.doc.querySelector("#ai-notes"), null);
  } finally {
    a.close();
  }
});

for (const length of [1998, 1999, 2000])
  test(`AI summary source preserves complete Unicode at object cutoff ${length}`, () => {
    const b = board("Summary Unicode");
    b.items = [
      item("note", 0, 0, {
        text: "Q".repeat(length) + "😀",
        lang: "fr-CA",
        textRuns: [
          { start: length, end: length + 2, style: { lang: "en-GB" } },
        ],
      }),
    ];
    validateBoard(structuredClone(b));
    const original = structuredClone(b);
    const result = boardText(b.items);
    assert.equal(
      result,
      "- (note) " + "Q".repeat(length) + (length === 1998 ? "😀" : ""),
    );
    assert.equal(result.isWellFormed(), true);
    assert.deepEqual(b, original);
  });
for (const length of [1749, 1750, 1751])
  test(`AI summary source preserves complete Unicode at total cutoff ${length}`, () => {
    const b = board("Combined summary Unicode");
    b.items = Array.from({ length: 24 }, (_, n) =>
      item("note", n * 250, 0, { text: "Q".repeat(2000) }),
    );
    b.items.push(
      item("note", 24 * 250, 0, {
        text: "R".repeat(length) + "😀",
        lang: "fr-CA",
        textRuns: [
          { start: length, end: length + 2, style: { lang: "en-GB" } },
        ],
      }),
    );
    validateBoard(structuredClone(b));
    const original = structuredClone(b);
    const result = boardText(b.items);
    assert.equal(
      result,
      ("- (note) " + "Q".repeat(2000) + "\n").repeat(24) +
        "- (note) " +
        "R".repeat(length) +
        (length === 1749 ? "😀" : ""),
    );
    assert.equal(result.isWellFormed(), true);
    assert.deepEqual(b, original);
  });

function fullSummaryBoard() {
  const b = board("Full summary budget"),
    f = item("frame", 0, 0, { text: "F".repeat(20000) });
  b.items = [
    f,
    ...Array.from({ length: 4999 }, (_, n) =>
      item("note", n % 100, Math.floor(n / 100), {
        text: "Note " + n,
        parentId: f.id,
      }),
    ),
  ];
  validateBoard(structuredClone(b));
  return b;
}
test("AI summary retains bounded text memory for a full valid board", () => {
  const source = new URL("./ai-summary-omission-optimized-candidate.js", import.meta.url);
  const script = `
import assert from 'node:assert/strict';
import {board,item,validateBoard} from ${JSON.stringify(new URL("../src/model.js", import.meta.url).href)};
import {boardText} from ${JSON.stringify(source.href)};
${fullSummaryBoard.toString()}
const b=fullSummaryBoard(),original=JSON.stringify(b);
globalThis.gc();
const before=process.memoryUsage().heapUsed;
globalThis.retainedSummary=boardText(b.items);
globalThis.gc();
const retained=process.memoryUsage().heapUsed-before;
const expected=Array.from({length:3},(_,n)=>'- (note, '+b.items[0].text+') Note '+n).join('\\n').slice(0,50000);
assert.equal(globalThis.retainedSummary,expected);
assert.equal(JSON.stringify(b),original);
console.log(JSON.stringify({items:b.items.length,length:globalThis.retainedSummary.length,retained}));
`;
  const child = spawnSync(
    process.execPath,
    ["--expose-gc", "--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.items, 5000);
  assert.equal(result.length, 50000);
  assert.ok(
    result.retained < 10 * 1024 * 1024,
    `Summary retained ${result.retained} bytes for 50,000 characters`,
  );
});
test("AI summary keeps a late selected note and its frame on a full board", () => {
  const b = fullSummaryBoard(),
    last = b.items.at(-1),
    original = JSON.stringify(b);
  const result = boardText(b.items, new Set([last.id]));
  assert.equal(result, "- (note, " + b.items[0].text + ") " + last.text);
  assert.equal(JSON.stringify(b), original);
});
test("AI summary omits blank and excluded content without consuming separators", () => {
  const b = board("Visible summary");
  b.items = [
    item("note", 0, 0, { text: "  \n " }),
    item("note", 1, 0, { text: "Hidden source" }),
    item("note", 2, 0, { text: "First 😀" }),
    item("note", 3, 0, { text: "Second 😀" }),
  ];
  validateBoard(structuredClone(b));
  const original = structuredClone(b);
  assert.equal(
    boardText(b.items, new Set([b.items[0].id, b.items[2].id, b.items[3].id])),
    "- (note) First 😀\n- (note) Second 😀",
  );
  assert.deepEqual(b, original);
});
test("AI summary budget preserves a complete Unicode frame label at the combined boundary", () => {
  const b = board("Frame label budget"),
    f = item("frame", 0, 0, { text: "F".repeat(20000) }),
    g = item("frame", 1, 0, {
      text: "R".repeat(5966) + "😀",
      lang: "fr-CA",
      textRuns: [{ start: 5966, end: 5968, style: { lang: "en-GB" } }],
    });
  b.items = [
    f,
    g,
    item("note", 0, 0, { text: "Q".repeat(2000), parentId: f.id }),
    item("note", 1, 0, { text: "Q".repeat(2000), parentId: f.id }),
    item("note", 2, 0, { text: "x", parentId: g.id }),
  ];
  validateBoard(structuredClone(b));
  const original = structuredClone(b);
  const expected =
      Array.from(
        { length: 2 },
        () => "- (note, " + f.text + ") " + "Q".repeat(2000),
      ).join("\n") +
      "\n- (note, " +
      "R".repeat(5966),
    result = boardText(b.items);
  assert.equal(expected.length, 49999);
  assert.equal(result, expected);
  assert.equal(result.isWellFormed(), true);
  assert.deepEqual(b, original);
});

const summaryScopeNotice = {
  en: "Some source text was shortened or left out to fit the summary limit. Check the original content before using this summary.",
  fr: "Une partie du texte source a été raccourcie ou omise pour respecter la limite du résumé. Vérifiez le contenu original avant d’utiliser ce résumé.",
};
const summaryScopeCases = [
  ["short content", false],
  ["exact object limit", false],
  ["over object limit", true],
  ["Unicode object cutoff", true],
  ["exact combined limit", false],
  ["over combined limit", true],
  ["exact limit with blank remainder", false],
  ["exact limit with later content", true],
  ["private excess content", false],
  ["late selected content", false],
];
function summaryScopeItems(kind) {
  if (kind === "short content")
    return [item("note", 0, 0, { text: "Visible decision." })];
  if (kind === "exact object limit")
    return [item("text", 0, 0, { text: "A".repeat(2000) })];
  if (kind === "over object limit")
    return [
      item("text", 0, 0, {
        text: "A".repeat(2000) + "Decision: keep the launch date.",
      }),
    ];
  if (kind === "Unicode object cutoff")
    return [item("text", 0, 0, { text: "A".repeat(1999) + "😀" })];
  const items = Array.from({ length: 25 }, (_, n) =>
    item("note", n, 0, {
      text: "A".repeat(
        n === 24 ? (kind === "over combined limit" ? 1992 : 1991) : 1990,
      ),
    }),
  );
  if (kind === "exact limit with blank remainder")
    items.push(item("note", 0, 1, { text: " \n " }));
  if (
    [
      "exact limit with later content",
      "private excess content",
      "late selected content",
    ].includes(kind)
  )
    items.push(item("note", 0, 1, { text: "Decision: keep the launch date." }));
  return items;
}
for (const locale of ["en", "fr"])
  for (const [kind, shortened] of summaryScopeCases)
    test(`summary review explains only actual source omissions: ${kind} in ${locale}`, async () => {
      const a = setup("Reviewed summary.");
      try {
        setLanguage(locale);
        a.b.items = summaryScopeItems(kind);
        const shown =
          kind === "private excess content" ? [a.b.items.at(-1)] : a.b.items;
        const chosen =
          kind === "late selected content" ? [a.b.items.at(-1)] : [];
        a.show(shown.map((i) => i.id));
        a.choose(chosen.map((i) => i.id));
        shown[0].lang = "fr-CA";
        shown[0].textRuns = [{ start: 0, end: 1, style: { lang: "en-GB" } }];
        validateBoard(structuredClone(a.b));
        const source = JSON.stringify(a.b);
        await a.ai.summarize(a.d);
        const sent = a.prompts[0].prompt.split("\n\nContent:\n")[1];
        assert.equal(
          sent,
          boardText(
            shown,
            chosen.length ? new Set(chosen.map((i) => i.id)) : null,
          ),
        );
        assert.equal(sent.isWellFormed(), true);
        if (kind.includes("combined") || kind.startsWith("exact limit"))
          assert.equal(sent.length, 50000);
        assert.deepEqual(fieldContent(a.input), {
          text: "Reviewed summary.",
          lang: locale,
        });
        const notice = a.d.querySelector("#ai-summary-scope");
        if (shortened) {
          assert.ok(
            notice,
            "The review must identify source text that was shortened or left out.",
          );
          assert.equal(notice.textContent, summaryScopeNotice[locale]);
          assert.equal(notice.hidden, false);
          assert.ok(
            a.input
              .getAttribute("aria-describedby")
              ?.split(/\s+/)
              .includes(notice.id),
          );
        } else {
          assert.equal(notice, null);
          assert.ok(
            !a.input
              .getAttribute("aria-describedby")
              ?.split(/\s+/)
              .includes("ai-summary-scope"),
          );
        }
        await a.d.querySelector("#ai-copy").onclick();
        assert.equal(
          await a.copied[0].data["text/plain"].text(),
          "Reviewed summary.",
        );
        assert.equal(a.d.querySelector("#ai-summary-scope"), notice);
        assert.equal(JSON.stringify(a.b), source);
        assert.equal(a.writes(), 0);
      } finally {
        a.close();
      }
    });

for (const locale of ["en", "fr"])
  test(`summary omission notice clears when a complete request replaces the review in ${locale}`, async () => {
    const a = setup("Reviewed summary.");
    try {
      setLanguage(locale);
      a.b.items = summaryScopeItems("over object limit");
      a.show(a.b.items.map((i) => i.id));
      await a.ai.summarize(a.d);
      assert.equal(
        a.d.querySelector("#ai-summary-scope")?.textContent,
        summaryScopeNotice[locale],
      );
      a.b.items[0].text = "Complete source.";
      const source = JSON.stringify(a.b);
      await a.ai.summarize(a.d);
      assert.equal(a.prompts.length, 2);
      assert.equal(a.d.querySelector("#ai-summary-scope"), null);
      assert.ok(
        !a.input.getAttribute("aria-describedby")?.includes("ai-summary-scope"),
      );
      assert.equal(JSON.stringify(a.b), source);
      assert.equal(a.writes(), 0);
    } finally {
      a.close();
    }
  });
