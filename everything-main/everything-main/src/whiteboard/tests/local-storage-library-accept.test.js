import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { board, item } from "../src/model.js";
function controlledLibraryChoiceStorage() {
  const indexedDB = new IDBFactory(),
    open = indexedDB.open.bind(indexedDB);
  let armed = false,
    quota = false,
    entered,
    callbacks = [],
    released = false,
    reached;
  indexedDB.open = (...args) => {
    const request = open(...args);
    request.addEventListener("success", () => {
      const db = request.result,
        transaction = db.transaction.bind(db);
      db.transaction = (...args) => {
        const tx = transaction(...args);
        if (armed && args[0] === "boards" && args[1] === "readwrite") {
          armed = false;
          for (const key of ["oncomplete", "onerror", "onabort"]) {
            let handler;
            Object.defineProperty(tx, key, {
              configurable: true,
              get: () => handler,
              set: (callback) => {
                handler = (event) => {
                  const run = () => callback.call(tx, event);
                  if (released) run();
                  else {
                    callbacks.push(run);
                    entered();
                  }
                };
              },
            });
          }
          if (quota) {
            const objectStore = tx.objectStore.bind(tx);
            tx.objectStore = (name) => {
              const store = objectStore(name),
                put = store.put.bind(store);
              store.put = (...values) => {
                const result = put(...values);
                tx.abort();
                tx.error = new DOMException(
                  "Device is full",
                  "QuotaExceededError",
                );
                return result;
              };
              return store;
            };
          }
        }
        return tx;
      };
    });
    return request;
  };
  return {
    indexedDB,
    hold(options = {}) {
      armed = true;
      quota = !!options.quota;
      released = false;
      callbacks = [];
      reached = new Promise((resolve) => (entered = resolve));
      return reached;
    },
    release() {
      armed = false;
      released = true;
      const pending = callbacks;
      callbacks = [];
      for (const run of pending) run();
    },
  };
}

