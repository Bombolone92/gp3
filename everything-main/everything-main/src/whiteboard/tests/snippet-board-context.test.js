import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item, clone } from "../src/model.js";
import { createFeatures } from "../src/features.js";
import { language, setLanguage, translateUI } from "../src/i18n.js";

function fixture(locale) {
  const dom = new JSDOM("<body></body>", { url: "https://whiteboard.test" }),
    keys = ["window", "document", "HTMLElement", "Node", "NodeFilter"];
  const globals = Object.fromEntries(
      keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
    ),
    previousLanguage = language;
  for (const k of keys)
    Object.defineProperty(globalThis, k, {
      value: dom.window[k],
      configurable: true,
      writable: true,
    });
  setLanguage(locale);
  const original = board("Source board"),
    other = board("Other board");
  original.tags = [
    { id: "used", name: "Source tag", color: "#4488aa" },
    { id: "unused", name: "Unused tag", color: "#aa8844" },
  ];
  original.items = [
    item("frame", 0, 0, {
      id: "frame",
      text: "Source frame",
      lang: "en",
      w: 600,
      h: 400,
    }),
    item("note", 20, 30, {
      id: "note",
      text: "Note française",
      lang: "fr-CA",
      parentId: "frame",
      groupId: "partial",
      tagIds: ["used"],
      objectLink: { objectId: "other" },
    }),
    item("arrow", 250, 120, { id: "arrow", startId: "note", endId: "other" }),
    item("note", 800, 30, {
      id: "other",
      text: "Unselected source note",
      groupId: "partial",
    }),
  ];
  other.items = [
    item("note", 0, 0, { id: "note", text: "Different board content" }),
  ];
  let current = original,
    selected = new Set(["frame", "note", "arrow"]),
    hidden = new Set(),
    save = async () => {};
  const saved = [],
    toasts = [],
    addresses = [];
  const features = createFeatures({
    board: () => current,
    selection: () => selected,
    concealedIn: () => hidden,
    objectURL: (id) => {
      addresses.push({ board: current.id, id });
      return `https://whiteboard.test/#local=${current.id}&object=${id}`;
    },
    modal(title, html, ready) {
      const d = document.createElement("dialog");
      d.open = true;
      d.setAttribute("aria-label", title);
      d.innerHTML = html;
      d.close = () => {
        d.open = false;
        d.remove();
        d.dispatchEvent(new dom.window.Event("close"));
      };
      document.body.append(d);
      ready?.(d);
      translateUI(d);
      return d;
    },
    local: {
      saveTemplate: async (value) => {
        await save(value);
        saved.push(clone(value));
      },
    },
    toast: (m) => toasts.push(m),
  });
  return {
    original,
    other,
    features,
    saved,
    toasts,
    addresses,
    hidden: (ids) => (hidden = new Set(ids)),
    selection: (ids) => (selected = new Set(ids)),
    navigate: (b) => (current = b),
    save: (fn) => (save = fn),
    dialog: () => document.querySelector("dialog"),
    async open() {
      await features.actions["save-snippet"]();
      const d = document.querySelector("dialog");
      if (d) d.querySelector("#snippet-name").value = "Chosen content";
      return d;
    },
    async submit(d = this.dialog()) {
      await d.querySelector("form").onsubmit({ preventDefault() {} });
    },
    close() {
      dom.window.close();
      setLanguage(previousLanguage);
      for (const [k, v] of Object.entries(globals)) {
        if (v) Object.defineProperty(globalThis, k, v);
        else delete globalThis[k];
      }
    },
  };
}
function verifySaved(a, ids = ["frame", "note", "arrow"]) {
  assert.equal(a.saved.length, 1);
  const s = a.saved[0];
  assert.equal(s.title, "Chosen content");
  assert.deepEqual(
    s.items.map((i) => i.id),
    ids,
  );
  const note = s.items.find((i) => i.id === "note"),
    arrow = s.items.find((i) => i.id === "arrow");
  if (note) {
    assert.equal(note.text, "Note française");
    assert.equal(note.lang, "fr-CA");
    assert.equal(note.groupId, undefined);
    assert.equal(note.parentId, ids.includes("frame") ? "frame" : undefined);
    assert.match(note.objectLink.url, new RegExp(a.original.id));
    assert.deepEqual(
      s.tags.map((t) => t.id),
      ["used"],
    );
  }
  if (arrow) {
    assert.equal(arrow.startId, ids.includes("note") ? "note" : undefined);
    assert.equal(arrow.endId, undefined);
  }
  assert.equal(a.dialog(), null);
}
for (const locale of ["en", "fr"])
  for (const phase of [
    "same board",
    "different board",
    "same id replacement",
    "return to source",
    "changed selection",
    "all hidden",
    "all deleted",
    "partial hidden",
    "partial deleted",
  ])
    test(`reusable selection remains tied to its source after ${phase} in ${locale}`, async () => {
      const a = fixture(locale);
      try {
        const d = await a.open(),
          draft = d.querySelector("#snippet-name"),
          before = JSON.stringify(a.original);
        if (phase === "different board" || phase === "same id replacement") {
          if (phase === "same id replacement") a.other.id = a.original.id;
          a.navigate(a.other);
          a.selection(["note"]);
        }
        if (phase === "return to source") {
          a.navigate(a.other);
          a.selection([]);
          a.navigate(a.original);
        }
        if (phase === "changed selection") a.selection(["other"]);
        if (phase === "all hidden") a.hidden(["frame", "note", "arrow"]);
        if (phase === "all deleted")
          a.original.items = a.original.items.filter(
            (i) => !["frame", "note", "arrow"].includes(i.id),
          );
        if (phase === "partial hidden") a.hidden(["frame"]);
        if (phase === "partial deleted")
          a.original.items = a.original.items.filter((i) => i.id !== "frame");
        const snapshot = JSON.stringify(a.original);
        await a.submit(d);
        if (
          [
            "different board",
            "same id replacement",
            "all hidden",
            "all deleted",
          ].includes(phase)
        ) {
          assert.equal(
            a.saved.length,
            0,
            "Unavailable or different-board content is never saved as reusable content.",
          );
          assert.equal(d.open, true);
          assert.equal(draft.value, "Chosen content");
          assert.equal(d.querySelector(".primary").disabled, false);
          const status = d.querySelector('[role="status"]');
          assert.ok(status && !status.hidden);
          assert.equal(document.activeElement, status);
          assert.equal(status.getAttribute("aria-live"), "polite");
          assert.match(
            status.textContent,
            phase.includes("board") || phase === "same id replacement"
              ? locale === "fr"
                ? /autre tableau/
                : /different board/
              : locale === "fr"
                ? /objets sélectionnés/
                : /selected objects/,
          );
        } else
          verifySaved(
            a,
            phase.startsWith("partial") ? ["note", "arrow"] : undefined,
          );
        assert.equal(
          JSON.stringify(a.original),
          snapshot,
          "Saving a snippet never mutates the source board.",
        );
        if (!phase.includes("deleted")) assert.equal(snapshot, before);
      } finally {
        a.close();
      }
    });
