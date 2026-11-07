import test from "node:test";
import assert from "node:assert/strict";
import { board, item } from "../src/model.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { encode, decode, hash } from "../src/collaboration/protocol.js";
import { environment, owner, editor } from "./collaboration-helpers.js";

// A board's worker shares one Puter KV request quota (about 40 requests a
// second on paid plans) among everyone on its boards. Commits and syncs must
// stay cheap however long a board's history grows.
test("commits and syncs stay within a small, constant storage request budget", async () => {
  const env = environment(),
    svc = env.service;
  let clock = Date.now();
  svc.now = () => clock;
  svc.org.now = () => clock;
  const counts = { get: 0, set: 0, list: 0, incr: 0, del: 0 };
  const kv = svc.kv;
  // Page like Puter (200 rows) so list counts reflect real requests.
  kv.list = async ({ pattern, cursor, limit, returnValues }) => {
    const keys = [...env.data.keys()]
      .filter((k) => k.startsWith(pattern.replace(/\*$/, "")))
      .sort();
    const at = Number(cursor || 0),
      end = at + Math.min(limit, 200);
    return {
      items: keys
        .slice(at, end)
        .map((key) =>
          returnValues
            ? { key, value: structuredClone(env.data.get(key)) }
            : key,
        ),
      cursor: end < keys.length ? String(end) : undefined,
    };
  };
  for (const method of Object.keys(counts)) {
    const original = kv[method].bind(kv);
    kv[method] = (...args) => {
      counts[method]++;
      return original(...args);
    };
  }
  let reads = 0;
  const read = svc.puter.fs.read.bind(svc.puter.fs);
  svc.puter.fs.read = (...args) => {
    reads++;
    return read(...args);
  };
  const b = board("Capacity"),
    seed = new SharedDocument();
  b.items = [item("note", 0, 0, { text: "start" })];
  seed.commit(b);
  await svc.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  const invite = await svc.call(owner, {
    op: "invite",
    room: b.id,
    role: "editor",
  });
  await svc.call(editor, { op: "join", room: b.id, token: invite.token });
  const client = new SharedDocument(
    decode((await svc.call(editor, { op: "sync", room: b.id })).update),
  );
  const commit = async (n) => {
    const vector = client.vector(),
      next = client.snapshot();
    next.items.push(item("note", n * 10, 0, { text: `n${n}` }));
    client.commit(next);
    const update = client.update(vector);
    return svc.call(editor, {
      op: "commit",
      room: b.id,
      id: await hash(update),
      update: encode(update),
    });
  };
  // Build a long history, then measure steady-state costs.
  for (let n = 0; n < 300; n++) {
    clock += 200;
    await commit(n);
  }
  assert.ok(env.data.get(`wb:${b.id}:cp`), "a checkpoint bounds loading");
  const reset = () => {
    for (const key in counts) counts[key] = 0;
    reads = 0;
  };
  const total = () => Object.values(counts).reduce((a, b) => a + b, 0);
  reset();
  for (let n = 0; n < 100; n++) {
    clock += 200;
    await commit(1000 + n);
  }
  assert.ok(total() / 100 <= 3.5, `commit cost ${total() / 100}`);
  assert.equal(reads, 0, "snapshots and checkpoints are cached");
  reset();
  for (let n = 0; n < 100; n++) {
    clock += 700;
    await svc.call(editor, { op: "sync", room: b.id });
  }
  assert.ok(total() / 100 <= 2, `sync cost ${total() / 100}`);
  // A fresh worker instance still reads only the checkpoint and recent edits.
  const { doc } = await svc.load(b.id);
  assert.equal(doc.snapshot().items.length, 401);
  doc.destroy();
});
