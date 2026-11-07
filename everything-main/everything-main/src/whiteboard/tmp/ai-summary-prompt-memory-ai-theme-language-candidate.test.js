import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item, validateBoard } from "../src/model.js";
import { createAI } from "./ai-summary-prompt-memory-candidate.js";
import { language, setLanguage } from "../src/i18n.js";
import { fieldContent } from "../src/facilitation/authored-field.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { clipboardFormats, readFragment } from "../src/transfer.js";

const heading = 'Veuillez lire. Read first. <img id="theme-injection">';
const defaultReply = {
  themes: [
    { name: heading, notes: [1, 2] },
    { name: "Follow the remaining steps", notes: [3] },
  ],
};
function setup() {
  const dom = new JSDOM(
      '<dialog open><div id="ai-work"></div><p id="ai-status"></p></dialog>',
      { url: "https://whiteboard.test" },
    ),
    doc = dom.window.document,
    d = doc.querySelector("dialog");
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document"),
    previousLanguage = language;
  Object.defineProperty(globalThis, "document", {
    value: doc,
    configurable: true,
    writable: true,
  });
  setLanguage("en");
  const b = board("Theme declarations");
  b.items = [
    item("note", 0, 0, { text: "Read the source instructions.", lang: "en" }),
    item("note", 230, 0, {
      text: "Veuillez lire les instructions.",
      lang: "fr",
    }),
    item("note", 460, 0, { text: "Review the final source." }),
  ];
  const selected = new Set(b.items.map((i) => i.id));
  let handler = async () => ({ text: JSON.stringify(defaultReply) }),
    editable = true,
    refused = false,
    writes = 0;
  const prompts = [],
    toasts = [];
  d.close = () => {
    d.open = false;
    d.dispatchEvent(new dom.window.Event("close"));
    d.remove();
  };
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
    view: () => b,
    selection: () => selected,
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
    doc,
    d,
    b,
    selected,
    ai,
    prompts,
    toasts,
    input: (n) => d.querySelector(`#ai-theme-${n}`),
    response: (fn) => {
      handler = fn;
    },
    editable: (value) => {
      editable = value;
    },
    refused: (value) => {
      refused = value;
    },
    writes: () => writes,
    declare(n, tag, scope = "field", start = 0, end = start) {
      this.input(n).setSelectionRange(start, end);
      d.querySelector(`#ai-theme-${n}-language-options`).click();
      d.querySelector(`#ai-theme-${n}-language-scope`).value = scope;
      d.querySelector(`#ai-theme-${n}-language-tag`).value = tag;
      d.querySelector(`#ai-theme-${n}-language-save`).click();
    },
    close() {
      d.close();
      setLanguage(previousLanguage);
      dom.window.close();
      if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
      else delete globalThis.document;
    },
  };
}

test("reviewed theme headings retain whole and edited passage declarations in frames, shared storage and clipboard", async () => {
  const a = setup(),
    original = structuredClone(a.b.items);
  try {
    await a.ai.themes(a.d);
    const input = a.input(0);
    assert.equal(input.getAttribute("aria-labelledby"), "ai-theme-0-label");
    assert.equal(input.getAttribute("aria-multiline"), "false");
    a.declare(0, "fr-ca");
    const start = input.value.indexOf("Read first.");
    a.declare(0, "en-ca", "text", start, start + 11);
    input.value = "  " + input.value;
    input.value += "  ";
    assert.equal(
      input.querySelector('[lang="en-CA"]').textContent,
      "Read first.",
    );
    assert.equal(a.doc.querySelector("#theme-injection"), null);
    a.d.querySelector("#ai-apply").click();
    const frames = a.b.items.filter((i) => i.type === "frame");
    assert.equal(frames.length, 2);
    assert.equal(frames[0].text, heading);
    assert.equal(frames[0].lang, "fr-CA");
    assert.deepEqual(frames[0].textRuns, [
      { start, end: start + 11, style: { lang: "en-CA" } },
    ]);
    assert.equal(frames[1].lang, "en");
    for (const source of original) {
      const note = a.b.items.find((i) => i.id === source.id);
      assert.equal(note.text, source.text);
      assert.equal(note.lang, source.lang);
      assert.deepEqual(note.textRuns, source.textRuns);
    }
    validateBoard(a.b);
    const shared = new SharedDocument();
    let peer;
    try {
      shared.commit(a.b);
      peer = new SharedDocument(shared.update());
      const saved = peer
        .snapshot(a.b.id)
        .items.find((i) => i.id === frames[0].id);
      assert.deepEqual(saved, frames[0]);
      const formats = clipboardFormats(frames);
      for (const types of [Object.keys(formats), ["text/html"]]) {
        const copy = readFragment({
          getData: (type) => (types.includes(type) ? formats[type] || "" : ""),
        });
        assert.equal(copy[0].lang, "fr-CA");
        assert.deepEqual(copy[0].textRuns, frames[0].textRuns);
        assert.equal(copy[1].lang, "en");
      }
    } finally {
      shared.destroy();
      peer?.destroy();
    }
  } finally {
    a.close();
  }
});

