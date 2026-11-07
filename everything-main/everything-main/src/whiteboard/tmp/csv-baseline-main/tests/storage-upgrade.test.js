import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { board, item } from "../src/model.js";

test("an open connection yields to a schema upgrade from another tab", async () => {
  globalThis.indexedDB = new IDBFactory();
  // Load storage after installing the database so its connection uses it.
  const { local } = await import("../src/storage.js");
  await local.save(board("Kept"));
  const upgraded = await new Promise((resolve, reject) => {
    const request = indexedDB.open("whiteboard-v1", 4);
    const timer = setTimeout(() => reject(Error("Upgrade blocked")), 2000);
    request.onsuccess = () => {
      clearTimeout(timer);
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
  assert.equal(upgraded.version, 4);
  assert.equal(
    await new Promise((resolve) => {
      const request = upgraded
        .transaction("boards")
        .objectStore("boards")
        .getAll();
      request.onsuccess = () => resolve(request.result[0].title);
    }),
    "Kept",
  );
  upgraded.close();
});
test("versions are pruned by their recorded size without re-serializing", async () => {
  // The previous test upgraded its database, which closed this connection.
  globalThis.indexedDB = new IDBFactory();
  const { local } = await import("../src/storage.js");
  const b = board("Large");
  b.items = Array.from({ length: 300 }, (_, n) =>
    item("note", n, 0, { text: "x".repeat(20000) }),
  );
  const stringify = JSON.stringify;
  let large = 0;
  JSON.stringify = (value, ...rest) => {
    const text = stringify(value, ...rest);
    if (text.length > 1_000_000) large++;
    return text;
  };
  try {
    for (let n = 0; n < 6; n++) await local.checkpoint(b, `Edit ${n}`);
  } finally {
    JSON.stringify = stringify;
  }
  assert.equal(large, 6, "Only each new version is measured");
  const revisions = await local.revisions(b.id);
  // About 12 MB per version keeps four within the 50 MB budget.
  assert.equal(revisions.length, 4);
  assert.ok(revisions.every((r) => r.bytes > 10_000_000));
});
