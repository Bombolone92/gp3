import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "vite";
import { SharedDocument } from "../src/collaboration/document.js";
import { encode, hash } from "../src/collaboration/protocol.js";
import { call, deploy } from "../src/collaboration/api.js";
import { board, item } from "../src/model.js";
import { environment, owner, editor } from "./collaboration-helpers.js";

test("the shipped worker bundle deploys and exposes authenticated JSON routes", async (t) => {
  const bundle = await build({
    configFile: "vite.worker.config.js",
    logLevel: "silent",
    build: { write: false },
  });
  const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(
    (file) => file.type === "chunk" && file.isEntry,
  ).code;
  const routes = new Map(),
    env = environment(),
    puter = env.sdk(owner);
  vm.runInNewContext(code, {
    router: {
      get: (path, handler) => routes.set("GET " + path, handler),
      post: (path, handler) => routes.set("POST " + path, handler),
      custom: (method, path, handler) =>
        routes.set(method + " " + path, handler),
    },
    me: { puter },
    Response,
    URL,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    crypto,
    btoa,
    atob,
    structuredClone,
    setTimeout,
    clearTimeout,
    fetch,
    AbortSignal,
    console,
  });
  const health = await routes.get("GET /health")();
  assert.equal(health.status, 200);
  const metadata = await health.json();
  assert.equal(metadata.protocol, 1);
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "/worker/whiteboard-worker.js");
    return new Response(code);
  });
  let deployments = 0;
  puter.workers.create = async (name, path) => {
    deployments++;
    assert.equal(env.files.get(path), code);
    return { url: `https://${name}.puter.work` };
  };
  puter.workers.exec = async (url, options) => {
    assert.ok(url.endsWith("/health"));
    assert.equal(options.headers["x-puter-no-auth"], "1");
    assert.equal(options.headers["puter-auth"], undefined);
    return routes.get("GET /health")();
  };
  const server = await deploy(puter);
  const config = await puter.kv.get("whiteboard-collaboration-worker-v1");
  assert.equal(config.server, server);
  assert.equal(config.build, metadata.build);
  assert.equal(config.builtAt, metadata.builtAt);
  assert.equal(await deploy(puter), server);
  assert.equal(deployments, 1, "Reuse the same deployed build");
  const post = (body, user, headers = {}) =>
    routes.get("POST /api")({
      request: new Request("https://worker.puter.work/api", {
        method: "POST",
        headers: {
          ...(user ? { "puter-auth": env.sdk(user).authToken } : {}),
          ...headers,
        },
        body,
      }),
      user: user ? { puter: env.sdk(user) } : null,
    });
  assert.equal((await post("{}", null)).status, 401);
  assert.equal((await post("not JSON", owner)).status, 400);
  puter.workers.exec = async (url, options) =>
    routes.get("POST /api")({
      request: new Request(url, options),
      user: { puter: env.requestor(options.headers["puter-auth"]) },
    });
  const initial = board("Bundled worker");
  initial.items = [item("note", 10, 10, { text: "Actual bundled code" })];
  const doc = new SharedDocument();
  doc.commit(initial);
  const created = await call(puter, "https://worker.puter.work", {
    op: "create",
    room: initial.id,
    update: encode(doc.update()),
  });
  assert.equal(created.room, initial.id);
  const token = [...env.credentials.keys()][0];
  assert.equal(
    (
      await post(JSON.stringify({ op: "sync", room: initial.id }), owner, {
        "puter-auth": token,
      })
    ).status,
    401,
    "A restricted token cannot bypass proof verification on the bundled route",
  );
  assert.equal(
    (await post(JSON.stringify({ op: "sync", room: initial.id }), editor))
      .status,
    403,
  );
  const sync = await post(
    JSON.stringify({ op: "sync", room: initial.id }),
    owner,
  );
  assert.equal(sync.status, 200);
  assert.ok((await sync.json()).update);
  doc.destroy();
});

