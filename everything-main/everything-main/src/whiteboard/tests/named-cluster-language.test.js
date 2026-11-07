import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item, validateBoard } from "../src/model.js";
import { openClusters } from "../src/clusters-ui.js";
import { language, setLanguage, translateUI } from "../src/i18n.js";
import { fieldContent } from "../src/facilitation/authored-field.js";

function setup(locale = "en") {
  const dom = new JSDOM("<main></main>", { url: "https://whiteboard.test" }),
    doc = dom.window.document,
    descriptor = Object.getOwnPropertyDescriptor(globalThis, "document"),
    filterDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "NodeFilter",
    ),
    previousLanguage = language;
  Object.defineProperty(globalThis, "document", {
    value: doc,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "NodeFilter", {
    value: dom.window.NodeFilter,
    configurable: true,
    writable: true,
  });
  setLanguage(locale);
  const b = board("Named cluster declarations");
  b.items = [
    item("note", 0, 0, { text: "Read the source instructions.", lang: "en" }),
    item("note", 240, 0, {
      text: "Veuillez lire les instructions.",
      lang: "fr",
    }),
  ];
  const ids = new Set(b.items.map((i) => i.id));
  let d,
    editable = true,
    writes = 0;
  openClusters({
    board: () => b,
    selection: () => ids,
    canEdit: () => editable,
    toast() {},
    mutate(fn) {
      writes++;
      fn();
    },
    select() {},
    focusClusters() {},
    modal(title, html, ready) {
      d = doc.createElement("dialog");
      d.open = true;
      d.innerHTML = `<h2>${title}</h2>${html}`;
      doc.body.append(d);
      d.close = () => {
        d.open = false;
        d.dispatchEvent(new dom.window.Event("close"));
        d.remove();
      };
      ready(d);
      translateUI(d);
      return d;
    },
  });
  const name = d.querySelector("#cluster-name"),
    mode = d.querySelector("#cluster-mode");
  mode.value = "one";
  mode.dispatchEvent(new dom.window.Event("change"));
  return {
    dom,
    doc,
    d,
    b,
    name,
    mode,
    writes: () => writes,
    editable: (value) => {
      editable = value;
    },
    declare(tag, scope = "field", start = 0, end = start) {
      name.setSelectionRange(start, end);
      d.querySelector("#cluster-name-language-options").click();
      d.querySelector("#cluster-name-language-scope").value = scope;
      d.querySelector("#cluster-name-language-tag").value = tag;
      d.querySelector("#cluster-name-language-save").click();
    },
    close() {
      d.close();
      setLanguage(previousLanguage);
      dom.window.close();
      if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
      else delete globalThis.document;
      if (filterDescriptor)
        Object.defineProperty(globalThis, "NodeFilter", filterDescriptor);
      else delete globalThis.NodeFilter;
    },
  };
}

test("named caption declarations refresh preview immediately and persist on the first submission", () => {
  const a = setup("fr"),
    text = 'Veuillez lire. Read first. <img id="named-injection">';
  try {
    assert.equal(a.name.fieldLanguage(), "fr");
    a.name.value = text;
    a.declare("fr-ca");
    const start = text.indexOf("Read first.");
    a.declare("en-ca", "text", start, start + 11);
    a.name.value = "  " + a.name.value;
    a.name.value += "  ";
    const preview = a.d.querySelector("#cluster-preview");
    assert.equal(preview.querySelector('[lang="fr-CA"]').textContent, text);
    assert.equal(
      preview.querySelector('[lang="en-CA"]').textContent,
      "Read first.",
    );
    assert.equal(a.doc.querySelector("#named-injection"), null);
    a.d.querySelector("#cluster-apply").click();
    assert.equal(a.writes(), 1);
    assert.equal(a.d.open, false);
    const frame = a.b.items.find((i) => i.type === "frame");
    assert.equal(frame.lang, "fr-CA");
    assert.equal(frame.text, text);
    assert.deepEqual(frame.textRuns, [
      { start, end: start + 11, style: { lang: "en-CA" } },
    ]);
    assert.deepEqual(
      a.b.items.filter((i) => i.type === "note").map((i) => i.lang),
      ["en", "fr"],
    );
    validateBoard(a.b);
  } finally {
    a.close();
  }
});

