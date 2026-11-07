import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item, validateBoard } from "../src/model.js";
import { createAI } from "../src/ai/ai-ui.js";
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
    view: () => ({ ...b, items: b.items.filter((i) => i.id === "visible") }),
    selection: () => new Set(),
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


test("WCAG transcribed note review allows explicit languages for ordinary mixed sentences", () => {
 const a=setup();
 try {
  a.ai.review(a.d,[{text:"Veuillez lire cette étape."},{text:"Read first."}],"Review the transcription.");
  const field=a.d.querySelector("#ai-notes");
  assert.equal(field.value,"Veuillez lire cette étape.\nRead first.");
  console.log(JSON.stringify({pageLanguage:language,field:field.outerHTML,authoringControl:a.d.querySelector("#ai-notes-language-options")?.outerHTML}));
  assert.ok(a.d.querySelector("#ai-notes-language-options"),"ordinary foreign-language sentences need an explicit declaration mechanism");
 } finally {a.close();}
});
