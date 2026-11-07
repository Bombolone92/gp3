import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item } from "../src/model.js";
import { createObjectLinks } from "./object-links-table-unicode-candidate.js";
import { objectAddress } from "../src/object-link-data.js";

function setup() {
  const dom = new JSDOM(
    '<div><canvas tabindex="0"></canvas><div id="badges"></div></div>',
    { url: "https://whiteboard.test" },
  );
  const previous = Object.fromEntries(
    ["document", "localStorage", "NodeFilter"].map((k) => [k, globalThis[k]]),
  );
  for (const key of Object.keys(previous)) globalThis[key] = dom.window[key];
  const s = {
    board: board(),
    view: { x: 0, y: 0, z: 1 },
    selected: null,
    readOnly: false,
    addresses: 0,
    draws: 0,
    navigated: null,
  };
  const doc = dom.window.document,
    canvas = doc.querySelector("canvas");
  canvas.getBoundingClientRect = () => ({ width: 1200, height: 900 });
  const ui = createObjectLinks({
    state: () => s,
    selected: () => s.selected,
    base: () => dom.window.location.href,
    address: (id) => {
      s.addresses++;
      return objectAddress(s.board, id, dom.window.location.href);
    },
    canvas: () => canvas,
    writable: (i) => !!i && !s.readOnly && !i.locked,
    prepare() {},
    icon: () => '<span aria-hidden="true">↗</span>',
    draw: () => {
      s.draws++;
      ui.render();
    },
    change: (i, link) => {
      if (link) i.objectLink = link;
      else delete i.objectLink;
    },
    navigate: (id) => {
      s.navigated = id;
    },
    toast() {},
  });
  ui.bind(doc.querySelector("#badges"));
  return {
    s,
    doc,
    ui,
    w: dom.window,
    close() {
      ui.close();
      dom.window.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    },
  };
}

test("5,000 linked objects have bounded badges, cached addresses and icons, and no content reads during camera movement", () => {
  const a = setup();
  try {
    let contentReads = 0;
    a.s.board.items = Array.from({ length: 5000 }, (_, n) => {
      const i = item("note", 200, 100, {
        objectLink: { objectId: "destination" },
      });
      Object.defineProperty(i, "text", {
        get() {
          contentReads++;
          return `Object ${n}`;
        },
      });
      return i;
    });
    a.s.selected = a.s.board.items[0];
    a.ui.render();
    assert.equal(a.doc.querySelectorAll("[data-object-link]").length, 401);
    const badge = a.doc.querySelector(
        `[data-object-link="${a.s.selected.id}"]`,
      ),
      icon = badge.firstChild;
    const addressCount = a.s.addresses;
    for (let n = 0; n < 20; n++) {
      a.s.view.x++;
      a.ui.render();
    }
    assert.equal(
      a.s.addresses,
      addressCount,
      "Panning reuses direct addresses",
    );
    assert.equal(contentReads, 0, "Badges do not scan object text");
    assert.equal(badge.firstChild, icon);
    a.s.board.shared = { server: "https://worker.puter.work", room: "room" };
    a.ui.render();
    assert.equal(
      new URLSearchParams(new URL(badge.href).hash.slice(1)).get("board"),
      "room",
    );
    a.s.selected.objectLink = { url: "https://example.com/updated" };
    a.ui.render();
    assert.equal(badge.href, "https://example.com/updated");
    assert.equal(badge.target, "_blank");
    a.s.view.x = 10000;
    a.ui.render();
    assert.equal(a.doc.querySelectorAll("[data-object-link]").length, 0);
  } finally {
    a.close();
  }
});

test("destination picking pages and searches targets, restores canvas controls, and rejects stale or protected drafts", () => {
  const a = setup();
  try {
    a.s.board.items = Array.from({ length: 103 }, (_, n) =>
      item("note", n * 300, 0, {
        text: n === 102 ? "Café destination" : `Object ${n}`,
      }),
    );
    a.s.selected = a.s.board.items[0];
    a.ui.show();
    assert.equal(a.doc.querySelectorAll("[data-link-target]").length, 50);
    a.doc.querySelector("#object-link-next").click();
    assert.equal(a.doc.querySelectorAll("[data-link-target]").length, 50);
    a.doc.querySelector("#object-link-next").click();
    assert.equal(a.doc.querySelectorAll("[data-link-target]").length, 2);
    const search = a.doc.querySelector("#object-link-search");
    search.value = "cafe";
    search.dispatchEvent(new a.w.Event("input"));
    assert.equal(a.doc.querySelectorAll("[data-link-target]").length, 1);
    a.doc.querySelector("[data-link-target]").click();
    assert.ok(
      a.doc
        .querySelector("#object-link-url")
        .value.includes(a.s.board.items[102].id),
    );
    a.s.selected.objectLink = { url: "https://example.com/remote" };
    a.ui.render();
    a.doc
      .querySelector("form")
      .dispatchEvent(new a.w.Event("submit", { cancelable: true }));
    assert.match(
      a.doc.querySelector("#object-link-error").textContent,
      /changed/,
    );
    assert.equal(a.s.selected.objectLink.url, "https://example.com/remote");
    const draws = a.s.draws;
    a.doc.querySelector("#object-link-close").click();
    assert.equal(
      a.s.draws,
      draws + 1,
      "Closing redraws suppressed canvas controls",
    );
    assert.equal(a.doc.activeElement, a.doc.querySelector("canvas"));
    a.ui.show();
    a.s.readOnly = true;
    a.ui.render();
    assert.equal(a.doc.querySelector("form").hidden, true);
    a.doc.querySelector("#object-link-remove").click();
    assert.equal(a.s.selected.objectLink.url, "https://example.com/remote");
    a.s.board.items = [];
    a.ui.render();
    assert.equal(a.ui.isOpen(), false);
  } finally {
    a.close();
  }
});

