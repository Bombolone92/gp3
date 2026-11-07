import test from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { board, item } from "../src/model.js";
import {
  SharedDocument,
  REPAIR,
  rebase,
} from "../src/collaboration/document.js";
import {
  encode,
  decode,
  hash,
  topology,
  keyPair,
  verify,
  workerURL,
} from "../src/collaboration/protocol.js";
import { CollaborationSession } from "../src/collaboration/session.js";
import { reactionKey } from "../src/facilitation/model.js";

import {
  environment,
  memoryStore,
  owner,
  editor,
  viewer,
} from "./collaboration-helpers.js";

test("rebased editors and saved baselines never share received objects or nested content", () => {
  const before = board("Together");
  const received = {
    ...before,
    items: [item("table", 0, 0, { cells: [["Original"]] })],
  };
  const local = rebase(before, before, received);
  const baseline = rebase(before, before, received);
  local.items[0].color = "#dce5f7";
  local.items[0].cells[0][0] = "Edited";
  assert.equal(baseline.items[0].color, received.items[0].color);
  assert.equal(baseline.items[0].cells[0][0], "Original");
  const document = new SharedDocument();
  try {
    document.commit(received);
    document.commit(rebase(local, baseline, document.snapshot()));
    assert.equal(document.snapshot().items[0].color, "#dce5f7");
    assert.equal(document.snapshot().items[0].cells[0][0], "Edited");
    const next = rebase(local, baseline, received);
    next.items[0].cells[0][0] = "Independent";
    assert.equal(local.items[0].cells[0][0], "Edited");
  } finally {
    document.destroy();
  }
  const pending = {
    ...before,
    items: [item("pen", 0, 0, { points: [[1, 2]] })],
  };
  const next = rebase(pending, before, received);
  next.items.find((i) => i.type === "pen").points[0][0] = 10;
  assert.equal(pending.items[0].points[0][0], 1);
});

function seed() {
  const b = board("Together");
  b.items = [item("note", 0, 0, { text: "Hello" }), item("rect", 300, 0)];
  const doc = new SharedDocument();
  doc.commit(b);
  doc.undo.clear();
  return { b, doc };
}
test("concurrent object properties and text merge despite reordered and duplicate packets; undo stays local", () => {
  const { b, doc } = seed(),
    a = new SharedDocument(doc.update()),
    c = new SharedDocument(doc.update());
  const left = a.snapshot(),
    right = c.snapshot();
  left.items[0].x = 70;
  right.items[0].color = "#ff0000";
  a.commit(left);
  c.commit(right);
  a.text(b.items[0].id, "Hello Alice");
  c.text(b.items[0].id, "Hello Bob");
  const au = a.update(),
    bu = c.update();
  a.apply(bu);
  a.apply(bu);
  c.apply(au);
  assert.deepEqual(a.snapshot(), c.snapshot());
  assert.equal(a.snapshot().items[0].x, 70);
  assert.equal(a.snapshot().items[0].color, "#ff0000");
  assert.match(a.snapshot().items[0].text, /Alice/);
  assert.match(a.snapshot().items[0].text, /Bob/);
  a.undo.undo();
  assert.doesNotMatch(a.snapshot().items[0].text, /Alice/);
  assert.match(a.snapshot().items[0].text, /Bob/);
  a.undo.undo();
  assert.equal(a.snapshot().items[0].x, 0);
  assert.equal(a.snapshot().items[0].color, "#ff0000");
  for (const d of [doc, a, c]) d.destroy();
});
test("simultaneous geometry stays coherent; deletion does not resurrect an edited object", () => {
  const { doc } = seed(),
    a = new SharedDocument(doc.update()),
    b = new SharedDocument(doc.update());
  const x = a.snapshot(),
    y = b.snapshot();
  Object.assign(x.items[0], { x: 10, y: 20 });
  Object.assign(y.items[0], { x: 30, y: 40 });
  a.commit(x);
  b.commit(y);
  const one = a.update(),
    two = b.update();
  a.apply(two);
  b.apply(one);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.ok(
    [
      [10, 20],
      [30, 40],
    ].some(
      ([x, y]) =>
        a.snapshot().items[0].x === x && a.snapshot().items[0].y === y,
    ),
  );
  const next = a.snapshot();
  next.items.shift();
  a.commit(next);
  b.text(y.items[0].id, "Concurrent edit");
  a.apply(b.update());
  b.apply(a.update());
  assert.equal(a.snapshot().items.length, 1);
  assert.deepEqual(a.snapshot(), b.snapshot());
  for (const d of [doc, a, b]) d.destroy();
});
test("remote updates preserve an in-progress local gesture without overwriting unrelated fields", () => {
  const { b, doc } = seed(),
    local = structuredClone(b),
    remote = structuredClone(b);
  local.items[0].x = 100;
  remote.items[1].text = "Remote";
  remote.items[0].color = "#ff0000";
  const next = rebase(local, b, remote);
  assert.equal(next.items[0].x, 100);
  assert.equal(next.items[1].text, "Remote");
  assert.equal(next.items[0].color, "#ff0000");
  doc.destroy();
});
test("rebasing preserves local layer changes and insertion positions without undoing remote-only ordering", () => {
  const before = board("Layers");
  before.items = ["a", "b", "c", "d"].map((id) => item("rect", 0, 0, { id }));
  const local = structuredClone(before),
    remote = structuredClone(before);
  const ids = (b) => b.items.map((i) => i.id);
  local.items = [
    local.items[2],
    local.items[0],
    local.items[1],
    local.items[3],
  ];
  remote.items[0].color = "#ff0000";
  remote.items.splice(3, 0, item("note", 10, 10, { id: "remote" }));
  const next = rebase(local, before, remote);
  assert.deepEqual(ids(next), ["c", "a", "b", "remote", "d"]);
  assert.equal(next.items[1].color, "#ff0000");

  // Deletions cannot resurrect objects, and new local objects retain their layers.
  remote.items = remote.items.filter((i) => i.id !== "b");
  local.items.splice(0, 0, item("arrow", 0, 0, { id: "back" }));
  local.items.splice(2, 0, item("rect", 0, 0, { id: "middle" }));
  local.items.push(item("note", 0, 0, { id: "front" }));
  assert.deepEqual(ids(rebase(local, before, remote)), [
    "back",
    "c",
    "middle",
    "a",
    "remote",
    "d",
    "front",
  ]);

  const unchangedOrder = structuredClone(before);
  unchangedOrder.items[0].x = 120;
  remote.items.reverse();
  const moved = rebase(unchangedOrder, before, remote);
  assert.deepEqual(ids(moved), ids(remote));
  assert.equal(moved.items.find((i) => i.id === "a").x, 120);
});
test("512-participant topology is connected and stays within 61 links, including relay failover", () => {
  const roster = Array.from({ length: 512 }, (_, i) => ({
    session: String(i).padStart(4, "0"),
  }));
  for (const people of [
    roster,
    roster.slice(1),
    roster.filter((_, i) => i % 32 > 1),
  ]) {
    const { edges, relays } = topology(people),
      reached = new Set(),
      todo = [people[0].session];
    while (todo.length) {
      const id = todo.pop();
      if (reached.has(id)) continue;
      reached.add(id);
      todo.push(...edges.get(id));
    }
    assert.equal(reached.size, people.length);
    for (const [id, links] of edges)
      assert.ok(links.size <= (relays.has(id) ? 61 : 2));
  }
});
test("worker address validation prevents token forwarding to arbitrary hosts", () => {
  assert.equal(
    workerURL("https://whiteboard-test.puter.work"),
    "https://whiteboard-test.puter.work",
  );
  for (const value of [
    "https://evil.test",
    "http://whiteboard.puter.work",
    "https://whiteboard.puter.work.evil.test",
    "https://user:secret@whiteboard.puter.work",
    "https://whiteboard.puter.work/api",
  ])
    assert.throws(() => workerURL(value));
});

test("shared validation rejects structurally invalid text even when its JSON projection looks valid", () => {
  const { b, doc } = seed();
  doc.items
    .get(b.items[0].id)
    .set("text", "Looks like a note, but is not collaborative text");
  assert.throws(() => doc.validate(), /structure/);
  doc.destroy();
});

test("shared validation rejects geometry keys and labels that would change or break objects on every client", () => {
  const { b, doc } = seed();
  const entry = doc.items.get(b.items[0].id),
    geometry = entry.get("geometry");
  try {
    entry.set("geometry", { ...geometry, id: "spoofed" });
    assert.throws(() => doc.validate(), /geometry/);
    entry.set("geometry", { ...geometry, crop: undefined });
    doc.validate();
    entry.set("geometry", geometry);
    for (const [key, value] of [
      ["fileName", 42],
      ["url", 7],
      ["mimeType", {}],
      ["size", -1],
      ["size", "large"],
    ]) {
      entry.set(key, value);
      assert.throws(() => doc.validate(), /invalid object/, key);
      entry.delete(key);
    }
    entry.set("fileName", "notes.txt");
    entry.set("size", 12);
    doc.validate();
  } finally {
    doc.destroy();
  }
});

