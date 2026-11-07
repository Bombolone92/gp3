import test from "node:test";
import assert from "node:assert/strict";
import { board, item } from "../src/model.js";
import { SharedDocument } from "../src/collaboration/document.js";
import {
  encode,
  decode,
  hash,
  keyPair,
} from "../src/collaboration/protocol.js";
import { DAY } from "../worker/org.js";
import { BoardService } from "../worker/service.js";
import { environment, owner, editor } from "./collaboration-helpers.js";

// A stored item's size as DynamoDB bills it: the owner's namespace (about
// 80 bytes), the key, and the value.
const itemBytes = (key, value) =>
  80 +
  new TextEncoder().encode(key + (value == null ? "" : JSON.stringify(value)))
    .length;

// Counts KV requests and the capacity Puter bills them by. Lists page like
// Puter: up to `limit` rows and 1 MB a request, reading every row of a page
// whatever it returns. Reads are eventually consistent, half a unit per
// 4 KB (each item rounded alone for a get, a page's rows together for a
// list); writes cost a unit per 1 KB of the larger of the old and new item,
// and an update writes twice, as Puter creates its paths first.
function instrument(env) {
  const counts = { get: 0, set: 0, list: 0, incr: 0, del: 0, update: 0 };
  const io = { readBytes: 0, writtenBytes: 0, rcu: 0, wcu: 0, rows: {} };
  const kv = env.service.kv;
  const old = (key) =>
    env.data.has(key) ? itemBytes(key, env.data.get(key)) : 0;
  const write = (key, next, times = 1) => {
    const size = itemBytes(key, next);
    io.writtenBytes += size;
    io.wcu += times * Math.max(1, Math.ceil(Math.max(size, old(key)) / 1024));
  };
  kv.list = async ({ pattern, cursor, limit, returnValues, reverse }) => {
    const prefix = pattern.replace(/\*$/, "");
    const keys = [...env.data.keys()]
      .filter((k) => k.startsWith(prefix))
      .sort();
    if (reverse) keys.reverse();
    let at = Number(cursor || 0),
      bytes = 0;
    const start = at;
    while (at < keys.length && at - start < limit && bytes < 1_000_000)
      bytes += itemBytes(keys[at], env.data.get(keys[at++]));
    io.readBytes += bytes;
    io.rcu += Math.max(0.5, Math.ceil(bytes / 4096) * 0.5);
    // Rows read, by the kind of record: "log", "presence", ...
    const kind = prefix.split(":")[2] || prefix;
    io.rows[kind] = (io.rows[kind] || 0) + at - start;
    return {
      items: keys
        .slice(start, at)
        .map((key) =>
          returnValues
            ? { key, value: structuredClone(env.data.get(key)) }
            : key,
        ),
      cursor: at < keys.length ? String(at) : undefined,
    };
  };
  const metered = {
    get: (keys) => {
      for (const key of [keys].flat()) {
        const size = old(key);
        io.readBytes += size;
        io.rcu += Math.max(0.5, Math.ceil(size / 4096) * 0.5);
      }
    },
    set: (key, value) => write(key, value),
    update: (key, paths) => write(key, { ...env.data.get(key), ...paths }, 2),
    incr: (key) => write(key, (env.data.get(key) || 0) + 1),
    del: (key) => {
      io.wcu += Math.max(1, Math.ceil(old(key) / 1024));
    },
  };
  for (const method of Object.keys(counts)) {
    const original = kv[method].bind(kv);
    kv[method] = (...args) => {
      counts[method]++;
      metered[method]?.(...args);
      return original(...args);
    };
  }
  return {
    counts,
    io,
    reset: () => {
      for (const key in counts) counts[key] = 0;
      Object.assign(io, {
        readBytes: 0,
        writtenBytes: 0,
        rcu: 0,
        wcu: 0,
        rows: {},
      });
    },
    total: () => Object.values(counts).reduce((a, b) => a + b, 0),
  };
}

