import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item } from "../src/model.js";
import { createTagsUI } from "../src/tags-ui.js";
function setup() {
  const dom = new JSDOM('<div><canvas tabindex="0"></canvas></div>'),
    previous = globalThis.document,
    previousFilter = globalThis.NodeFilter;
  globalThis.document = dom.window.document;
  globalThis.NodeFilter = dom.window.NodeFilter;
  const b = board();
  b.tags = Array.from({ length: 9 }, (_, n) => ({
    id: `t${n}`,
    name: `Tag ${n}`,
    color: "#365dc4",
  }));
  b.items = [item("note", 0, 0), item("note", 200, 0)];
  const s = {
    board: b,
    selection: new Set(b.items.map((i) => i.id)),
    readOnly: false,
    writes: 0,
    concealed: new Set(),
  };
  const ui = createTagsUI({
    board: () => s.board,
    selection: () => s.selection,
    concealed: () => s.concealed,
    canvas: () => dom.window.document.querySelector("canvas"),
    canEdit: (ids) =>
      !s.readOnly && !b.items.some((i) => ids.has(i.id) && i.locked),
    mutate: (fn) => {
      s.writes++;
      fn();
      ui.render();
    },
    draw: () => ui.render(),
    prepare() {},
    toast() {},
    find() {},
  });
  return {
    b,
    s,
    ui,
    doc: dom.window.document,
    w: dom.window,
    close() {
      ui.close();
      dom.window.close();
      if (previous === undefined) delete globalThis.document;
      else globalThis.document = previous;
      if (previousFilter === undefined) delete globalThis.NodeFilter;
      else globalThis.NodeFilter = previousFilter;
    },
  };
}
test("tag pagination keeps focus usable when remote tag changes remove pages", () => {
  const a = setup();
  try {
    const tags = Array.from({ length: 101 }, (_, n) => ({
      id: `t${n}`,
      name: `Tag ${String(n).padStart(3, "0")}`,
      color: "#365dc4",
    }));
    a.b.tags = tags;
    a.ui.open();
    const previous = a.doc.querySelector("#tag-prev"),
      next = a.doc.querySelector("#tag-next"),
      search = a.doc.querySelector("#tag-search");
    next.focus();
    next.click();
    next.focus();
    a.b.tags = tags.slice(0, 51);
    a.ui.render();
    assert.equal(next.disabled, true);
    assert.equal(a.doc.activeElement, previous);
    a.b.tags = tags.slice(0, 50);
    a.ui.render();
    assert.equal(a.doc.querySelector(".tag-pages").hidden, true);
    assert.equal(a.doc.activeElement, search);
    a.b.tags = tags.slice(0, 51);
    a.ui.render();
    next.focus();
    next.click();
    assert.equal(a.doc.activeElement, previous);
    previous.click();
    assert.equal(
      a.doc.activeElement,
      next,
      "Manual paging retains keyboard access",
    );
    search.focus();
    a.b.tags = tags.slice(0, 50);
    a.ui.render();
    assert.equal(
      a.doc.activeElement,
      search,
      "Unrelated updates do not move focus",
    );
    assert.equal(a.s.writes, 0);
  } finally {
    a.close();
  }
});

test("losing tag edit access restores usable focus and preserves the rename draft", () => {
  const a = setup();
  try {
    a.ui.open();
    a.doc.querySelector('[data-tag="t0"][data-tag-action="edit"]').click();
    const field = a.doc.querySelector("#tag-name"),
      search = a.doc.querySelector("#tag-search");
    field.value = "My pending rename";
    field.focus();
    a.s.readOnly = true;
    a.ui.render();
    assert.equal(field.disabled, true);
    assert.equal(a.doc.activeElement, search);
    assert.equal(field.value, "My pending rename");
    a.doc
      .querySelector("#tag-form")
      .dispatchEvent(new a.w.Event("submit", { cancelable: true }));
    assert.equal(a.s.writes, 0);
    assert.equal(a.b.tags[0].name, "Tag 0");
    a.s.readOnly = false;
    a.ui.render();
    assert.equal(
      a.doc.activeElement,
      search,
      "Regaining access does not steal focus",
    );
    assert.equal(field.value, "My pending rename");
    field.focus();
    a.ui.render();
    assert.equal(a.doc.activeElement, field);
    a.doc
      .querySelector("#tag-form")
      .dispatchEvent(new a.w.Event("submit", { cancelable: true }));
    assert.equal(a.b.tags[0].name, "My pending rename");
    assert.equal(a.s.writes, 1);
  } finally {
    a.close();
  }
});

