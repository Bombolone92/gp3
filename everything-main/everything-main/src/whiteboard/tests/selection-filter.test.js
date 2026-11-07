import test from "node:test";
import assert from "node:assert/strict";
import { item } from "../src/model.js";
import { selectionFilters } from "../src/selection-filter.js";

const all = (items) => new Set(items.map((i) => i.id));
const choice = (plan, type) => plan.choices.find((c) => c.key === type);

test("selection filtering distinguishes ordinary content, groups, and mind map nodes without reading text", () => {
  const items = [
    "note",
    "text",
    "rect",
    "ellipse",
    "arrow",
    "pen",
    "image",
    "frame",
    "table",
    "link",
    "file",
  ].map((type) => item(type, 0, 0));
  items.push(
    item("rect", 0, 0, { shape: "diamond" }),
    item("note", 0, 0, { mindMap: { parent: null } }),
    item("note", 0, 0, { groupId: "g" }),
    item("rect", 0, 0, { groupId: "g" }),
  );
  for (const i of items)
    Object.defineProperty(i, "text", {
      get() {
        throw Error("Content must not be read");
      },
    });
  const plan = selectionFilters(items, all(items));
  assert.equal(plan.choices.length, 12);
  assert.equal(choice(plan, "shape").count, 3);
  assert.equal(choice(plan, "group").count, 1);
  assert.equal(choice(plan, "group").ids.size, 2);
  assert.equal(choice(plan, "note").ids.size, 1);
  assert.equal(choice(plan, "mind").ids.size, 1);
  assert.equal(selectionFilters(items, new Set(["deleted"])).choices.length, 0);
});

test("filtering retains atomic containers and hidden branches while allowing independent frame contents", () => {
  const frame = item("frame", 0, 0),
    root = item("rect", 20, 20, { mindMap: { parent: null } }),
    child = item("text", 50, 20, {
      mindMap: { parent: root.id },
      locked: true,
    }),
    note = item("note", 40, 40, { parentId: frame.id }),
    grouped = item("note", 60, 40, { groupId: "g" }),
    sibling = item("ellipse", 80, 40, { groupId: "g", locked: true });
  const items = [frame, root, child, note, grouped, sibling];
  const plan = selectionFilters(
    items,
    new Set([frame.id, root.id, note.id, grouped.id]),
  );
  assert.deepEqual(choice(plan, "frame").ids, new Set([frame.id, note.id]));
  assert.deepEqual(choice(plan, "note").ids, new Set([note.id]));
  assert.deepEqual(choice(plan, "mind").ids, new Set([root.id, child.id]));
  assert.deepEqual(
    choice(plan, "group").ids,
    new Set([grouped.id, sibling.id]),
  );
  assert.equal(child.locked, true);
  assert.equal(note.parentId, frame.id);
});

test("filter signatures detect changed types, membership and deleted sources, but tolerate content, positions, locks and stacking", () => {
  const frame = item("frame", 0, 0),
    note = item("note", 20, 20, { parentId: frame.id });
  const items = [frame, note],
    ids = all(items),
    original = selectionFilters(items, ids).signature;
  Object.assign(note, { text: "Concurrent text", x: 500, locked: true });
  assert.equal(selectionFilters([...items].reverse(), ids).signature, original);
  note.type = "rect";
  assert.notEqual(selectionFilters(items, ids).signature, original);
  note.type = "note";
  assert.notEqual(selectionFilters([frame], ids).signature, original);
  assert.notEqual(
    selectionFilters(
      [...items, item("text", 40, 40, { parentId: frame.id })],
      ids,
    ).signature,
    original,
  );
  note.groupId = "g";
  assert.notEqual(selectionFilters(items, ids).signature, original);
});

test("a 5,000-object selection has a bounded type catalog and does not inspect geometry or text", () => {
  const items = Array.from({ length: 5000 }, (_, n) => ({
    id: String(n),
    type: n % 2 ? "note" : "rect",
    get text() {
      throw Error("text");
    },
    get x() {
      throw Error("geometry");
    },
  }));
  const plan = selectionFilters(items, all(items));
  assert.equal(plan.choices.length, 2);
  assert.equal(choice(plan, "note").count, 2500);
  assert.equal(choice(plan, "shape").count, 2500);
});