test("late movement previews cannot overwrite a newer committed action", () => {
  const env = environment(),
    { doc } = seed();
  const session = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: "test",
    user: owner,
    store: memoryStore(),
    changed() {},
    activity() {},
    status() {},
  });
  session.shared.apply(doc.update());
  const ticket = { session: "remote", user: editor.uuid, role: "editor" };
  const data = {
    cursor: { x: 3, y: 4 },
    selection: [],
    preview: [{ id: "moving", x: 10, y: 10, w: 50, h: 50 }],
  };
  try {
    session.receive("presence", data, ticket, 2);
    session.receive("committed", {}, ticket, 5);
    session.receive("edit", { update: encode(doc.update()) }, ticket, 3);
    session.receive("presence", data, ticket, 4);
    assert.equal(session.people.get("remote").preview.length, 0);
  } finally {
    session.close();
    doc.destroy();
  }
});

test("a finished move stays where it was dropped until its edit arrives", async () => {
  const env = environment(),
    { doc } = seed();
  let activity = 0;
  const session = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: "test",
    user: owner,
    store: memoryStore(),
    changed() {},
    activity: () => activity++,
    status() {},
  });
  session.shared.apply(doc.update());
  let synchronized = 0;
  session.synchronize = async () => void synchronized++;
  const ticket = { session: "remote", user: editor.uuid, role: "editor" };
  const moving = [{ id: "moving", x: 10, y: 10, w: 50, h: 50 }];
  const presence = (sequence, extra) =>
    session.receive(
      "presence",
      { cursor: { x: 3, y: 4 }, selection: [], preview: [], ...extra },
      ticket,
      sequence,
    );
  const shown = () => session.people.get("remote").preview;
  try {
    presence(1, { preview: moving });
    // Dropped: the gesture ended, and its edit is on its way.
    presence(2, { settling: true });
    assert.deepEqual(shown(), moving);
    presence(3, { settling: true, cursor: { x: 9, y: 9 } });
    assert.deepEqual(shown(), moving, "the cursor moving on keeps it");
    // The notice that the edit was saved ends it once the board has it.
    session.receive("committed", {}, ticket, 4);
    assert.deepEqual(shown(), moving);
    await new Promise((resolve) => setTimeout(resolve, 260));
    assert.equal(synchronized, 1);
    assert.deepEqual(shown(), []);
    assert.ok(activity > 0, "the board is drawn again");
    // A cancelled gesture ends at once.
    presence(5, { preview: moving });
    presence(6);
    assert.deepEqual(shown(), []);
    // And a kept preview lasts a few seconds at most.
    presence(7, { preview: moving });
    presence(8, { settling: true });
    session.people.get("remote").settling = Date.now() - 3500;
    presence(9, { settling: true });
    assert.deepEqual(shown(), []);
  } finally {
    session.close();
    doc.destroy();
  }
});

async function room(env) {
  const { b, doc } = seed();
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(doc.update()),
  });
  doc.destroy();
  return b;
}
async function invite(env, b, user, role = "editor") {
  const { token } = await env.service.call(owner, {
    op: "invite",
    room: b.id,
    role,
  });
  await env.service.call(user, { op: "join", room: b.id, token });
  return token;
}
test("peer document updates require a genuine worker receipt for the exact edit", async () => {
  const env = environment(),
    b = await room(env);
  await invite(env, b, editor);
  env.dropEvents = true;
  const session = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: owner,
    store: memoryStore(),
    changed() {},
    activity() {},
    status() {},
  });
  let other;
  try {
    await session.start();
    other = new SharedDocument(session.shared.update());
    const vector = other.vector();
    other.text(b.items[0].id, "Accepted text");
    const update = other.update(vector),
      encoded = encode(update);
    const ticket = { session: "remote", user: editor.uuid, role: "editor" };
    await session.receive("edit", { update: encoded }, ticket, 1);
    assert.equal(
      session.shared.snapshot().items[0].text,
      "Hello",
      "Unacknowledged peer edits cannot change the document",
    );
    const accepted = await env.service.call(editor, {
      op: "commit",
      room: b.id,
      id: await hash(update),
      update: encoded,
    });
    await session.receive(
      "edit",
      {
        update: encoded,
        receipt: accepted.receipt,
        receiptProof: accepted.receiptProof,
      },
      ticket,
      2,
    );
    assert.equal(session.shared.snapshot().items[0].text, "Accepted text");
    other.text(b.items[0].id, "Tampered text");
    await session.receive(
      "edit",
      {
        update: encode(other.update(vector)),
        receipt: accepted.receipt,
        receiptProof: accepted.receiptProof,
      },
      ticket,
      3,
    );
    assert.equal(
      session.shared.snapshot().items[0].text,
      "Accepted text",
      "A receipt cannot authorize different update bytes",
    );
  } finally {
    session.close();
    other?.destroy();
  }
});
test("worker isolates membership, identifies contributors, retries idempotently, and rejects viewers", async () => {
  const env = environment(),
    b = await room(env);
  await assert.rejects(env.service.call(editor, { op: "sync", room: b.id }), {
    status: 403,
  });
  await invite(env, b, editor);
  await invite(env, b, viewer, "viewer");
  const base = await env.service.call(editor, { op: "sync", room: b.id });
  const doc = new SharedDocument(decode(base.update)),
    vector = doc.vector();
  doc.text(b.items[0].id, "Bob wrote this");
  const binary = doc.update(vector),
    update = encode(binary),
    id = await hash(binary);
  const request = { op: "commit", room: b.id, id, update, author: "owner" };
  await assert.rejects(env.service.call(viewer, request), { status: 403 });
  await Promise.all([
    env.service.call(editor, request),
    env.service.call(editor, request),
  ]);
  // Edits are recorded once, under time-ordered log keys.
  const rows = [...env.data].filter(([key]) => key.includes(":log:"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1].author, editor.uuid);
  await assert.rejects(
    env.service.call(editor, {
      op: "role",
      room: b.id,
      uuid: owner.uuid,
      role: "removed",
    }),
    { status: 403 },
  );
  const keys = await keyPair();
  const presence = await env.service.call(editor, {
    op: "presence",
    room: b.id,
    session: "bob-tab",
    publicKey: keys.publicKey,
    invite: "PEER",
  });
  const joined = await env.service.call(editor, { op: "join", room: b.id });
  assert.equal(
    await verify(joined.publicKey, presence.ticket, presence.signature),
    true,
  );
  assert.equal(presence.ticket.username, "Bob");
  await env.service.call(owner, {
    op: "role",
    room: b.id,
    uuid: editor.uuid,
    role: "removed",
  });
  await assert.rejects(env.service.call(editor, request), { status: 403 });
  assert.equal(env.data.has(`wb:${b.id}:presence:bob-tab`), false);
  doc.destroy();
});
test("invitation expiration and revocation do not remove existing members", async () => {
  const env = environment(),
    b = await room(env),
    token = await invite(env, b, editor);
  await env.service.call(owner, { op: "revoke-invite", room: b.id });
  await assert.rejects(
    env.service.call(viewer, { op: "join", room: b.id, token }),
    { status: 403 },
  );
  await env.service.call(editor, { op: "sync", room: b.id });
  assert.equal(
    (await env.service.call(editor, { op: "join", room: b.id, token })).member
      .role,
    "editor",
    "Existing members can reopen the original invitation after revocation",
  );
  const fresh = await env.service.call(owner, { op: "invite", room: b.id });
  env.now += 8 * 86400_000;
  await assert.rejects(
    env.service.call(viewer, { op: "join", room: b.id, token: fresh.token }),
    { status: 403 },
  );
  await env.service.call(owner, {
    op: "role",
    room: b.id,
    uuid: editor.uuid,
    role: "viewer",
  });
  assert.equal(
    (
      await env.service.call(editor, {
        op: "join",
        room: b.id,
        token: fresh.token,
      })
    ).member.role,
    "viewer",
    "Expired invitation links retain the member's current role",
  );
  await env.service.call(owner, {
    op: "role",
    room: b.id,
    uuid: editor.uuid,
    role: "removed",
  });
  for (const linkToken of [undefined, token, fresh.token])
    await assert.rejects(
      env.service.call(editor, { op: "join", room: b.id, token: linkToken }),
      { status: 403 },
    );
});
test("no one can change the owner's access while the board's details still name the previous owner", async () => {
  const env = environment(),
    b = await room(env);
  await invite(env, b, editor);
  await invite(env, b, viewer, "facilitator");
  // Ownership moved on another worker instance; this one's board details
  // are a moment old and still name the previous owner.
  const key = `wb:${b.id}:member:${editor.uuid}`;
  env.data.set(key, { ...env.data.get(key), role: "owner" });
  await assert.rejects(
    env.service.call(viewer, {
      op: "role",
      room: b.id,
      uuid: editor.uuid,
      role: "removed",
    }),
    { status: 400 },
  );
  assert.equal(env.data.get(key).role, "owner");
});
test("facilitator invitations stop admitting facilitators once their creator no longer owns the board", async () => {
  const env = environment(),
    b = await room(env);
  await invite(env, b, editor);
  const roomId = b.id;
  await env.service.call(owner, {
    op: "transfer",
    room: roomId,
    uuid: editor.uuid,
  });
  const [facilitator, member] = await Promise.all(
    ["facilitator", "editor"].map((role) =>
      env.service.call(editor, { op: "invite", room: roomId, role }),
    ),
  );
  await env.service.call(editor, {
    op: "transfer",
    room: roomId,
    uuid: owner.uuid,
  });
  await assert.rejects(
    env.service.call(viewer, {
      op: "join",
      room: roomId,
      token: facilitator.token,
    }),
    { status: 403 },
  );
  // Their other invitations still work while they manage the board.
  assert.equal(
    (
      await env.service.call(viewer, {
        op: "join",
        room: roomId,
        token: member.token,
      })
    ).member.role,
    "editor",
  );
});
test("two independent sessions recover missed events and lost acknowledgements across reload", async () => {
  const env = environment(),
    b = await room(env);
  await invite(env, b, editor);
  const stores = [memoryStore(), memoryStore()],
    states = [],
    statuses = [];
  const make = (user, i) =>
    new CollaborationSession({
      puter: env.sdk(user),
      server: "https://whiteboard-test.puter.work",
      room: b.id,
      user,
      store: stores[i],
      changed: (b) => {
        states[i] = b;
      },
      activity() {},
      status: (s) => statuses.push(s),
    });
  const a = make(owner, 0),
    c = make(editor, 1);
  try {
    await a.start();
    await c.start();
    env.dropEvents = true;
    const ab = structuredClone(states[0]),
      cb = structuredClone(states[1]);
    ab.items[0].x = 200;
    cb.items[1].text = "Bob's rectangle";
    await Promise.all([a.commit(ab, states[0]), c.commit(cb, states[1])]);
    await Promise.all([a.flush(), c.flush()]);
    await Promise.all([a.synchronize(), c.synchronize()]);
    assert.deepEqual(states[0], states[1]);
    assert.equal(states[0].items[0].x, 200);
    assert.equal(states[0].items[1].text, "Bob's rectangle");
    env.offline = true;
    const offline = structuredClone(states[1]);
    offline.items[0].text = "Saved offline";
    await c.commit(offline, states[1]);
    await assert.rejects(c.flush());
    assert.ok(c.unsaved);
    c.close();
    env.offline = false;
    env.lostAck = true;
    const recovered = make(editor, 1);
    try {
      await assert.rejects(recovered.start());
      assert.ok(recovered.pending.size);
      await recovered.flush();
      await a.synchronize();
      assert.equal(states[0].items[0].text, "Saved offline");
      assert.equal(recovered.unsaved, false);
      assert.equal(
        [...stores[1].rows.values()].filter((r) => r.kind === "update").length,
        0,
      );
    } finally {
      recovered.close();
    }
  } finally {
    a.close();
    c.close();
  }
});
test("more than one batch of offline edits saves after a reload", async () => {
  const env = environment(),
    b = await room(env);
  // IndexedDB returns rows in key order, and keys are content hashes.
  const store = memoryStore(),
    read = store.collaborationRows;
  store.collaborationRows = async (scope) =>
    (await read(scope)).sort((x, y) => (x.id < y.id ? -1 : 1));
  const make = () =>
    new CollaborationSession({
      puter: env.sdk(owner),
      server: "https://whiteboard-test.puter.work",
      room: b.id,
      user: owner,
      store,
      changed() {},
      activity() {},
      status() {},
    });
  env.dropEvents = true;
  const first = make();
  await first.start();
  env.offline = true;
  for (let n = 1; n <= 200; n++) {
    const before = first.shared.snapshot(),
      next = structuredClone(before);
    next.items[0].x = n;
    await first.commit(next, before);
  }
  await first.queue;
  first.close();
  env.offline = false;
  const reopened = make();
  try {
    await reopened.start();
    await reopened.flush();
    assert.equal(reopened.pending.size, 0);
    const { doc } = await env.service.load(b.id);
    assert.equal(doc.snapshot().items[0].x, 200);
    doc.destroy();
  } finally {
    reopened.close();
  }
});
test("shared layer changes persist, synchronize, and undo without removing another editor's changes", async () => {
  const env = environment(),
    b = await room(env);
  await invite(env, b, editor);
  env.dropEvents = true;
  const make = (user) =>
    new CollaborationSession({
      puter: env.sdk(user),
      server: "https://whiteboard-test.puter.work",
      room: b.id,
      user,
      store: memoryStore(),
      changed() {},
      activity() {},
      status() {},
    });
  const a = make(owner),
    c = make(editor),
    reopened = make(owner);
  const ids = (session) => session.shared.snapshot().items.map((i) => i.id);
  try {
    await a.start();
    await c.start();
    const before = a.shared.snapshot(),
      next = structuredClone(before);
    next.items.reverse();
    c.shared.text(b.items[0].id, "Remote text stays");
    await c.flush();
    await a.commit(next, before);
    assert.deepEqual(
      ids(a),
      [...b.items].reverse().map((i) => i.id),
    );
    await a.flush();
    await c.synchronize();
    assert.deepEqual(ids(c), ids(a));
    await reopened.start();
    assert.deepEqual(ids(reopened), ids(a), "Layer order survives reopening");
    a.shared.undo.undo();
    await a.flush();
    await c.synchronize();
    assert.deepEqual(
      ids(c),
      b.items.map((i) => i.id),
    );
    assert.equal(c.shared.snapshot().items[0].text, "Remote text stays");
    a.shared.undo.redo();
    await a.flush();
    await c.synchronize();
    assert.deepEqual(
      ids(c),
      [...b.items].reverse().map((i) => i.id),
    );
    assert.equal(c.shared.snapshot().items[1].text, "Remote text stays");
  } finally {
    a.close();
    c.close();
    reopened.close();
  }
});