for (const locale of ["en", "fr"])
  for (const cause of ["empty selection", "hidden selection"])
    test(`reusable content refuses an initial ${cause} in ${locale}`, async () => {
      const a = fixture(locale);
      try {
        if (cause === "empty selection") a.selection([]);
        else a.hidden(["frame", "note", "arrow"]);
        assert.equal(await a.open(), null);
        assert.equal(a.saved.length, 0);
        assert.equal(a.toasts.length, 1);
      } finally {
        a.close();
      }
    });
for (const locale of ["en", "fr"])
  test(`reusable content preserves its source and draft after a storage failure in ${locale}`, async () => {
    const a = fixture(locale);
    try {
      const d = await a.open();
      a.save(() => Promise.reject(Error("Storage unavailable")));
      const button = d.querySelector(".primary");
      button.focus();
      await a.submit(d);
      assert.equal(a.saved.length, 0);
      assert.equal(d.open, true);
      assert.equal(d.querySelector("#snippet-name").value, "Chosen content");
      assert.equal(button.disabled, false);
      assert.equal(document.activeElement, button);
      a.save(() => Promise.resolve());
      await a.submit(d);
      verifySaved(a);
    } finally {
      a.close();
    }
  });
for (const locale of ["en", "fr"])
  test(`a reusable save started on the source completes with its captured content after navigation in ${locale}`, async () => {
    const a = fixture(locale);
    let release, pending;
    try {
      const d = await a.open();
      a.save(() => new Promise((resolve) => (release = resolve)));
      pending = a.submit(d);
      assert.equal(typeof release, "function");
      a.navigate(a.other);
      a.selection(["note"]);
      release();
      release = null;
      await pending;
      pending = null;
      verifySaved(a);
      assert.ok(a.addresses.every((p) => p.board === a.original.id));
      assert.equal(a.other.items[0].text, "Different board content");
    } finally {
      release?.();
      await pending;
      a.close();
    }
  });

for (const locale of ["en", "fr"])
  for (const value of ["   ", "\u00a0", "\u2003", " \t\u00a0\u2003 "])
    test(`reusable content rejects a whitespace-only name ${JSON.stringify(value)} and accepts its correction in ${locale}`, async () => {
      const a = fixture(locale);
      try {
        const d = await a.open(),
          name = d.querySelector("#snippet-name"),
          source = JSON.stringify(a.original);
        name.value = value;
        await a.submit(d);
        assert.equal(
          a.saved.length,
          0,
          "An unnamed reusable record is never written.",
        );
        assert.equal(d.open, true);
        assert.equal(name.value, value);
        assert.equal(name.getAttribute("aria-invalid"), "true");
        assert.equal(name.getAttribute("aria-describedby"), "snippet-status");
        assert.equal(document.activeElement, name);
        const status = d.querySelector("#snippet-status");
        assert.equal(status.hidden, false);
        assert.match(status.textContent, locale === "fr" ? /nom/ : /name/);
        name.value = "  Chosen content  ";
        name.dispatchEvent(new window.Event("input", { bubbles: true }));
        assert.equal(name.hasAttribute("aria-invalid"), false);
        assert.equal(name.hasAttribute("aria-describedby"), false);
        assert.equal(status.hidden, true);
        await a.submit(d);
        verifySaved(a);
        assert.equal(JSON.stringify(a.original), source);
      } finally {
        a.close();
      }
    });
