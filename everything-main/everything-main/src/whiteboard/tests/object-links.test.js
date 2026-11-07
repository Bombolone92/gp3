import test from "node:test";
import assert from "node:assert/strict";
import { board, item, validateBoard } from "../src/model.js";
import {
  objectAddress,
  boardDestination,
  linkTo,
  validObjectLink,
} from "../src/object-link-data.js";
import {
  selectionFragment,
  placeFragment,
  clipboardFormats,
  readFragment,
} from "../src/transfer.js";
import { planDuplication } from "../src/duplication.js";
import { SharedDocument, rebase } from "../src/collaboration/document.js";
import { createSearchIndex, searchIndex } from "../src/board-search.js";
const base = "https://whiteboard.test/app/?tracking=secret#invite=secret";

test("object links validate exact bounded destinations and reject active schemes and malformed metadata", () => {
  const b = board(),
    note = item("note", 0, 0);
  b.items = [note];
  for (const link of [
    { url: "https://example.com/path?a=1&b=2" },
    { objectId: "target café" },
  ]) {
    note.objectLink = link;
    assert.equal(validObjectLink(link), true);
    validateBoard(b);
  }
  for (const link of [
    null,
    [],
    {},
    { objectId: "" },
    { objectId: "x".repeat(257) },
    { objectId: "x\n" },
    { url: "javascript:alert(1)" },
    { url: "data:text/html,hi" },
    { url: "https://example.com", objectId: "x" },
    { url: "https://example.com", extra: true },
  ]) {
    note.objectLink = link;
    assert.throws(() => validateBoard(b), /object link/);
  }
});
test("direct object addresses use public board identity, omit invitation/query credentials and normalize same-board targets", () => {
  const b = board(),
    address = objectAddress(b, "target café", base);
  assert.deepEqual(boardDestination(address, base), {
    localId: b.id,
    objectId: "target café",
  });
  assert.equal(new URL(address).search, "");
  assert.ok(!address.includes("secret"));
  assert.deepEqual(linkTo(address, b, base), { objectId: "target café" });
  assert.deepEqual(linkTo("example.com", b, base), {
    url: "https://example.com/",
  });
  assert.equal(
    boardDestination("https://other.test/app/#local=x&object=y", base),
    null,
  );
  assert.equal(
    boardDestination("https://whiteboard.test/other/#local=x&object=y", base),
    null,
  );
  b.shared = { server: "https://worker.puter.work", room: "room1" };
  const shared = objectAddress(b, "node1", base);
  assert.deepEqual(boardDestination(shared, base), {
    server: b.shared.server,
    room: "room1",
    token: undefined,
    objectId: "node1",
  });
  assert.deepEqual(linkTo(shared, b, base), { objectId: "node1" });
  // Notification links name the discussion to open.
  assert.deepEqual(boardDestination(`${shared}&thread=t1`, base), {
    server: b.shared.server,
    room: "room1",
    token: undefined,
    objectId: "node1",
    thread: "t1",
  });
  assert.equal(boardDestination(`${shared}&thread=%00`, base), null);
  assert.equal(
    boardDestination(
      "https://whiteboard.test/app/#board=x&server=https://attacker.test&object=y",
      base,
    ),
    null,
  );
  const other = { ...b, shared: { ...b.shared, room: "room2" } };
  assert.deepEqual(linkTo(shared, other, base), { url: shared });
  assert.equal(
    boardDestination(objectAddress(b, undefined, base), base).objectId,
    undefined,
  );
});
test("duplicating and transferring remaps included link targets and preserves references outside a copied selection", () => {
  const b = board(),
    a = item("note", 0, 0),
    target = item("frame", 400, 0),
    external = item("note", 900, 0);
  a.objectLink = { objectId: target.id };
  target.objectLink = { objectId: external.id };
  b.items = [a, target, external];
  const plan = planDuplication(b.items, new Set([a.id, target.id]));
  assert.equal(plan.copies[0].objectLink.objectId, plan.idMap.get(target.id));
  assert.equal(plan.copies[1].objectLink.objectId, external.id);
  const fragment = selectionFragment(
    b.items,
    new Set([a.id, target.id]),
    (id) => objectAddress(b, id, base),
  );
  assert.equal(fragment[1].objectLink.url, objectAddress(b, external.id, base));
  const payload = clipboardFormats(fragment),
    decoded = readFragment({ getData: (type) => payload[type] || "" });
  const placed = placeFragment(decoded, { x: 100, y: 100 });
  assert.equal(placed[0].objectLink.objectId, placed[1].id);
  assert.equal(placed[1].objectLink.url, objectAddress(b, external.id, base));
  placed[0].objectLink.objectId = "changed";
  assert.equal(a.objectLink.objectId, target.id);
  validateBoard({ ...b, items: placed });
});
test("shared object links merge independent content edits, persist and undo without losing remote words", () => {
  const b = board(),
    i = item("note", 0, 0, { text: "Original" });
  b.items = [i];
  const a = new SharedDocument();
  a.commit(b);
  a.undo.clear();
  const remote = new SharedDocument(a.update());
  try {
    const original = a.snapshot(),
      local = structuredClone(original),
      other = structuredClone(original);
    local.items[0].objectLink = { url: "https://example.com/" };
    other.items[0].text = "Remote words";
    a.commit(local);
    remote.commit(other);
    a.apply(remote.update());
    remote.apply(a.update());
    assert.deepEqual(a.snapshot(), remote.snapshot());
    assert.equal(a.snapshot().items[0].text, "Remote words");
    assert.equal(a.snapshot().items[0].objectLink.url, "https://example.com/");
    assert.equal(rebase(local, original, other).items[0].text, "Remote words");
    a.undo.undo();
    assert.equal(a.snapshot().items[0].objectLink, undefined);
    assert.equal(a.snapshot().items[0].text, "Remote words");
    a.validate();
    remote.validate();
  } finally {
    a.destroy();
    remote.destroy();
  }
});
test("board search indexes object destination URLs", () => {
  const i = item("rect", 0, 0, {
    text: "Plan",
    objectLink: { url: "https://example.com/destination-review" },
  });
  assert.equal(
    searchIndex(createSearchIndex([i]), "destination-review")[0].item,
    i,
  );
});