test("shared media is stored in files and hydrated for export without embedding bytes in KV", async () => {
  const env = environment(),
    b = await room(env),
    store = memoryStore();
  let visible;
  const session = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: owner,
    store,
    changed: (b) => {
      visible = b;
    },
    activity() {},
    status() {},
  });
  try {
    await session.start();
    const before = structuredClone(visible),
      next = structuredClone(visible);
    next.items.push(
      item("image", 600, 0, { src: "data:image/png;base64,AA==" }),
    );
    await session.commit(next, before);
    await session.flush();
    assert.equal(visible.items.at(-1).src, "data:image/png;base64,AA==");
    assert.ok([...env.files.keys()].some((key) => key.includes("/assets/")));
    const loaded = await env.service.load(b.id);
    assert.match(loaded.doc.snapshot().items.at(-1).src, /^asset:/);
    assert.equal(JSON.stringify([...env.data]).includes("data:image"), false);
    loaded.doc.destroy();
  } finally {
    session.close();
  }
});
test("presence tickets carry only public key coordinates and cap sessions per account", async () => {
  const env = environment(),
    b = await room(env);
  await invite(env, b, viewer, "viewer");
  const keys = await keyPair();
  const padded = { ...keys.publicKey, padding: "x".repeat(100_000) };
  const call = (user, session, publicKey = keys.publicKey) =>
    env.service.call(user, { op: "presence", room: b.id, session, publicKey });
  const first = await call(viewer, "cam-0", padded);
  assert.deepEqual(Object.keys(first.ticket.publicKey).sort(), [
    "crv",
    "kty",
    "x",
    "y",
  ]);
  assert.ok(JSON.stringify(first.roster).length < 2000);
  await assert.rejects(
    call(viewer, "cam-bad", { ...keys.publicKey, x: "short" }),
    { status: 400 },
  );
  for (let n = 1; n < 16; n++) await call(viewer, `cam-${n}`);
  await assert.rejects(call(viewer, "cam-16"), { status: 429 });
  assert.equal(env.data.has(`wb:${b.id}:presence:cam-16`), false);
  // Existing sessions keep renewing, and other participants can still join.
  await call(viewer, "cam-3");
  const alice = await call(owner, "alice-tab");
  assert.equal(alice.roster.length, 17);
  assert.deepEqual(
    alice.roster.map((p) => p.session),
    alice.roster.map((p) => p.session).sort(),
  );
});
test("commits rejected by shared validation report a client error", async () => {
  const env = environment(),
    b = await room(env);
  await invite(env, b, editor);
  const base = await env.service.call(editor, { op: "sync", room: b.id });
  const doc = new SharedDocument(decode(base.update)),
    vector = doc.vector();
  doc.doc.getMap("unsupported").set("value", 1);
  const binary = doc.update(vector);
  await assert.rejects(
    env.service.call(editor, {
      op: "commit",
      room: b.id,
      id: await hash(binary),
      update: encode(binary),
    }),
    { status: 422 },
  );
  doc.destroy();
});
test("a legacy table resize concurrent with a structural change remains valid", () => {
  const b = board("Tables");
  b.items = [
    item("table", 0, 0, {
      w: 600,
      h: 180,
      cells: [
        ["One", "Two", "Three"],
        ["A", "B", "C"],
      ],
    }),
  ];
  const base = new SharedDocument();
  base.commit(b);
  base.doc.transact(() =>
    base.items.get(b.items[0].id).set("cells", b.items[0].cells),
  );
  const a = new SharedDocument(base.update()),
    c = new SharedDocument(base.update());
  const resized = a.snapshot();
  resized.items[0].columnWidths = [300, 150, 150];
  a.commit(resized);
  const widened = c.snapshot();
  widened.items[0].cells.forEach((row) => row.push("New"));
  c.commit(widened);
  c.apply(a.update(c.vector()));
  c.validate();
  assert.equal(c.snapshot().items[0].cells[0].length, 4);
  for (const d of [base, a, c]) d.destroy();
});
test("a batch the worker rejects is isolated, discarded, and replaced by shared state", async () => {
  const env = environment(),
    initial = board("Limits");
  const note = item("note", 0, 0, { text: "Hello" });
  initial.items = [note];
  initial.comments = [
    {
      id: "thread",
      x: 0,
      y: 0,
      resolved: false,
      messages: Array.from({ length: 99 }, (_, n) => ({
        id: `m${n}`,
        authorId: owner.uuid,
        authorName: owner.username,
        text: `Message ${n}`,
        createdAt: n,
      })),
    },
  ];
  const seedDoc = new SharedDocument();
  seedDoc.commit(initial);
  await env.service.call(owner, {
    op: "create",
    room: initial.id,
    update: encode(seedDoc.update()),
  });
  seedDoc.destroy();
  await invite(env, initial, editor);
  const states = [],
    rejected = [];
  const make = (user, i) =>
    new CollaborationSession({
      puter: env.sdk(user),
      server: "https://whiteboard-test.puter.work",
      room: initial.id,
      user,
      store: memoryStore(),
      changed: (next) => {
        states[i] = next;
      },
      activity() {},
      status() {},
      rejected: () => rejected.push(i),
    });
  const a = make(owner, 0),
    c = make(editor, 1);
  const reply = (state, user, id) => {
    const next = structuredClone(state);
    next.comments[0].messages.push({
      id,
      authorId: user.uuid,
      authorName: user.username,
      text: id,
      createdAt: 500,
    });
    return next;
  };
  try {
    await a.start();
    await c.start();
    env.dropEvents = true;
    // Flush explicitly so a slow run cannot upload rows between the steps.
    a.scheduleFlush = c.scheduleFlush = () => {};
    await a.commit(reply(states[0], owner, "alice"), states[0]);
    await a.flush();
    const renamed = structuredClone(states[1]);
    renamed.items[0].text = "Bob's note";
    await c.commit(renamed, states[1]);
    const replied = reply(renamed, editor, "bob");
    await c.commit(replied, renamed);
    const lost = structuredClone(replied);
    lost.items[0].text = "Discarded";
    await c.commit(lost, replied);
    assert.equal(c.pending.size, 3);
    await c.flush();
    assert.deepEqual(rejected, [1]);
    assert.equal(c.pending.size, 0);
    const ids = states[1].comments[0].messages.map((m) => m.id);
    assert.ok(ids.includes("alice") && !ids.includes("bob"));
    // The accepted prefix is kept; later rows are not partially applied.
    assert.equal(states[1].items[0].text, "Bob's note");
    // Later edits save normally.
    const later = structuredClone(states[1]);
    later.items[0].x = 90;
    await c.commit(later, states[1]);
    await c.flush();
    assert.equal(c.pending.size, 0);
    await a.synchronize();
    assert.equal(states[0].items[0].text, "Bob's note");
    assert.equal(states[0].items[0].x, 90);
    assert.equal(states[0].comments[0].messages.length, 100);
  } finally {
    a.close();
    c.close();
  }
});
test("no one can take up the positions of another participant's next edits, so accepted edits are never dropped", async () => {
  const env = environment(),
    initial = board("Together");
  initial.items = [item("note", 0, 0, { text: "Hello" })];
  const seed = new SharedDocument();
  seed.commit(initial);
  await env.service.call(owner, {
    op: "create",
    room: initial.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  await invite(env, initial, viewer, "commenter");
  await invite(env, initial, editor, "editor");
  const commit = async (user, bytes) =>
    env.service.call(user, {
      op: "commit",
      room: initial.id,
      id: await hash(bytes),
      update: encode(bytes),
    });
  const sync = async (user) =>
    decode(
      (await env.service.call(user, { op: "sync", room: initial.id })).update,
    );
  // The editor saves one edit, then makes another that is not saved yet.
  const mine = new SharedDocument(await sync(editor));
  let vector = mine.vector(),
    next = mine.snapshot();
  next.items[0].x = 50;
  mine.commit(next);
  await commit(editor, mine.update(vector));
  env.now += 3000;
  vector = mine.vector();
  next = mine.snapshot();
  next.title = "Renamed";
  mine.commit(next);
  const unsaved = mine.update(vector);
  // A commenter reserves the next clocks of every client the board lists
  // with content nobody sees.
  const varint = (n) => {
    const out = [];
    for (; n > 127; n = Math.floor(n / 128)) out.push(128 | (n & 127));
    return [...out, n];
  };
  const state = Y.decodeStateVector(
    Y.encodeStateVectorFromUpdate(await sync(viewer)),
  );
  const squat = [...varint(state.size)];
  for (const [client, clock] of state)
    squat.push(
      ...varint(1),
      ...varint(client),
      ...varint(clock),
      0,
      ...varint(1_000_000),
    );
  squat.push(...varint(0));
  await assert.rejects(commit(viewer, new Uint8Array(squat)), {
    status: 422,
    message: /another participant's edits/,
  });
  env.now += 3000;
  assert.ok((await commit(editor, unsaved)).receipt);
  const { doc } = await env.service.load(initial.id);
  assert.equal(doc.snapshot().title, "Renamed");
  assert.equal(doc.snapshot().items[0].x, 50);
  doc.destroy();
  // Content under a client ID of the commenter's own is still saved.
  const own = [
    ...varint(1),
    ...varint(1),
    ...varint(0x7ffffff0),
    ...varint(0),
    0,
    ...varint(5),
    ...varint(0),
  ];
  assert.ok((await commit(viewer, new Uint8Array(own))).receipt);
  mine.destroy();
});

test("participants cannot rewrite content, workshop settings or others' entries with unchanged values, and commenter saves leave content untouched", async () => {
  const env = environment(),
    initial = board("Projected");
  const frame = item("frame", 0, 0, { w: 400, h: 300, text: "Frame" }),
    note = item("note", 20, 20, { text: "Inside", parentId: frame.id });
  initial.items = [frame, note];
  const reaction = reactionKey(editor.uuid, ["o", note.id]);
  initial.workshop = {
    settings: { lock: "open" },
    [reaction]: {
      by: editor.uuid,
      target: ["o", note.id],
      types: ["thumbs"],
      at: 1,
      name: editor.username,
    },
  };
  const seed = new SharedDocument();
  seed.commit(initial);
  // A concurrent frame deletion leaves the note's stored membership behind;
  // snapshots leave it out.
  seed.items.delete(frame.id);
  await env.service.call(owner, {
    op: "create",
    room: initial.id,
    update: encode(seed.update()),
  });
  await invite(env, initial, viewer, "commenter");
  await invite(env, initial, editor, "editor");
  const rewrite = async (user, change) => {
    const { update } = await env.service.call(user, {
      op: "sync",
      room: initial.id,
    });
    const doc = new Y.Doc();
    doc.clientID = 0xfffffff0;
    Y.applyUpdate(doc, decode(update));
    const before = Y.encodeStateVector(doc);
    change(doc);
    const bytes = Y.encodeStateAsUpdate(doc, before);
    doc.destroy();
    return env.service.call(user, {
      op: "commit",
      room: initial.id,
      id: await hash(bytes),
      update: encode(bytes),
    });
  };
  const entry = (doc) => doc.getMap("items").get(note.id);
  await assert.rejects(
    rewrite(viewer, (doc) =>
      entry(doc).set("geometry", structuredClone(entry(doc).get("geometry"))),
    ),
    { status: 422 },
  );
  await assert.rejects(
    rewrite(viewer, (doc) => doc.getMap("board").set("title", "Projected")),
    { status: 422 },
  );
  // Editors are not facilitators: the same holds for workshop settings.
  await assert.rejects(
    rewrite(editor, (doc) =>
      doc.getMap("workshop").set("settings", { lock: "open" }),
    ),
    { status: 422 },
  );
  // Nor other participants' reactions, ballots or attendance.
  await assert.rejects(
    rewrite(viewer, (doc) =>
      doc
        .getMap("workshop")
        .set(reaction, structuredClone(doc.getMap("workshop").get(reaction))),
    ),
    { status: 422 },
  );
  // A commenter's own save writes only the discussion.
  let state;
  const session = new CollaborationSession({
    puter: env.sdk(viewer),
    server: "https://whiteboard-test.puter.work",
    room: initial.id,
    user: viewer,
    store: memoryStore(),
    changed: (next) => (state = next),
    activity() {},
    status() {},
    rejected: () => assert.fail("The comment was refused"),
  });
  try {
    await session.start();
    assert.equal(state.items[0].parentId, undefined);
    const next = structuredClone(state);
    next.comments = [
      {
        id: "thread",
        x: 0,
        y: 0,
        resolved: false,
        messages: [
          {
            id: "m",
            authorId: viewer.uuid,
            authorName: viewer.username,
            text: "A question",
            createdAt: 1,
          },
        ],
      },
    ];
    await session.commit(next, state);
    await session.flush();
    assert.equal(session.pending.size, 0);
  } finally {
    session.close();
  }
  const { doc } = await env.service.load(initial.id);
  try {
    assert.equal(doc.snapshot().comments[0].messages[0].text, "A question");
    assert.equal(doc.items.get(note.id).get("parentId"), frame.id);
  } finally {
    doc.destroy();
  }
});
test("a failed start releases live channels instead of leaving an unsaved writable session", async () => {
  const env = environment(),
    b = await room(env);
  const session = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: owner,
    store: memoryStore(),
    changed() {},
    activity() {},
    status() {},
  });
  const request = session.request.bind(session);
  session.request = (op, data) =>
    op === "sync"
      ? Promise.reject(Error("Network unavailable"))
      : request(op, data);
  await assert.rejects(session.start(), /Network unavailable/);
  assert.equal(session.closed, true);
  // Remote activity can no longer reopen editing on this session.
  session.readOnly = true;
  session.request = request;
  await session.synchronize();
  assert.equal(session.readOnly, true);
});
test("local edits persist outbox rows without rewriting the full snapshot", async () => {
  const env = environment(),
    b = await room(env),
    store = memoryStore();
  const writes = [];
  const put = store.collaborationPut.bind(store);
  store.collaborationPut = async (row) => {
    writes.push(row.kind);
    return put(row);
  };
  let state;
  const make = () =>
    new CollaborationSession({
      puter: env.sdk(owner),
      server: "https://whiteboard-test.puter.work",
      room: b.id,
      user: owner,
      store,
      changed: (next) => {
        state = next;
      },
      activity() {},
      status() {},
    });
  const session = make();
  try {
    await session.start();
    session.scheduleFlush = () => {};
    writes.length = 0;
    for (let n = 0; n < 5; n++) {
      const next = structuredClone(state);
      next.items[0].text = `Draft ${n}`;
      await session.commit(next, state);
    }
    assert.deepEqual(writes, Array(5).fill("update"));
  } finally {
    session.close();
  }
  // Reopening replays the saved rows over the older snapshot and uploads them.
  const reopened = make();
  try {
    await reopened.start();
    assert.equal(state.items[0].text, "Draft 4");
    assert.equal(reopened.pending.size, 0);
    assert.equal(
      [...store.rows.values()].filter((r) => r.kind === "update").length,
      0,
    );
  } finally {
    reopened.close();
  }
});
test("completed peer actions are remembered for a bounded set of sessions", () => {
  const session = new CollaborationSession({
    puter: {},
    server: "https://whiteboard-test.puter.work",
    room: "bounded",
    user: owner,
    store: memoryStore(),
    changed() {},
    activity() {},
    status() {},
  });
  for (let n = 0; n < 600; n++) session.acted(`s${n}`, 1);
  session.acted("s100", 5);
  session.acted("s100", 3);
  assert.equal(session.lastAction.size, 512);
  assert.equal(session.lastAction.get("s100"), 5);
  assert.equal(session.lastAction.has("s0"), false);
  session.close();
});
test("a synchronization requested during another one runs again afterwards", async () => {
  const env = environment(),
    b = await room(env);
  await invite(env, b, editor);
  const states = [];
  const make = (user, i) =>
    new CollaborationSession({
      puter: env.sdk(user),
      server: "https://whiteboard-test.puter.work",
      room: b.id,
      user,
      store: memoryStore(),
      changed: (next) => {
        states[i] = next;
      },
      activity() {},
      status() {},
    });
  const a = make(owner, 0),
    c = make(editor, 1);
  try {
    await a.start();
    await c.start();
    env.dropEvents = true;
    let release;
    const request = a.request.bind(a);
    a.request = async (op, data) => {
      const result = await request(op, data);
      if (op === "sync" && !release)
        await new Promise((resolve) => (release = resolve));
      return result;
    };
    const first = a.synchronize();
    while (!release) await new Promise((r) => setTimeout(r, 5));
    // A collaborator's edit lands after the first response was prepared.
    const next = structuredClone(states[1]);
    next.items[0].text = "Arrived meanwhile";
    await c.commit(next, states[1]);
    await c.flush();
    const second = a.synchronize();
    release();
    await Promise.all([first, second]);
    assert.equal(states[0].items[0].text, "Arrived meanwhile");
  } finally {
    a.close();
    c.close();
  }
});
test("an edit made while an upload finishes is sent soon after it, not at the next retry", async () => {
  const env = environment(),
    b = await room(env);
  let state;
  const session = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: owner,
    store: memoryStore(),
    changed: (next) => (state = next),
    activity() {},
    status() {},
  });
  try {
    await session.start();
    // Showing the upload's result takes a while, as on a large board.
    let slow = false,
      shown = 0,
      saving;
    const publish = session.publish.bind(session);
    session.publish = async () => {
      if (slow && ++shown === 1)
        await (saving = new Promise((r) => setTimeout(r, 150)));
      return publish();
    };
    const commits = () => env.calls.filter((c) => c.op === "commit").length;
    const before = commits();
    const first = structuredClone(state);
    first.title = "First";
    await session.commit(first, state);
    slow = true;
    const upload = session.flush();
    while (!saving) await new Promise((r) => setTimeout(r, 5));
    // A later edit arrives during that save and asks for an upload.
    const second = structuredClone(state);
    second.title = "Second";
    await session.commit(second, state);
    // Its batching delay ends while the upload is still finishing.
    clearTimeout(session.flushTimer);
    session.flushTimer = null;
    await session.flush();
    await upload;
    slow = false;
    assert.equal(commits(), before + 1);
    const deadline = Date.now() + 3000;
    while (session.pending.size && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(commits(), before + 2);
    assert.equal(session.pending.size, 0);
  } finally {
    session.close();
  }
});
test("a selection or open editor keeps being shared while its participant is idle", async () => {
  const env = environment(),
    b = await room(env);
  const session = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: owner,
    store: memoryStore(),
    changed() {},
    activity() {},
    status() {},
  });
  try {
    await session.start();
    const sent = [];
    session.peers?.close();
    session.peers = {
      links: new Map(),
      async broadcast(kind, data) {
        if (kind === "presence") sent.push(data);
      },
      close() {},
    };
    session.presence({ cursor: null, selection: [], editing: null });
    await new Promise((r) => setTimeout(r, 4300));
    assert.equal(sent.length, 1, "Nothing selected is not repeated");
    session.presence({ cursor: null, selection: ["note"], editing: null });
    await new Promise((r) => setTimeout(r, 6500));
    assert.ok(sent.length >= 3, `Presence updates: ${sent.length}`);
    assert.deepEqual(sent.at(-1).selection, ["note"]);
  } finally {
    session.close();
  }
});
test("someone whose access is removed stops seeing the previous participants", async () => {
  const env = environment(),
    b = await room(env);
  await invite(env, b, editor);
  const rosters = [];
  const make = (user, activity = () => {}) =>
    new CollaborationSession({
      puter: env.sdk(user),
      server: "https://whiteboard-test.puter.work",
      room: b.id,
      user,
      store: memoryStore(),
      changed() {},
      activity,
      status() {},
    });
  const a = make(owner),
    c = make(editor, (people, roster) => rosters.push(roster.length));
  try {
    await a.start();
    await c.start();
    await a.heartbeat();
    await c.heartbeat();
    assert.equal(rosters.at(-1), 2);
    await env.service.call(owner, {
      op: "role",
      room: b.id,
      uuid: editor.uuid,
      role: "removed",
    });
    env.now += 5000;
    await assert.rejects(c.heartbeat(), { status: 403 });
    c.failure({ status: 403 });
    assert.equal(rosters.at(-1), 0);
    // The regular presence expiry runs every two seconds.
    await new Promise((r) => setTimeout(r, 2200));
    assert.equal(rosters.at(-1), 0);
  } finally {
    a.close();
    c.close();
  }
});
test("network failures and gateway pages give a message people can act on, keeping the status", async () => {
  const env = environment(),
    b = await room(env);
  const puter = env.sdk(owner);
  const session = new CollaborationSession({
    puter,
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: owner,
    store: memoryStore(),
    changed() {},
    activity() {},
    status() {},
  });
  try {
    env.offline = true;
    await assert.rejects(session.request("sync"), (error) => {
      assert.equal(
        error.message,
        "Could not reach the shared board. Check your connection and try again.",
      );
      assert.equal(error.status, undefined);
      return true;
    });
    env.offline = false;
    puter.workers.exec = async () =>
      new Response("<html>Bad gateway</html>", { status: 502 });
    await assert.rejects(session.request("sync"), { status: 502 });
  } finally {
    session.close();
  }
});
test("an invite code renewed during a check-in is published right after it", async () => {
  const env = environment(),
    b = await room(env);
  const session = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: owner,
    store: memoryStore(),
    changed() {},
    activity() {},
    status() {},
  });
  try {
    await session.start();
    const peers = {
      server: { inviteCode: "first" },
      links: new Map(),
      update() {},
      close() {},
      async broadcast() {},
    };
    session.peers?.close();
    session.peers = peers;
    const published = [];
    let release;
    const request = session.request.bind(session);
    session.request = async (op, data) => {
      if (op === "presence") {
        published.push(data.invite);
        if (published.length === 1)
          await new Promise((resolve) => (release = resolve));
      }
      return request(op, data);
    };
    const first = session.heartbeat();
    while (!release) await new Promise((r) => setTimeout(r, 5));
    // The peer service reconnects with a new code meanwhile.
    peers.server.inviteCode = "second";
    await session.heartbeat();
    release();
    await first;
    const deadline = Date.now() + 2000;
    while (published.length < 2 && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(published, ["first", "second"]);
    // An unchanged code is not published twice.
    while (session.beating) await new Promise((r) => setTimeout(r, 5));
    const again = session.heartbeat();
    await session.heartbeat();
    await again;
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(published.length, 3);
  } finally {
    session.close();
  }
});
test("a failed upload while connecting leaves live features on and uploads once access returns", async () => {
  const env = environment(),
    b = await room(env),
    store = memoryStore();
  let state;
  const make = () =>
    new CollaborationSession({
      puter: env.sdk(owner),
      server: "https://whiteboard-test.puter.work",
      room: b.id,
      user: owner,
      store,
      changed: (next) => (state = next),
      activity() {},
      status() {},
    });
  const offline = make();
  await offline.start();
  offline.scheduleFlush = () => {};
  env.offline = true;
  const next = structuredClone(state);
  next.title = "Queued offline";
  await offline.commit(next, state);
  offline.close();
  env.offline = false;
  const session = make();
  const request = session.request.bind(session);
  let failures = 0;
  session.request = (op, data) =>
    op === "commit" && !failures++
      ? Promise.reject(Object.assign(Error("Unavailable"), { status: 503 }))
      : request(op, data);
  try {
    await assert.rejects(session.start(), { status: 503 });
    assert.equal(session.connected, true);
    assert.equal(session.pending.size, 1);
    // The editor makes a failed start read-only until a check-in.
    session.readOnly = session.contentReadOnly = true;
    await session.heartbeat();
    const deadline = Date.now() + 3000;
    while (session.pending.size && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(session.pending.size, 0);
    const { doc } = await env.service.load(b.id);
    try {
      assert.equal(doc.snapshot().title, "Queued offline");
    } finally {
      doc.destroy();
    }
  } finally {
    session.close();
  }
});
test("the save status says live the same way after synchronizing and after saving", async () => {
  const env = environment(),
    b = await room(env);
  const statuses = [];
  let state;
  const session = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: owner,
    store: memoryStore(),
    changed: (next) => (state = next),
    activity() {},
    status: (message) => statuses.push(message),
  });
  try {
    await session.start();
    // A large room: no board events, only a peer link.
    session.subscription?.off();
    session.subscription = null;
    const link = { connected: true, whiteboardAuthorized: false };
    session.peers?.close();
    session.peers = {
      links: new Map([["relay", link]]),
      update() {},
      close() {},
      async broadcast() {},
    };
    await session.synchronize();
    assert.equal(statuses.at(-1), "Saved · periodic sync");
    link.whiteboardAuthorized = true;
    await session.synchronize();
    assert.equal(statuses.at(-1), "Saved · live");
    const next = structuredClone(state);
    next.title = "Renamed";
    await session.commit(next, state);
    await session.flush();
    assert.equal(statuses.at(-1), "Saved · live");
    link.whiteboardAuthorized = false;
    const later = structuredClone(state);
    later.title = "Renamed again";
    await session.commit(later, state);
    await session.flush();
    assert.equal(statuses.at(-1), "Saved · periodic sync");
  } finally {
    session.close();
  }
});
test("synchronizing without news neither rewrites the local copy nor redraws, but deletions and access changes do", async () => {
  const env = environment(),
    b = await room(env);
  await invite(env, b, editor);
  const states = [],
    store = memoryStore();
  let puts = 0;
  const put = store.collaborationPut;
  store.collaborationPut = (row) => {
    if (row.kind === "snapshot") puts++;
    return put(row);
  };
  const changes = [0, 0];
  const make = (user, i, s = memoryStore()) =>
    new CollaborationSession({
      puter: env.sdk(user),
      server: "https://whiteboard-test.puter.work",
      room: b.id,
      user,
      store: s,
      changed: (next) => {
        states[i] = next;
        changes[i]++;
      },
      activity() {},
      status() {},
    });
  const a = make(owner, 0),
    c = make(editor, 1, store);
  try {
    await a.start();
    await c.start();
    env.dropEvents = true;
    const [renders, writes] = [changes[1], puts];
    await c.synchronize();
    await c.synchronize();
    // Nor does a periodic upload with nothing to send.
    await c.flush();
    assert.equal(changes[1], renders);
    assert.equal(puts, writes);
    // A deletion does not change the document's state vector.
    const next = structuredClone(states[0]);
    next.items = [];
    await a.commit(next, states[0]);
    await a.flush();
    await c.synchronize();
    assert.equal(changes[1], renders + 1);
    assert.equal(states[1].items.length, 0);
    assert.equal(puts, writes + 1);
    await env.service.call(owner, {
      op: "role",
      room: b.id,
      uuid: editor.uuid,
      role: "viewer",
    });
    env.now += 5000;
    await c.synchronize();
    assert.equal(c.readOnly, true);
    assert.equal(changes[1], renders + 2);
  } finally {
    a.close();
    c.close();
  }
});
test("a session whose ID another participant took after it lapsed continues under a new one", async () => {
  const env = environment(),
    b = await room(env);
  await invite(env, b, editor);
  await invite(env, b, viewer, "viewer");
  const session = new CollaborationSession({
    puter: env.sdk(editor),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: editor,
    store: memoryStore(),
    changed() {},
    activity() {},
    status() {},
  });
  try {
    await session.start();
    const lapsed = session.session;
    // The tab slept past the presence expiry, and someone claimed its ID.
    env.data.delete(`wb:${b.id}:presence:${lapsed}`);
    await env.service.call(viewer, {
      op: "presence",
      room: b.id,
      session: lapsed,
      publicKey: session.keys.publicKey,
    });
    await session.heartbeat();
    assert.notEqual(session.session, lapsed);
    assert.equal(session.readOnly, false);
    assert.ok(session.roster.some((p) => p.session === session.session));
    assert.equal(
      session.roster.find((p) => p.session === lapsed)?.user,
      viewer.uuid,
    );
  } finally {
    session.close();
  }
});
test("a facilitator revoking invitations leaves the owner's facilitator invitations", async () => {
  const env = environment(),
    b = await room(env);
  await invite(env, b, editor, "facilitator");
  const [lead, member] = await Promise.all(
    ["facilitator", "viewer"].map((role) =>
      env.service.call(owner, { op: "invite", room: b.id, role }),
    ),
  );
  await env.service.call(editor, { op: "revoke-invite", room: b.id });
  await assert.rejects(
    env.service.call(viewer, { op: "join", room: b.id, token: member.token }),
    { status: 403 },
  );
  assert.equal(
    (
      await env.service.call(viewer, {
        op: "join",
        room: b.id,
        token: lead.token,
      })
    ).member.role,
    "facilitator",
  );
  // The owner's revocation ends every invitation.
  const again = await env.service.call(owner, {
    op: "invite",
    room: b.id,
    role: "facilitator",
  });
  await env.service.call(owner, { op: "revoke-invite", room: b.id });
  const stranger = {
    uuid: "66666666-6666-4666-8666-666666666666",
    username: "Fay",
  };
  await assert.rejects(
    env.service.call(stranger, { op: "join", room: b.id, token: again.token }),
    { status: 403 },
  );
});
test("reports of exports are capped per person and minute, so no one can flood the audit log", async () => {
  const env = environment(),
    b = await room(env);
  await invite(env, b, viewer, "viewer");
  const exported = () =>
    env.service.call(viewer, {
      op: "export",
      room: b.id,
      format: "png",
      scope: "board",
    });
  for (let n = 0; n < 20; n++) await exported();
  await assert.rejects(exported(), { status: 429 });
  // Others are unaffected, and the allowance returns the next minute.
  await env.service.call(owner, { op: "export", room: b.id, format: "pdf" });
  const now = env.service.now;
  env.service.now = () => now() + 60_000;
  try {
    await exported();
  } finally {
    env.service.now = now;
  }
});