// A board's worker shares one Puter KV request quota (about 40 requests a
// second on paid plans) among everyone on its boards. Commits and syncs must
// stay cheap however long a board's history grows.
test("commits and syncs stay within a small, constant storage request budget", async () => {
  const env = environment(),
    svc = env.service;
  let clock = Date.now();
  svc.now = () => clock;
  svc.org.now = () => clock;
  const { counts, total, reset: resetCounts } = instrument(env);
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
    resetCounts();
    reads = 0;
  };
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

test("check-ins in a large room cost about one storage request each", async () => {
  const env = environment(),
    svc = env.service;
  let clock = Date.now();
  svc.now = () => clock;
  svc.org.now = () => clock;
  const { counts, total, reset } = instrument(env);
  const b = board("Crowded"),
    seed = new SharedDocument();
  seed.commit(b);
  await svc.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  // 300 people already present, checking in from other instances.
  for (let n = 0; n < 300; n++)
    env.data.set(`wb:${b.id}:presence:p${n}`, {
      room: b.id,
      session: `p${n}`,
      user: `user-${n}`,
      role: "editor",
      expires: clock + 90_000,
    });
  const { publicKey } = await keyPair();
  const checkIn = (n) =>
    svc.call(owner, {
      op: "presence",
      room: b.id,
      session: `own-${n}`,
      publicKey,
    });
  for (let n = 0; n < 10; n++) await checkIn(n);
  reset();
  for (let round = 0; round < 10; round++)
    for (let n = 0; n < 10; n++) {
      clock += 200;
      const { roster } = await checkIn(n);
      assert.equal(roster.length, 310);
    }
  assert.ok(total() / 100 <= 1.5, `check-in cost ${total() / 100}`);
  // Puter allows a worker far fewer listings than other requests: one
  // request lists everyone present, and once more after the ten who joined
  // before, as listings may show them late.
  assert.ok(counts.list <= 2, `${counts.list} listings`);
});

test("check-ins on a quiet board list who is present when someone joins or leaves, and before a ticket in the list could lapse", async () => {
  const env = environment(),
    A = env.service;
  const { BoardService } = await import("../worker/service.js?instance=roster");
  const B = new BoardService(A.puter, { now: () => env.now, org: A.org });
  const { counts, reset } = instrument(env);
  const b = board("Quiet"),
    seed = new SharedDocument();
  seed.commit(b);
  await A.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const { publicKey } = await keyPair();
  const checkIn = (service, session) =>
    service.call(owner, { op: "presence", room: b.id, session, publicKey });
  const present = async (service) =>
    (await checkIn(service, "s0")).roster.map((p) => p.session).sort();
  // Four people check in every 20 seconds or so, through either instance.
  for (const n of [0, 1, 2, 3]) await checkIn(n % 2 ? B : A, `s${n}`);
  reset();
  for (let second = 0; second < 120; second += 5) {
    env.now += 5000;
    await checkIn(second % 10 ? B : A, `s${(second / 5) % 4}`);
  }
  assert.ok(counts.list <= 6, `${counts.list} listings`);
  // Someone joining or leaving through one instance shows on the other's
  // next check-in two seconds later.
  await checkIn(B, "s4");
  env.now += 2000;
  assert.deepEqual(await present(A), ["s0", "s1", "s2", "s3", "s4"]);
  env.now += 2000;
  await present(A);
  await B.call(owner, { op: "leave", room: b.id, session: "s4" });
  env.now += 2000;
  assert.deepEqual(await present(A), ["s0", "s1", "s2", "s3"]);
});

test("checking someone's access reads their board and organization records in one request", async () => {
  const env = environment(),
    svc = env.service;
  const b = board("Access"),
    seed = new SharedDocument();
  seed.commit(b);
  await svc.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const { token } = await svc.call(owner, {
    op: "invite",
    room: b.id,
    role: "editor",
  });
  await svc.call(editor, { op: "join", room: b.id, token });
  // Past the time an instance reuses records.
  env.now += 20_000;
  const get = svc.kv.get,
    read = [];
  svc.kv.get = (key, ...args) => (read.push(key), get(key, ...args));
  try {
    await svc.call(editor, { op: "sync", room: b.id });
  } finally {
    svc.kv.get = get;
  }
  // With the board's and the organization's access stamps, and the
  // organization's policy, which says what the board allows.
  assert.deepEqual(read[0], [
    `wb:${b.id}:access`,
    "org:access",
    `wb:${b.id}:meta`,
    `wb:${b.id}:member:${editor.uuid}`,
    "org:meta",
    `org:user:${editor.uuid}`,
  ]);
  assert.deepEqual(
    read.flat().filter((key) => key.startsWith("org:user:")),
    [`org:user:${editor.uuid}`],
  );
});

test("an instance reads access stamps once a second for everyone's requests, and keeps their records meanwhile", async () => {
  const env = environment(),
    svc = env.service;
  const b = board("Stamps"),
    seed = new SharedDocument();
  seed.commit(b);
  await svc.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const people = Array.from({ length: 10 }, (_, n) => ({
    uuid: `person-${n}`,
    username: `Person ${n}`,
  }));
  for (const { uuid, username } of people)
    env.data.set(`wb:${b.id}:member:${uuid}`, {
      uuid,
      username,
      role: "editor",
    });
  const syncs = () =>
    Promise.all(people.map((p) => svc.call(p, { op: "sync", room: b.id })));
  await syncs();
  env.now += 2000;
  await syncs();
  const get = svc.kv.get,
    read = [];
  svc.kv.get = (key, ...args) => (read.push(key), get(key, ...args));
  try {
    for (let n = 0; n < 4; n++) {
      env.now += 500;
      await syncs();
    }
  } finally {
    svc.kv.get = get;
  }
  const keys = read.flat();
  assert.equal(keys.filter((key) => key === `wb:${b.id}:access`).length, 2);
  assert.equal(keys.filter((key) => key === "org:access").length, 2);
  assert.deepEqual(
    keys.filter((key) => /:member:|^org:user:|:meta$/.test(key)),
    [],
  );
});

test("someone joining a room of 300 through another instance shows within seconds, while saves keep changing the board's signal", async () => {
  const env = environment(),
    A = env.service;
  const { BoardService } = await import("../worker/service.js?instance=joins");
  const B = new BoardService(A.puter, { now: () => env.now, org: A.org });
  const { counts, reset } = instrument(env);
  const b = board("Crowded"),
    seed = new SharedDocument();
  seed.commit(b);
  await A.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  for (let n = 0; n < 300; n++)
    env.data.set(`wb:${b.id}:presence:p${n}`, {
      room: b.id,
      session: `p${n}`,
      user: `user-${n}`,
      role: "editor",
      expires: env.now + 90_000,
    });
  const { publicKey } = await keyPair();
  const checkIn = async (service, session) =>
    (
      await service.call(owner, {
        op: "presence",
        room: b.id,
        session,
        publicKey,
      })
    ).roster.map((p) => p.session);
  await checkIn(A, "own");
  // A save every 200 ms, and a check-in through A after each.
  let saves = 0;
  const later = async () => {
    env.now += 200;
    await A.notify(b.id, `save-${saves++}`);
    return checkIn(A, "own");
  };
  reset();
  for (let n = 0; n < 100; n++) await later();
  assert.ok(counts.list <= 2, `${counts.list} listings`);
  await checkIn(B, "newcomer");
  let waited = 0;
  while (!(await later()).includes("newcomer")) waited += 200;
  assert.ok(waited <= 4000, `${waited} ms`);
});

test("listings read in full take one request per thousand rows", async () => {
  const env = environment();
  const { counts } = instrument(env);
  for (let n = 0; n < 600; n++)
    env.data.set(`org:user:u${n}`, { uuid: `u${n}`, status: "active" });
  assert.equal((await env.service.org.list("org:user:")).length, 600);
  assert.equal((await env.service.members("room")).length, 0);
  for (let n = 0; n < 600; n++)
    env.data.set(`wb:room:member:u${n}`, { uuid: `u${n}`, role: "editor" });
  // Members written elsewhere show once the shared listing is five
  // seconds old.
  env.now += 5000;
  assert.equal((await env.service.members("room")).length, 600);
  assert.equal(counts.list, 3);
});

test("people joining together share one listing of the board's members", async () => {
  const env = environment();
  const { counts } = instrument(env);
  for (let n = 0; n < 50; n++)
    env.data.set(`wb:room:member:u${n}`, { uuid: `u${n}`, role: "editor" });
  const lists = await Promise.all(
    Array.from({ length: 20 }, () =>
      env.service.members("room", { shared: true }),
    ),
  );
  assert.ok(lists.every((list) => list.length === 50));
  env.now += 2000;
  assert.equal(
    (await env.service.members("room", { shared: true })).length,
    50,
  );
  assert.equal(counts.list, 1);
  // A member added or changed through this instance shows at once,
  // without listing them again.
  await env.service.setMember("room", { uuid: "u50", role: "viewer" });
  await env.service.setMember("room", { uuid: "u3", role: "removed" });
  const members = await env.service.members("room", { shared: true });
  assert.equal(members.length, 51);
  assert.equal(members.find((m) => m.uuid === "u3").role, "removed");
  assert.equal(counts.list, 1);
  // Five seconds on, they are listed again.
  env.now += 3000;
  assert.equal(
    (await env.service.members("room", { shared: true })).length,
    51,
  );
  assert.equal(counts.list, 2);
  // Counting the members reads them afresh.
  assert.equal((await env.service.members("room")).length, 51);
  assert.equal(counts.list, 3);
});

// A board on its own worker instance, with an editor whose edits each add a
// note.
async function busyBoard(clock) {
  const env = environment(),
    svc = env.service;
  svc.now = () => clock.at;
  svc.org.now = () => clock.at;
  const b = board("Busy"),
    seed = new SharedDocument();
  b.items = [item("note", 0, 0, { text: "start" })];
  seed.commit(b);
  await svc.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  const invite = await svc.call(owner, {
    op: "invite",
    room: b.id,
    role: "editor",
  });
  await svc.call(editor, { op: "join", room: b.id, token: invite.token });
  const client = new SharedDocument(
    decode((await svc.call(editor, { op: "sync", room: b.id })).update),
  );
  const edit = async (change) => {
    const vector = client.vector(),
      next = client.snapshot();
    change(next);
    client.commit(next);
    const update = client.update(vector);
    return svc.call(editor, {
      op: "commit",
      room: b.id,
      id: await hash(update),
      update: encode(update),
    });
  };
  const commit = (n) =>
    edit((next) => next.items.push(item("note", n * 10, 0, { text: `n${n}` })));
  return { env, svc, room: b.id, commit, edit };
}

test("refreshing a busy board reads its newest edits, not the rest of the minute", async () => {
  // Every edit below falls in one minute.
  const clock = { at: Date.UTC(2026, 9, 5, 12, 0, 0) };
  const { env, svc, room, commit } = await busyBoard(clock);
  const { io, reset } = instrument(env);
  let refreshes = 0;
  const logSince = svc.logSince.bind(svc);
  svc.logSince = (...args) => {
    refreshes++;
    return logSince(...args);
  };
  // Ten edits a second, with a refresh every second and a half.
  for (let n = 0; n < 550; n++) {
    clock.at += 100;
    if (n === 250) {
      reset();
      refreshes = 0;
    }
    await commit(n);
  }
  assert.ok(refreshes >= 15, `refreshes ${refreshes}`);
  // A refresh needs the last 16.5 seconds: 165 edits.
  const rows = io.rows.log / refreshes;
  assert.ok(rows <= 210, `log rows read per refresh ${rows}`);
  // Another instance still finds every edit.
  const { BoardService } = await import("../worker/service.js?instance=busy");
  const other = new BoardService(svc.puter, {
    now: () => clock.at,
    org: svc.org,
  });
  const { doc } = await other.load(room);
  assert.equal(doc.snapshot().items.length, 551);
  doc.destroy();
});

test("refreshing a board gone quiet after a burst reads few records, and a new burst in full", async () => {
  const clock = { at: Date.UTC(2026, 9, 5, 12, 0, 0) };
  const { env, svc, room, commit } = await busyBoard(clock);
  // Another instance follows the board through synchronizations.
  const { BoardService } = await import("../worker/service.js?instance=quiet");
  const other = new BoardService(svc.puter, {
    now: () => clock.at,
    org: svc.org,
  });
  let refreshes = 0;
  const logSince = other.logSince.bind(other);
  other.logSince = (...args) => {
    refreshes++;
    return logSince(...args);
  };
  const notes = async () => {
    const { update } = await other.call(editor, { op: "sync", room });
    const doc = new SharedDocument(decode(update));
    const count = doc.snapshot().items.length;
    doc.destroy();
    return count;
  };
  for (let n = 0; n < 300; n++) {
    clock.at += 100;
    await commit(n);
    if (n % 16 === 15) await notes();
  }
  const { io, reset } = instrument(env);
  // Someone joins every second and a half, so each check lists the log.
  const quiet = async () => {
    clock.at += 1600;
    await svc.notify(room);
    return notes();
  };
  while (clock.at < Date.UTC(2026, 9, 5, 12, 0, 48)) await quiet();
  // Fifteen seconds after the burst, the busy minute is still read.
  reset();
  refreshes = 0;
  while (clock.at < Date.UTC(2026, 9, 5, 12, 0, 58))
    assert.equal(await quiet(), 301);
  assert.ok(refreshes >= 5, `refreshes ${refreshes}`);
  const rows = io.rows.log / refreshes;
  assert.ok(rows <= 20, `log rows read per refresh ${rows}`);
  // A burst through the first instance is still read in full.
  for (let n = 0; n < 150; n++) {
    clock.at += 10;
    await commit(300 + n);
  }
  clock.at += 1600;
  assert.equal(await notes(), 451);
});

test("reopening a board after a week reads the edits since its checkpoint, not its whole history", async () => {
  const clock = { at: Date.UTC(2026, 0, 1) };
  const { env, svc, room, commit } = await busyBoard(clock);
  for (let n = 0; n < 1000; n++) {
    clock.at += 1000;
    await commit(n);
  }
  // A day later an edit renews the checkpoint, and one more follows.
  clock.at += DAY;
  await commit(1000);
  assert.ok(env.data.get(`wb:${room}:cp`).at >= clock.at - 1000);
  clock.at += 60_000;
  await commit(1001);
  clock.at += 8 * DAY;
  const { io } = instrument(env);
  const { BoardService } = await import("../worker/service.js?instance=week");
  const other = new BoardService(svc.puter, {
    now: () => clock.at,
    org: svc.org,
  });
  const { doc } = await other.load(room);
  assert.equal(doc.snapshot().items.length, 1003);
  doc.destroy();
  assert.ok(io.rows.log <= 200, `log rows read ${io.rows.log}`);
});

test("loading or refreshing a board reads its new edits in one listing however long they span", async () => {
  const clock = { at: Date.UTC(2026, 9, 5, 0, 0, 0) };
  const { env, svc, room, commit } = await busyBoard(clock);
  // An edit an hour, the first few hours after a checkpoint.
  for (let n = 0; n < 20; n++) {
    clock.at += 3600_000;
    await commit(n);
  }
  assert.ok(env.data.get(`wb:${room}:cp`).at < clock.at - 12 * 3600_000);
  const { counts, reset } = instrument(env);
  const { BoardService } = await import("../worker/service.js?instance=span");
  const other = new BoardService(svc.puter, {
    now: () => clock.at,
    org: svc.org,
  });
  const { doc } = await other.load(room);
  assert.equal(doc.snapshot().items.length, 21);
  doc.destroy();
  assert.equal(counts.list, 1);
  // Read again after twenty quiet minutes, with an edit saved meanwhile
  // through the first instance.
  clock.at += 20 * 60_000;
  await commit(20);
  clock.at += 1000;
  reset();
  const { update } = await other.call(editor, { op: "sync", room });
  const copy = new SharedDocument(decode(update));
  assert.equal(copy.snapshot().items.length, 22);
  copy.destroy();
  assert.equal(counts.list, 1);
});

test("an instance lists a board at most once a second for callers told of saves, who share each listing", async () => {
  const clock = { at: Date.UTC(2026, 9, 5, 12, 0, 0) };
  const { svc, room, edit } = await busyBoard(clock);
  // Saves reach another instance, whose clock waits only as long as it
  // is told to.
  const { BoardService } = await import("../worker/service.js?instance=pace");
  const other = new BoardService(svc.puter, {
    now: () => clock.at,
    org: svc.org,
  });
  const waited = [],
    listed = [];
  other.wait = async (ms, signal) => {
    // Listings here answer at once, never as late as a caller waits for.
    if (signal) return new Promise(() => {});
    waited.push(ms);
    clock.at += ms;
  };
  const logSince = other.logSince.bind(other);
  other.logSince = (...args) => {
    listed.push(clock.at);
    return logSince(...args);
  };
  await other.call(editor, { op: "sync", room });
  const told = async (n) => {
    clock.at += 200;
    const { receipt } = await edit((b) =>
      b.items.push(item("note", n * 10, 0, { text: `n${n}` })),
    );
    return other.call(editor, {
      op: "sync",
      room,
      noticed: true,
      ids: [receipt.id],
    });
  };
  // One after another, each waits for the next listing.
  for (let n = 0; n < 5; n++) assert.deepEqual((await told(n)).missing, []);
  assert.equal(listed.length, 6);
  for (let n = 2; n < listed.length; n++)
    assert.ok(listed[n] - listed[n - 1] >= 1000, JSON.stringify(listed));
  assert.ok(Math.max(...waited) <= 1000);
  // Together, they share one.
  const all = await Promise.all([5, 6, 7, 8].map(told));
  for (const { missing } of all) assert.deepEqual(missing, []);
  assert.ok(listed.length <= 8, `${listed.length} listings`);
});

test("polls of a board no one changes read its signal, and list its edits about once a minute", async () => {
  const clock = { at: Date.UTC(2026, 9, 5, 12, 0, 0) };
  const { env, svc, room, commit } = await busyBoard(clock);
  await commit(0);
  const { counts } = instrument(env);
  // A poll every two seconds for two minutes, as from a few people.
  for (let n = 0; n < 60; n++) {
    clock.at += 2000;
    const { update } = await svc.call(editor, { op: "sync", room });
    const doc = new SharedDocument(decode(update));
    assert.equal(doc.snapshot().items.length, 2);
    doc.destroy();
  }
  assert.ok(counts.list <= 4, `${counts.list} listings`);
});

test("a board's search text is written again only when it changes", async () => {
  const clock = { at: Date.UTC(2026, 9, 5, 12, 0, 0) };
  const { env, svc, room, commit, edit } = await busyBoard(clock);
  const key = `org:idx:${room}`;
  await commit(0);
  const writes = [];
  const set = svc.kv.set.bind(svc.kv);
  svc.kv.set = (...args) => (writes.push(args[0]), set(...args));
  const activity = async (change) => {
    clock.at += 61_000;
    writes.length = 0;
    await edit(change);
    assert.equal(env.data.get(`org:board:${room}`).lastActivity, clock.at);
    return writes.includes(key);
  };
  // Moving a note leaves the text as it was.
  assert.equal(await activity((b) => (b.items[1].x += 10)), false);
  assert.equal(env.data.get(key), "start\nn0");
  assert.equal(await activity((b) => (b.items[1].text = "moved")), true);
  assert.equal(env.data.get(key), "start\nmoved");
  // Text another instance stored since is written over.
  env.data.set(key, "start\nolder");
  assert.equal(await activity((b) => (b.items[1].x += 10)), true);
  assert.equal(env.data.get(key), "start\nmoved");
});

// The same numbers every run.
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Actions run in the order of a simulated clock, each given a few turns of
// the event loop to reach its next storage request.
function timeline(clock) {
  const heap = [];
  let order = 0;
  const before = (a, b) => a.at < b.at || (a.at === b.at && a.order < b.order);
  const swap = (i, j) => ([heap[i], heap[j]] = [heap[j], heap[i]]);
  const at = (time, run) => {
    heap.push({ at: time, order: order++, run });
    for (let i = heap.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      if (!before(heap[i], heap[parent])) break;
      swap(i, parent);
      i = parent;
    }
  };
  const next = () => {
    const top = heap[0],
      last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < heap.length && before(heap[l], heap[m])) m = l;
        if (r < heap.length && before(heap[r], heap[m])) m = r;
        if (m === i) break;
        swap(i, m);
        i = m;
      }
    }
    return top;
  };
  const settle = async () => {
    for (let n = 0; n < 6; n++) await new Promise((r) => setImmediate(r));
  };
  const step = async () => {
    const { at: when, run } = next();
    clock.at = Math.max(clock.at, when);
    run();
    await settle();
  };
  return {
    at,
    wait: (ms) => new Promise((r) => at(clock.at + ms, r)),
    async until(time) {
      while (heap.length && heap[0].at <= time) await step();
      clock.at = Math.max(clock.at, time);
    },
    // Runs until everything started has finished.
    async drain(pending) {
      while (pending.size) {
        if (heap.length) await step();
        else await settle();
      }
    },
  };
}
// Storage request times, and how long a write takes to show in listings.
const LATENCY = {
  get: 10,
  set: 20,
  update: 20,
  incr: 15,
  del: 15,
  expire: 10,
  list: 60,
};
const LAG = 600;

