import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { board, item } from "../src/model.js";
for (const mode of [
  "accept",
  "reject",
  "activated while waiting",
  "throw",
  "default",
  "deleted",
])
  test(`a guarded local read preserves the edit conflict boundary when ${mode}`, async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    globalThis.indexedDB = new IDBFactory();
    try {
      const { local } = await import(
          "../src/storage.js?read-guard-own=" + mode
        ),
        { local: foreign } = await import(
          "../src/storage.js?read-guard-foreign=" + mode
        );
      const original = board("Original cached copy");
      original.updated = 100;
      original.items.push(
        item("note", 0, 0, { text: "Original own note", lang: "en-CA" }),
      );
      await local.save(original);
      const remote = await foreign.get(original.id);
      remote.title = "Foreign latest copy";
      remote.updated = 200;
      remote.items.push(
        item("note", 200, 0, {
          text: "Foreign authored addition",
          lang: "fr-CA",
        }),
      );
      if (mode === "deleted") await foreign.remove(remote.id);
      else await foreign.save(remote);
      let cached = original,
        active = mode === "reject",
        called = false;
      const read =
        mode === "default"
          ? local.get(original.id)
          : local.get(original.id, {
              accept: (latest) => {
                called = true;
                if (mode === "throw")
                  throw Error("View no longer accepts recovery");
                if (active) return false;
                cached = latest;
                return true;
              },
            });
      if (mode === "activated while waiting") active = true;
      if (mode === "throw")
        await assert.rejects(read, /no longer accepts recovery/);
      else {
        const latest = await read;
        if (mode === "default") cached = latest;
        if (mode === "deleted") assert.equal(latest, undefined);
        else assert.equal(latest.title, remote.title);
      }
      if (mode === "accept") assert.equal(called, true);
      if (mode === "deleted") assert.equal(called, false);
      cached.title = "New own edit";
      cached.updated = 300;
      if (
        ["reject", "activated while waiting", "throw", "deleted"].includes(mode)
      )
        await assert.rejects(local.save(cached), {
          name: mode === "deleted" ? "DeletedBoardError" : "StaleBoardError",
        });
      else {
        assert.deepEqual(cached.items, remote.items);
        await local.save(cached);
        assert.equal((await local.get(original.id)).title, cached.title);
      }
      const actual = await foreign.get(original.id);
      if (mode === "deleted") assert.equal(actual, undefined);
      else {
        assert.deepEqual(actual.items, remote.items);
        if (["reject", "activated while waiting", "throw"].includes(mode))
          assert.equal(actual.title, remote.title);
      }
    } finally {
      if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
      else delete globalThis.indexedDB;
    }
  });