for (const phase of [
  "default favorite",
  "default trash",
  "default restore",
  "accept favorite",
  "accept trash",
  "accept restore",
  "accept unchanged",
  "reject active",
  "queued own foreign",
  "queued own unchanged",
  "accepted read while waiting",
  "throw",
  "first library write",
  "deletion",
  "failed write",
])
  test(`library writes acknowledge only accepted content for ${phase}`, async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"),
      storage = controlledLibraryChoiceStorage();
    globalThis.indexedDB = storage.indexedDB;
    let pending, own;
    try {
      const source = "../src/storage.js";
      const { local } = await import(
          source + "?library-accept-own=" + encodeURIComponent(phase)
        ),
        { local: foreign } = await import(
          source + "?library-accept-foreign=" + encodeURIComponent(phase)
        );
      const original = board("Original own copy");
      original.updated = 100;
      original.favorite = false;
      original.items = [
        item("note", 0, 0, { text: "Original own note", lang: "en-CA" }),
      ];
      if (phase.endsWith("restore")) original.deletedAt = 1000;
      if (phase !== "first library write") await local.save(original);
      let remote;
      if (phase !== "first library write") {
        remote = await foreign.get(original.id);
        if (phase === "deletion") await foreign.remove(original.id);
        else if (
          !["accept unchanged", "queued own unchanged"].includes(phase)
        ) {
          remote.title = "Foreign authored title";
          remote.updated = 200;
          remote.items.push(
            item("note", 240, 0, {
              text: "Foreign note to preserve",
              lang: "fr-CA",
            }),
          );
          await foreign.save(remote);
        }
      }
      if (phase.endsWith("restore")) delete original.deletedAt;
      else if (phase.endsWith("trash")) original.deletedAt = 2000;
      else original.favorite = true;
      let cached = original,
        calls = 0;
      const accept = (latest, changed) => {
        calls++;
        assert.equal(
          changed,
          !["accept unchanged", "queued own unchanged"].includes(phase),
        );
        if (phase === "throw") throw Error("Recovery view rejected adoption");
        if (phase === "reject active") return false;
        cached = latest;
        return true;
      };
      const options = { library: true };
      if (!phase.startsWith("default")) options.accept = accept;
      const held = [
        "queued own foreign",
        "queued own unchanged",
        "accepted read while waiting",
        "first library write",
        "failed write",
      ].includes(phase);
      if (held) {
        const reached = storage.hold({ quota: phase === "failed write" });
        pending = local.save(original, options);
        pending.catch(() => {});
        await reached;
      } else if (phase === "deletion") {
        await assert.rejects(local.save(original, options), {
          name: "DeletedBoardError",
        });
        assert.equal(calls, 0);
        return;
      } else if (phase === "throw") {
        await assert.rejects(
          local.save(original, options),
          /rejected adoption/,
        );
      } else await local.save(original, options);
      if (phase.startsWith("queued own") || phase === "first library write") {
        cached.title = "Own draft made while waiting";
        cached.updated = 300;
        cached.items.push(
          item("note", 480, 0, { text: "Later own draft", lang: "en-CA" }),
        );
        const next = structuredClone(cached);
        own = local.save(next);
        own.catch(() => {});
        storage.release();
        await pending;
        pending = null;
        if (phase === "queued own foreign")
          await assert.rejects(own, { name: "StaleBoardError" });
        else {
          await own;
          const actual = await local.get(next.id);
          assert.equal(actual.title, next.title);
          assert.deepEqual(actual.items, next.items);
        }
        own = null;
        assert.equal(
          calls,
          0,
          "A waiting older library copy cannot adopt or acknowledge content on behalf of a newer queued edit.",
        );
      } else if (phase === "accepted read while waiting") {
        const newer = await foreign.get(original.id);
        newer.title = "Later foreign title";
        newer.updated = 400;
        newer.items.push(
          item("note", 480, 0, {
            text: "Even later foreign note",
            lang: "fr-CA",
          }),
        );
        await foreign.save(newer);
        cached = await local.get(original.id);
        storage.release();
        await pending;
        pending = null;
        assert.equal(
          calls,
          0,
          "An older completion cannot replace a copy already accepted by a later read.",
        );
        cached.title = "Own edit after accepted newer read";
        cached.updated = 500;
        await local.save(cached);
        assert.deepEqual((await foreign.get(cached.id)).items, newer.items);
      } else if (phase === "failed write") {
        storage.release();
        await assert.rejects(pending, { name: "QuotaExceededError" });
        pending = null;
        assert.equal(calls, 0);
        assert.equal((await foreign.get(original.id)).favorite, false);
      } else {
        const actual = await foreign.get(original.id);
        assert.deepEqual(actual.items, remote.items);
        assert.equal(actual.title, remote.title);
        if (phase.endsWith("trash")) assert.equal(actual.deletedAt, 2000);
        else if (phase.endsWith("restore"))
          assert.equal(actual.deletedAt, undefined);
        else assert.equal(actual.favorite, true);
        cached.title = "Next own edit";
        cached.updated = 300;
        cached.items.push(
          item("note", 480, 0, { text: "Next own note", lang: "en-CA" }),
        );
        if (
          phase.startsWith("default") ||
          ["reject active", "throw"].includes(phase)
        )
          await assert.rejects(local.save(cached), { name: "StaleBoardError" });
        else {
          assert.equal(calls, 1);
          await local.save(cached);
          assert.deepEqual((await foreign.get(cached.id)).items, cached.items);
        }
      }
      if (
        ["queued own foreign", "failed write"].includes(phase) ||
        phase.startsWith("default") ||
        ["reject active", "throw"].includes(phase)
      ) {
        const actual = await foreign.get(original.id);
        assert.equal(actual.title, remote.title);
        assert.deepEqual(actual.items, remote.items);
        const retry = await local.get(original.id);
        retry.title = "Accepted retry";
        retry.updated = 600;
        await local.save(retry);
        assert.equal((await foreign.get(retry.id)).title, retry.title);
        assert.deepEqual((await foreign.get(retry.id)).items, remote.items);
      }
    } finally {
      storage.release();
      await pending?.catch(() => {});
      await own?.catch(() => {});
      if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
      else delete globalThis.indexedDB;
    }
  });