test("undoing a deletion a collaborator edited meanwhile brings the object back whole", async () => {
  for (const kind of ["note", "table"]) {
    const initial = board("Undo delete"),
      target = item(
        kind,
        0,
        0,
        kind === "table" ? { cells: [["A", "B"]] } : { text: "Hello" },
      );
    initial.items = [target, item("rect", 300, 0)];
    const seed = new SharedDocument();
    seed.commit(initial);
    const a = new SharedDocument(seed.update()),
      b = new SharedDocument(seed.update());
    seed.destroy();
    const exchange = () => {
      a.apply(b.update(a.vector()));
      b.apply(a.update(b.vector()));
    };
    try {
      // A deletes the object while B moves it (and adds a row to a table).
      const removed = a.snapshot();
      removed.items = removed.items.filter((i) => i.id !== target.id);
      a.commit(removed);
      const moved = b.snapshot(),
        other = moved.items.find((i) => i.id === target.id);
      other.x += 50;
      if (kind === "table") {
        other.cells.push(["", ""]);
        other.h += 40;
      }
      b.commit(moved);
      exchange();
      a.undo.undo();
      exchange();
      for (const doc of [a, b]) {
        doc.validate();
        const back = doc.snapshot().items.find((i) => i.id === target.id);
        assert.equal(back.w, target.w, kind);
        assert.equal(back.h, target.h, kind);
        if (kind === "table") assert.deepEqual(back.cells, [["A", "B"]]);
        else assert.equal(back.text, "Hello");
      }
      assert.deepEqual(a.snapshot(), b.snapshot());
      // Redo deletes it again, and a second undo restores it whole again.
      a.undo.redo();
      assert.equal(
        a.snapshot().items.some((i) => i.id === target.id),
        false,
      );
      a.undo.undo();
      a.validate();
      assert.equal(
        a.snapshot().items.find((i) => i.id === target.id).w,
        target.w,
      );
    } finally {
      a.destroy();
      b.destroy();
    }
  }
});