// A worker serving a 300-person room through three instances for a minute,
// with `quiet` five-person boards beside it. Everyone checks in every 40 to
// 45 seconds (20 to 25 on the quiet boards, polling at the same time), polls
// every 20 to 45, and 40 editors save about eight edits a second between
// them. `named` people told of each save by a peer's "committed" notice, but
// without its edit, synchronize naming its record 150 to 400 ms later.
// Requests reach a random instance. `sticky` models clients from before
// notices naming records were cleared once their edits arrived: every poll
// says it follows an unnamed notice and carries the time of the last save.
// Given `joins`, someone new joins the room that often, in milliseconds.
async function simulateMinute({
  quiet = 0,
  named = 2,
  sticky = false,
  quota = Infinity,
  joins = 0,
  label,
  seed = 7,
}) {
  const rng = random(seed);
  const between = (a, b) => a + rng() * (b - a);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const env = environment();
  const { counts, reset } = instrument(env);
  const kv = env.service.puter.kv;
  const clock = { at: Date.UTC(2026, 9, 5, 12, 0, 0) };
  const line = timeline(clock);
  const shown = new Map(),
    set = kv.set,
    list = kv.list;
  kv.set = (key, ...args) => {
    if (!shown.has(key)) shown.set(key, clock.at + LAG);
    return set(key, ...args);
  };
  kv.list = async (options) => {
    const page = await list(options);
    page.items = page.items.filter(
      (i) => (shown.get(typeof i === "string" ? i : i.key) ?? 0) <= clock.at,
    );
    return page;
  };
  // Puter's listing quota, as its SDK meets it: a refused request is sent
  // again after 250 ms, 500 ms, a second and five times two seconds, then
  // fails.
  const granted = [];
  const admit = async () => {
    for (const retry of [250, 500, 1000, 2000, 2000, 2000, 2000, 2000, 0]) {
      while (granted.length && granted[0] <= clock.at - 60_000) granted.shift();
      if (granted.length < quota) return void granted.push(clock.at);
      if (!retry) break;
      await line.wait(retry);
    }
    throw {
      error: "Too many requests.",
      message: "Too many requests.",
      code: "too_many_requests",
    };
  };
  // Requests by method and kind of record, such as "list log", or for a get
  // of several keys, each kind it read, as "get meta+member".
  const kinds = {};
  const kindOf = (key) => {
    const parts = key.split(":");
    return parts[0] === "wb" ? parts[2] : parts.slice(0, 2).join(":");
  };
  const lists = { inFlight: 0, peak: 0, instances: {} };
  const { OrgService } = await import("../worker/org.js");
  const instances = [];
  for (const name of ["a", "b", "c"]) {
    const { BoardService } = await import(
      `../worker/service.js?instance=minute-${label}-${name}`
    );
    const own = (lists.instances[name] = { count: 0, inFlight: 0, peak: 0 });
    const slow = {};
    for (const [method, ms] of Object.entries(LATENCY))
      slow[method] = async (...args) => {
        const listing = method === "list",
          keys = listing ? [args[0].pattern] : [args[0]].flat().map(String),
          kind = `${method} ${keys.map(kindOf).join("+")}`;
        kinds[kind] = (kinds[kind] || 0) + 1;
        if (listing) {
          own.count++;
          lists.peak = Math.max(lists.peak, ++lists.inFlight);
          own.peak = Math.max(own.peak, ++own.inFlight);
        }
        try {
          if (listing) await admit();
          await line.wait(ms / 2);
          const result = await kv[method](...args);
          await line.wait(ms / 2);
          return result;
        } finally {
          if (listing) {
            lists.inFlight--;
            own.inFlight--;
          }
        }
      };
    const puter = { ...env.service.puter, kv: slow };
    const org = new OrgService(puter, { now: () => clock.at });
    const svc = new BoardService(puter, { now: () => clock.at, org });
    svc.wait = (ms) => line.wait(ms);
    instances.push({ svc, org });
  }
  const { publicKey } = await keyPair();
  let start = Infinity,
    end = Infinity;
  // The longest any synchronization, commit or check-in took, and how many
  // synchronizations named back records the instance still lacked.
  const slowest = {},
    answered = { syncs: 0, lacking: 0 };
  const timed = (input, call) => {
    const began = clock.at;
    return call.then((result) => {
      if (began < start || began >= end) return result;
      slowest[input.op] = Math.max(slowest[input.op] || 0, clock.at - began);
      if (input.op === "sync" && input.ids) {
        answered.syncs++;
        if (result.missing?.length) answered.lacking++;
      }
      return result;
    });
  };
  const failures = {};
  const pending = new Set();
  const track = (call) => {
    pending.add(call);
    call.finally(() => pending.delete(call));
    return call;
  };
  // Refused commits building on edits an instance lacks are sent again.
  let retried = 0;
  const request = (user, input) =>
    track(
      timed(input, pick(instances).svc.call(user, input)).catch((error) => {
        if (error.status === 409) retried++;
        else failures[error.status] = (failures[error.status] || 0) + 1;
        return { error };
      }),
    );
  const setUp = async (title, people) => {
    const b = board(title),
      seed = new SharedDocument();
    b.items = [item("note", 0, 0, { text: "start" })];
    seed.commit(b);
    const update = encode(seed.update());
    seed.destroy();
    await env.service.call(owner, { op: "create", room: b.id, update });
    const room = { id: b.id, update, people: [], saved: 0, last: 0 };
    for (let n = 0; n < people; n++) {
      const person = {
        uuid: `${title}-${n}`,
        username: `${title} ${n}`,
        session: `${title}-session-${n}`,
      };
      room.people.push(person);
      env.data.set(`wb:${b.id}:member:${person.uuid}`, {
        uuid: person.uuid,
        username: person.username,
        role: "editor",
      });
      env.data.set(`wb:${b.id}:presence:${person.session}`, {
        room: b.id,
        session: person.session,
        user: person.uuid,
        username: person.username,
        role: "editor",
        publicKey,
        topology: 2,
        group: Math.floor(n / 32),
        since: clock.at,
        expires: clock.at + between(50_000, 90_000),
        invite: null,
      });
      // As after a while on the board.
      for (const { org } of instances)
        org.instance.touched.set(person.uuid, clock.at);
    }
    return room;
  };
  const busy = await setUp("busy", 300);
  const rooms = [busy];
  for (let n = 0; n < quiet; n++) rooms.push(await setUp(`quiet${n}`, 5));
  start = clock.at + 10_000;
  end = start + 60_000;
  const sync = (room, person, extra = {}) =>
    request(person, { op: "sync", room: room.id, ...extra });
  const poll = (room, person) =>
    sync(
      room,
      person,
      sticky && room.last ? { noticed: true, after: room.last } : {},
    );
  const checkIn = (room, person) =>
    request(person, {
      op: "presence",
      room: room.id,
      session: person.session,
      publicKey,
      topology: 2,
    });
  const editor = (room, person) => ({
    room,
    person,
    doc: new SharedDocument(decode(room.update)),
    count: 0,
  });
  // How long edits made in the minute took to save, retries included.
  const delays = [];
  const save = async (e, id, update, notify, made = clock.at) => {
    const result = await request(e.person, {
      op: "commit",
      room: e.room.id,
      id,
      update,
    });
    if (result.error?.status === 409) {
      line.at(clock.at + 1500, () => save(e, id, update, notify, made));
      return;
    }
    if (result.error) return;
    if (made >= start && made < end) delays.push(clock.at - made);
    e.room.saved++;
    e.room.last = result.serverTime;
    notify(id, result.serverTime);
  };
  const edit = (e, notify) => {
    const vector = e.doc.vector(),
      next = e.doc.snapshot();
    next.items.push(
      item("note", e.count * 10, 0, { text: `${e.person.uuid} ${e.count++}` }),
    );
    e.doc.commit(next);
    const update = e.doc.update(vector);
    return track(
      hash(update).then((id) => save(e, id, encode(update), notify)),
    );
  };
  // Each instance loads the boards and lists who is present, and each
  // editor saves once.
  for (const room of rooms)
    for (const { svc } of instances) {
      line.at(clock.at + between(0, 2000), () =>
        track(svc.call(owner, { op: "sync", room: room.id })),
      );
      const person = pick(room.people);
      line.at(clock.at + between(0, 2000), () =>
        track(
          svc.call(person, {
            op: "presence",
            room: room.id,
            session: person.session,
            publicKey,
            topology: 2,
          }),
        ),
      );
    }
  const editors = busy.people.slice(0, 40).map((p) => editor(busy, p));
  const toldOf = (room) => (id, at) => {
    for (let n = 0; n < named; n++)
      line.at(clock.at + between(150, 400), () =>
        sync(room, pick(room.people), { noticed: true, ids: [id], after: at }),
      );
  };
  for (const e of editors)
    line.at(clock.at + between(2000, 8000), () => edit(e, () => {}));
  for (const room of rooms) {
    const large = room.people.length > 30;
    for (const person of room.people) {
      let at = start + between(0, large ? 45_000 : 25_000);
      while (at < end) {
        line.at(at, () => checkIn(room, person));
        if (!large) line.at(at, () => poll(room, person));
        at += large ? between(40_000, 45_000) : between(20_000, 25_000);
      }
      if (!large) continue;
      for (
        let at = start + between(0, 45_000);
        at < end;
        at += between(20_000, 45_000)
      )
        line.at(at, () => poll(room, person));
    }
  }
  for (const e of editors)
    for (let at = start + between(0, 5000); at < end; at += between(4500, 5500))
      line.at(at, () => edit(e, toldOf(busy)));
  if (joins) {
    const { token } = await env.service.call(owner, {
      op: "invite",
      room: busy.id,
      role: "editor",
    });
    for (let at = start, n = 0; at < end; at += joins, n++)
      line.at(at, () =>
        request(
          { uuid: `joining-${n}`, username: `Joining ${n}` },
          { op: "join", room: busy.id, token },
        ),
      );
  }
  // Someone on each quiet board saves once; the others' board events then
  // have them synchronize.
  for (const room of rooms.slice(1)) {
    const e = editor(room, room.people[0]);
    editors.push(e);
    line.at(start + between(5000, 55_000), () =>
      edit(e, () => {
        for (const person of room.people.slice(1))
          line.at(clock.at + between(150, 400), () => poll(room, person));
      }),
    );
  }
  let measured;
  line.at(start, () => {
    reset();
    for (const key in kinds) delete kinds[key];
    for (const own of Object.values(lists.instances)) {
      own.count = 0;
      own.peak = own.inFlight;
    }
    lists.peak = lists.inFlight;
  });
  line.at(end, () => {
    const others = ["get", "set", "update", "incr", "del"];
    measured = {
      lists: counts.list,
      perInstance: Object.values(lists.instances).map((i) => i.count),
      peak: lists.peak,
      peakPerInstance: Math.max(
        ...Object.values(lists.instances).map((i) => i.peak),
      ),
      // Other requests a second.
      gets: counts.get / 60,
      sets: counts.set / 60,
      others: others.reduce((n, k) => n + counts[k], 0) / 60,
      kinds: { ...kinds },
      failures: { ...failures },
    };
  });
  await line.until(end);
  await line.drain(pending);
  delays.sort((a, b) => a - b);
  Object.assign(measured, {
    retried,
    slowest,
    answered,
    saving: {
      median: delays[Math.floor(delays.length / 2)],
      p95: delays[Math.floor(delays.length * 0.95)],
      most: delays.at(-1),
    },
  });
  // Every saved edit reaches every instance, once there are listings to
  // spare.
  await line.until(clock.at + (quota < Infinity ? 60_000 : 5000));
  measured.notes = [];
  for (const { svc } of instances) {
    const call = track(svc.call(owner, { op: "sync", room: busy.id }));
    await line.drain(pending);
    const doc = new SharedDocument(decode((await call).update));
    measured.notes.push(doc.snapshot().items.length);
    doc.destroy();
  }
  measured.saved = busy.saved + 1;
  for (const e of editors) e.doc.destroy();
  return measured;
}