for (const locale of ["en", "fr"])
  for (const value of ["  Useful name  ", "日本語のメモ", "Notes 👨‍👩‍👧‍👦", "0"])
    test(`reusable content preserves the valid name ${JSON.stringify(value)} in ${locale}`, async () => {
      const a = fixture(locale);
      try {
        const d = await a.open();
        d.querySelector("#snippet-name").value = value;
        await a.submit(d);
        assert.equal(a.saved.length, 1);
        assert.equal(a.saved[0].title, value.trim());
        assert.deepEqual(
          a.saved[0].items.map((i) => i.id),
          ["frame", "note", "arrow"],
        );
        assert.equal(a.dialog(), null);
      } finally {
        a.close();
      }
    });

for (const locale of ["en", "fr"])
  for (const phase of [
    "unchanged",
    "edited",
    "cleared",
    "second edit",
    "update failure",
    "board navigation",
    "changed source",
    "closed",
  ])
    test(`a pending reusable save preserves its name after ${phase} in ${locale}`, async () => {
      const a = fixture(locale);
      let release, pending;
      try {
        const d = await a.open(),
          name = d.querySelector("#snippet-name"),
          button = d.querySelector(".primary");
        const draft = phase === "cleared" ? "" : "Updated reusable name";
        a.save(() => new Promise((resolve) => (release = resolve)));
        pending = a.submit(d);
        assert.equal(typeof release, "function");
        assert.equal(button.disabled, true);
        assert.equal(name.disabled, false);
        assert.equal(name.readOnly, false);
        if (phase !== "unchanged") {
          name.focus();
          name.value = draft;
          name.dispatchEvent(new window.Event("input", { bubbles: true }));
        }
        if (phase === "closed") d.close();
        release();
        release = null;
        await pending;
        pending = null;
        assert.equal(a.saved.length, 1);
        const first = a.saved[0];
        assert.equal(first.title, "Chosen content");
        if (phase === "unchanged" || phase === "closed") {
          assert.equal(a.dialog(), null);
          return;
        }
        assert.equal(
          d.open,
          true,
          "The name edited during storage remains available.",
        );
        assert.equal(name.value, draft);
        assert.equal(document.activeElement, name);
        assert.equal(button.disabled, false);
        const status = d.querySelector("#snippet-status");
        assert.equal(status.hidden, false);
        assert.match(status.textContent, locale === "fr" ? /nom/ : /name/);
        a.save(() => Promise.resolve());
        if (phase === "cleared") {
          await a.submit(d);
          assert.equal(a.saved.length, 1);
          assert.equal(name.getAttribute("aria-invalid"), "true");
          name.value = "Corrected reusable name";
          name.dispatchEvent(new window.Event("input", { bubbles: true }));
        }
        if (phase === "board navigation") {
          a.navigate(a.other);
          await a.submit(d);
          assert.equal(a.saved.length, 1);
          assert.equal(name.value, draft);
          assert.match(
            status.textContent,
            locale === "fr" ? /autre tableau/ : /different board/,
          );
          a.navigate(a.original);
        }
        if (phase === "changed source") {
          a.original.items = [];
          a.hidden(["frame", "note", "arrow"]);
        }
        const source = JSON.stringify(a.original);
        if (phase === "update failure") {
          a.save(() => Promise.reject(Error("Storage unavailable")));
          await a.submit(d);
          assert.equal(a.saved.length, 1);
          assert.equal(d.open, true);
          assert.equal(name.value, draft);
          assert.equal(button.disabled, false);
          assert.equal(
            a.toasts.at(-1),
            "Could not save this content on this device.",
          );
          a.save(() => Promise.resolve());
        }
        if (phase === "second edit") {
          a.save(() => new Promise((resolve) => (release = resolve)));
          pending = a.submit(d);
          assert.equal(button.disabled, true);
          name.focus();
          name.value = "Latest reusable name";
          name.dispatchEvent(new window.Event("input", { bubbles: true }));
          release();
          release = null;
          await pending;
          pending = null;
          assert.equal(a.saved.length, 2);
          assert.equal(a.saved[1].title, draft);
          assert.equal(d.open, true);
          assert.equal(name.value, "Latest reusable name");
          assert.equal(document.activeElement, name);
          a.save(() => Promise.resolve());
        }
        const finalName = name.value.trim();
        await a.submit(d);
        assert.equal(a.saved.length, phase === "second edit" ? 3 : 2);
        assert.ok(
          a.saved.every((t) => t.id === first.id),
          "Name corrections target the same stored record.",
        );
        assert.equal(a.saved.at(-1).title, finalName);
        assert.deepEqual(a.saved.at(-1).items, first.items);
        assert.deepEqual(a.saved.at(-1).tags, first.tags);
        assert.equal(a.dialog(), null);
        assert.equal(JSON.stringify(a.original), source);
      } finally {
        release?.();
        await pending;
        a.close();
      }
    });