test("undoing a change made at the same moment as a collaborator's keeps the property", () => {
  const initial = board("Same property"),
    note = item("note", 0, 0, { text: "Hi", color: "#f6e7a4" }),
    table = item("table", 0, 300, { cells: [["A", "B"]] });
  initial.items = [note, table];
  for (let attempt = 0; attempt < 8; attempt++) {
    const seed = new SharedDocument();
    seed.commit(initial);
    const a = new SharedDocument(seed.update()),
      b = new SharedDocument(seed.update());
    seed.destroy();
    const exchange = () => {
      a.apply(b.update(a.vector()));
      b.apply(a.update(b.vector()));
    };
    const change = (doc, color, dx) => {
      const next = doc.snapshot();
      const n = next.items.find((i) => i.id === note.id),
        t = next.items.find((i) => i.id === table.id);
      n.color = color;
      n.x += dx;
      t.cells.push(["", ""]);
      t.h += 40;
      doc.commit(next);
    };
    try {
      change(a, "#dce5f7", 50);
      change(b, "#d8f0df", 90);
      exchange();
      const winner = a.snapshot().items[0].color === "#dce5f7" ? a : b;
      const won = structuredClone(winner.snapshot().items);
      winner.undo.undo();
      exchange();
      for (const doc of [a, b]) {
        doc.validate();
        const [n, t] = doc.snapshot().items;
        assert.equal(n.color, "#f6e7a4");
        assert.equal(n.x, 0);
        assert.deepEqual(t.cells, [["A", "B"]]);
        assert.equal(t.h, table.h);
      }
      assert.deepEqual(a.snapshot(), b.snapshot());
      // Redo brings back the undone change, and undo removes it again.
      winner.undo.redo();
      assert.deepEqual(winner.snapshot().items, won);
      winner.undo.undo();
      winner.validate();
      assert.equal(winner.snapshot().items[0].color, "#f6e7a4");
      assert.deepEqual(winner.snapshot().items[1].cells, [["A", "B"]]);
      // A collaborator's later change stays when the other undoes.
      const loser = winner === a ? b : a;
      exchange();
      winner.undo.redo();
      exchange();
      const later = loser.snapshot();
      later.items[0].color = "#f5d7c9";
      loser.commit(later);
      exchange();
      winner.undo.undo();
      exchange();
      assert.equal(winner.snapshot().items[0].color, "#f5d7c9");
      assert.equal(winner.snapshot().items[0].x, 0);
    } finally {
      a.destroy();
      b.destroy();
    }
  }
});