test("object link previews never read concealed destinations and update when workshop visibility changes", () => {
  const a = setup();
  try {
    const target = item("note", 300, 0, {
        text: "Secret workshop contribution",
      }),
      source = item("note", 0, 0, {
        text: "Public source",
        objectLink: { objectId: target.id },
      });
    a.s.board.items = [source, target];
    a.s.selected = source;
    a.s.hidden = new Set([target.id]);
    a.s.concealed = new Set([target.id]);
    a.ui.show();
    assert.ok(
      !a.doc
        .querySelector("#object-links-panel")
        .textContent.includes(target.text),
      "A private destination's content cannot appear in the preview",
    );
    let contentReads = 0;
    Object.defineProperty(target, "text", {
      configurable: true,
      get() {
        contentReads++;
        return "Secret workshop contribution";
      },
    });
    a.s.board.updated++;
    a.ui.render();
    assert.equal(contentReads, 0);
    assert.equal(a.doc.querySelectorAll("[data-link-target]").length, 0);
    a.s.hidden.clear();
    a.s.concealed.clear();
    a.ui.render();
    assert.equal(
      a.doc.querySelector("#object-link-current a").textContent,
      "Sticky note: Secret workshop contribution",
    );
    assert.equal(a.doc.querySelectorAll("[data-link-target]").length, 1);
    a.s.hidden.add(target.id);
    a.ui.render();
    assert.equal(
      a.doc.querySelector("#object-link-current a").textContent,
      "Sticky note: Secret workshop contribution",
      "Collapsed branches retain their accessible destination names",
    );
    assert.equal(a.doc.querySelectorAll("[data-link-target]").length, 0);
    a.s.concealed.add(target.id);
    contentReads = 0;
    a.ui.render();
    assert.equal(contentReads, 0);
    assert.ok(
      !a.doc
        .querySelector("#object-links-panel")
        .textContent.includes("Secret workshop contribution"),
    );
    a.s.concealed.add(source.id);
    a.ui.render();
    assert.equal(
      a.ui.isOpen(),
      false,
      "Concealing the source closes its preview",
    );
    a.ui.show(source);
    assert.equal(a.ui.isOpen(), false);
  } finally {
    a.close();
  }
});

test("object link destination updates retain keyboard focus, including after removal or lost edit access", () => {
  const a = setup();
  try {
    const source = item("note", 0, 0, { text: "Source" }),
      first = item("note", 300, 0, { text: "First destination" }),
      second = item("note", 600, 0, { text: "Second destination" });
    source.objectLink = { objectId: first.id };
    a.s.board.items = [source, first, second];
    a.s.selected = source;
    a.ui.show();
    a.doc.querySelector(`[data-link-target="${first.id}"]`).focus();
    first.text = "Remote rename";
    a.s.board.updated++;
    a.ui.render();
    assert.equal(a.doc.activeElement.dataset.linkTarget, first.id);
    const focused = a.doc.activeElement;
    a.ui.render();
    assert.equal(
      a.doc.activeElement,
      focused,
      "An unchanged paint keeps the DOM",
    );
    a.doc.querySelector("#object-link-current a").focus();
    first.text = "Another remote rename";
    a.s.board.updated++;
    a.ui.render();
    assert.ok(a.doc.activeElement.matches("#object-link-current a"));
    assert.equal(
      a.doc.activeElement.textContent,
      "Sticky note: Another remote rename",
    );
    a.doc.querySelector(`[data-link-target="${first.id}"]`).focus();
    a.s.board.items = [source, second];
    a.ui.render();
    assert.equal(a.doc.activeElement.dataset.linkTarget, second.id);
    a.s.board.items = [source];
    a.ui.render();
    assert.equal(a.doc.activeElement.id, "object-link-search");
    const field = a.doc.querySelector("#object-link-url");
    field.value = "https://example.com/draft";
    field.focus();
    a.s.readOnly = true;
    a.ui.render();
    assert.equal(a.doc.activeElement.id, "object-link-copy");
    assert.equal(field.value, "https://example.com/draft");
  } finally {
    a.close();
  }
});

test("composition Escape preserves the object link draft and ordinary Escape closes the panel", () => {
  const a = setup();
  try {
    const source = item("note", 0, 0, { text: "Source" });
    a.s.board.items = [source];
    a.s.selected = source;
    a.ui.show();
    const field = a.doc.querySelector("#object-link-url");
    field.value = "https://例え.テスト/下書き";
    for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
      const event = new a.w.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
        ...flags,
      });
      field.dispatchEvent(event);
      assert.equal(a.ui.isOpen(), true);
      assert.equal(a.doc.activeElement, field);
      assert.equal(field.value, "https://例え.テスト/下書き");
      assert.equal(event.defaultPrevented, false);
      assert.equal(source.objectLink, undefined);
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
    assert.equal(source.objectLink, undefined);
  } finally {
    a.close();
  }
});

for(const n of [298,299,300])
  test(`table destination previews retain complete Unicode at ${n} characters`,()=>{
    const a=setup();
    try {
      const text='Q'.repeat(n)+'😀',target=item('table',300,0,{cells:[[text]],lang:'fr-CA'}),source=item('note',0,0,{text:'Source',objectLink:{objectId:target.id}});
      a.s.board.items=[source,target];a.s.selected=source;a.ui.show();
      const caption=a.doc.querySelector('#object-link-current a');assert.ok(caption);assert.equal(caption.textContent.isWellFormed(),true);assert.equal(target.cells[0][0],text);
    }finally{a.close();}
  });
