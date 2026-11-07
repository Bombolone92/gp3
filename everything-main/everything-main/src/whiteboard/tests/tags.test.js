import test from "node:test";
import assert from "node:assert/strict";
import { board, item, validateBoard } from "../src/model.js";
import {
  importTags,
  referencedTags,
  rebaseTags,
  tagFooter,
} from "../src/tags.js";
import { SharedDocument, rebase } from "../src/collaboration/document.js";
import { tagLayout } from "../src/tag-renderer.js";
import {
  clipboardFormats,
  readFragment,
  placeFragment,
  CLIPBOARD_TYPE,
} from "../src/transfer.js";
import { createSearchIndex, searchIndex } from "../src/board-search.js";
import { createCanvas } from "./canvas.js";
import { fitTextLayout } from "../src/text.js";
import { drawObject } from "../src/render.js";
import { quickConnectPlan } from "../src/quick-connect.js";
const tags = [
  { id: "a", name: "Urgent", color: "#c43b3b" },
  { id: "b", name: "Café", color: "#365dc4" },
  { id: "c", name: "Research", color: "#27834b" },
];
function fixture() {
  const b = board();
  b.tags = structuredClone(tags);
  b.items = [
    item("note", 0, 0, { text: "A useful idea", tagIds: ["a"] }),
    item("note", 300, 0, { text: "Another idea" }),
  ];
  return b;
}

test("a shortened tag label breaks between graphemes, never inside an emoji sequence", () => {
  const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}",
    name = family.repeat(12);
  const ctx = {
    measureText: (text) => ({ width: Array.from(text).length * 10 }),
  };
  const tags = new Map([["t1", { id: "t1", name, color: "#ff0000" }]]);
  const note = item("note", 0, 0, { w: 200, h: 200, tagIds: ["t1"] });
  const [chip] = tagLayout(ctx, note, tags).shapes;
  assert.ok(chip.text.endsWith("…"));
  const kept = chip.text.slice(0, -1);
  assert.ok(kept.length > 0 && kept.length < name.length);
  assert.equal(kept.length % family.length, 0, JSON.stringify(kept));
});

test("tag schema bounds labels, identifiers, colors, membership and legacy boards", () => {
  validateBoard(board());
  const b = fixture();
  validateBoard(b);
  for (const patch of [
    { id: "a:" },
    { name: " " },
    { name: "X".repeat(65) },
    { name: "a\nb" },
    { color: "red" },
    { extra: true },
  ]) {
    const bad = structuredClone(b);
    Object.assign(bad.tags[0], patch);
    assert.throws(() => validateBoard(bad));
  }
  for (const ids of [["missing"], ["a", "a"], Array(9).fill("a")]) {
    const bad = structuredClone(b);
    bad.items[0].tagIds = ids;
    assert.throws(() => validateBoard(bad));
  }
  assert.throws(() => validateBoard({ ...b, tags: Array(1001).fill(tags[0]) }));
});

test("tag clipboard preserves definitions and imports reuse destination names without changing their color", () => {
  const b = fixture(),
    formats = clipboardFormats([b.items[0]], b.tags);
  const fragment = readFragment({ getData: (type) => formats[type] || "" });
  assert.deepEqual(fragment.tags, [tags[0]]);
  const copied = placeFragment(fragment, { x: 100, y: 200 });
  assert.deepEqual(copied[0].tagIds, ["a"]);
  assert.notEqual(copied[0].id, b.items[0].id);
  const dest = board();
  dest.tags = [{ id: "existing", name: "urgent", color: "#222722" }];
  dest.tags = importTags(dest, copied, fragment.tags);
  dest.items = copied;
  validateBoard(dest);
  assert.deepEqual(copied[0].tagIds, ["existing"]);
  assert.equal(dest.tags[0].color, "#222722");
  const forged = JSON.parse(formats[CLIPBOARD_TYPE]);
  delete forged.tags;
  assert.throws(() =>
    readFragment({
      getData: (type) =>
        type === CLIPBOARD_TYPE ? JSON.stringify(forged) : "",
    }),
  );
  assert.deepEqual(referencedTags(b.items, b.tags), [tags[0]]);
});