test("Enter applies or validates a language tag without submitting the cluster, and title Enter preserves form submission", () => {
  const a = setup();
  try {
    a.name.value = "Veuillez lire.";
    a.name.setSelectionRange(0, 0);
    a.d.querySelector("#cluster-name-language-options").click();
    const tag = a.d.querySelector("#cluster-name-language-tag");
    tag.value = "bad_tag";
    tag.dispatchEvent(
      new a.dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(a.writes(), 0);
    assert.equal(a.d.open, true);
    assert.equal(tag.getAttribute("aria-invalid"), "true");
    assert.equal(
      a.d.querySelector("#cluster-name-language-error").hidden,
      false,
    );
    tag.value = "fr-ca";
    tag.dispatchEvent(
      new a.dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(a.writes(), 0);
    assert.equal(a.name.fieldLanguage(), "fr-CA");
    assert.equal(a.name.languageControls.hidden, true);
    assert.ok(a.d.querySelector('#cluster-preview [lang="fr-CA"]'));
    a.name.dispatchEvent(
      new a.dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        keyCode: 229,
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(a.writes(), 0);
    let destroyed = 0;
    const destroy = a.name.destroy;
    a.name.destroy = () => {
      destroyed++;
      destroy();
    };
    a.name.dispatchEvent(
      new a.dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(a.writes(), 1);
    assert.equal(a.d.open, false);
    assert.equal(destroyed, 1);
    assert.equal(a.b.items.find((i) => i.type === "frame").lang, "fr-CA");
  } finally {
    a.close();
  }
});

test("clearing named-caption language retains selected declarations, denied edits and cancel cleanup", () => {
  const a = setup();
  try {
    const text = "Veuillez lire. Read first.",
      end = text.indexOf(" Read first.");
    a.name.value = text;
    a.declare("fr-ca", "text", 0, end);
    a.declare("");
    assert.equal(a.name.fieldLanguage(), null);
    assert.equal(
      a.d.querySelector('#cluster-preview [lang="fr-CA"]').textContent,
      text.slice(0, end),
    );
    const draft = fieldContent(a.name),
      before = structuredClone(a.b);
    a.editable(false);
    a.d.querySelector("#cluster-apply").click();
    assert.equal(a.writes(), 0);
    assert.equal(a.d.open, true);
    assert.deepEqual(a.b, before);
    assert.deepEqual(fieldContent(a.name), draft);
    let destroyed = 0;
    const destroy = a.name.destroy;
    a.name.destroy = () => {
      destroyed++;
      destroy();
    };
    a.d.querySelector("#cluster-cancel").click();
    assert.equal(destroyed, 1);
    assert.equal(a.doc.querySelector("#cluster-name"), null);
    assert.deepEqual(a.b, before);
  } finally {
    a.close();
  }
});

test("named captions preserve Unicode-limited ranges through stale-plan review and expose empty-title errors", () => {
  const a = setup("fr");
  try {
    a.name.value = "   ";
    a.name.dispatchEvent(new a.dom.window.Event("input", { bubbles: true }));
    assert.equal(a.d.querySelector("#cluster-apply").disabled, true);
    assert.equal(a.d.querySelector("#cluster-error").hidden, false);
    assert.match(
      a.d.querySelector("#cluster-error").textContent,
      /nom de regroupement.*200/i,
    );
    a.name.value = "x".repeat(199) + "😀 Continue.";
    assert.equal(a.name.value, "x".repeat(199));
    a.declare("en-ca", "text", 198, 199);
    a.b.items[0].x += 20;
    a.d.querySelector("#cluster-apply").click();
    assert.equal(a.writes(), 0);
    assert.equal(a.d.open, true);
    assert.equal(a.d.querySelector("#cluster-error").hidden, false);
    assert.equal(
      a.d.querySelector('#cluster-preview [lang="en-CA"]').textContent,
      "x",
    );
    a.d.querySelector("#cluster-apply").click();
    assert.equal(a.writes(), 1);
    const frame = a.b.items.find((i) => i.type === "frame");
    assert.equal(frame.text, "x".repeat(199));
    assert.equal(frame.lang, "fr");
    assert.deepEqual(frame.textRuns, [
      { start: 198, end: 199, style: { lang: "en-CA" } },
    ]);
    validateBoard(a.b);
  } finally {
    a.close();
  }
});
