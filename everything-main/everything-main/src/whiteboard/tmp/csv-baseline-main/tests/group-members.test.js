import test from "node:test";
import assert from "node:assert/strict";
import { item, clone } from "../src/model.js";
import {
  descendants,
  selectionGroupId,
  moveItems,
  removeItems,
  reorderItems,
  layoutUnits,
  layoutMoves,
  applyLayout,
  connectObjects,
  group,
} from "../src/scene.js";
import { createResizePlan, applyResize } from "../src/resize.js";
import { createRotationPlan, applyRotation } from "../src/rotation.js";
import { planDuplication } from "../src/duplication.js";
import { selectionFragment } from "../src/transfer.js";
import { selectionFilters } from "../src/selection-filter.js";
const ids = (...items) => new Set(items.map((i) => i.id));
const inside = { groups: false, withinGroup: "team" };
const fixture = () => [
  item("rect", 100, 100, { w: 120, h: 80, groupId: "team", text: "First" }),
  item("rect", 300, 140, { w: 100, h: 80, groupId: "team", text: "Second" }),
  item("note", 500, 200, { groupId: "team", text: "Third" }),
];
test("resolved group members move, resize, rotate, reorder and delete independently while connections follow", () => {
  let items = fixture();
  const [a, b, c] = items,
    untouched = clone([b, c]);
  const line = connectObjects(items, ids(a, b)),
    oldLine = clone(line);
  moveItems(items, ids(a), 25, 10, inside);
  assert.deepEqual([b, c], untouched);
  assert.notEqual(line.x, oldLine.x);
  const plan = createResizePlan(items, ids(a), null, inside);
  assert.equal(plan.items.length, 1);
  applyResize(items, plan, 180, 100);
  applyRotation(items, createRotationPlan(items, ids(a), inside), 45);
  assert.equal(a.rotation, 45);
  assert.deepEqual([b, c], untouched);
  assert.equal(a.groupId, "team");
  assert.deepEqual(
    reorderItems(items, ids(a), "front", inside).map((i) => i.id),
    [line.id, b.id, c.id, a.id],
  );
  items = removeItems(items, ids(a), inside);
  assert.deepEqual(items, untouched);
  const normal = fixture();
  moveItems(normal, ids(normal[0]), 10, 0);
  assert.deepEqual(
    normal.map((i) => i.x),
    [110, 310, 510],
    "Default API still moves complete groups",
  );
});
test("member copies detach partial groups but preserve complete nested containers and internal connections", () => {
  const [a, b, c] = fixture(),
    frame = item("frame", 10, 10, { groupId: "team" }),
    child = item("note", 30, 40, { parentId: frame.id }),
    items = [a, b, c, frame, child];
  const fragment = selectionFragment(items, ids(a), undefined, inside);
  assert.equal(fragment.length, 1);
  assert.equal(fragment[0].groupId, undefined);
  const one = planDuplication(items, ids(a), { ...inside, direction: "right" });
  assert.equal(one.copies.length, 1);
  assert.equal(one.copies[0].groupId, undefined);
  const container = planDuplication(items, ids(frame), inside);
  assert.equal(container.copies.length, 2);
  assert.equal(
    container.copies.find((i) => i.type === "note").parentId,
    container.idMap.get(frame.id),
  );
  assert.equal(container.copies[0].groupId, undefined);
  assert.deepEqual(descendants(items, ids(frame), inside), ids(frame, child));
  const normal = planDuplication(items, ids(a));
  assert.equal(normal.copies.length, 5);
  assert.ok(normal.copies.find((i) => i.text === "First").groupId);
  assert.equal(
    items[0].groupId,
    "team",
    "Copying never changes the source group",
  );
});
test("selection filters and alignment can work within a group, and grouping a subset retains other members", () => {
  const items = fixture(),
    [a, b, c] = items,
    all = ids(...items);
  assert.equal(layoutUnits(items, all).length, 1);
  assert.equal(layoutUnits(items, all, inside).length, 3);
  const plan = selectionFilters(items, all, inside);
  assert.deepEqual(
    plan.choices.map((c) => [c.key, c.count]),
    [
      ["note", 1],
      ["shape", 2],
    ],
  );
  assert.deepEqual(plan.choices.find((c) => c.key === "shape").ids, ids(a, b));
  applyLayout(items, layoutMoves(items, ids(a, b), "top", inside));
  assert.equal(b.y, a.y);
  assert.equal(c.y, 200);
  group(items, ids(a, b), inside);
  assert.equal(a.groupId, b.groupId);
  assert.notEqual(c.groupId, a.groupId);
});
test("member operations keep group and descendant locks authoritative", () => {
  const items = fixture(),
    [a, b] = items;
  b.locked = true;
  const original = clone(items);
  for (const action of [
    () => moveItems(items, ids(a), 1, 0, inside),
    () => createResizePlan(items, ids(a), null, inside),
    () => createRotationPlan(items, ids(a), inside),
    () => removeItems(items, ids(a), inside),
    () => reorderItems(items, ids(a), "front", inside),
  ])
    assert.throws(action, /Unlock/);
  assert.deepEqual(items, original);
  assert.equal(
    planDuplication(items, ids(a), inside).copies.length,
    1,
    "Copying protected content remains available",
  );
});

test("large-board member selection inspects unrelated metadata without reading content", () => {
  const selected = item("rect", 0, 0, { groupId: "team" }),
    items = [selected];
  for (let n = 1; n < 5000; n++) {
    const other = item("note", n * 10, 100, {
      groupId: n < 100 ? "team" : `g${n}`,
    });
    for (const key of ["text", "points", "src", "data"])
      Object.defineProperty(other, key, {
        get() {
          throw Error("Unselected content must not be read");
        },
      });
    items.push(other);
  }
  const chosen = ids(selected);
  assert.equal(
    planDuplication(items.slice(0, 4999), chosen, inside).copies.length,
    1,
  );
  assert.equal(selectionFragment(items, chosen, undefined, inside).length, 1);
  assert.equal(selectionFilters(items, chosen, inside).choices[0].count, 1);
  assert.equal(layoutUnits(items, chosen, inside).length, 1);
});

test("group navigation recognizes later-added container contents without treating outside objects as members", () => {
  const frame = item("frame", 0, 0, { groupId: "team" }),
    child = item("note", 40, 40, { parentId: frame.id }),
    peer = item("rect", 500, 0, { groupId: "team" }),
    outside = item("note", 800, 0);
  assert.equal(selectionGroupId([frame, child, peer]), "team");
  assert.equal(selectionGroupId([child, frame, peer]), "team");
  assert.equal(selectionGroupId([frame, child, peer, outside]), null);
  assert.equal(selectionGroupId([outside]), null);
});
