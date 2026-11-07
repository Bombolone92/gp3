import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { board } from "../src/model.js";

test("a tab that never read a board does not write an older copy over another tab's newer one", async () => {
  globalThis.indexedDB = new IDBFactory();
  const tabA = await import("../src/storage.js?unseen-a"),
    tabB = await import("../src/storage.js?unseen-b");
  const b = board("Shared idea");
  b.updated = 100;
  await tabB.local.save(b);
  // Another tab edits the board after this tab's older copy was made.
  const edited = structuredClone(b);
  edited.title = "Edited in the other tab";
  edited.updated = 300;
  await tabB.local.save(edited);
  const older = structuredClone(b);
  older.updated = 200;
  await assert.rejects(tabA.local.save(older), { name: "StaleBoardError" });
  assert.equal((await tabB.local.get(b.id)).title, "Edited in the other tab");
  // A newer copy still goes in, keeping the stored library choice.
  await tabB.local.save({ ...edited, favorite: true }, { library: "favorite" });
  const newer = { ...structuredClone(b), title: "Newest", updated: 400 };
  await tabA.local.save(newer);
  const stored = await tabB.local.get(b.id);
  assert.equal(stored.title, "Newest");
  assert.equal(stored.favorite, true);
  // A board first saved here, and a shared one, still go in.
  const fresh = board("Fresh");
  await tabA.local.save(fresh);
  assert.equal((await tabA.local.get(fresh.id)).title, "Fresh");
  const shared = { ...structuredClone(edited), shared: { room: "r" } };
  shared.updated = 50;
  const tabC = await import("../src/storage.js?unseen-c");
  await tabC.local.save(shared);
});
