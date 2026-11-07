import test from "node:test";
import * as Y from "yjs";
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

for (const status of [429, 503, 403])
  test(`a first check-in that fails with ${status} ${status === 403 ? "ends" : "keeps"} the synchronized session`, async () => {
    const env = environment(),
      initial = board("Busy room");
    initial.items = [item("note", 0, 0)];
    const seed = new SharedDocument();
    seed.commit(initial);
    await env.service.call(owner, {
      op: "create",
      room: initial.id,
      update: encode(seed.update()),
    });
    seed.destroy();
    const puter = env.sdk(owner),
      exec = puter.workers.exec;
    let fail = true;
    puter.workers.exec = async (url, options) => {
      if (JSON.parse(options.body).op === "presence" && fail) {
        fail = false;
        return Response.json({ message: "Busy" }, { status });
      }
      return exec(url, options);
    };
    let ready = false;
    const session = new CollaborationSession({
      puter,
      store: memoryStore(),
      room: initial.id,
      server: "https://whiteboard-test.puter.work",
      user: owner,
      changed() {},
      activity() {},
      status() {},
      ready: () => (ready = true),
    });
    try {
      if (status === 403) {
        // Refused access still ends the session, as before.
        await assert.rejects(session.start(), { status: 403 });
        assert.ok(session.closed);
        return;
      }
      await session.start();
      assert.ok(ready && !session.closed && session.connected);
      // The check-in is tried again soon rather than the whole join.
      assert.ok(session.checkInTimer, "A retry is scheduled");
    } finally {
      session.close();
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

test("offline edits too large to send in time over a slow connection go up in smaller batches", async () => {
  const env = environment();
  const b = board("Slow connection");
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
  const puter = env.sdk(owner);
  // Requests carrying more than about 1 MB never complete in time.
  const exec = puter.workers.exec;
  puter.workers.exec = (url, options) =>
    (options.body?.length || 0) > 1_000_000
      ? Promise.reject(
          new DOMException("The operation was aborted.", "AbortError"),
        )
      : exec(url, options);
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
  const text = (n, seed) =>
    Array.from({ length: n }, (_, k) =>
      ((k * 7919 + seed) % 36).toString(36),
    ).join("");
  try {
    await session.start();
    env.offline = true;
    for (let n = 0; n < 20; n++) {
      const before = session.shared.snapshot(),
        next = structuredClone(before);
      next.items.forEach((i, k) => (i.text = text(20000, n * 5 + k)));
      await session.commit(next, before);
    }
    await session.queue;
    env.offline = false;
    const deadline = Date.now() + 60_000;
    while (session.pending.size && Date.now() < deadline) {
      await session.flush().catch(() => {});
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(session.pending.size, 0, "Every edit was saved");
    const { doc } = await env.service.load(b.id);
    assert.equal(doc.snapshot().items[0].text, text(20000, 19 * 5));
    doc.destroy();
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

test("a member left without peer links catches up on edits, and again when one returns", async () => {
  const env = environment(),
    hub = createPeerHub();
  const b = board("Stranded");
  b.items = [item("note", 0, 0)];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const session = new CollaborationSession({
    puter: { ...env.sdk(owner), peer: hub.peer },
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
    while (session.beating) await new Promise((r) => setTimeout(r, 5));
    const order = [];
    const { heartbeat, synchronize } = session;
    session.heartbeat = async () => {
      order.push("check-in");
      return heartbeat.call(session);
    };
    session.synchronize = async () => {
      order.push("sync");
      return synchronize.call(session);
    };
    // Its relays are gone: it checks in, for board events, then catches up.
    await session.peers.changed(true);
    assert.deepEqual(order, ["check-in", "sync"]);
    // A link that returns may have missed edits too.
    await session.peers.relinked();
    assert.deepEqual(order, ["check-in", "sync", "sync"]);
    // Other changes, such as a new invite code, only check in.
    await session.peers.changed();
    assert.deepEqual(order, ["check-in", "sync", "sync", "check-in"]);
  } finally {
    session.close();
  }
});

test("a member left without peer links catches up on edits, and again when one returns", async () => {
  const env = environment(),
    hub = createPeerHub();
  const b = board("Stranded");
  b.items = [item("note", 0, 0)];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const session = new CollaborationSession({
    puter: { ...env.sdk(owner), peer: hub.peer },
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
    while (session.beating) await new Promise((r) => setTimeout(r, 5));
    const order = [];
    const { heartbeat, synchronize } = session;
    session.heartbeat = async () => {
      order.push("check-in");
      return heartbeat.call(session);
    };
    session.synchronize = async () => {
      order.push("sync");
      return synchronize.call(session);
    };
    // Its relays are gone: it checks in, for board events, then catches up.
    await session.peers.changed(true);
    assert.deepEqual(order, ["check-in", "sync"]);
    // A link that returns may have missed edits too.
    await session.peers.relinked();
    assert.deepEqual(order, ["check-in", "sync", "sync"]);
    // Other changes, such as a new invite code, only check in.
    await session.peers.changed();
    assert.deepEqual(order, ["check-in", "sync", "sync", "check-in"]);
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

test("switching tabs checks in only when the last check-in is old, and hiding sends waiting edits", async () => {
  const env = environment();
  const b = board("Tabs");
  b.items = [item("note", 0, 0, { text: "Hi" })];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const page = new EventTarget();
  page.visibilityState = "visible";
  const previous = globalThis.document;
  globalThis.document = page;
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
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const count = (op) => env.calls.filter((c) => c.op === op).length;
  const toggle = (state) => {
    page.visibilityState = state;
    page.dispatchEvent(new Event("visibilitychange"));
  };
  try {
    await session.start();
    await wait(300);
    const presence = count("presence"),
      syncs = count("sync");
    for (let n = 0; n < 10; n++) {
      toggle(n % 2 ? "visible" : "hidden");
      await wait(20);
    }
    await wait(100);
    assert.equal(count("presence"), presence, "No extra check-ins");
    assert.equal(count("sync"), syncs, "No extra synchronizations");
    // Edits still waiting go as the tab is hidden.
    let flushes = 0;
    const flush = session.flush.bind(session);
    session.flush = () => (flushes++, flush());
    toggle("hidden");
    assert.equal(flushes, 1);
    // Back after a while, the board catches up at once.
    session.lastBeat = Date.now() - 11000;
    toggle("visible");
    await wait(200);
    assert.equal(count("presence"), presence + 1);
    assert.equal(count("sync"), syncs + 1);
  } finally {
    session.close();
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
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

test("a board's owner who is not an administrator can bring it back from the trash", async () => {
  const env = environment();
  const b = board("Mine");
  b.items = [item("note", 0, 0, { text: "Hi" })];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  for (const member of [editor, viewer]) {
    const { token } = await env.service.call(owner, {
      op: "invite",
      room: b.id,
      role: "editor",
    });
    await env.service.call(member, { op: "join", room: b.id, token });
  }
  await env.service.call(owner, {
    op: "transfer",
    room: b.id,
    uuid: editor.uuid,
  });
  await env.service.call(editor, { op: "delete", room: b.id });
  await assert.rejects(env.service.call(editor, { op: "sync", room: b.id }), {
    status: 404,
  });
  // Another member cannot, even by asking to restore it.
  await assert.rejects(
    env.service.call(viewer, { op: "restore", room: b.id }),
    { status: 404 },
  );
  await env.service.call(editor, { op: "restore", room: b.id });
  const synced = await env.service.call(editor, { op: "sync", room: b.id });
  assert.ok(synced.update, "The restored board is read again");
});

test("edits the worker keeps refusing as out of order are made again on its state instead of waiting forever or being lost", async () => {
  const env = environment();
  const b = board("Conflicts");
  b.items = [item("note", 0, 0, { text: "Hi" })];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const statuses = [];
  const session = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: owner,
    store: memoryStore(),
    changed() {},
    activity() {},
    status: (s) => statuses.push(s),
  });
  const call = env.service.call.bind(env.service);
  let commits = 0;
  env.service.call = async (user, input) => {
    if (input.op === "commit") {
      commits++;
      throw Object.assign(
        Error("This change depends on edits that have not arrived yet."),
        { status: 409 },
      );
    }
    return call(user, input);
  };
  try {
    await session.start();
    const before = session.shared.snapshot(),
      next = structuredClone(before);
    next.items[0].text = "Changed";
    await session.commit(next, before);
    await session.queue;
    const [first] = session.pending.keys();
    for (let n = 0; n < 7; n++) {
      await session.flush();
      assert.equal(session.pending.size, 1, `still waiting after ${n + 1}`);
      assert.equal(statuses.at(-1), "Saving shared changes…");
    }
    await session.flush();
    assert.equal(commits, 8);
    // The refused row is given up, and its change made again on the
    // worker's state rather than lost.
    await session.queue;
    assert.equal(session.pending.size, 1);
    assert.notEqual([...session.pending.keys()][0], first);
    assert.equal(session.shared.snapshot().items[0].text, "Changed");
    env.service.call = call;
    await session.flush();
    assert.equal(session.pending.size, 0);
    const { doc: saved } = await env.service.load(b.id);
    assert.equal(saved.snapshot().items[0].text, "Changed");
    saved.destroy();
    // The session follows the worker's state and saves again afterwards.
    const again = session.shared.snapshot(),
      after = structuredClone(again);
    after.items[0].text = "Later";
    await session.commit(after, again);
    await session.queue;
    await session.flush();
    assert.equal(session.pending.size, 0);
    const { doc } = await env.service.load(b.id);
    assert.equal(doc.snapshot().items[0].text, "Later");
    doc.destroy();
  } finally {
    env.service.call = call;
    session.close();
  }
});

test("an edit refused as out of order that cannot be made again on the worker's state is reported, not lost silently", async () => {
  const env = environment();
  const b = board("Conflicts");
  b.items = [item("note", 0, 0, { text: "Hi" })];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const rejections = [];
  const session = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: owner,
    store: memoryStore(),
    changed() {},
    activity() {},
    status() {},
    rejected: (r) => rejections.push(r),
  });
  const call = env.service.call.bind(env.service);
  try {
    await session.start();
    // The state a lagging instance holds: from before this device's first edit.
    const stale = (await call(owner, { op: "sync", room: b.id })).update;
    // R1, saved through another instance.
    let before = session.shared.snapshot(),
      next = structuredClone(before);
    next.items[0].text = "Hi there";
    await session.commit(next, before);
    await session.queue;
    await session.flush();
    assert.equal(session.pending.size, 0);
    // R2 builds on R1; the lagging instance keeps refusing it and syncs stale.
    env.service.call = async (user, input) => {
      if (input.op === "commit")
        throw Object.assign(
          Error("This change depends on edits that have not arrived yet."),
          { status: 409 },
        );
      if (input.op === "sync")
        return { ...(await call(user, input)), update: stale };
      return call(user, input);
    };
    before = session.shared.snapshot();
    next = structuredClone(before);
    next.items[0].text = "Hi there, world";
    await session.commit(next, before);
    await session.queue;
    for (let n = 0; n < 8; n++) await session.flush();
    await session.queue;
    env.service.call = call;
    await session.flushed();
    await session.synchronize();
    const text = session.shared.snapshot().items[0].text;
    const { doc } = await env.service.load(b.id);
    const saved = doc.snapshot().items[0].text;
    doc.destroy();
    // Either the edit is saved, or the person is told it was not.
    assert.ok(
      saved === "Hi there, world" || rejections.some((r) => !r.remade),
      "edit lost without a word",
    );
  } finally {
    env.service.call = call;
    session.close();
  }
});

test("a board holding what only a newer app writes asks for a reload instead of showing offline", async () => {
  const env = environment();
  const b = board("Newer");
  b.items = [item("note", 0, 0, { text: "Hi" })];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const statuses = [];
  const session = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: owner,
    store: memoryStore(),
    changed() {},
    activity() {},
    status: (s) => statuses.push(s),
  });
  try {
    await session.start();
    session.shared.validate = () => {
      throw Error("Unknown shared object property.");
    };
    await session.synchronize().catch((e) => session.failure(e));
    assert.equal(
      statuses.at(-1),
      "This board needs a newer version of the app · reload",
    );
    assert.equal(session.readOnly, true);
    assert.equal(session.contentReadOnly, true);
    // A check-in confirming the role does not make it editable again, so
    // this older copy cannot save over what it cannot read.
    await session.heartbeat();
    assert.equal(session.readOnly, true);
    assert.equal(session.contentReadOnly, true);
    const next = session.shared.snapshot(b.id);
    next.items[0].text = "Written by the older app";
    await session.commit(next, session.shared.snapshot(b.id));
    await session.flushed();
    const { doc } = await env.service.load(b.id);
    assert.equal(doc.snapshot().items[0].text, "Hi");
    doc.destroy();
    // Once it can read the board again, it edits again.
    delete session.shared.validate;
    await session.synchronize();
    assert.equal(session.readOnly, false);
    assert.equal(session.contentReadOnly, false);
  } finally {
    session.close();
  }
});

test("what only a newer app writes is noticed when a later synchronization brings it", async () => {
  const env = environment();
  const b = board("Later");
  b.items = [item("note", 0, 0, { text: "Hi" })];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const statuses = [];
  const session = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: owner,
    store: memoryStore(),
    changed() {},
    activity() {},
    status: (s) => statuses.push(s),
  });
  try {
    await session.start();
    await session.synchronize();
    // The worker, newer than this app, saved a property it does not know.
    const newer = new SharedDocument(session.shared.update()),
      vector = newer.vector();
    newer.doc.transact(() =>
      newer.items.get(b.items[0].id).set("sparkle", true),
    );
    const update = encode(newer.update(vector));
    newer.destroy();
    const request = session.request.bind(session);
    session.request = async (op, input) =>
      op === "sync"
        ? { ...(await request(op, input)), update }
        : request(op, input);
    await session.synchronize().catch((e) => session.failure(e));
    assert.equal(
      statuses.at(-1),
      "This board needs a newer version of the app · reload",
    );
    assert.equal(session.readOnly, true);
    // The next synchronization brings nothing new; the property is still
    // there, so the board stays read-only.
    session.request = request;
    await session.synchronize().catch((e) => session.failure(e));
    assert.equal(session.readOnly, true);
  } finally {
    session.close();
  }
});

for (const path of ["a peer", "a save's response"])
  test(`what only a newer app writes is noticed when ${path} brings it`, async () => {
    const env = environment();
    const b = board("Arrived");
    b.items = [item("note", 0, 0, { text: "Hi" })];
    const seed = new SharedDocument();
    seed.commit(b);
    await env.service.call(owner, {
      op: "create",
      room: b.id,
      update: encode(seed.update()),
    });
    seed.destroy();
    const statuses = [];
    const session = new CollaborationSession({
      puter: env.sdk(owner),
      server: "https://whiteboard-test.puter.work",
      room: b.id,
      user: owner,
      store: memoryStore(),
      changed() {},
      activity() {},
      status: (s) => statuses.push(s),
    });
    try {
      await session.start();
      await session.synchronize();
      const newer = new SharedDocument(session.shared.update()),
        vector = newer.vector();
      newer.doc.transact(() =>
        newer.items.get(b.items[0].id).set("sparkle", true),
      );
      const update = newer.update(vector);
      newer.destroy();
      if (path === "a peer")
        // As a receipted peer edit is applied.
        session.shared.apply(update);
      else {
        const request = session.request.bind(session);
        session.request = async (op, input) => {
          const result = await request(op, input);
          return op === "commit"
            ? {
                ...result,
                update: encode(Y.mergeUpdates([decode(result.update), update])),
              }
            : result;
        };
        const before = session.shared.snapshot(b.id),
          next = structuredClone(before);
        next.items[0].x = 50;
        await session.commit(next, before);
        await session.flushed();
        session.request = request;
      }
      await session.synchronize().catch((e) => session.failure(e));
      assert.equal(
        statuses.at(-1),
        "This board needs a newer version of the app · reload",
      );
      assert.equal(session.readOnly, true);
    } finally {
      session.close();
    }
  });

test("a queued edit that no longer fits the board is uploaded and settled before the board is called too new", async () => {
  const env = environment();
  const b = board("Queued");
  b.items = [item("note", 0, 0, { text: "Hi" })];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const statuses = [];
  const store = memoryStore();
  const make = () =>
    new CollaborationSession({
      puter: env.sdk(owner),
      server: "https://whiteboard-test.puter.work",
      room: b.id,
      user: owner,
      store,
      changed() {},
      activity() {},
      status: (s) => statuses.push(s),
    });
  let session = make();
  try {
    await session.start();
    env.offline = true;
    const snapshot = session.shared.snapshot(b.id);
    const before = structuredClone(snapshot);
    snapshot.items[0].text = "Queued offline";
    await session.commit(snapshot, before);
    await session.flush().catch(() => {});
    assert.equal(session.pending.size, 1);
    // The merged state fails validation only while this device's edit is
    // still queued, as when it conflicts with a concurrent remote edit.
    const validate = session.shared.validate.bind(session.shared);
    session.shared.validate = (...args) => {
      if (session.pending.size) throw Error("Invalid embed.");
      return validate(...args);
    };
    env.offline = false;
    await session.synchronize();
    assert.equal(session.pending.size, 0, "The queued edit was uploaded");
    assert.equal(session.readOnly, false);
    assert.notEqual(
      statuses.at(-1),
      "This board needs a newer version of the app · reload",
    );
    session.close();
    // Reopening on this device works, with nothing left in the outbox.
    session = make();
    await session.start();
    assert.equal(session.readOnly, false);
    assert.equal(
      (await store.collaborationRows(session.scope)).filter(
        (r) => r.kind === "update",
      ).length,
      0,
    );
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

test("a device that cannot keep its copy of the board still saves, shows others' edits, and joins", async () => {
  const env = environment();
  const b = board("Full device");
  b.items = [item("note", 0, 0, { text: "Hi" })];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  // The device's storage refuses the copy of the board, as when it is full.
  const store = memoryStore(),
    put = store.collaborationPut;
  store.collaborationPut = async (row) => {
    if (row.kind === "snapshot")
      throw Object.assign(Error("The quota has been exceeded."), {
        name: "QuotaExceededError",
      });
    return put(row);
  };
  const open = (user, rows = store) => {
    const statuses = [];
    const session = new CollaborationSession({
      puter: env.sdk(user),
      server: "https://whiteboard-test.puter.work",
      room: b.id,
      user,
      store: rows,
      changed() {},
      activity() {},
      status(s) {
        statuses.push(s);
      },
    });
    return { session, statuses };
  };
  const first = open(owner),
    other = open(editor, memoryStore());
  await env.service
    .call(owner, {
      op: "invite",
      room: b.id,
      role: "editor",
    })
    .then(({ token }) =>
      env.service.call(editor, { op: "join", room: b.id, token }),
    );
  let again;
  try {
    await first.session.start();
    await other.session.start();
    for (const text of ["One", "Two", "Three"]) {
      const before = first.session.shared.snapshot(b.id),
        next = structuredClone(before);
      next.items[0].text = text;
      await first.session.commit(next, before);
      await first.session.flushed();
    }
    assert.equal(first.session.pending.size, 0);
    assert.match(first.statuses.at(-1), /^Saved/);
    const { doc } = await env.service.load(b.id);
    assert.equal(doc.snapshot().items[0].text, "Three");
    doc.destroy();
    // Another person's edit is shown.
    const before = other.session.shared.snapshot(b.id),
      next = structuredClone(before);
    next.items[0].text = "From Bob";
    await other.session.synchronize();
    await other.session.commit(next, other.session.shared.snapshot(b.id));
    await other.session.flushed();
    await first.session.synchronize();
    assert.equal(first.session.shared.snapshot(b.id).items[0].text, "From Bob");
    assert.match(first.statuses.at(-1), /^Saved/);
    first.session.close();
    // Reloading keeps the edits the missing copy could not hold, sends
    // them again as nothing new, and joins.
    assert.ok([...store.rows.values()].some((r) => r.kind === "update"));
    again = open(owner);
    await again.session.start();
    await again.session.flushed();
    assert.equal(again.session.pending.size, 0);
    assert.equal(again.session.shared.snapshot(b.id).items[0].text, "From Bob");
    assert.match(again.statuses.at(-1), /^Saved/);
  } finally {
    first.session.close();
    other.session.close();
    again?.session.close();
  }
});

test("a session continuing under a new ID publishes its new peer invite at once", async () => {
  const env = environment(),
    hub = createPeerHub();
  const b = board("Invite");
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  for (const [user, role] of [
    [editor, "editor"],
    [viewer, "viewer"],
  ]) {
    const { token } = await env.service.call(owner, {
      op: "invite",
      room: b.id,
      role,
    });
    await env.service.call(user, { op: "join", room: b.id, token });
  }
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
    const published = () =>
      env.data.get(`wb:${b.id}:presence:${session.session}`)?.invite;
    for (let n = 0; n < 100 && !(session.peers?.server && published()); n++)
      await new Promise((r) => setTimeout(r, 5));
    assert.ok(session.peers.server.inviteCode);
    assert.equal(published(), session.peers.server.inviteCode);
  } finally {
    session.close();
  }
});

test("an editor demoted to viewer while edits wait is told they stay on this device", async () => {
  const env = environment();
  const b = board("Demote");
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
    status: (text) => statuses.push(text),
  });
  try {
    await session.start();
    env.offline = true;
    const before = session.shared.snapshot(),
      next = structuredClone(before);
    next.items[0].text = "Edited offline";
    await session.commit(next, before);
    await session.queue;
    assert.equal(session.pending.size, 1);
    await env.service.call(owner, {
      op: "role",
      room: b.id,
      uuid: editor.uuid,
      role: "viewer",
    });
    env.offline = false;
    await session.heartbeat();
    await session.synchronize();
    await session.flush();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(session.role, "viewer");
    // The edit can no longer be sent: rather than "Saving…" for ever, the
    // status says what became of it.
    assert.equal(
      statuses.at(-1),
      "Access changed · unsent changes stay on this device",
    );
  } finally {
    session.close();
  }
});

test("edits arriving steadily on a slow board are shown in fewer redraws, and quickly on a small one", async () => {
  let cost = 0,
    shown = 0;
  const session = new CollaborationSession({
    puter: {},
    server: "https://whiteboard-test.puter.work",
    room: "slow-board",
    user: owner,
    store: memoryStore(),
    changed() {
      shown++;
      const until = performance.now() + cost;
      while (performance.now() < until);
    },
    activity() {},
    status() {},
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    // A small board shows an edit within a frame or two, as before.
    let started = performance.now();
    session.showEdit("a");
    while (!shown) await wait(1);
    assert.ok(performance.now() - started < 80);
    // On a board that takes 40 ms to show again, a second of edits
    // arriving every few milliseconds leaves the device time for the rest.
    cost = 40;
    session.showEdit("a");
    while (shown < 2) await wait(1);
    shown = 0;
    started = performance.now();
    while (performance.now() - started < 1000) {
      session.showEdit("a");
      await wait(5);
    }
    assert.ok(shown <= 7, `${shown} redraws in a second`);
    assert.ok(shown >= 3, `${shown} redraws in a second`);
  } finally {
    session.close();
  }
});

test("a resting cursor survives one lost repeat, and a crashed participant's selection still goes after 10 seconds", async (t) => {
  const env = environment(),
    initial = board("Resting");
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
    session.heartbeat = async () => {};
    session.synchronize = async () => {};
    session.flush = async () => {};
    const ticket = (id) => ({ session: id, user: id, role: "editor" });
    let seq = 1;
    await session.receive(
      "presence",
      { cursor: { x: 1, y: 2 } },
      ticket("rest"),
      seq++,
    );
    await session.receive(
      "presence",
      { cursor: { x: 3, y: 4 }, selection: [initial.items[0].id] },
      ticket("pick"),
      seq++,
    );
    // A resting cursor is repeated every 6 seconds over a channel that can
    // lose a packet; the repeat at 6 s was lost, the one at 12 s arrives.
    t.mock.timers.tick(11_000);
    assert.ok(session.people.has("rest"), "The resting cursor stays");
    assert.ok(!session.people.has("pick"), "A selection still expires");
    t.mock.timers.tick(5_000);
    assert.ok(!session.people.has("rest"), "A crashed cursor goes");
  } finally {
    session.close();
    t.mock.timers.reset();
  }
});
