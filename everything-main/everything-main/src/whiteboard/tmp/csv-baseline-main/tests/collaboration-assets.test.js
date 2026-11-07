import test from "node:test";
import assert from "node:assert/strict";
import { board, item } from "../src/model.js";
import { CollaborationSession } from "../src/collaboration/session.js";
import { ASSET, hash } from "../src/collaboration/protocol.js";
import { memoryStore, owner } from "./collaboration-helpers.js";

const image = "data:image/png;base64,AA==";

async function fixture() {
  const asset = await hash(image),
    initial = board("Shared media"),
    rendered = [],
    store = memoryStore();
  initial.items = [
    item("image", 0, 0, { src: "asset:" + asset }),
    item("image", 300, 0, { src: "asset:" + asset }),
  ];
  const session = new CollaborationSession({
    puter: {},
    server: "https://whiteboard-test.puter.work",
    room: initial.id,
    user: owner,
    store,
    changed: (snapshot) => rendered.push(snapshot),
    activity() {},
    status() {},
  });
  session.shared.commit(initial);
  return { session, initial, asset, rendered, store };
}

test("overlapping shared-board renders download each image once, show changes at once, and fill in only the newest state", async () => {
  const { session, initial, asset, rendered, store } = await fixture();
  let release;
  const available = new Promise((resolve) => {
    release = resolve;
  });
  let requests = 0;
  session.request = async (op, data) => {
    if (op === "leave") return {};
    assert.equal(op, "asset.get");
    assert.equal(data.asset, asset);
    requests++;
    await available;
    return { data: image };
  };
  const pending = [];
  try {
    for (let i = 0; i < 8; i++) {
      session.shared.commit({ ...initial, title: `Revision ${i}` });
      pending.push(session.publish());
    }
    // Each change shows without waiting for the image.
    await Promise.all(pending);
    assert.deepEqual(
      rendered.map((b) => b.title),
      Array.from({ length: 8 }, (_, i) => `Revision ${i}`),
    );
    assert.ok(rendered.every((b) => ASSET.test(b.items[0].src)));
    release();
    for (let n = 0; n < 50 && rendered.length < 9; n++)
      await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(requests, 1, "Concurrent updates share the media download");
    assert.equal(
      rendered.length,
      9,
      "Only the newest state is shown again with its image",
    );
    assert.equal(rendered[8].title, "Revision 7");
    assert.ok(rendered[8].items.every((item) => item.src === image));
    assert.equal(store.rows.size, 1);
    await session.materialize();
    assert.equal(requests, 1, "Subsequent renders use the verified cache");
  } finally {
    release();
    await Promise.allSettled(pending);
    session.close();
  }
});

for (const failure of ["network", "checksum"])
  test(`a failed shared image download (${failure}) can retry without caching bad data`, async () => {
    const { session, store } = await fixture();
    let requests = 0,
      failing = true;
    session.request = async (op) => {
      if (op === "leave") return {};
      requests++;
      if (failing && failure === "network") throw Error("Connection lost");
      return { data: failing ? image + "corrupt" : image };
    };
    try {
      // The board still opens; the image keeps its reference until a
      // download succeeds.
      const first = await Promise.all([
        session.materialize(),
        session.materialize(),
      ]);
      assert.ok(first.every((snapshot) => ASSET.test(snapshot.items[0].src)));
      assert.equal(requests, 1, "One failed transfer serves both callers");
      assert.equal(session.assets.size, 0);
      assert.equal(store.rows.size, 0);
      failing = false;
      const recovered = await Promise.all([
        session.materialize(),
        session.materialize(),
      ]);
      assert.equal(requests, 2, "Retry starts one fresh transfer");
      assert.ok(recovered.every((snapshot) => snapshot.items[0].src === image));
      assert.equal(store.rows.size, 1);
    } finally {
      session.close();
    }
  });

