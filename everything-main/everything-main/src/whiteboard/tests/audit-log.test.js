import test from "node:test";
import assert from "node:assert/strict";
import { OrgService } from "../worker/org.js";
import { environment, owner } from "./collaboration-helpers.js";

test("concurrent requests retry every refused audit record without dropping or delivering duplicates", async () => {
  const { service } = environment();
  const org = service.org;
  const other = new OrgService(org.puter, { now: org.now });
  const set = org.kv.set.bind(org.kv);
  org.kv.set = async () => {
    throw Error("storage unavailable");
  };
  const first = await org.audit(owner, "policy.first");
  const second = await org.audit(owner, "policy.second");
  assert.equal(org.instance.unsaved.length, 2);

  let release, began;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    began = resolve;
  });
  let blocked = false;
  org.kv.set = async (key, value) => {
    if (!blocked && key === "org:audit:" + first.id) {
      blocked = true;
      began();
      await held;
    }
    return set(key, value);
  };
  const one = org.retryUnsaved(1);
  await started;
  const two = other.retryUnsaved(1);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([one, two]);
  await org.retryUnsaved();
  assert.equal(
    (await org.kv.get("org:audit:" + second.id))?.action,
    "policy.second",
  );
  assert.deepEqual(
    [...org.pending, ...other.pending].map((entry) => entry.id).sort(),
    [first.id, second.id].sort(),
  );
  assert.equal(org.instance.unsaved.length, 0);
});

test("audit queries reject reversed date ranges before reading storage", async () => {
  const { adminCall } = await import("../worker/admin.js");
  const { service } = environment();
  let lists = 0;
  const list = service.org.kv.list.bind(service.org.kv);
  service.org.kv.list = (options) => {
    lists++;
    return list(options);
  };
  await assert.rejects(
    adminCall(service.org, service, owner, {
      op: "org.audit",
      from: "2026-09-20",
      to: "2026-09-19",
    }),
    { status: 400, message: "Invalid date range." },
  );
  assert.equal(lists, 0);
});

test("placing a board hold during audit retention preserves its activity records", async () => {
  const { purge } = await import("../worker/retention.js");
  const { DAY } = await import("../worker/org.js");
  const env = environment();
  const org = env.service.org;
  await org.registerBoard("held-board", { title: "Held", legalHold: false });
  const entry = await org.audit(owner, "board.created", {
    type: "board",
    id: "held-board",
  });
  env.now += 400 * DAY;
  const list = org.kv.list.bind(org.kv);
  let placed = false;
  org.kv.list = async (options) => {
    if (!placed && options.pattern === "org:audit:") {
      placed = true;
      await org.registerBoard("held-board", { legalHold: true });
    }
    return list(options);
  };
  await purge(org);
  assert.equal(await org.kv.get("org:audit:" + entry.id), null);
  assert.ok(await org.kv.get(`org:bact:held-board:${entry.id}`));
  assert.equal((await org.kv.get("org:board:held-board")).keptActivity, true);
});

test("audit retention batches fresh hold reads and can retry a refused activity deletion", async () => {
  const { purge } = await import("../worker/retention.js");
  const { DAY } = await import("../worker/org.js");
  const env = environment();
  const org = env.service.org;
  const entries = [];
  for (const room of ["one", "two", "three"]) {
    await org.registerBoard(room, { legalHold: false });
    entries.push(
      await org.audit(owner, "board.created", { type: "board", id: room }),
    );
  }
  env.now += 400 * DAY;
  const get = org.kv.get.bind(org.kv);
  const holdReads = [];
  org.kv.get = (key) => {
    if (Array.isArray(key) && key.some((k) => k.startsWith("org:board:")))
      holdReads.push(key);
    return get(key);
  };
  const del = org.kv.del.bind(org.kv);
  org.kv.del = async (key) => {
    if (key.startsWith("org:bact:")) throw Error("storage unavailable");
    return del(key);
  };
  await assert.rejects(purge(org), /storage unavailable/);
  for (const entry of entries)
    assert.ok(await org.kv.get("org:audit:" + entry.id));
  assert.equal(holdReads.length, 1);
  assert.equal(holdReads[0].length, 3);
  org.kv.del = del;
  await purge(org);
  for (const entry of entries) {
    assert.equal(await org.kv.get("org:audit:" + entry.id), null);
    assert.equal(await org.kv.get(`org:bact:${entry.board}:${entry.id}`), null);
  }
});