test("redoing an addition a collaborator edited meanwhile brings the object back whole", () => {
  const seed = new SharedDocument();
  seed.commit(board("Redo add"));
  const a = new SharedDocument(seed.update()),
    b = new SharedDocument(seed.update());
  seed.destroy();
  const exchange = () => {
    a.apply(b.update(a.vector()));
    b.apply(a.update(b.vector()));
  };
  try {
    const added = a.snapshot(),
      note = item("note", 0, 0, { text: "Idea" });
    added.items.push(note);
    a.commit(added);
    exchange();
    // A undoes adding the note while B moves it.
    a.undo.undo();
    const moved = b.snapshot();
    moved.items[0].x = 200;
    b.commit(moved);
    exchange();
    a.undo.redo();
    exchange();
    for (const doc of [a, b]) {
      doc.validate();
      const back = doc.snapshot().items[0];
      assert.equal(back.id, note.id);
      assert.equal(back.x, 0);
      assert.equal(back.w, note.w);
      assert.equal(back.text, "Idea");
    }
    assert.deepEqual(a.snapshot(), b.snapshot());
  } finally {
    a.destroy();
    b.destroy();
  }
});

test("repairs made outside undo history are saved like edits", async () => {
  const env = environment(),
    b = await room(env);
  const a = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: owner,
    store: memoryStore(),
    changed() {},
    activity() {},
    status() {},
  });
  try {
    await a.start();
    a.shared.doc.transact(() => a.shared.meta.set("title", "Repaired"), REPAIR);
    assert.equal(a.shared.undo.undoStack.length, 0);
    await a.queue;
    await a.flush();
    const { doc } = await env.service.load(b.id);
    assert.equal(doc.snapshot().title, "Repaired");
    doc.destroy();
  } finally {
    a.close();
  }
});

