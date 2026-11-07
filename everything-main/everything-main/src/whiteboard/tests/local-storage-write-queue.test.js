import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { board, item } from "../src/model.js";
function controlledLibraryRenameStorage() {
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
  "personal",
  "shared",
  "mutable",
  "first save",
  "failed first write",
  "foreign change",
  "foreign deletion",
  "library merge",
  "multiple writes",
  "other board",
])
  test(`same-tab board writes respect their completion order for ${phase}`, async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"),
      storage = controlledLibraryRenameStorage();
    globalThis.indexedDB = storage.indexedDB;
    let first, second, third, db;
    try {
      const { local } = await import("../src/storage.js?queue-review=" + phase);
      const value = board("Initial");
      value.updated = 100;
      if (phase === "shared")
        value.shared = { room: "review-shared", role: "editor" };
      if (phase !== "first save") await local.save(value);
      value.title = "First sent";
      value.updated = 200;
      const reached = storage.hold({ quota: phase === "failed first write" });
      let firstError;
      first = local.save(value).catch((error) => {
        firstError = error;
      });
      await reached;
      const next = phase === "mutable" ? value : structuredClone(value);
      next.title = "Second sent";
      next.updated = 300;
      if (phase === "library merge") next.favorite = true;
      let finished = false,
        error;
      second = local.save(next, { library: phase === "library merge" }).then(
        () => {
          finished = true;
        },
        (e) => {
          finished = true;
          error = e;
        },
      );
      if (phase === "mutable") {
        next.title = "Latest mutable name";
        next.updated = 350;
      }
      if (phase === "multiple writes") {
        const last = structuredClone(next);
        last.title = "Third sent";
        last.updated = 400;
        third = local.save(last);
        third.catch(() => {});
      }
      if (phase === "other board") {
        const unrelated = board("Independent board");
        unrelated.updated = 900;
        await local.save(unrelated);
      }
      let latest;
      if (
        ["foreign change", "foreign deletion", "library merge"].includes(phase)
      ) {
        const other = await import("../src/storage.js?queue-other=" + phase);
        latest = await other.local.get(value.id);
        if (phase === "foreign deletion") await other.local.remove(value.id);
        else {
          latest.title = "Actual other tab";
          latest.updated = 500;
          latest.items.push(
            item("note", 0, 0, {
              text: "Foreign content to preserve",
              lang: "fr-CA",
            }),
          );
          await other.local.save(latest);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
      const finishedBeforeRelease = finished;
      storage.release();
      await first;
      await second;
      await third;
      first = second = third = null;
      assert.equal(
        finishedBeforeRelease,
        false,
        "A second same-board write waits for acknowledgement rather than misclassifying our own committed write.",
      );
      if (phase === "foreign change" || phase === "foreign deletion")
        assert.equal(
          error?.name,
          phase === "foreign deletion"
            ? "DeletedBoardError"
            : "StaleBoardError",
        );
      else assert.equal(error, undefined);
      if (phase === "failed first write")
        assert.equal(firstError?.name, "QuotaExceededError");
      else assert.equal(firstError, undefined);
      const saved = await local.get(value.id);
      if (phase === "foreign deletion") assert.equal(saved, undefined);
      else {
        assert.equal(
          saved.title,
          phase === "foreign change" || phase === "library merge"
            ? "Actual other tab"
            : phase === "multiple writes"
              ? "Third sent"
              : next.title,
        );
        if (phase === "foreign change" || phase === "library merge")
          assert.deepEqual(saved.items, latest.items);
        if (phase === "library merge") {
          assert.equal(saved.updated, 500);
          assert.equal(saved.favorite, true);
        }
      }
      if (phase !== "foreign deletion") {
        const last = structuredClone(saved);
        last.title = "Later independent retry";
        last.updated = 700;
        await local.save(last);
        assert.equal((await local.get(value.id)).title, last.title);
      }
    } finally {
      storage.release();
      await first;
      await second;
      await third;
      db?.close();
      if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
      else delete globalThis.indexedDB;
    }
  });
