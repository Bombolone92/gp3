import { validateBoard } from "./model.js";
const DB = "whiteboard-v1";
let dbPromise;
function db() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 3);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("boards"))
        req.result.createObjectStore("boards", { keyPath: "id" });
      if (!req.result.objectStoreNames.contains("revisions")) {
        const store = req.result.createObjectStore("revisions", {
          keyPath: "id",
        });
        store.createIndex("boardId", "boardId");
      }
      if (!req.result.objectStoreNames.contains("templates"))
        req.result.createObjectStore("templates", { keyPath: "id" });
      if (!req.result.objectStoreNames.contains("collaboration")) {
        const store = req.result.createObjectStore("collaboration", {
          keyPath: "id",
        });
        store.createIndex("scope", "scope");
      }
    };
    req.onsuccess = () => {
      const database = req.result;
      // A newer release in another tab must be able to upgrade the schema;
      // an open connection would otherwise block it indefinitely.
      database.onversionchange = () => {
        database.close();
        dbPromise = null;
      };
      resolve(database);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  }));
}
async function transaction(mode, fn, store = "boards") {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export const local = {
  collaborationRows: (scope) =>
    transaction(
      "readonly",
      (s) => s.index("scope").getAll(scope),
      "collaboration",
    ),
  collaborationPut: (row) =>
    transaction("readwrite", (s) => s.put(row), "collaboration"),
  collaborationDelete: (id) =>
    transaction("readwrite", (s) => s.delete(id), "collaboration"),
  // Every row one shared-board session kept on this device.
  collaborationClear: (scope) =>
    transaction(
      "readwrite",
      (s) => {
        const keys = s.index("scope").getAllKeys(scope);
        keys.onsuccess = () => keys.result.forEach((key) => s.delete(key));
        return keys;
      },
      "collaboration",
    ),
  list: () => transaction("readonly", (s) => s.getAll()),
  save: (b) => transaction("readwrite", (s) => s.put(b)),
  remove: (id) => transaction("readwrite", (s) => s.delete(id)),
  revisions: (id) =>
    transaction("readonly", (s) => s.index("boardId").getAll(id), "revisions"),
  templates: () => transaction("readonly", (s) => s.getAll(), "templates"),
  saveTemplate: (b) => transaction("readwrite", (s) => s.put(b), "templates"),
  removeTemplate: (id) =>
    transaction("readwrite", (s) => s.delete(id), "templates"),
  async checkpoint(b, label = "Board edit") {
    const snapshot = structuredClone(b),
      revision = {
        id: crypto.randomUUID(),
        boardId: b.id,
        created: Date.now(),
        label,
        board: snapshot,
      };
    // Record the size once so pruning does not re-serialize every version.
    revision.bytes = JSON.stringify(revision).length * 2;
    await transaction("readwrite", (s) => s.put(revision), "revisions");
    const all = (await local.revisions(b.id)).sort(
      (a, b) => b.created - a.created,
    );
    let bytes = 0;
    const expired = [];
    for (const [index, r] of all.entries()) {
      bytes += r.bytes ?? JSON.stringify(r).length * 2;
      if (index >= 30 || (index > 0 && bytes > 50 * 1024 * 1024))
        expired.push(r.id);
    }
    if (expired.length)
      await transaction(
        "readwrite",
        (s) => expired.map((id) => s.delete(id)).at(-1),
        "revisions",
      );
    return revision;
  },
};
const missing = (e) =>
  ["subject_does_not_exist", "ENOENT", "not_found"].includes(e.code);
const uuidPattern = /^[a-f\d-]{36}$/;
export class CloudStore {
  constructor(puter) {
    this.puter = puter;
    this.queue = Promise.resolve();
    this.catalog = null;
    this.catalogRequest = null;
  }
  // A small file index avoids reading every board (and embedded image) to list titles.
  // It is updated only for new boards and renamed boards, never for pointer movement.
  loadCatalog() {
    if (this.catalog) return Promise.resolve(this.catalog);
    this.catalogRequest ||= this.readCatalog().finally(() => {
      this.catalogRequest = null;
    });
    return this.catalogRequest;
  }
  async readCatalog() {
    try {
      const data = JSON.parse(
        await (await this.puter.fs.read("whiteboard/catalog.json")).text(),
      );
      if (
        !Array.isArray(data) ||
        !data.every(
          (b) =>
            typeof b?.id === "string" &&
            uuidPattern.test(b.id) &&
            typeof b.title === "string",
        )
      )
        throw Error(
          "The cloud board index is invalid. Your files remain in Puter.",
        );
      this.catalog = data;
    } catch (e) {
      if (!missing(e)) throw e;
      // Recover older files if the index was never written or its first write failed.
      try {
        this.catalog = (await this.puter.fs.readdir("whiteboard"))
          .filter(
            (f) =>
              !f.is_dir &&
              uuidPattern.test(f.name.replace(/\.json$/, "")) &&
              f.name.endsWith(".json"),
          )
          .map((f) => ({ id: f.name.slice(0, -5), title: "Recovered board" }));
      } catch (error) {
        if (!missing(error)) throw error;
        this.catalog = [];
      }
    }
    return this.catalog;
  }
  async list() {
    return (await this.loadCatalog()).map((b) => ({
      name: b.id + ".json",
      title: b.title,
      path: "whiteboard/" + b.id + ".json",
    }));
  }
  async read(path) {
    return validateBoard(
      JSON.parse(await (await this.puter.fs.read(path)).text()),
    );
  }
  save(b) {
    const snapshot = JSON.stringify(b);
    const id = b.id,
      title = b.title;
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        if (!uuidPattern.test(id)) throw Error("Invalid board identifier.");
        const catalog = await this.loadCatalog();
        await this.puter.fs.write(`whiteboard/${id}.json`, snapshot, {
          createMissingParents: true,
          overwrite: true,
        });
        if (
          !catalog.some((entry) => entry.id === id && entry.title === title)
        ) {
          const next = [
            ...catalog.filter((entry) => entry.id !== id),
            { id, title },
          ];
          await this.puter.fs.write(
            "whiteboard/catalog.json",
            JSON.stringify(next),
            { createMissingParents: true, overwrite: true },
          );
          this.catalog = next;
        }
      });
    this.queue = task;
    return task;
  }
}