test("a slow reply does not put the shared clock out of step with the server", async () => {
  const env = environment(),
    b = await room(env);
  env.service.now = () => Date.now();
  const puter = env.sdk(owner),
    exec = puter.workers.exec;
  let slow = false;
  puter.workers.exec = async (url, options) => {
    const response = await exec(url, options);
    // The server read its clock, then the reply took long to arrive, as
    // when a large board is sent back.
    if (slow) await new Promise((r) => setTimeout(r, 1500));
    return response;
  };
  const session = new CollaborationSession({
    puter,
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: owner,
    store: memoryStore(),
    changed() {},
    activity() {},
    status() {},
  });
  try {
    await session.start();
    assert.ok(Math.abs(session.now() - Date.now()) < 300);
    slow = true;
    await session.synchronize();
    slow = false;
    assert.ok(
      Math.abs(session.now() - Date.now()) < 300,
      `${session.now() - Date.now()} ms`,
    );
  } finally {
    session.close();
  }
});

test("joining tells participants only whether the board is archived, and managers its settings", async () => {
  const env = environment(),
    b = await room(env);
  const { token } = await env.service.call(owner, {
    op: "invite",
    room: b.id,
    role: "viewer",
  });
  const joined = await env.service.call(viewer, {
    op: "join",
    room: b.id,
    token,
  });
  assert.deepEqual(joined.settings, { archived: false });
  const managed = await env.service.call(owner, { op: "join", room: b.id });
  assert.equal(managed.settings.visibility, "private");
  assert.equal(managed.settings.legalHold, false);
});

test("reorders made at once by two people both take effect", () => {
  const initial = board("Layers");
  initial.items = ["a", "b", "c", "d", "e"].map((id) =>
    item("rect", 0, 0, { id }),
  );
  const pair = () => {
    const seed = new SharedDocument();
    seed.commit(initial);
    const docs = [
      new SharedDocument(seed.update()),
      new SharedDocument(seed.update()),
    ];
    seed.destroy();
    return docs;
  };
  const exchange = (a, b) => {
    a.apply(b.update(a.vector()));
    b.apply(a.update(b.vector()));
  };
  const order = (doc) =>
    doc
      .snapshot()
      .items.map((i) => i.id)
      .join("");
  let [a, b] = pair();
  // One brings a to the front while the other sends e to the back.
  let next = a.snapshot();
  next.items.push(next.items.shift());
  a.commit(next);
  next = b.snapshot();
  next.items.unshift(next.items.pop());
  b.commit(next);
  exchange(a, b);
  assert.equal(order(a), "ebcda");
  assert.equal(order(b), "ebcda");
  a.destroy();
  b.destroy();
  // A reorder leaves an object someone else added where they put it.
  [a, b] = pair();
  next = a.snapshot();
  next.items.push(next.items.shift());
  a.commit(next);
  next = b.snapshot();
  next.items.splice(3, 0, item("note", 0, 0, { id: "N" }));
  b.commit(next);
  exchange(a, b);
  assert.equal(order(a), "bcNdea");
  assert.equal(order(b), "bcNdea");
  a.destroy();
  b.destroy();
  // Moving objects into the same gap again and again stays in order.
  [a] = pair();
  for (let n = 0; n < 80; n++) {
    next = a.snapshot();
    const moved = next.items.splice(n % 2 ? 4 : 0, 1)[0];
    next.items.splice(2, 0, moved);
    a.commit(next);
    assert.deepEqual(
      a.snapshot().items.map((i) => i.id),
      next.items.map((i) => i.id),
    );
  }
  a.destroy();
});

