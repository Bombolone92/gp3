import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item } from "../src/model.js";
import { hasLocked } from "../src/locking.js";
import { openClusters } from "../src/clusters-ui.js";
function setup(count = 2) {
  const dom = new JSDOM("<body></body>"),
    previous = globalThis.document;
  globalThis.document = dom.window.document;
  const b = board();
  b.items = Array.from({ length: count }, (_, n) => item("note", n * 220, 0));
  const state = {
    board: b,
    selection: new Set(b.items.map((i) => i.id)),
    writes: 0,
    readOnly: false,
  };
  const api = {
    board: () => state.board,
    selection: () => state.selection,
    canEdit: (ids) => !state.readOnly && !hasLocked(b.items, ids),
    select: (ids) => {
      state.selection = ids;
    },
    mutate: (fn) => {
      state.writes++;
      fn();
    },
    toast() {},
    modal(title, html, ready) {
      const d = dom.window.document.createElement("dialog");
      d.innerHTML = html;
      d.close = () => d.remove();
      dom.window.document.body.append(d);
      ready(d);
    },
  };
  return {
    b,
    state,
    api,
    doc: dom.window.document,
    w: dom.window,
    submit() {
      dom.window.document
        .querySelector("form")
        .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    },
    close() {
      dom.window.close();
      if (previous === undefined) delete globalThis.document;
      else globalThis.document = previous;
    },
  };
}
test("cluster previews require review after remote geometry changes, retain names and use latest text", () => {
  const a = setup();
  try {
    openClusters(a.api);
    a.doc.querySelector("#cluster-mode").value = "one";
    a.doc.querySelector("#cluster-mode").dispatchEvent(new a.w.Event("change"));
    a.doc.querySelector("#cluster-name").value = "My cluster";
    a.doc.querySelector("#cluster-name").dispatchEvent(new a.w.Event("input"));
    a.b.items[0].x += 100;
    a.submit();
    assert.equal(a.state.writes, 0);
    assert.match(a.doc.querySelector("#cluster-error").textContent, /Review/);
    assert.equal(a.doc.querySelector("#cluster-name").value, "My cluster");
    a.b.items[0].text = "Concurrent content";
    a.submit();
    assert.equal(a.state.writes, 1);
    assert.equal(a.b.items[0].text, "My cluster");
    assert.ok(a.b.items.some((i) => i.text === "Concurrent content"));
    assert.equal(a.doc.querySelector("dialog"), null);
  } finally {
    a.close();
  }
});
test("cluster submits recheck viewer access, remote locks, deletion and board changes without editing", () => {
  for (const change of [
    (a) => {
      a.state.readOnly = true;
    },
    (a) => {
      a.b.items[0].locked = true;
    },
    (a) => {
      a.b.items.pop();
    },
    (a) => {
      a.state.board = board();
    },
  ]) {
    const a = setup();
    try {
      openClusters(a.api);
      change(a);
      a.submit();
      assert.equal(a.state.writes, 0);
    } finally {
      a.close();
    }
  }
});
test("cluster previews page a thousand groups and cancel without cloning content or writing history", () => {
  const a = setup(1000);
  try {
    a.b.tags = a.b.items.map((i, n) => ({
      id: `t${n}`,
      name: `Tag ${n}`,
      color: "#365dc4",
    }));
    for (const [n, i] of a.b.items.entries()) {
      i.tagIds = [`t${n}`];
      Object.defineProperty(i, "text", {
        get() {
          throw Error("Preview read content");
        },
      });
    }
    openClusters(a.api);
    a.doc.querySelector("#cluster-mode").value = "tag";
    a.doc.querySelector("#cluster-mode").dispatchEvent(new a.w.Event("change"));
    const preview = a.doc.querySelector("#cluster-preview");
    assert.equal(preview.tabIndex, 0);
    assert.equal(preview.getAttribute("aria-label"), "Cluster preview");
    preview.focus();
    assert.equal(a.doc.activeElement, preview);
    assert.equal(a.doc.querySelectorAll("#cluster-preview li").length, 50);
    assert.equal(a.doc.querySelector("#cluster-page").textContent, "1 / 20");
    a.doc.querySelector("#cluster-next").click();
    assert.equal(a.doc.querySelector("#cluster-page").textContent, "2 / 20");
    assert.equal(a.doc.querySelectorAll("#cluster-preview li").length, 50);
    assert.equal(a.doc.querySelector("#cluster-preview"), preview);
    assert.equal(a.doc.activeElement, preview);
    a.doc.querySelector("#cluster-cancel").click();
    assert.equal(a.state.writes, 0);
    assert.equal(a.doc.querySelector("dialog"), null);
  } finally {
    a.close();
  }
});