test("an edit whose file is written slowly still reaches other instances and checkpoints", async () => {
  const env = environment();
  const A = env.service;
  // Other worker instances keep their own cached states.
  const { BoardService: B2 } = await import("../worker/service.js?instance=b");
  const { BoardService: C2 } = await import("../worker/service.js?instance=c");
  const B = new B2(A.puter, { now: () => env.now, org: A.org });
  const C = new C2(A.puter, { now: () => env.now, org: A.org });
  const b = board("T");
  b.items = [item("note", 0, 0, { text: "Hi" })];
  const seed = new SharedDocument();
  seed.commit(b);
  await A.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  (await B.load(b.id)).doc.destroy();
  env.now += 2000;
  // A large edit is stored as a file, and the write takes 22 seconds while
  // instance B keeps refreshing.
  const { doc } = await A.load(b.id);
  const vector = doc.vector(),
    next = doc.snapshot();
  for (let n = 0; n < 16; n++)
    next.items.push(item("note", n * 10, 300, { text: "x".repeat(19000) }));
  doc.commit(next);
  const update = doc.update(vector);
  doc.destroy();
  const write = A.writeFile.bind(A);
  A.writeFile = async (path, value) => {
    for (let t = 0; t < 14; t++) {
      env.now += 1600;
      (await B.load(b.id)).doc.destroy();
    }
    return write(path, value);
  };
  await A.call(owner, {
    op: "commit",
    room: b.id,
    id: await hash(update),
    update: encode(update),
  });
  A.writeFile = write;
  env.now += 1600;
  const seen = (await B.load(b.id)).doc;
  assert.equal(
    seen.snapshot().items.length,
    17,
    "The other instance applies it",
  );
  seen.destroy();
  // Later edits and checkpoints keep it for a fresh instance.
  env.now += 3 * 60_000;
  const { doc: later } = await A.load(b.id);
  const v2 = later.vector(),
    s2 = later.snapshot();
  s2.items[0].text = "later";
  later.commit(s2);
  const u2 = later.update(v2);
  later.destroy();
  await A.call(owner, {
    op: "commit",
    room: b.id,
    id: await hash(u2),
    update: encode(u2),
  });
  env.now += 1600;
  (await B.load(b.id)).doc.destroy();
  env.now += 5 * 60_000;
  const fresh = (await C.load(b.id)).doc;
  assert.equal(fresh.snapshot().items.length, 17);
  fresh.destroy();
});

test("the worker's file cache counts checkpoints and stays within its limit", async () => {
  const { BoardService, FILES } = await import("../worker/service.js");
  const { environment } = await import("./collaboration-helpers.js");
  const { SharedDocument } = await import("../src/collaboration/document.js");
  const { board, item } = await import("../src/model.js");
  const env = environment();
  const service = new BoardService(env.service.puter, { now: () => env.now });
  const b = board("Big");
  b.items = Array.from({ length: 50 }, (_, n) =>
    item("note", n * 10, 0, { text: "x".repeat(19000) }),
  );
  const doc = new SharedDocument();
  doc.commit(b);
  for (let n = 0; n < 60; n++) {
    const next = doc.snapshot();
    next.items[0].text = `v${n}`;
    doc.commit(next);
    await service.checkpoint(`room-${n % 3}`, doc, env.now);
  }
  for (let n = 0; n < 20; n++) {
    const path = `whiteboard/shared/x/f${n}.txt`;
    env.files.set(path, "y".repeat(1_500_000));
    await service.cachedFile(path);
  }
  const held = [...FILES.values()].reduce((sum, v) => sum + v.length, 0);
  assert.equal(FILES.bytes, held);
  assert.ok(held <= 48_000_000, `${held}`);
  doc.destroy();
});

test("a quiet board's checkpoint is renewed so loads stop reading its whole log", async () => {
  const { BoardService, DOCS } = await import("../worker/service.js");
  const { environment, owner } = await import("./collaboration-helpers.js");
  const { SharedDocument } = await import("../src/collaboration/document.js");
  const { encode, hash } = await import("../src/collaboration/protocol.js");
  const { board, item } = await import("../src/model.js");
  const env = environment();
  const puter = env.service.puter;
  const service = new BoardService(puter, { now: () => env.now });
  const b = board("Quiet");
  b.items = [item("note", 0, 0, { text: "start" })];
  const doc = new SharedDocument();
  doc.commit(b);
  await service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(doc.update()),
  });
  for (let n = 0; n < 30; n++) {
    env.now += 2000;
    const vector = doc.vector(),
      next = doc.snapshot();
    next.items[0].text = `edit ${n}`;
    doc.commit(next);
    const update = doc.update(vector);
    await service.call(owner, {
      op: "commit",
      room: b.id,
      id: await hash(update),
      update: encode(update),
    });
  }
  // A later load checkpoints every edit; then the board goes quiet.
  env.now += 2 * 86_400_000;
  DOCS.clear();
  await service.call(owner, { op: "sync", room: b.id });
  env.now += 8 * 86_400_000;
  const list = puter.kv.list;
  let rows = 0;
  puter.kv.list = async (options) => {
    const page = await list(options);
    if (String(options?.pattern || "").includes(":log:"))
      rows += page.items.length;
    return page;
  };
  const coldSync = async () => {
    DOCS.clear();
    rows = 0;
    const { update } = await service.call(owner, { op: "sync", room: b.id });
    return { rows, update };
  };
  const first = await coldSync();
  assert.ok(first.rows >= 30, "The first load after a week reads the log");
  const second = await coldSync();
  assert.ok(second.rows < 5, `${second.rows} log records read again`);
  const state = new SharedDocument(
    (await import("../src/collaboration/protocol.js")).decode(second.update),
  );
  assert.equal(state.snapshot().items[0].text, "edit 29");
  state.destroy();
  doc.destroy();
});

