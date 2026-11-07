import test from "node:test";
import assert from "node:assert/strict";
import { board, item } from "../src/model.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { CollaborationSession } from "../src/collaboration/session.js";
import { encode, decode, hash } from "../src/collaboration/protocol.js";
import {
  environment,
  memoryStore,
  owner,
  editor,
  viewer,
} from "./collaboration-helpers.js";
import { commentThread } from "../src/comments.js";
import { createPeerHub } from "./peer-hub.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const phase of [
  "join",
  "storage",
  "peer",
  "subscribe",
  "sync",
  "presence",
  "flush",
])
  test(`leaving during collaboration startup (${phase}) releases resources and presence`, async () => {
    const env = environment(),
      initial = board("Cancelled connection");
    initial.items = [item("note", 0, 0)];
    const seed = new SharedDocument();
    seed.commit(initial);
    await env.service.call(owner, {
      op: "create",
      room: initial.id,
      update: encode(seed.update()),
    });
    const puter = env.sdk(owner),
      store = memoryStore();
    // The startup flush uploads an edit queued while offline.
    if (phase === "flush") {
      const offline = new SharedDocument(seed.update()),
        vector = offline.vector(),
        next = offline.snapshot();
      next.items[0].text = "Offline";
      offline.commit(next);
      const update = offline.update(vector),
        digest = await hash(update);
      offline.destroy();
      const scope = `https://whiteboard-test.puter.work|${initial.id}|${owner.uuid}`;
      await store.collaborationPut({
        id: `${scope}|op:${digest}`,
        scope,
        kind: "update",
        digest,
        update: encode(update),
        seq: 1,
      });
    }
    seed.destroy();
    const reached = deferred(),
      release = deferred();
    const pause = async (step) => {
      if (step !== phase) return;
      reached.resolve();
      await release.promise;
    };
    const exec = puter.workers.exec;
    puter.workers.exec = async (url, options) => {
      const { op } = JSON.parse(options.body);
      await pause(op === "commit" ? "flush" : op);
      return exec(url, options);
    };
    const read = store.collaborationRows;
    store.collaborationRows = async (...args) => {
      await pause("storage");
      return read(...args);
    };
    let peers = 0,
      subscriptions = 0;
    puter.peer = {
      serve: async () => {
        await pause("peer");
        peers++;
        let closed = false;
        return {
          inviteCode: "TEST-PEER",
          addEventListener() {},
          close() {
            if (!closed) peers--;
            closed = true;
          },
        };
      },
    };
    puter.events.onLocal = async () => {
      await pause("subscribe");
      subscriptions++;
      let closed = false;
      return {
        off() {
          if (!closed) subscriptions--;
          closed = true;
        },
      };
    };
    let changes = 0;
    const session = new CollaborationSession({
      puter,
      store,
      room: initial.id,
      server: "https://whiteboard-test.puter.work",
      user: owner,
      changed() {
        changes++;
      },
      activity() {},
      status() {},
    });
    const leaves = [];
    const request = session.request.bind(session);
    session.request = (op, data) => {
      const pending = request(op, data);
      if (op === "leave") leaves.push(pending);
      return pending;
    };
    const starting = session.start();
    try {
      await reached.promise;
      session.close();
      const priorChanges = changes;
      release.resolve();
      await starting;
      await Promise.all(leaves);
      assert.equal(
        session.connected,
        false,
        "A closed session cannot become connected",
      );
      assert.equal(peers, 0, "No peer server survives cancellation");
      assert.equal(
        subscriptions,
        0,
        "No event subscription survives cancellation",
      );
      assert.equal(
        changes,
        priorChanges,
        "No stale board is published after leaving",
      );
      assert.ok(!session.poll || session.poll._destroyed, "Polling stops");
      assert.ok(
        !session.expire || session.expire._destroyed,
        "Activity timers stop",
      );
      assert.equal(
        env.data.has(`wb:${initial.id}:presence:${session.session}`),
        false,
        "A delayed heartbeat cannot leave a ghost participant",
      );
    } finally {
      release.resolve();
      await starting.catch(() => {});
      session.close();
      // Also clean up leaked resources when checking the pre-fix implementation.
      clearInterval(session.poll);
      clearInterval(session.expire);
      session.peers?.close();
      session.subscription?.off();
    }
  });