test("a minute of a 300-person room on three instances loses no edit, keeps within Puter's listing quota, and slows gently past it", async (t) => {
  const alone = await simulateMinute({ label: "alone" });
  const shared = await simulateMinute({ label: "shared", quiet: 5 });
  // Puter allows a worker 240 listings a minute on paid plans and 120 on
  // free ones.
  const paid = await simulateMinute({ label: "paid", quiet: 5, quota: 240 });
  const free = await simulateMinute({ label: "free", quiet: 5, quota: 120 });
  // Another order of events, in which commits refused together once each
  // listed the log and kept an instance behind past the minute.
  const freeAgain = await simulateMinute({
    label: "free-again",
    quiet: 5,
    quota: 120,
    seed: 5,
  });
  const joining = await simulateMinute({ label: "joining", joins: 3000 });
  const report = JSON.stringify({
    alone,
    shared,
    paid,
    free,
    freeAgain,
    joining,
  });
  t.diagnostic(report);
  for (const minute of [alone, shared, paid, free, freeAgain, joining]) {
    assert.deepEqual(minute.failures, {}, report);
    assert.ok(minute.saved >= 500, report);
    assert.deepEqual(
      minute.notes,
      [minute.saved, minute.saved, minute.saved],
      report,
    );
    // Puter allows five listings at once, per worker.
    assert.ok(minute.peakPerInstance <= 2, report);
    // Nobody waits long for a listing.
    assert.ok(minute.slowest.sync <= 4500, report);
    assert.ok(minute.slowest.presence <= 4500, report);
  }
  assert.ok(alone.lists <= 230, report);
  assert.ok(shared.lists <= 300, report);
  // An access check reads what it cannot reuse in one request, and keeps
  // records while their access stamps are unchanged.
  assert.ok(alone.gets <= 30, report);
  assert.ok(shared.gets <= 35, report);
  // Joining leaves the board's access stamp.
  assert.ok(joining.gets <= 33, report);
  assert.ok(paid.saving.p95 <= 3000, report);
});