test("commits check only images newly added to the board", async () => {
  const { environment, owner } = await import("./collaboration-helpers.js");
  const { SharedDocument } = await import("../src/collaboration/document.js");
  const { board: newBoard, item } = await import("../src/model.js");
  const { encode, hash } = await import("../src/collaboration/protocol.js");
  const env = environment();
  const boards = env.service;
  const b = newBoard("Images");
  b.items = [item("note", 0, 0, { text: "x" })];
  const doc = new SharedDocument();
  doc.commit(b);
  await boards.call(owner, {
    op: "create",
    room: b.id,
    update: encode(doc.update()),
  });
  const commit = async (change) => {
    const vector = doc.vector(),
      next = doc.snapshot();
    change(next);
    doc.commit(next);
    const update = doc.update(vector);
    return boards.call(owner, {
      op: "commit",
      room: b.id,
      id: await hash(update),
      update: encode(update),
    });
  };
  const data = "data:image/png;base64," + btoa("image");
  const asset = await hash(data);
  await boards.call(owner, { op: "asset.put", room: b.id, asset, data });
  await commit((next) =>
    next.items.push(item("image", 50, 0, { src: "asset:" + asset })),
  );
  let stats = 0;
  const stat = boards.puter.fs.stat;
  boards.puter.fs.stat = (...args) => (stats++, stat(...args));
  await commit((next) => (next.items[0].text = "xy"));
  assert.equal(stats, 0, "unchanged images are not checked again");
  const missing = await hash("data:image/png;base64,bm9uZQ==");
  await assert.rejects(
    commit((next) =>
      next.items.push(item("image", 90, 0, { src: "asset:" + missing })),
    ),
  );
  assert.equal(stats, 1);
  doc.destroy();
});

test("an image queued before access became commenter does not stop comments from saving", async () => {
  const { SharedDocument } = await import("../src/collaboration/document.js");
  const { encode } = await import("../src/collaboration/protocol.js");
  const { environment, editor } = await import("./collaboration-helpers.js");
  const { commentThread } = await import("../src/comments.js");
  const env = environment(),
    b = board("Demoted");
  b.items = [item("note", 0, 0, { text: "x" })];
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
  const store = memoryStore();
  let state;
  const open = () =>
    new CollaborationSession({
      puter: env.sdk(editor),
      server: "https://whiteboard-test.puter.work",
      room: b.id,
      user: editor,
      store,
      changed: (next) => (state = next),
      activity() {},
      status() {},
    });
  let session = open();
  try {
    await session.start();
    // An image added offline waits to be uploaded.
    env.offline = true;
    const before = structuredClone(state),
      next = structuredClone(state);
    next.items.push(item("image", 50, 50, { src: image, w: 10, h: 10 }));
    await session.commit(next, before);
    await session.flush().catch(() => {});
    assert.equal(session.pendingAssets.size, 1);
    session.close();
    env.offline = false;
    await env.service.call(owner, {
      op: "role",
      room: b.id,
      uuid: editor.uuid,
      role: "commenter",
    });
    session = open();
    await session.start();
    const now = structuredClone(state),
      commented = structuredClone(state);
    commented.comments = [
      commentThread({ x: 1, y: 1 }, { id: editor.uuid, name: "Bob" }, "Hi"),
    ];
    await session.commit(commented, now);
    await session.flush();
    const { doc } = await env.service.load(b.id);
    assert.equal(doc.snapshot().comments?.[0]?.messages[0].text, "Hi");
    doc.destroy();
  } finally {
    session.close();
  }
});

test("an image that could not be downloaded is tried again on a quiet board", async () => {
  const { SharedDocument } = await import("../src/collaboration/document.js");
  const { encode } = await import("../src/collaboration/protocol.js");
  const { environment, editor } = await import("./collaboration-helpers.js");
  const env = environment(),
    b = board("Retry");
  const asset = await hash(image);
  b.items = [item("image", 0, 0, { src: "asset:" + asset, w: 10, h: 10 })];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  await env.service.call(owner, {
    op: "asset.put",
    room: b.id,
    asset,
    data: image,
  });
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
    changed: (next) => (state = next),
    activity() {},
    status() {},
  });
  const request = session.request.bind(session);
  let offline = true;
  session.request = async (op, data) => {
    if (op === "asset.get" && offline) throw Error("Network error");
    return request(op, data);
  };
  try {
    await session.start();
    assert.match(state.items[0].src, ASSET);
    offline = false;
    const deadline = Date.now() + 8000;
    while (ASSET.test(state.items[0].src) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 100));
    assert.equal(state.items[0].src, image);
  } finally {
    session.close();
  }
});

