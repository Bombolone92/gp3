import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { board, item } from "../src/model.js";
for (const choice of ["favorite", "trash", "restore"])
  for (const changed of [false, true])
    test(`a scoped ${choice} preserves the other tab's ${changed ? "new" : "unchanged"} library choice`, async () => {
      const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
      globalThis.indexedDB = new IDBFactory();
      try {
        const source = "../src/storage.js";
        const { local } = await import(
            source + "?field-own=" + choice + changed
          ),
          { local: foreign } = await import(
            source + "?field-foreign=" + choice + changed
          );
        const original = board("Keep independent library choices");
        original.updated = 100;
        original.favorite = false;
        original.items = [item("note", 0, 0, { text: "Content stays intact" })];
        if (choice === "restore") original.deletedAt = 1000;
        await local.save(original);
        const remote = await foreign.get(original.id);
        if (changed) {
          if (choice === "favorite") remote.deletedAt = 2000;
          else remote.favorite = true;
          await foreign.save(remote, { library: true });
        }
        if (choice === "favorite") original.favorite = true;
        else if (choice === "trash") original.deletedAt = 3000;
        else delete original.deletedAt;
        await local.save(original, {
          library: choice === "favorite" ? "favorite" : "deletedAt",
          accept: () => true,
        });
        const actual = await foreign.get(original.id);
        assert.deepEqual(actual.items, remote.items);
        assert.equal(actual.title, remote.title);
        if (choice === "favorite") {
          assert.equal(actual.favorite, true);
          assert.equal(
            actual.deletedAt,
            remote.deletedAt,
            "Starring a stale card must not restore a board trashed elsewhere.",
          );
        } else {
          assert.equal(
            actual.favorite,
            remote.favorite,
            "Trash and restore must not undo a favorite changed elsewhere.",
          );
          assert.equal(actual.deletedAt, choice === "trash" ? 3000 : undefined);
        }
      } finally {
        if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
        else delete globalThis.indexedDB;
      }
    });
