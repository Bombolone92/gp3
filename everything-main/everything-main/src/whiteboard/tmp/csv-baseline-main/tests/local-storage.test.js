import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { local } from "../src/storage.js";
import { board, item } from "../src/model.js";

test("storage upgrades preserve boards and bound isolated recovery snapshots", async (t) => {
  globalThis.indexedDB = new IDBFactory();
  const b = board("Existing board");
  b.items.push(item("note", 10, 20, { text: "Original idea" }));
  const legacy = await new Promise((resolve, reject) => {
    const request = indexedDB.open("whiteboard-v1", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("boards", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = legacy.transaction("boards", "readwrite");
    tx.objectStore("boards").put(b);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  legacy.close();
  assert.equal((await local.list())[0].title, "Existing board");
  let now = Date.now();
  t.mock.method(Date, "now", () => ++now);
  await local.checkpoint(b, "First");
  b.items[0].text = "Updated idea";
  assert.equal(
    (await local.revisions(b.id))[0].board.items[0].text,
    "Original idea",
  );
  for (let n = 0; n < 32; n++) await local.checkpoint(b, `Edit ${n}`);
  const revisions = await local.revisions(b.id);
  assert.equal(revisions.length, 30);
  assert.ok(!revisions.some((r) => r.label === "First"));
  assert.ok(revisions.some((r) => r.label === "Edit 31"));
  await local.saveTemplate(b);
  assert.equal((await local.templates())[0].items[0].text, "Updated idea");
  await local.removeTemplate(b.id);
  assert.equal((await local.templates()).length, 0);
});