test("an old version reads the edit log only up to its moment", async () => {
  const { BoardService } = await import("../worker/service.js");
  const env = environment();
  const puter = env.service.puter;
  const service = new BoardService(puter, { now: () => env.now });
  const b = board("Old");
  b.items = [item("note", 0, 0, { text: "start" })];
  const doc = new SharedDocument();
  doc.commit(b);
  await service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(doc.update()),
  });
  const times = [];
  for (let n = 0; n < 40; n++) {
    env.now += 60_000;
    const vector = doc.vector(),
      next = doc.snapshot();
    next.items[0].text = `edit ${n}`;
    doc.commit(next);
    const update = doc.update(vector);
    await service.call(owner, {
      op: "commit",
      room: b.id,
      id: await hash(update),
      update: encode(update),
    });
    times.push(env.now);
  }
  await service.checkpoint(b.id, doc, env.now);
  const list = puter.kv.list;
  let rows = 0;
  puter.kv.list = async (options) => {
    const page = await list(options);
    if (String(options?.pattern || "").includes(":log:"))
      rows += page.items.length;
    return page;
  };
  // Versions before the checkpoint replay the log from the start, reading
  // at most a page past their last edit.
  for (const n of [0, 4, 38]) {
    rows = 0;
    const { doc: past, count } = await service.loadAt(b.id, times[n]);
    assert.equal(past.snapshot().items[0].text, `edit ${n}`);
    assert.equal(count, n + 1);
    assert.ok(rows <= n + 4, `${rows} log records read`);
    past.destroy();
  }
  puter.kv.list = list;
  doc.destroy();
});

test("an old version starts from the checkpoint before it", async () => {
  const { BoardService } = await import("../worker/service.js");
  const env = environment();
  const puter = env.service.puter;
  const service = new BoardService(puter, { now: () => env.now });
  const b = board("Old");
  b.items = [item("note", 0, 0, { text: "start" })];
  const doc = new SharedDocument();
  doc.commit(b);
  await service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(doc.update()),
  });
  const times = [];
  for (let n = 0; n < 60; n++) {
    env.now += 600_000;
    const vector = doc.vector(),
      next = doc.snapshot();
    next.items[0].text = `edit ${n}`;
    doc.commit(next);
    const update = doc.update(vector);
    await service.call(owner, {
      op: "commit",
      room: b.id,
      id: await hash(update),
      update: encode(update),
    });
    times.push(env.now);
    if (n === 19 || n === 39) await service.checkpoint(b.id, doc, env.now);
  }
  await service.checkpoint(b.id, doc, env.now);
  for (const [n, at] of times.entries()) {
    const { doc: past } = await service.loadAt(b.id, at);
    assert.equal(past.snapshot().items[0].text, `edit ${n}`);
    past.destroy();
  }
  const list = puter.kv.list;
  let rows = 0;
  puter.kv.list = async (options) => {
    const page = await list(options);
    if (String(options?.pattern || "").includes(":log:"))
      rows += page.items.length;
    return page;
  };
  // Each reads the edits since the checkpoint before it, and a few more
  // from the hour that checkpoint was saved in.
  for (const [n, from] of [
    [19, 19],
    [25, 19],
    [45, 39],
    [58, 39],
  ]) {
    rows = 0;
    const { doc: past } = await service.loadAt(b.id, times[n]);
    assert.equal(past.snapshot().items[0].text, `edit ${n}`);
    assert.ok(rows <= n - from + 10, `${rows} log records read`);
    past.destroy();
  }
  puter.kv.list = list;
  doc.destroy();
});

test("an edit saved while another request reads the board stays in the instance's cached state", async () => {
  const { BoardService } = await import("../worker/service.js");
  const env = environment();
  const puter = env.service.puter;
  const service = new BoardService(puter, { now: () => env.now });
  const b = board("Busy");
  b.items = [item("note", 0, 0, { text: "start" })];
  const doc = new SharedDocument();
  doc.commit(b);
  await service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(doc.update()),
  });
  (await service.load(b.id)).doc.destroy();
  env.now += 2000;
  // A synchronization starts reading the edit log and is slow to finish.
  const list = puter.kv.list;
  let paused, resume;
  const reached = new Promise((resolve) => (paused = resolve));
  puter.kv.list = async (options) => {
    const page = await list(options);
    if (String(options?.pattern || "").includes(":log:") && !resume) {
      const gate = new Promise((resolve) => (resume = resolve));
      paused();
      await gate;
    }
    return page;
  };
  const slow = service.load(b.id);
  await reached;
  // Meanwhile this instance saves an edit.
  const vector = doc.vector(),
    next = doc.snapshot();
  next.items[0].text = "saved";
  doc.commit(next);
  const update = doc.update(vector);
  await new BoardService(puter, { now: () => env.now }).call(owner, {
    op: "commit",
    room: b.id,
    id: await hash(update),
    update: encode(update),
  });
  resume();
  (await slow).doc.destroy();
  puter.kv.list = list;
  const { doc: cached } = await service.load(b.id);
  assert.equal(cached.snapshot().items[0].text, "saved");
  cached.destroy();
  doc.destroy();
});