test("tag range operations are atomic at capacity and stale catalog edits preserve typed text", () => {
  const a = setup();
  try {
    a.b.items[0].tagIds = a.b.tags.slice(0, 8).map((t) => t.id);
    a.ui.open();
    a.doc.querySelector('[data-tag="t8"][data-tag-action="toggle"]').click();
    assert.equal(a.s.writes, 0);
    assert.equal(a.b.items[1].tagIds, undefined);
    assert.match(a.doc.querySelector("#tag-error").textContent, /8 tags/);
    a.doc.querySelector('[data-tag="t0"][data-tag-action="edit"]').click();
    a.doc.querySelector("#tag-name").value = "My private rename";
    a.b.tags[0] = { ...a.b.tags[0], name: "Remote rename" };
    a.ui.render();
    a.doc
      .querySelector("#tag-form")
      .dispatchEvent(new a.w.Event("submit", { cancelable: true }));
    assert.equal(a.s.writes, 0);
    assert.equal(a.doc.querySelector("#tag-name").value, "My private rename");
    assert.match(a.doc.querySelector("#tag-error").textContent, /changed/);
    a.s.readOnly = true;
    a.ui.render();
    assert.equal(a.doc.querySelector("#tag-save").disabled, true);
    a.doc
      .querySelector("#tag-form")
      .dispatchEvent(new a.w.Event("submit", { cancelable: true }));
    assert.equal(a.s.writes, 0);
  } finally {
    a.close();
  }
});
test("tag renaming and deletion respect locked members outside the current selection", () => {
  const a = setup();
  try {
    a.b.items[0].tagIds = ["t0"];
    a.b.items[1].tagIds = ["t0"];
    a.b.items[1].locked = true;
    a.s.selection = new Set([a.b.items[0].id]);
    a.ui.open();
    a.doc.querySelector('[data-tag="t0"][data-tag-action="delete"]').click();
    assert.equal(a.s.writes, 0);
    assert.match(a.doc.querySelector("#tag-error").textContent, /Unlock/);
    a.doc.querySelector('[data-tag="t0"][data-tag-action="edit"]').click();
    a.doc.querySelector("#tag-name").value = "Changed";
    a.doc
      .querySelector("#tag-form")
      .dispatchEvent(new a.w.Event("submit", { cancelable: true }));
    assert.equal(a.s.writes, 0);
  } finally {
    a.close();
  }
});
test("tag panel keeps 50 rows and stable DOM across 5000 notes without reading note content", () => {
  const a = setup();
  try {
    a.b.tags = Array.from({ length: 1000 }, (_, n) => ({
      id: `t${n}`,
      name: `Tag ${String(n).padStart(4, "0")}`,
      color: "#365dc4",
    }));
    a.b.items = Array.from({ length: 5000 }, () => {
      const i = item("note", 0, 0, { tagIds: ["t0"] });
      Object.defineProperty(i, "text", {
        get() {
          throw Error("Unrelated note content read");
        },
      });
      return i;
    });
    a.s.selection = new Set(a.b.items.map((i) => i.id));
    a.ui.open();
    assert.equal(a.doc.querySelectorAll(".tag-row").length, 50);
    const node = a.doc.querySelector(".tag-row");
    for (let n = 0; n < 20; n++) a.ui.render();
    assert.equal(a.doc.querySelector(".tag-row"), node);
    assert.equal(a.s.writes, 0);
    a.doc.querySelector("#tag-search").value = "0999";
    a.doc.querySelector("#tag-search").dispatchEvent(new a.w.Event("input"));
    assert.equal(a.doc.querySelectorAll(".tag-row").length, 1);
  } finally {
    a.close();
  }
});
test("tags with custom or uppercase colors can be renamed", () => {
  const a = setup();
  try {
    a.b.tags[0].color = "#123456";
    a.b.tags[1].color = "#C43B3B";
    a.ui.open();
    for (const [id, color] of [
      ["t0", "#123456"],
      ["t1", "#c43b3b"],
    ]) {
      a.doc.querySelector(`[data-tag="${id}"][data-tag-action="edit"]`).click();
      assert.equal(a.doc.querySelector("#tag-color").value, color);
      a.doc.querySelector("#tag-name").value = `Renamed ${id}`;
      a.doc
        .querySelector("#tag-form")
        .dispatchEvent(new a.w.Event("submit", { cancelable: true }));
      assert.equal(a.doc.querySelector("#tag-error").hidden, true);
    }
    assert.deepEqual(
      a.b.tags.slice(0, 2).map((t) => [t.name, t.color]),
      [
        ["Renamed t0", "#123456"],
        ["Renamed t1", "#c43b3b"],
      ],
    );
    assert.equal(a.doc.querySelectorAll("[data-custom-color]").length, 0);
  } finally {
    a.close();
  }
});
test("deleting a tag keeps keyboard focus in the tag list", () => {
  const a = setup();
  try {
    a.ui.open();
    a.doc.querySelector('[data-tag="t0"][data-tag-action="delete"]').focus();
    a.doc.querySelector('[data-tag="t0"][data-tag-action="delete"]').click();
    assert.equal(
      a.b.tags.some((t) => t.id === "t0"),
      false,
    );
    assert.equal(a.doc.activeElement.dataset.tag, "t1");
    assert.equal(a.doc.activeElement.dataset.tagAction, "delete");
    for (let n = 1; n < 9; n++)
      a.doc
        .querySelector(`[data-tag="t${n}"][data-tag-action="delete"]`)
        .click();
    assert.equal(a.doc.activeElement.id, "tag-search");
  } finally {
    a.close();
  }
});