test("theme review captures request context and the actual translated fallback language across delayed replies", async () => {
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
    const pending = a.ai.themes(a.d);
    assert.equal(typeof release, "function");
    assert.match(a.prompts[0].prompt, /Canadian French/);
    setLanguage("en");
    release({
      text: JSON.stringify({
        themes: [
          {
            name: "Améliorer l’accès aux services",
            notes: [1],
            lang: "es",
            textRuns: [{ start: 0, end: 5, style: { lang: "es" } }],
          },
          { notes: [2] },
        ],
      }),
    });
    await pending;
    assert.equal(a.input(0).fieldLanguage(), "fr");
    assert.equal(
      a.input(0).querySelector('[lang="es"]'),
      null,
      "model-supplied declarations are not authored metadata",
    );
    assert.equal(a.input(1).value, "Theme");
    assert.equal(a.input(1).fieldLanguage(), "en");
    assert.equal(a.input(2).value, "Other");
    assert.equal(a.input(2).fieldLanguage(), "en");
    a.d.querySelector("#ai-apply").click();
    const frames = a.b.items.filter((i) => i.type === "frame");
    assert.deepEqual(
      frames.map((i) => i.lang),
      ["fr", "en", "en"],
    );
    validateBoard(a.b);
  } finally {
    a.close();
  }
});

test("theme authors can clear the whole declaration, retain a foreign passage and recover from invalid tags", async () => {
  const a = setup();
  try {
    await a.ai.themes(a.d);
    const input = a.input(0),
      end = input.value.indexOf(" Read first.");
    a.declare(0, "fr-ca", "text", 0, end);
    a.declare(0, "");
    const before = fieldContent(input);
    a.declare(
      0,
      "sh-x-a1234567-b1234567-c1234567-d1234567-e1234567-f1234567-g123",
    );
    assert.deepEqual(fieldContent(input), before);
    const error = a.d.querySelector("#ai-theme-0-language-error");
    assert.equal(error.hidden, false);
    assert.equal(error.getAttribute("role"), "alert");
    assert.equal(
      a.doc.activeElement,
      a.d.querySelector("#ai-theme-0-language-tag"),
    );
    a.d.querySelector("#ai-theme-0-language-cancel").click();
    a.d.querySelector("#ai-apply").click();
    const frame = a.b.items.find((i) => i.type === "frame");
    assert.equal(frame.lang, undefined);
    assert.deepEqual(frame.textRuns, [
      { start: 0, end, style: { lang: "fr-CA" } },
    ]);
    validateBoard(a.b);
  } finally {
    a.close();
  }
});

test("theme review respects its single-line Unicode cap and uses translated empty-title fallbacks", async () => {
  const a = setup();
  try {
    setLanguage("fr");
    a.response(async () => ({
      text: JSON.stringify({
        themes: [
          { name: "x".repeat(119) + "😀 Continue", notes: [1, 2] },
          { name: "Other heading", notes: [3] },
        ],
      }),
    }));
    await a.ai.themes(a.d);
    assert.equal(a.input(0).value, "x".repeat(119));
    a.declare(0, "en-ca", "text", 118, 119);
    a.input(0).value = "\n" + a.input(0).value;
    assert.equal(a.input(0).value, "x".repeat(119));
    a.input(1).value = "   ";
    a.declare(1, "es");
    setLanguage("en");
    a.d.querySelector("#ai-apply").click();
    const frames = a.b.items.filter((i) => i.type === "frame");
    assert.equal(frames[0].text, "x".repeat(119));
    assert.equal(frames[0].lang, "fr");
    assert.deepEqual(frames[0].textRuns, [
      { start: 118, end: 119, style: { lang: "en-CA" } },
    ]);
    assert.equal(frames[1].text, "Theme");
    assert.equal(frames[1].lang, "en");
    validateBoard(a.b);
  } finally {
    a.close();
  }
});