test("audit query bounds use the worker clock and are returned even when the log is empty", async () => {
  const { adminCall } = await import("../worker/admin.js");
  const { DAY } = await import("../worker/org.js");
  const env = environment();
  env.now = Date.parse("2026-10-06T12:00:00Z");
  const query = (data = {}) =>
    adminCall(env.service.org, env.service, owner, {
      op: "org.audit",
      ...data,
    });
  const empty = await query();
  assert.deepEqual(empty.range, {
    from: env.now - 30 * DAY,
    to: env.now,
    now: env.now,
  });
  assert.deepEqual(empty.entries, []);
  const entry = await env.service.org.audit(owner, "policy.clock-test");
  const result = await query();
  assert.deepEqual(result.range, empty.range);
  assert.deepEqual(
    result.entries.map((e) => e.id),
    [entry.id],
  );
  const past = await query({ to: "2026-09-01T00:00:00Z" });
  const to = Date.parse("2026-09-01T00:00:00Z");
  assert.deepEqual(past.range, { from: to - 30 * DAY, to, now: env.now });
});

test("SCIM user and group reads record their authenticated API access once per request", async () => {
  const { adminCall } = await import("../worker/admin.js");
  const { restRoute } = await import("../worker/api.js");
  const { editor } = await import("./collaboration-helpers.js");
  const { service } = environment();
  const org = service.org;
  await org.saveUser({
    ...editor,
    email: "bob@example.test",
    role: "member",
    status: "active",
  });
  await org.kv.set("org:team:read-team", {
    id: "read-team",
    name: "Read team",
    members: [editor.uuid],
    created: org.now(),
  });
  const makeKey = (scopes) =>
    adminCall(org, service, owner, {
      op: "apikeys.create",
      name: "SCIM reader",
      scopes,
    });
  const { key, record } = await makeKey(["scim"]);
  const read = (path, token = key) =>
    restRoute(
      org,
      service,
      new Request(`https://audit.puter.work/scim/v2/${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      "GET",
      path,
    );
  const paths = ["Users", `Users/${editor.uuid}`, "Groups", "Groups/read-team"];
  for (const path of paths) assert.equal((await read(path)).status, 200);
  const events = (await org.list("org:audit:"))
    .map((row) => row.value)
    .filter((e) => e.action === "api.read");
  assert.equal(events.length, paths.length);
  assert.deepEqual(
    events.map((e) => e.target.name).sort(),
    paths.map((path) => `/scim/v2/${path}`).sort(),
  );
  for (const event of events) {
    assert.equal(event.actor.uuid, `apikey-${record.id}`);
    assert.equal(event.actor.username, "API key: SCIM reader");
    assert.equal(event.category, "api");
    assert.deepEqual(event.details, { scope: "scim" });
  }
  for (const metadata of ["Schemas", "ResourceTypes", "ServiceProviderConfig"])
    assert.equal((await read(metadata)).status, 200);
  const { key: denied } = await makeKey(["audit:read"]);
  await assert.rejects(read("Users", denied), { status: 403 });
  await assert.rejects(read("Groups", "invalid-key"), { status: 401 });
  assert.equal(
    (await org.list("org:audit:")).filter(
      (row) => row.value.action === "api.read",
    ).length,
    paths.length,
  );
});

test("a filtered audit query reads a bounded number of records per request and pages on", async () => {
  const { adminCall } = await import("../worker/admin.js");
  const env = environment();
  env.now = Date.parse("2026-10-06T12:00:00Z");
  const org = env.service.org;
  // 12,000 events over five days; one person has a single event, the
  // oldest.
  for (let n = 0; n < 12_000; n++) {
    const at = env.now - 5 * 86_400_000 + n * 30_000;
    const id = `${new Date(at).toISOString()}:${String(n).padStart(8, "0")}`;
    env.data.set("org:audit:" + id, {
      id,
      at,
      time: new Date(at).toISOString(),
      category: "access",
      action: "board.joined",
      actor: { uuid: n ? "someone" : "rare" },
    });
  }
  let read = 0;
  const page = org.page.bind(org);
  org.page = async (options) => {
    const rows = await page(options);
    read += (Array.isArray(rows) ? rows : rows.items).length;
    return rows;
  };
  const found = [];
  let cursor = null,
    requests = 0;
  do {
    read = 0;
    const result = await adminCall(org, env.service, owner, {
      op: "org.audit",
      actor: "rare",
      ...(cursor ? { cursor } : {}),
    });
    assert.ok(read <= 5100, `${read} records read in one request`);
    found.push(...result.entries);
    assert.notEqual(result.cursor, cursor);
    cursor = result.cursor;
    requests++;
  } while (cursor && requests < 10);
  assert.deepEqual(
    found.map((e) => e.actor.uuid),
    ["rare"],
  );
  assert.equal(cursor, null);
});