test("tag search indexes renamed labels, supports exact filtering, and retains accent-insensitive text search", () => {
  const b = fixture();
  b.items[1].tagIds = ["b"];
  let index = createSearchIndex(b.items, b.tags);
  assert.equal(searchIndex(index, "cafe")[0].item.id, b.items[1].id);
  assert.equal(searchIndex(index, "", "note", "a")[0].item.id, b.items[0].id);
  b.tags[0].name = "Priority";
  index = createSearchIndex(b.items, b.tags);
  assert.equal(searchIndex(index, "urgent").length, 0);
  assert.equal(searchIndex(index, "priority").length, 1);
});

test("shared tag assignments and catalog edits merge independently and local undo preserves remote changes", () => {
  const b = fixture(),
    a = new SharedDocument();
  a.commit(b);
  a.undo.clear();
  const other = new SharedDocument(a.update());
  try {
    const mine = a.snapshot(),
      theirs = other.snapshot();
    mine.items[0].tagIds.push("b");
    theirs.items[0].tagIds.push("c");
    theirs.tags.find((t) => t.id === "a").name = "Priority";
    a.commit(mine);
    other.commit(theirs);
    a.apply(other.update());
    other.apply(a.update());
    assert.deepEqual(a.snapshot(), other.snapshot());
    assert.deepEqual(a.snapshot().items[0].tagIds, ["a", "b", "c"]);
    a.undo.undo();
    assert.deepEqual(a.snapshot().items[0].tagIds, ["a", "c"]);
    assert.equal(a.snapshot().tags.find((t) => t.id === "a").name, "Priority");
    a.validate();
    const removed = other.snapshot();
    removed.tags = removed.tags.filter((t) => t.id !== "a");
    removed.items[0].tagIds = removed.items[0].tagIds.filter(
      (id) => id !== "a",
    );
    other.commit(removed);
    a.apply(other.update());
    a.validate();
    assert.equal(a.snapshot().items[0].tagIds.includes("a"), false);
  } finally {
    a.destroy();
    other.destroy();
  }
});

test("queued tag changes retain remote assignments and catalog creation while deletion removes stale references", () => {
  const b = fixture(),
    mine = structuredClone(b),
    remote = structuredClone(b);
  mine.items[0].tagIds.push("b");
  remote.items[0].tagIds.push("c");
  remote.tags[0].name = "Priority";
  const merged = rebase(mine, b, remote);
  assert.deepEqual(merged.items[0].tagIds, ["a", "b", "c"]);
  assert.equal(merged.tags[0].name, "Priority");
  validateBoard(merged);
  remote.tags = remote.tags.filter((t) => t.id !== "a");
  remote.items[0].tagIds = ["c"];
  const next = rebase(mine, b, remote);
  assert.deepEqual(next.items[0].tagIds, ["b", "c"]);
  validateBoard(next);
  assert.deepEqual(rebaseTags([], [], tags), tags);
});

test("shared tag validation rejects forged registers and concurrent over-capacity assignments remain bounded", () => {
  const b = fixture();
  b.tags = Array.from({ length: 10 }, (_, n) => ({
    id: `t${n}`,
    name: `Tag ${n}`,
    color: "#222722",
  }));
  b.items[0].tagIds = ["t0", "t1", "t2", "t3", "t4", "t5"];
  const a = new SharedDocument();
  a.commit(b);
  const other = new SharedDocument(a.update());
  try {
    const mine = a.snapshot(),
      remote = other.snapshot();
    mine.items[0].tagIds.push("t6", "t7");
    remote.items[0].tagIds.push("t8", "t9");
    a.commit(mine);
    other.commit(remote);
    a.apply(other.update());
    other.apply(a.update());
    assert.deepEqual(a.snapshot(), other.snapshot());
    assert.equal(a.snapshot().items[0].tagIds.length, 8);
    a.validate();
    a.items.get(b.items[0].id).set("tag:forged", false);
    assert.throws(() => a.validate());
  } finally {
    a.destroy();
    other.destroy();
  }
});

