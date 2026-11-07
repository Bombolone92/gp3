import test from "node:test";
import assert from "node:assert/strict";
import { item, board, validateBoard } from "../src/model.js";
import {
  canClearContent,
  hasClearableContent,
  clearContent,
} from "../src/clear-content.js";
import { commandEntries } from "../src/commands.js";
import { SharedDocument } from "../src/collaboration/document.js";
const ids = (items) => new Set(items.map((i) => i.id));
const blank = (i) => {
  const next = structuredClone(i);
  next.text = "";
  for (const key of ["tagIds", "textRuns", "textBlocks"]) delete next[key];
  return next;
};
test("clear content removes note/shape text, rich ranges, lists and tag assignments while retaining style and relationships", () => {
  const b = board();
  b.tags = [{ id: "research", name: "Research", color: "#365dc4" }];
  b.items = ["note", "rect", "ellipse"].map((type, n) =>
    item(type, -200 + n * 260, 70, {
      w: 220,
      h: 180,
      text: "Plan 🚀\nNext",
      color: "#dce5f7",
      fontSize: 24,
      fontFamily: "caveat",
      bold: true,
      italic: true,
      textColor: "#123456",
      textAlign: "center",
      autoFontSize: true,
      ...(type !== "note" ? { rotation: 30 } : {}),
      groupId: "g",
      parentId: "frame",
      objectLink: { url: "https://example.com/" },
      tagIds: ["research"],
      textRuns: [
        {
          start: 0,
          end: 4,
          style: { underline: true, link: "https://example.com/words" },
        },
      ],
      textBlocks: [{ start: 0, list: "bullet", indent: 1 }],
    }),
  );
  const expected = b.items.map(blank),
    catalog = structuredClone(b.tags);
  assert.equal(clearContent(b.items, ids(b.items)), 3);
  assert.deepEqual(b.items, expected);
  assert.deepEqual(b.tags, catalog);
  assert.equal(clearContent(b.items, ids(b.items)), 0);
  assert.equal(hasClearableContent(b.items[0]), false);
  validateBoard({
    ...b,
    items: [...b.items, item("frame", 0, 0, { id: "frame" })],
  });
});
test("mixed selections leave unsupported widgets intact and member selection does not expand to the group", () => {
  const supported = item("note", 0, 0, { text: "Clear me", groupId: "g" });
  const sibling = item("rect", 200, 0, { text: "Keep me", groupId: "g" });
  const unsupported = [
    "text",
    "table",
    "frame",
    "arrow",
    "pen",
    "image",
    "link",
    "file",
  ].map((type) =>
    item(type, 0, 0, { text: "Untouched", url: "https://example.com/" }),
  );
  unsupported.push(
    item("rect", 0, 0, { text: "Mind node", mindMap: { parent: null } }),
  );
  const before = structuredClone([sibling, ...unsupported]);
  const items = [supported, sibling, ...unsupported];
  assert.equal(clearContent(items, ids([supported, ...unsupported])), 1);
  assert.deepEqual(items.slice(1), before);
  assert.ok(unsupported.every((i) => !canClearContent(i)));
  for (const i of unsupported) assert.equal(hasClearableContent(i), false);
  assert.equal(clearContent(items, new Set()), 0);
});
test("group and container protection reject clearing atomically without altering any object", () => {
  const items = [
    item("note", 0, 0, { text: "First" }),
    item("rect", 200, 0, { text: "Locked", locked: true }),
  ];
  const original = structuredClone(items);
  assert.throws(() => clearContent(items, ids(items)), /Unlock/);
  assert.deepEqual(items, original);
  items[0].groupId = items[1].groupId = "g";
  assert.throws(() => clearContent(items, ids([items[0]])), /Unlock/);
  assert.equal(items[0].text, "First");
  const frame = item("frame", 0, 0, { groupId: "g" });
  const child = item("note", 0, 0, { locked: true, parentId: frame.id });
  assert.throws(
    () => clearContent([items[0], frame, child], ids([items[0]])),
    /Unlock/,
  );
  assert.equal(items[0].text, "First");
});
test("clearing a small selection on a 5,000-object board reads only selected content", () => {
  const selected = item("note", 0, 0, { text: "", tagIds: ["research"] });
  const items = [
    selected,
    ...Array.from({ length: 4999 }, (_, n) => {
      const other = item("rect", n * 10, 0, { text: "Unrelated" });
      for (const key of ["text", "textRuns", "textBlocks", "tagIds"])
        Object.defineProperty(other, key, {
          get() {
            throw Error("Unrelated content read");
          },
        });
      return other;
    }),
  ];
  assert.equal(clearContent(items, ids([selected])), 1);
  assert.equal(selected.tagIds, undefined);
  assert.equal(clearContent(items, ids([selected])), 0);
});
test("clear-content command eligibility reads metadata only and respects viewers, locks and unsupported types", () => {
  const b = board();
  const n = item("note", 0, 0);
  Object.defineProperty(n, "text", {
    get() {
      throw Error("Do not index content");
    },
  });
  b.items = [n];
  const entry = (readOnly = false) =>
    commandEntries({ board: b, selection: ids(b.items), readOnly }).find(
      (c) => c.id === "clear-content",
    );
  assert.equal(entry().disabled, "");
  assert.match(entry(true).disabled, /read-only/);
  n.locked = true;
  assert.match(entry().disabled, /Unlock/);
  b.items = [item("text", 0, 0, { text: "Keep text" })];
  assert.match(entry().disabled, /sticky notes or shapes/);
});
test("shared clearing and undo preserve concurrent text, style and tag additions", () => {
  const a = new SharedDocument(),
    b = new SharedDocument(),
    value = board();
  value.tags = [
    { id: "old", name: "Old", color: "#365dc4" },
    { id: "new", name: "New", color: "#137f91" },
  ];
  value.items = [
    item("note", 0, 0, { text: "Hello", tagIds: ["old"], bold: true }),
  ];
  try {
    a.commit(value);
    b.apply(a.update());
    a.undo.clear();
    const cleared = a.snapshot();
    clearContent(cleared.items, ids(cleared.items));
    a.commit(cleared);
    const remote = b.snapshot();
    remote.items[0].text += " world";
    remote.items[0].tagIds.push("new");
    remote.items[0].color = "#dce5f7";
    b.commit(remote);
    a.apply(b.update());
    b.apply(a.update());
    const merged = a.snapshot();
    assert.equal(merged.items[0].text, " world");
    assert.deepEqual(merged.items[0].tagIds, ["new"]);
    assert.equal(merged.items[0].color, "#dce5f7");
    assert.deepEqual(
      merged.tags,
      value.tags.toSorted((x, y) => x.id.localeCompare(y.id)),
    );
    a.undo.undo();
    b.apply(a.update());
    assert.equal(a.snapshot().items[0].text, "Hello world");
    assert.deepEqual(
      new Set(a.snapshot().items[0].tagIds),
      new Set(["old", "new"]),
    );
    assert.equal(a.snapshot().items[0].color, "#dce5f7");
    assert.deepEqual(a.snapshot(), b.snapshot());
  } finally {
    a.destroy();
    b.destroy();
  }
});
