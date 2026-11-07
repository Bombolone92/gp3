import test from "node:test";
import assert from "node:assert/strict";
import { CloudStore } from "../src/storage.js";
import { board } from "../src/model.js";

test("cloud uses files, serializes writes, and captures the intended snapshot", async () => {
  const events = [];
  let release;
  const wait = new Promise((r) => (release = r));
  const store = new CloudStore({
    fs: {
      read: async () => {
        throw { code: "subject_does_not_exist" };
      },
      readdir: async () => [],
      write: async (path, data, options) => {
        if (path.endsWith("catalog.json")) return;
        events.push({ path, data: JSON.parse(data), options });
        if (events.length === 1) await wait;
      },
    },
    kv: new Proxy(
      {},
      {
        get() {
          throw Error("KV must not store board files");
        },
      },
    ),
  });
  const b = board("First");
  store.catalog = [];
  const first = store.save(b);
  b.title = "Second";
  const second = store.save(b);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, 1);
  assert.equal(events[0].data.title, "First");
  release();
  await Promise.all([first, second]);
  assert.equal(events[1].data.title, "Second");
  assert.equal(events[1].options.createMissingParents, true);
});
test("a failed write is surfaced but does not poison the next save", async () => {
  let calls = 0;
  const store = new CloudStore({
    fs: {
      read: async () => {
        throw { code: "subject_does_not_exist" };
      },
      readdir: async () => [],
      write: async (path) => {
        if (path.endsWith("catalog.json")) return;
        if (++calls === 1) throw Error("Offline");
      },
    },
  });
  await assert.rejects(store.save(board()), /Offline/);
  await store.save(board());
  assert.equal(calls, 2);
});
test("missing folder is empty, but permissions and service failures are surfaced", async () => {
  const missing = new CloudStore({
    fs: {
      read: async () => {
        throw { code: "subject_does_not_exist" };
      },
      readdir: async () => [],
      readdir: async () => {
        throw { code: "subject_does_not_exist" };
      },
    },
  });
  assert.deepEqual(await missing.list(), []);
  const denied = new CloudStore({
    fs: {
      read: async () => {
        throw { code: "subject_does_not_exist" };
      },
      readdir: async () => [],
      readdir: async () => {
        throw Error("Permission denied");
      },
    },
  });
  await assert.rejects(denied.list(), /Permission denied/);
});
test("cloud listing filters out unrelated files and directories", async () => {
  const b = board();
  const store = new CloudStore({
    fs: {
      read: async () => {
        throw { code: "subject_does_not_exist" };
      },
      readdir: async () => [],
      readdir: async () => [
        { name: b.id + ".json" },
        { name: "notes.txt" },
        { name: "folder", is_dir: true },
      ],
    },
  });
  assert.equal((await store.list()).length, 1);
});
test("cloud reads validate content before allowing it into the editor", async () => {
  const store = new CloudStore({
    fs: {
      read: async () => {
        throw { code: "subject_does_not_exist" };
      },
      readdir: async () => [],
      read: async () => new Blob(['{"items":[]}']),
    },
  });
  await assert.rejects(store.read("board.json"), /supported Whiteboard/);
});

test("catalog reads do not download board content; normal autosaves do not rewrite metadata", async () => {
  const b = board("A named board");
  const writes = [],
    reads = [];
  const store = new CloudStore({
    fs: {
      read: async (path) => {
        reads.push(path);
        return new Blob([JSON.stringify([{ id: b.id, title: b.title }])]);
      },
      write: async (path) => writes.push(path),
    },
  });
  const files = await store.list();
  assert.equal(files[0].title, b.title);
  assert.deepEqual(reads, ["whiteboard/catalog.json"]);
  await store.save(b);
  assert.deepEqual(writes, [`whiteboard/${b.id}.json`]);
  b.title = "Renamed";
  await store.save(b);
  assert.equal(writes.at(-1), "whiteboard/catalog.json");
});

test("opening the cloud picker while saving cannot replace the updated index with a late read", async () => {
  const files = new Map([["whiteboard/catalog.json", "[]"]]);
  let reads = 0,
    release;
  const delayed = new Promise((resolve) => (release = resolve));
  const store = new CloudStore({
    fs: {
      read: async (path) => {
        const snapshot = files.get(path);
        if (++reads === 1) await delayed;
        return new Blob([snapshot]);
      },
      write: async (path, data) => files.set(path, data),
    },
  });
  const first = board("First saved board"),
    listing = store.list(),
    saving = store.save(first);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([listing, saving]);
  assert.deepEqual(
    (await store.list()).map((f) => f.title),
    [first.title],
    "A late listing must not erase the saved board from the cached index",
  );
  assert.equal(reads, 1, "Concurrent initialization shares one request");
  const second = board("Second saved board");
  await store.save(second);
  assert.deepEqual(
    JSON.parse(files.get("whiteboard/catalog.json")).map((b) => b.id),
    [first.id, second.id],
    "The next save preserves both index entries",
  );
});

test("a failed shared cloud index request rejects every waiter and can be retried", async () => {
  let reads = 0;
  const unavailable = Error("Offline"),
    store = new CloudStore({
      fs: {
        read: async () => {
          if (++reads === 1) throw unavailable;
          return new Blob(["[]"]);
        },
        write: async () => {},
      },
    }),
    results = await Promise.allSettled([store.list(), store.list()]);
  assert.equal(reads, 1);
  for (const result of results) {
    assert.equal(result.status, "rejected");
    assert.equal(result.reason, unavailable);
  }
  const b = board("Recovered after retry");
  await store.save(b);
  assert.equal(reads, 2);
  assert.equal((await store.list())[0].title, b.title);
});

test("malformed cloud index rows are rejected as an invalid index without coercing identifiers", async () => {
  const b = board("Valid board");
  for (const row of [
    { id: [b.id], title: b.title },
    null,
    {},
    7,
    "row",
    { id: b.id, title: 7 },
  ]) {
    const store = new CloudStore({
      fs: {
        read: async () => new Blob([JSON.stringify([row])]),
      },
    });
    await assert.rejects(store.list(), /The cloud board index is invalid/);
  }
});