test("a board's images download a few at a time", async () => {
  const images = Array.from(
    { length: 6 },
    (_, n) => `data:image/png;base64,${btoa(String(n))}`,
  );
  const ids = await Promise.all(images.map((data) => hash(data)));
  const initial = board("Gallery");
  initial.items = ids.map((id, n) =>
    item("image", n * 100, 0, { src: "asset:" + id }),
  );
  const session = new CollaborationSession({
    puter: {},
    server: "https://whiteboard-test.puter.work",
    room: initial.id,
    user: owner,
    store: memoryStore(),
    changed() {},
    activity() {},
    status() {},
  });
  session.shared.commit(initial);
  let active = 0,
    most = 0;
  session.request = async (op, data) => {
    if (op === "leave") return {};
    active++;
    most = Math.max(most, active);
    await new Promise((r) => setTimeout(r, 20));
    active--;
    return { data: images[ids.indexOf(data.asset)] };
  };
  try {
    const shown = await session.materialize();
    assert.deepEqual(
      shown.items.map((i) => i.src),
      images,
    );
    assert.ok(most > 1, "Downloads overlap");
    assert.ok(most <= 4, `${most} at once`);
  } finally {
    session.close();
  }
});

test("images no longer on the board are not kept on this device", async () => {
  const { SharedDocument } = await import("../src/collaboration/document.js");
  const { encode } = await import("../src/collaboration/protocol.js");
  const { environment } = await import("./collaboration-helpers.js");
  const env = environment(),
    b = board("Replaced");
  b.items = [item("note", 0, 0, { text: "x" })];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const store = memoryStore();
  let state;
  const session = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: owner,
    store,
    changed: (next) => (state = next),
    activity() {},
    status() {},
  });
  const assetRows = () =>
    [...store.rows.values()].filter((r) => r.kind === "asset");
  try {
    await session.start();
    // One image replaced by another, several times.
    for (let n = 0; n < 4; n++) {
      const before = structuredClone(state),
        next = structuredClone(state);
      next.items = next.items.filter((i) => i.type !== "image");
      next.items.push(
        item("image", 0, 0, {
          src: `data:image/png;base64,${btoa("picture " + n)}`,
          w: 10,
          h: 10,
        }),
      );
      await session.commit(next, before);
      await session.flush();
    }
    assert.equal(assetRows().length, 1);
    assert.equal(
      state.items.find((i) => i.type === "image").src,
      `data:image/png;base64,${btoa("picture 3")}`,
    );
    // Undoing the last replacement without a connection shows the earlier
    // image at once, and it is stored again.
    env.offline = true;
    session.shared.undo.undo();
    await session.publish();
    assert.equal(
      state.items.find((i) => i.type === "image").src,
      `data:image/png;base64,${btoa("picture 2")}`,
    );
    await session.cache();
    assert.equal(assetRows().length, 1);
    assert.equal(
      assetRows()[0].data,
      `data:image/png;base64,${btoa("picture 2")}`,
    );
  } finally {
    session.close();
  }
});

test("an image the server no longer has is not tried again forever on a quiet board", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { session } = await fixture();
  let requests = 0;
  session.request = async (op) => {
    if (op === "leave") return {};
    requests++;
    throw Object.assign(Error("Shared asset not found."), { status: 404 });
  };
  try {
    await session.publish();
    for (let n = 0; n < 20; n++) {
      t.mock.timers.tick(60_000);
      for (let k = 0; k < 20; k++) await Promise.resolve();
    }
    assert.equal(requests, 9, "The first try and eight more");
    assert.equal(session.assetTimer, null);
  } finally {
    session.close();
  }
});

test("the worker takes every attachment a board can hold", async () => {
  const { environment } = await import("./collaboration-helpers.js");
  const { SharedDocument } = await import("../src/collaboration/document.js");
  const { board: newBoard, validateBoard } = await import("../src/model.js");
  const { encode } = await import("../src/collaboration/protocol.js");
  const env = environment();
  const b = newBoard("Files");
  const doc = new SharedDocument();
  doc.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(doc.update()),
  });
  doc.destroy();
  const prefix = "data:application/octet-stream;base64,";
  const largest = prefix + "A".repeat(15 * 1024 * 1024 - prefix.length);
  // The board accepts it...
  validateBoard({
    ...b,
    items: [item("file", 0, 0, { fileName: "big.bin", data: largest })],
  });
  // ...and so does its worker.
  await env.service.call(owner, {
    op: "asset.put",
    room: b.id,
    asset: await hash(largest),
    data: largest,
  });
  const over = largest + "A";
  await assert.rejects(
    env.service.call(owner, {
      op: "asset.put",
      room: b.id,
      asset: await hash(over),
      data: over,
    }),
    { status: 400 },
  );
});