test("people joining a board together share its member counts, which stay right", async () => {
  const env = environment(),
    svc = env.service;
  const b = board("Joins"),
    seed = new SharedDocument();
  seed.commit(b);
  await svc.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  await svc.call(owner, { op: "settings", room: b.id, visibility: "link" });
  const list = svc.kv.list;
  let listings = 0;
  svc.kv.list = (options) => {
    if (options.pattern.startsWith(`wb:${b.id}:member:`) && !options.cursor)
      listings++;
    return list(options);
  };
  try {
    await Promise.all(
      Array.from({ length: 30 }, (_, n) =>
        svc.call(
          {
            uuid: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`,
            username: "P" + n,
          },
          { op: "join", room: b.id },
        ),
      ),
    );
  } finally {
    svc.kv.list = list;
  }
  assert.ok(listings <= 4, `${listings} member listings`);
  assert.equal((await svc.kv.get("org:board:" + b.id)).memberCount, 31);
});

test("listing a large board's members on a new instance reads their records together", async () => {
  const env = environment(),
    svc = env.service;
  const b = board("Roster"),
    seed = new SharedDocument();
  seed.commit(b);
  await svc.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  await svc.org.saveUser({
    uuid: owner.uuid,
    username: owner.username,
    role: "member",
    status: "active",
    teams: [],
  });
  for (let n = 0; n < 300; n++) {
    const uuid = `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
    env.data.set("org:user:" + uuid, {
      uuid,
      username: "P" + n,
      role: n % 10 ? "member" : "guest",
      status: n === 1 ? "deactivated" : "active",
      teams: [],
    });
    env.data.set(`wb:${b.id}:member:${uuid}`, {
      uuid,
      username: "P" + n,
      role: "editor",
      joined: env.now,
    });
  }
  // Another instance, which has read none of these records.
  const kv = svc.kv,
    reads = [];
  const fresh = new BoardService(
    {
      ...svc.puter,
      kv: {
        ...kv,
        get: (key) => (reads.push(key), kv.get(key)),
        list: kv.list.bind(kv),
      },
    },
    { now: () => env.now },
  );
  const { members } = await fresh.call(owner, { op: "members", room: b.id });
  assert.equal(members.length, 301);
  assert.equal(members.filter((m) => m.guest).length, 30);
  assert.equal(members.filter((m) => m.inactive).length, 1);
  assert.ok(reads.length <= 5, `${reads.length} reads`);
});

test("two instances admitting people at once leave the board's member count right", async () => {
  const { viewer } = await import("./collaboration-helpers.js");
  const env = environment();
  const b = board("Count");
  b.items = [item("note", 0, 0)];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  seed.destroy();
  // A second worker instance: its own memory, the same storage.
  const { BoardService } = await import("../worker/service.js?instance=count");
  const first = env.service;
  const second = new BoardService(first.puter, {
    now: () => env.now,
    fetcher: first.fetcher,
  });
  // Both listed the members moments before, as when comments were opened.
  await first.members(b.id, { shared: true });
  await second.members(b.id, { shared: true });
  env.now += 1000;
  await first.setMember(
    b.id,
    { uuid: editor.uuid, username: editor.username, role: "editor" },
    true,
  );
  await first.recount(b.id);
  await second.setMember(
    b.id,
    { uuid: viewer.uuid, username: viewer.username, role: "viewer" },
    true,
  );
  await second.recount(b.id);
  const registry = await env.service.kv.get("org:board:" + b.id);
  assert.equal(registry.memberCount, 3);
});
