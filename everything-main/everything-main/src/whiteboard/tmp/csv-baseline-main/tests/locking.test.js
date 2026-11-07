import test from "node:test";
import assert from "node:assert/strict";
import { item, board, validateBoard, resizeHit } from "../src/model.js";
import { hasLocked, setLocked, protectedIds } from "../src/locking.js";
import {
  moveItems,
  removeItems,
  group,
  ungroup,
  createFrame,
  attachToFrame,
  layoutMoves,
  reorderItems,
  connectObjects,
  updateConnectors,
  duplicateItems,
  unlockedSelection,
  inferParents,
} from "../src/scene.js";

test("lock state is optional, strictly validated, persisted, and preserved in duplicates", () => {
  const b = board();
  b.items = [item("note", 10, 20)];
  assert.equal(validateBoard(b), b);
  const ids = new Set([b.items[0].id]);
  setLocked(b.items, ids, true);
  assert.equal(
    validateBoard(JSON.parse(JSON.stringify(b))).items[0].locked,
    true,
  );
  duplicateItems(b.items, ids);
  assert.equal(b.items[1].locked, true);
  for (const invalid of ["true", 1, {}, []]) {
    b.items[0].locked = invalid;
    assert.throws(() => validateBoard(b), /Invalid object lock/);
  }
  setLocked(b.items, new Set(b.items.map((i) => i.id)), false);
  assert.ok(b.items.every((i) => !Object.hasOwn(i, "locked")));
});

test("locked objects reject every scene mutation before modifying any content", () => {
  const a = item("note", 0, 0, { locked: true });
  const b = item("note", 300, 0);
  const items = [a, b],
    ids = new Set([a.id, b.id]);
  const before = structuredClone(items);
  for (const run of [
    () => moveItems(items, ids, 10, 20),
    () => removeItems(items, ids),
    () => group(items, ids),
    () => ungroup(items, ids),
    () => createFrame(items, ids),
    () => attachToFrame(items, ids, null),
    () => layoutMoves(items, ids, "left"),
    () => reorderItems(items, ids, "front"),
  ]) {
    assert.throws(run, /Unlock protected/);
    assert.deepEqual(items, before);
  }
  assert.equal(
    resizeHit(items, new Set([a.id]), { x: a.x + a.w, y: a.y + a.h }, 1),
    null,
  );
});

test("locking a frame leaves children editable; locked children protect their frame and group", () => {
  const a = item("note", 100, 100),
    b = item("note", 350, 100);
  const items = [a, b];
  const frame = createFrame(items, new Set([a.id, b.id]));
  setLocked(items, new Set([frame.id]), true);
  assert.equal(a.locked, undefined);
  assert.equal(hasLocked(items, new Set([a.id])), false);
  moveItems(items, new Set([a.id]), 10, 0);
  assert.equal(a.x, 110);
  assert.throws(() => moveItems(items, new Set([frame.id]), 10, 0));
  assert.deepEqual(
    unlockedSelection(items, new Set(items.map((i) => i.id))),
    new Set([a.id, b.id]),
  );
  setLocked(items, new Set([frame.id]), false);
  group(items, new Set([a.id, b.id]));
  setLocked(items, new Set([a.id]), true);
  assert.equal(b.locked, true);
  assert.equal(protectedIds(items).size, 3);
  assert.equal(unlockedSelection(items, new Set([frame.id])).size, 0);
  assert.throws(() => removeItems(items, new Set([frame.id])));
  const before = structuredClone(a);
  a.parentId = undefined;
  inferParents(items, new Set([a.id]));
  assert.equal(a.parentId, undefined); // Automatic membership cannot change a lock.
  Object.assign(a, before);
  setLocked(items, new Set([b.id]), false);
  assert.equal(a.locked, undefined);
  assert.equal(protectedIds(items).size, 0);
});

test("locked connectors follow endpoints but cannot be deleted indirectly", () => {
  const a = item("rect", 0, 0),
    b = item("rect", 300, 0);
  const items = [a, b];
  const arrow = connectObjects(items, new Set([a.id, b.id]));
  setLocked(items, new Set([arrow.id]), true);
  const before = arrow.w;
  moveItems(items, new Set([b.id]), 100, 0);
  assert.notEqual(arrow.w, before);
  assert.equal(arrow.locked, true);
  updateConnectors(items);
  assert.throws(() => removeItems(items, new Set([a.id])), /Unlock protected/);
  setLocked(items, new Set([arrow.id]), false);
  assert.deepEqual(removeItems(items, new Set([a.id])), [b]);
});