test("formatting changed while someone types keeps to the same words", () => {
  const initial = board("Formatting"),
    note = item("note", 0, 0, {
      text: "Hello world",
      textRuns: [{ start: 0, end: 5, style: { bold: true, italic: true } }],
    });
  initial.items = [note];
  const mine = new SharedDocument();
  mine.commit(initial);
  const theirs = new SharedDocument(mine.update());
  try {
    const before = mine.snapshot();
    // Bold is removed from the note here...
    const local = structuredClone(before);
    local.items[0].textRuns = [{ start: 0, end: 5, style: { italic: true } }];
    // ...while someone types at its start.
    theirs.text(note.id, "Big Hello world");
    mine.apply(theirs.update(mine.vector()));
    const next = rebase(local, before, mine.snapshot());
    assert.equal(next.items[0].text, "Big Hello world");
    assert.deepEqual(next.items[0].textRuns, [
      { start: 4, end: 9, style: { italic: true } },
    ]);
    mine.commit(next);
    theirs.apply(mine.update(theirs.vector()));
    assert.deepEqual(
      theirs.snapshot().items[0].textRuns,
      next.items[0].textRuns,
    );
  } finally {
    mine.destroy();
    theirs.destroy();
  }
});

test("the shared clock catches up after the device sleeps", async () => {
  const env = environment(),
    b = await room(env);
  let slept = 0;
  env.service.now = () => Date.now() + slept;
  const puter = env.sdk(owner),
    exec = puter.workers.exec;
  // The reply after waking is no quicker than the first ones.
  puter.workers.exec = async (url, options) => {
    const response = await exec(url, options);
    if (slept) await new Promise((r) => setTimeout(r, 300));
    return response;
  };
  const session = new CollaborationSession({
    puter,
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: owner,
    store: memoryStore(),
    changed() {},
    activity() {},
    status() {},
  });
  try {
    await session.start();
    // A minute of sleep that the page's monotonic clock did not count.
    slept = 60_000;
    await session.synchronize();
    assert.ok(
      Math.abs(session.now() - (Date.now() + slept)) < 1000,
      `${session.now() - (Date.now() + slept)} ms`,
    );
  } finally {
    session.close();
  }
});

test("undoing a deletion a collaborator reordered or moved meanwhile keeps its rank and table sizes", async () => {
  const { resizeTableTracks } = await import("../src/table-layout.js");
  const { reorderItems } = await import("../src/scene.js");
  const pull = (x, y) => x.apply(y.update(x.vector()));
  const sync = (a, b) => {
    pull(a, b);
    pull(b, a);
  };
  const valid = (a, b) => {
    a.validate();
    const worker = new SharedDocument(b.update());
    pull(worker, a);
    worker.validate();
    worker.destroy();
  };
  const pair = (items) => {
    const base = new SharedDocument();
    base.commit({ ...board("Same moment"), items });
    const a = new SharedDocument(base.update()),
      b = new SharedDocument(base.update());
    base.destroy();
    return [a, b];
  };
  // Undoing a deletion brought to front meanwhile keeps a layer rank.
  let [a, b] = pair(
    ["n1", "n2", "n3"].map((id, n) => item("note", n * 50, 0, { id })),
  );
  let s = a.snapshot();
  s.items = s.items.filter((i) => i.id !== "n1");
  a.commit(s);
  s = b.snapshot();
  s.items = reorderItems(s.items, new Set(["n1"]), "front");
  b.commit(s);
  sync(a, b);
  a.undo.undo();
  assert.ok(Number.isFinite(a.items.get("n1").get("z")));
  valid(a, b);
  a.destroy();
  b.destroy();
  // Undoing the deletion of a resized table moved meanwhile.
  [a, b] = pair([]);
  s = a.snapshot();
  s.items = [
    item("table", 0, 0, {
      id: "t1",
      w: 360,
      h: 120,
      cells: [
        ["a", "b", "c"],
        ["", "", ""],
      ],
    }),
  ];
  a.commit(s);
  s = a.snapshot();
  Object.assign(s.items[0], resizeTableTracks(s.items[0], "column", [1], 163));
  a.commit(s);
  pull(b, a);
  s = a.snapshot();
  s.items = [];
  a.commit(s);
  s = b.snapshot();
  s.items[0].x += 50;
  b.commit(s);
  sync(a, b);
  a.undo.undo();
  assert.equal(a.snapshot().items[0].cells[0][0], "a");
  valid(a, b);
  a.destroy();
  b.destroy();
});

test("undo and redo around a collaborator's change at the same moment leave every object whole", async () => {
  const { resizeTableTracks } = await import("../src/table-layout.js");
  const { reorderItems } = await import("../src/scene.js");
  const pull = (x, y) => x.apply(y.update(x.vector()));
  const sync = (a, b) => {
    pull(a, b);
    pull(b, a);
  };
  // What the worker would hold: both clients' edits together.
  const valid = (a, b) => {
    a.validate();
    const worker = new SharedDocument(b.update());
    pull(worker, a);
    worker.validate();
    worker.destroy();
  };
  const pair = (items, ids, extra = {}) => {
    const initial = { ...board("Same moment"), items, ...extra };
    const base = new SharedDocument();
    base.commit(initial);
    const a = new SharedDocument(base.update()),
      b = new SharedDocument(base.update());
    base.destroy();
    if (ids) [a.doc.clientID, b.doc.clientID] = ids;
    return [a, b];
  };
  for (const ids of [
    [1, 2],
    [2, 1],
  ]) {
    // Two undos over a concurrent move, the values Yjs has merged.
    let [a, b] = pair([item("note", 0, 0, { id: "n1" })], ids);
    const move = (d, dx) => {
      const s = d.snapshot();
      s.items[0].x += dx;
      d.commit(s);
    };
    move(a, 10);
    pull(b, a);
    move(a, 20);
    move(b, 5);
    sync(a, b);
    move(a, 30);
    a.undo.undo();
    a.undo.undo();
    assert.ok(a.items.get("n1").get("geometry"), `${ids}: geometry kept`);
    valid(a, b);
    a.destroy();
    b.destroy();
    // Redo after a concurrent resize while undone.
    [a, b] = pair([item("note", 0, 0, { id: "n1" })], ids);
    let s = a.snapshot();
    s.items[0].x = 100;
    a.commit(s);
    sync(a, b);
    a.undo.undo();
    s = b.snapshot();
    s.items[0].w = 300;
    b.commit(s);
    sync(a, b);
    a.undo.redo();
    assert.equal(a.snapshot().items[0].x, 100, `${ids}: redone`);
    valid(a, b);
    a.destroy();
    b.destroy();
    // Redo of a tag and title change edited meanwhile.
    [a, b] = pair([item("note", 0, 0, { id: "n1", tagIds: ["t1"] })], ids, {
      tags: [{ id: "t1", name: "Bug", color: "#c43b3b" }],
    });
    s = a.snapshot();
    s.tags[0].name = "Defect";
    s.title = "Plan v2";
    a.commit(s);
    sync(a, b);
    a.undo.undo();
    s = b.snapshot();
    s.tags[0].color = "#365dc4";
    s.title = "Plan v3";
    b.commit(s);
    sync(a, b);
    a.undo.redo();
    const snap = a.snapshot();
    assert.equal(snap.tags.length, 1, `${ids}: tag kept`);
    assert.deepEqual(snap.items[0].tagIds, ["t1"]);
    assert.notEqual(snap.title, "Untitled board");
    valid(a, b);
    a.destroy();
    b.destroy();
  }
  // Redoing a table's addition after rows were added meanwhile.
  let [a, b] = pair([]);
  let s = a.snapshot();
  s.items = [
    item("table", 0, 0, {
      id: "t1",
      w: 240,
      h: 80,
      cells: [
        ["a", "b"],
        ["c", "d"],
      ],
    }),
  ];
  a.commit(s);
  pull(b, a);
  s = b.snapshot();
  s.items[0].cells.push(["", ""]);
  s.items[0].h = 120;
  b.commit(s);
  pull(a, b);
  s = b.snapshot();
  s.items[0].cells.push(["e", "f"]);
  s.items[0].h = 160;
  b.commit(s);
  a.undo.undo();
  sync(a, b);
  a.undo.redo();
  assert.ok(a.snapshot().items[0].cells.length >= 2);
  valid(a, b);
  a.destroy();
  b.destroy();
});

test("an undo tried on a copy that keeps deleted content matches the real undo", () => {
  const shared = new SharedDocument();
  shared.commit({
    ...board("Copy"),
    items: [item("note", 100, 100, { id: "n1", text: "mine" })],
  });
  shared.undo.clear();
  const moved = shared.snapshot();
  moved.items[0].x += 250;
  shared.commit(moved);
  const trial = new SharedDocument(shared.update(), { gc: false });
  try {
    trial.undo.undoStack.push(shared.undo.undoStack.at(-1));
    trial.undo.undo();
    shared.undo.undo();
    assert.deepEqual(trial.snapshot().items, shared.snapshot().items);
    assert.equal(trial.snapshot().items[0].x, 100);
  } finally {
    trial.destroy();
    shared.destroy();
  }
});