test("a failed check-in is tried again before presence can expire", async (t) => {
  const env = environment(),
    initial = board("Workshop");
  initial.items = [item("note", 0, 0)];
  const seed = new SharedDocument();
  seed.commit(initial);
  await env.service.call(owner, {
    op: "create",
    room: initial.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const session = new CollaborationSession({
    puter: env.sdk(owner),
    store: memoryStore(),
    room: initial.id,
    server: "https://whiteboard-test.puter.work",
    user: owner,
    changed() {},
    activity() {},
    status() {},
  });
  t.mock.timers.enable({
    apis: ["setTimeout", "setInterval", "Date"],
    now: Date.now(),
  });
  try {
    await session.start();
    // A large room checks in every 40 to 45 seconds.
    session.roster = Array.from({ length: 40 }, (_, n) => ({ user: `u${n}` }));
    const calls = [];
    let failWith = null;
    session.heartbeat = async () => {
      calls.push(failWith?.status ?? "ok");
      if (failWith) throw Object.assign(Error("Busy"), failWith);
    };
    session.synchronize = async () => {};
    session.flush = async () => {};
    const tick = async (ms) => {
      t.mock.timers.tick(ms);
      for (let n = 0; n < 5; n++) await Promise.resolve();
    };
    // Events from joining, and the check-in they lead to, settle first.
    await tick(6000);
    calls.length = 0;
    failWith = { status: 503 };
    await tick(19_000);
    assert.deepEqual(calls, [503], "The regular check-in failed");
    failWith = null;
    await tick(12_000);
    assert.deepEqual(calls, [503, "ok"], "It was tried again within 12 s");
    await tick(12_000);
    assert.deepEqual(calls, [503, "ok"], "Success ends the retries");
    // Refused access is not retried.
    failWith = { status: 403 };
    await tick(46_000);
    assert.equal(calls.at(-1), 403);
    assert.ok(!session.checkInTimer, "No retry is scheduled");
  } finally {
    session.close();
    t.mock.timers.reset();
  }
});

test("offline edits larger than one commit are sent in several and all saved", async () => {
  const env = environment();
  const b = board("Offline");
  b.items = Array.from({ length: 5 }, (_, n) =>
    item("note", n * 300, 0, { text: "x" }),
  );
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
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
  const text = (n, seed) =>
    Array.from({ length: n }, (_, k) =>
      ((k * 7919 + seed) % 36).toString(36),
    ).join("");
  try {
    await session.start();
    env.offline = true;
    for (let n = 0; n < 90; n++) {
      const before = session.shared.snapshot(),
        next = structuredClone(before);
      next.items.forEach((i, k) => (i.text = text(20000, n * 5 + k)));
      await session.commit(next, before);
    }
    await session.queue;
    env.offline = false;
    // A flush already under way (from the session's own timer) returns at
    // once, so keep flushing until everything is saved.
    const deadline = Date.now() + 60_000;
    while (session.pending.size && Date.now() < deadline) {
      await session.flush();
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(session.pending.size, 0, "Every edit was saved");
    const { doc } = await env.service.load(b.id);
    assert.equal(doc.snapshot().items[0].text, text(20000, 89 * 5));
  } finally {
    session.close();
  }
});

test("archiving makes open sessions read-only, and peers return after access does", async () => {
  const env = environment(),
    hub = createPeerHub();
  const b = board("Archive");
  b.items = [item("note", 0, 0, { text: "Hi" })];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const { token } = await env.service.call(owner, {
    op: "invite",
    room: b.id,
    role: "editor",
  });
  await env.service.call(editor, { op: "join", room: b.id, token });
  const session = new CollaborationSession({
    puter: { ...env.sdk(editor), peer: hub.peer },
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: editor,
    store: memoryStore(),
    changed() {},
    activity() {},
    status() {},
  });
  const settle = async () => {
    while (session.beating) await new Promise((r) => setTimeout(r, 5));
  };
  try {
    await session.start();
    assert.equal(session.readOnly, false);
    await env.service.call(owner, { op: "archive", room: b.id });
    await session.synchronize();
    assert.equal(session.contentReadOnly, true, "Sync reports the archive");
    await settle();
    await session.heartbeat();
    assert.equal(session.readOnly, true, "Check-ins keep it read-only");
    // A refused request closes peer links; they return with access.
    session.failure(Object.assign(Error("Refused"), { status: 403 }));
    assert.equal(session.peers, null);
    await env.service.call(owner, { op: "unarchive", room: b.id });
    await settle();
    await session.heartbeat();
    assert.equal(session.readOnly, false);
    assert.equal(session.contentReadOnly, false);
    const until = Date.now() + 2000;
    while (!session.peers?.server?.inviteCode && Date.now() < until)
      await new Promise((r) => setTimeout(r, 10));
    assert.ok(session.peers?.server?.inviteCode, "Peer links are rebuilt");
  } finally {
    session.close();
  }
});

test("a role change keeps a member's live board events", async () => {
  const env = environment();
  const b = board("Roles");
  b.items = [item("note", 0, 0, { text: "Hi" })];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const { token } = await env.service.call(owner, {
    op: "invite",
    room: b.id,
    role: "editor",
  });
  await env.service.call(editor, { op: "join", room: b.id, token });
  let state;
  const session = new CollaborationSession({
    puter: env.sdk(editor),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: editor,
    store: memoryStore(),
    changed: (x) => (state = x),
    activity() {},
    status() {},
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ownerEdit = async (text) => {
    const { doc } = await env.service.load(b.id);
    const vector = doc.vector(),
      next = doc.snapshot();
    next.items[0].text = text;
    doc.commit(next);
    const update = doc.update(vector);
    doc.destroy();
    env.now += 2000;
    await env.service.call(owner, {
      op: "commit",
      room: b.id,
      id: await hash(update),
      update: encode(update),
    });
  };
  const until = async (check, label) => {
    const deadline = Date.now() + 3000;
    while (!check() && Date.now() < deadline) await wait(20);
    assert.ok(check(), label);
  };
  try {
    await session.start();
    await ownerEdit("one");
    await until(() => state?.items[0].text === "one", "Live before");
    await env.service.call(owner, {
      op: "role",
      room: b.id,
      uuid: editor.uuid,
      role: "commenter",
    });
    while (session.beating) await wait(5);
    await session.heartbeat();
    assert.equal(session.role, "commenter");
    await ownerEdit("two");
    await until(
      () => state?.items[0].text === "two",
      "Edits still arrive live after the role change",
    );
  } finally {
    session.close();
  }
});

test("a burst of edits does not make every participant check in each time", async () => {
  const env = environment();
  const b = board("Burst");
  b.items = [item("note", 0, 0, { text: "Hi" })];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const { token } = await env.service.call(owner, {
    op: "invite",
    room: b.id,
    role: "editor",
  });
  await env.service.call(editor, { op: "join", room: b.id, token });
  let state;
  const session = new CollaborationSession({
    puter: env.sdk(editor),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: editor,
    store: memoryStore(),
    changed: (x) => (state = x),
    activity() {},
    status() {},
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await session.start();
    await wait(300);
    const beats = [];
    const heartbeat = session.heartbeat.bind(session);
    session.heartbeat = () => (beats.push(Date.now()), heartbeat());
    for (let n = 0; n < 10; n++) {
      const { doc } = await env.service.load(b.id);
      const vector = doc.vector(),
        next = doc.snapshot();
      next.items[0].text = `n${n}`;
      doc.commit(next);
      const update = doc.update(vector);
      doc.destroy();
      env.now += 2000;
      await env.service.call(owner, {
        op: "commit",
        room: b.id,
        id: await hash(update),
        update: encode(update),
      });
      await wait(250);
    }
    await wait(300);
    assert.equal(state.items[0].text, "n9", "Every edit still arrives live");
    assert.ok(beats.length <= 2, `${beats.length} check-ins`);
  } finally {
    session.close();
  }
});

test("a commenter's comment is saved even when their device measured text differently", async () => {
  const env = environment();
  const b = board("Comments");
  b.items = [item("text", 0, 0, { text: "Hello", w: 300, h: 77 })];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const { token } = await env.service.call(owner, {
    op: "invite",
    room: b.id,
    role: "commenter",
  });
  await env.service.call(viewer, { op: "join", room: b.id, token });
  let state;
  const session = new CollaborationSession({
    puter: env.sdk(viewer),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: viewer,
    store: memoryStore(),
    changed: (x) => (state = x),
    activity() {},
    status() {},
  });
  try {
    await session.start();
    assert.equal(session.contentReadOnly, true);
    const before = structuredClone(state);
    const next = structuredClone(state);
    // This device's fonts give the text a slightly different height.
    next.items[0].h = 76;
    next.comments = [
      commentThread(
        { x: 10, y: 10 },
        { id: viewer.uuid, name: viewer.username },
        "Looks good",
      ),
    ];
    await session.commit(next, before);
    await session.flush();
    const { doc } = await env.service.load(b.id);
    const saved = doc.snapshot();
    doc.destroy();
    assert.equal(saved.comments?.[0]?.messages[0].text, "Looks good");
    assert.equal(saved.items[0].h, 77);
  } finally {
    session.close();
  }
});

test("an open session whose board is deleted becomes read-only and says so, and edits again once it is restored", async () => {
  const env = environment();
  const b = board("Deleted");
  b.items = [item("note", 0, 0, { text: "Hi" })];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const { token } = await env.service.call(owner, {
    op: "invite",
    room: b.id,
    role: "editor",
  });
  await env.service.call(editor, { op: "join", room: b.id, token });
  const statuses = [];
  const session = new CollaborationSession({
    puter: env.sdk(editor),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: editor,
    store: memoryStore(),
    changed() {},
    activity() {},
    status: (s) => statuses.push(s),
  });
  try {
    await session.start();
    await env.service.call(owner, { op: "delete", room: b.id });
    await session.synchronize().catch((e) => session.failure(e));
    assert.equal(session.readOnly, true);
    assert.equal(session.contentReadOnly, true);
    assert.equal(statuses.at(-1), "Board unavailable · local changes retained");
    await env.service.call(owner, { op: "restore", room: b.id });
    await session.synchronize();
    assert.equal(session.readOnly, false);
  } finally {
    session.close();
  }
});

test("an upload keeps the shared state on this device once", async () => {
  const env = environment();
  const b = board("Cache");
  b.items = [item("note", 0, 0, { text: "Hi" })];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const store = memoryStore();
  let snapshots = 0;
  const put = store.collaborationPut;
  store.collaborationPut = async (row) => {
    if (row.kind === "snapshot") snapshots++;
    return put(row);
  };
  const session = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: owner,
    store,
    changed() {},
    activity() {},
    status() {},
  });
  try {
    await session.start();
    const before = snapshots,
      next = session.shared.snapshot(b.id);
    next.items[0].text = "Hello";
    await session.commit(next, session.shared.snapshot(b.id));
    await session.flush();
    assert.equal(session.pending.size, 0);
    assert.equal(snapshots - before, 1);
    // What reloading this device would show includes the edit.
    const row = [...store.rows.values()].find((r) => r.kind === "snapshot");
    const cached = new SharedDocument(decode(row.update));
    assert.equal(cached.snapshot().items[0].text, "Hello");
    cached.destroy();
  } finally {
    session.close();
  }
});