test("failed theme retries preserve all editors and replacement or close destroys each one without late recreation", async () => {
  const a = setup();
  let destroyed = 0,
    release;
  const observe = () => {
    for (const input of a.d.querySelectorAll("[data-theme]")) {
      const destroy = input.destroy;
      input.destroy = () => {
        destroyed++;
        destroy();
      };
    }
  };
  try {
    await a.ai.themes(a.d);
    a.declare(0, "fr-ca");
    const first = a.input(0),
      draft = fieldContent(first);
    observe();
    a.response(async () => {
      throw Error("Request failed");
    });
    await a.ai.themes(a.d);
    assert.equal(a.input(0), first);
    assert.deepEqual(fieldContent(first), draft);
    assert.equal(destroyed, 0);
    await a.ai.generate(a.d);
    assert.equal(destroyed, 2);
    a.response(async () => ({ text: JSON.stringify(defaultReply) }));
    await a.ai.themes(a.d);
    observe();
    const last = a.input(0);
    a.response(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = a.ai.themes(a.d);
    a.d.close();
    assert.equal(destroyed, 4);
    release({ text: JSON.stringify(defaultReply) });
    await pending;
    assert.equal(a.input(0), last);
    assert.equal(a.doc.querySelector(".ai-themes"), null);
  } finally {
    a.close();
  }
});

test("revoked access and refused arrangements retain theme drafts and their declarations", async () => {
  const a = setup();
  try {
    await a.ai.themes(a.d);
    a.declare(0, "fr-ca");
    const drafts = [fieldContent(a.input(0)), fieldContent(a.input(1))],
      before = structuredClone(a.b);
    a.editable(false);
    a.d.querySelector("#ai-apply").click();
    assert.equal(a.writes(), 0);
    assert.deepEqual(a.b, before);
    assert.deepEqual(
      [fieldContent(a.input(0)), fieldContent(a.input(1))],
      drafts,
    );
    a.editable(true);
    a.refused(true);
    a.d.querySelector("#ai-apply").click();
    assert.equal(a.writes(), 1);
    assert.deepEqual(a.b, before);
    assert.deepEqual(
      [fieldContent(a.input(0)), fieldContent(a.input(1))],
      drafts,
    );
    assert.equal(a.d.open, true);
    assert.equal(a.toasts.length, 0);
  } finally {
    a.close();
  }
});


for(const locale of ['en','fr'])for(const count of [3,300]){const limit=count===3?500:166;for(const length of [limit-2,limit-1,limit])test(`AI theme request preserves complete Unicode for ${count} notes at ${length} characters in ${locale}`,async()=>{const a=setup();try{setLanguage(locale);const first=a.b.items[0];first.text='Q'.repeat(length)+'😀';first.lang='fr-CA';first.textRuns=[{start:length,end:length+2,style:{lang:'en-GB'}}];for(let n=a.b.items.length;n<count;n++){const note=item('note',n*250,0,{text:'Note '+n});a.b.items.push(note);a.selected.add(note.id);}validateBoard(structuredClone(a.b));const original=structuredClone(a.b.items);await a.ai.themes(a.d);const prompt=a.prompts[0].prompt,line=prompt.split('\n\nNotes:\n')[1].split('\n')[0];assert.equal(line,'1. '+'Q'.repeat(length)+(length===limit-2?'😀':''));assert.equal(prompt.isWellFormed(),true);assert.ok(prompt.includes(count+'. '));assert.deepEqual(a.b.items,original);assert.equal(a.writes(),0);assert.equal(a.doc.documentElement.lang,locale);}finally{a.close();}});}
