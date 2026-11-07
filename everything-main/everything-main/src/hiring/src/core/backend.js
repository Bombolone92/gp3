/**
 * Storage adapters. The store persists each collection as a JSON document
 * under a namespaced key, and bulky binary data (candidate attachments) as
 * files. Two adapters share the same interface:
 *
 *   load(collection)        -> Promise<any | null>
 *   save(collection, data)  -> Promise<void>
 *   remove(collection)      -> Promise<void>
 *   writeFile(path, data)   -> Promise<void>
 *   readFile(path)          -> Promise<Blob>
 *   deleteFile(path)        -> Promise<void>
 *   deleteDir(path)         -> Promise<void>   (recursive, tolerant of absence)
 *   listDir(path)           -> Promise<[{ name, size }]>  ([] when absent)
 *
 * `createPuterBackend` is backed by the Puter.js cloud KV store and file
 * system (https://docs.puter.com) and is used in production.
 * `createMemoryBackend` is used for tests.
 */

const NS = 'hiring.v1';

/** Puter KV rejects values over 400 KB (docs.puter.com/KV/set). */
const MAX_KV_VALUE_BYTES = 400 * 1024;

export function createPuterBackend(puterInstance) {
  const p = () => {
    const instance = puterInstance ?? globalThis.puter;
    if (!instance?.kv) throw new Error('Puter.js is not available');
    return instance;
  };

  return {
    async load(collection) {
      const raw = await p().kv.get(`${NS}:${collection}`);
      if (raw === null || raw === undefined) return null;
      if (typeof raw !== 'string') return raw;
      try {
        return JSON.parse(raw);
      } catch {
        // Returning null would read as "never written": the app would
        // boot looking brand new and the first save would overwrite what
        // is left of the value. Refuse to load instead — the damaged
        // data stays in storage, recoverable by hand.
        throw new Error(
          `Your saved ${collection} could not be read. Loading stopped so the stored data is not overwritten.`
        );
      }
    },
    /**
     * Throws when a value could not be saved (the KV size limit), without
     * writing. Whole-dataset operations call this for every collection
     * before the first write, so a doomed save cannot leave storage split
     * between the old and the new dataset. Returns the serialized value.
     */
    preflight(collection, data) {
      const value = JSON.stringify(data);
      // Check before writing: past the KV limit the backend rejects with
      // an opaque error that reads like a transient failure, while the
      // UI already shows the change — every later save of the collection
      // fails the same way. Say what is wrong and what helps.
      if (new TextEncoder().encode(value).length > MAX_KV_VALUE_BYTES) {
        throw new Error(
          `The ${collection} data is too large to save (over the 400 KB storage limit). Download a backup from Settings, then remove records you no longer need.`
        );
      }
      return value;
    },
    async save(collection, data) {
      await p().kv.set(`${NS}:${collection}`, this.preflight(collection, data));
    },
    async remove(collection) {
      await p().kv.del(`${NS}:${collection}`);
    },
    async writeFile(path, data) {
      await p().fs.write(path, data, { createMissingParents: true });
    },
    async readFile(path) {
      return p().fs.read(path);
    },
    async deleteFile(path) {
      await p().fs.delete(path);
    },
    async deleteDir(path) {
      try {
        await p().fs.delete(path, { recursive: true });
      } catch (err) {
        // A directory that never existed is already "deleted".
        if (!isMissingPathError(err)) throw err;
      }
    },
    async listDir(path) {
      try {
        const entries = await p().fs.readdir(path);
        return (entries ?? []).map((e) => ({ name: e.name, size: Number(e.size) || null }));
      } catch (err) {
        // Nothing written there yet is an empty directory, not a failure.
        if (isMissingPathError(err)) return [];
        throw err;
      }
    },
  };
}

/** Puter rejects missing paths with subject_does_not_exist; cover variants. */
export function isMissingPathError(err) {
  const code = err?.code ?? err?.error?.code;
  if (typeof code === 'string' && /does_not_exist|not_found/i.test(code)) return true;
  const message = String(err?.message ?? err?.error?.message ?? '');
  return /no such file|not found|does not exist/i.test(message);
}

export function createMemoryBackend(initial = {}) {
  const data = new Map(Object.entries(initial));
  const files = new Map();
  return {
    async load(collection) {
      return data.has(collection) ? structuredClone(data.get(collection)) : null;
    },
    async save(collection, value) {
      data.set(collection, structuredClone(value));
    },
    async remove(collection) {
      data.delete(collection);
    },
    async writeFile(path, value) {
      files.set(path, value);
    },
    async readFile(path) {
      if (!files.has(path)) {
        const err = new Error(`No such file: ${path}`);
        err.code = 'subject_does_not_exist';
        throw err;
      }
      return files.get(path);
    },
    async deleteFile(path) {
      if (!files.has(path)) {
        const err = new Error(`No such file: ${path}`);
        err.code = 'subject_does_not_exist';
        throw err;
      }
      files.delete(path);
    },
    async deleteDir(path) {
      const prefix = `${path}/`;
      for (const key of [...files.keys()]) {
        if (key === path || key.startsWith(prefix)) files.delete(key);
      }
    },
    /** Test helper: inspect raw stored value. */
    peek(collection) {
      return data.get(collection) ?? null;
    },
    /** Test helper: inspect a stored file. */
    peekFile(path) {
      return files.get(path) ?? null;
    },
    async listDir(path) {
      const prefix = `${path}/`;
      return [...files.keys()]
        .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
        .map((key) => ({ name: key.slice(prefix.length), size: String(files.get(key) ?? '').length || null }));
    },
    /** Test helper: list stored file paths. */
    filePaths() {
      return [...files.keys()];
    },
  };
}