test("tags used only on content hidden from this person are neither listed nor deleted", () => {
  const a = setup();
  try {
    const hidden = item("note", 400, 0, { tagIds: ["t0", "t8"] });
    a.b.items.push(hidden);
    a.b.items[0].tagIds = ["t0"];
    a.s.concealed = new Set([hidden.id]);
    a.s.selection = new Set([a.b.items[0].id]);
    a.ui.open();
    const listed = () =>
      [...a.doc.querySelectorAll('[data-tag-action="toggle"]')].map(
        (b) => b.dataset.tag,
      );
    assert.ok(!listed().includes("t8"), "Used only where hidden");
    assert.ok(listed().includes("t0"), "Also used where visible");
    assert.ok(listed().includes("t1"), "Not used yet");
    a.doc.querySelector('[data-tag="t0"][data-tag-action="delete"]').click();
    assert.equal(a.s.writes, 0);
    assert.match(
      a.doc.querySelector("#tag-error").textContent,
      /hidden from you/,
    );
  } finally {
    a.close();
  }
});

test("legacy composition Escape preserves an unfinished tag rename and ordinary Escape still closes", () => {
  const a = setup();
  try {
    a.ui.open();
    a.doc.querySelector('[data-tag="t0"][data-tag-action="edit"]').click();
    const field = a.doc.querySelector("#tag-name");
    field.value = "日本語";
    for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
      const event = new a.w.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
        ...flags,
      });
      field.dispatchEvent(event);
      assert.equal(
        a.ui.isOpen(),
        true,
        "IME cancellation keeps the rename draft",
      );
      assert.equal(event.defaultPrevented, false);
      assert.equal(a.doc.activeElement, field);
      assert.equal(field.value, "日本語");
      assert.equal(a.s.writes, 0);
    }
    field.dispatchEvent(
      new a.w.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(a.ui.isOpen(), false);
    assert.equal(a.doc.activeElement, a.doc.querySelector("canvas"));
    assert.equal(a.b.tags[0].name, "Tag 0");
  } finally {
    a.close();
  }
});