test("tag footer reserves text space, renders inside note bounds, and stays separate from quick-created content", () => {
  const i = fixture().items[0],
    ctx = createCanvas(400, 300).getContext("2d");
  const layout = fitTextLayout(i, ctx);
  assert.equal(layout.box.h, i.h - tagFooter(i));
  ctx.clearRect(0, 0, 400, 300);
  drawObject(
    ctx,
    i,
    "#30342f",
    () => {},
    false,
    new Map(tags.map((t) => [t.id, t])),
  );
  const pixels = ctx.getImageData(5, 133, 180, 24).data;
  let white = 0;
  for (let n = 0; n < pixels.length; n += 4)
    if (
      pixels[n] > 245 &&
      pixels[n + 1] > 245 &&
      pixels[n + 2] > 245 &&
      pixels[n + 3]
    )
      white++;
  assert.ok(white > 100, "Tag pill is painted in the footer");
  // Below the note lies only the note's own faint shadow, never a pill.
  const below = ctx.getImageData(10, 165, 1, 1).data;
  assert.ok(
    below[3] < 64,
    `Tag drawing stays inside the note (alpha ${below[3]})`,
  );
  const plan = quickConnectPlan([i], i.id, "right");
  assert.equal(plan.node.tagIds, undefined);
  assert.deepEqual(i.tagIds, ["a"]);
});

test("tag layout measurements are cached for large unchanged scenes and invalidate after rename or font load", async () => {
  const { tagLayout, tagCatalog, clearTagLayouts } =
    await import("../src/tag-renderer.js");
  const ctx = createCanvas(10, 10).getContext("2d"),
    measure = ctx.measureText.bind(ctx);
  let reads = 0;
  ctx.measureText = (text) => {
    reads++;
    return measure(text);
  };
  const catalog = tagCatalog(tags),
    items = Array.from({ length: 5000 }, () =>
      item("note", 0, 0, { tagIds: ["a", "b", "c"] }),
    );
  for (const i of items) tagLayout(ctx, i, catalog);
  reads = 0;
  for (const i of items) tagLayout(ctx, i, catalog);
  assert.equal(reads, 0);
  const renamed = new Map(catalog);
  renamed.set("a", { ...tags[0], name: "A longer label" });
  tagLayout(ctx, items[0], renamed);
  assert.ok(reads > 0);
  reads = 0;
  clearTagLayouts();
  tagLayout(ctx, items[1], catalog);
  assert.ok(reads > 0);
});

test("a tag two people create at once under the same name becomes one", async () => {
  const initial = board("Tags");
  const one = item("note", 0, 0, { text: "Fix login" }),
    two = item("note", 300, 0, { text: "Fix billing" });
  initial.items = [one, two];
  const seed = new SharedDocument();
  seed.commit(initial);
  const a = new SharedDocument(seed.update()),
    b = new SharedDocument(seed.update());
  seed.destroy();
  try {
    const tag = (id, note, doc) => {
      const next = doc.snapshot();
      next.tags = [{ id, name: "Urgent", color: "#c43b3b" }];
      next.items.find((i) => i.id === note.id).tagIds = [id];
      doc.commit(next);
    };
    tag("tag-b", one, a);
    tag("tag-a", two, b);
    a.apply(b.update(a.vector()));
    b.apply(a.update(b.vector()));
    for (const doc of [a, b]) {
      const merged = doc.snapshot();
      assert.deepEqual(
        merged.tags.map((t) => t.id),
        ["tag-a"],
      );
      assert.deepEqual(
        merged.items.map((i) => i.tagIds),
        [["tag-a"], ["tag-a"]],
      );
    }
    // Saving the board stores the one tag.
    a.commit(a.snapshot());
    assert.deepEqual([...a.tags.keys()], ["tag-a"]);
  } finally {
    a.destroy();
    b.destroy();
  }
});
