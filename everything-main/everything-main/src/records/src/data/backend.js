/**
 * Storage backends. The app reads and writes files through this small
 * interface, so the same code runs on Puter, in memory (tests) and in
 * IndexedDB (the ?local development mode).
 *
 *   read(path)      -> { text, modified, size } | null
 *   readBlob(path)  -> Blob | null
 *   write(path, data: string | Blob) -> { modified, size }
 *   stat(path)      -> { modified, size } | null
 *   remove(path)    -> removes a file or a folder (missing is fine)
 *   copy(from, to)  -> copies a file
 *
 * puter.kv only holds small per-person settings (theme and the like). Base
 * contents and files always go to the file system.
 */

export function isMissing(err) {
  const code = String(err?.code || err?.error?.code || '');
  const msg = String(err?.message || err?.error?.message || err || '');
  return code === 'subject_does_not_exist' || code === 'not_found' || code === 'dest_does_not_exist' || err?.status === 404 || /does not exist|not found|no such/i.test(msg);
}

export function isQuota(err) {
  const code = String(err?.code || err?.error?.code || '');
  return code === 'storage_limit_reached' || err?.status === 413;
}

/** Puter reports times in seconds; everything here uses milliseconds. */
const ms = (item) => {
  const m = Number(item?.modified ?? item?.mtime ?? 0);
  return m && m < 1e12 ? m * 1000 : m;
};

const WRITE_OPTS = { overwrite: true, dedupeName: false, createMissingParents: true };

/** Files under ~/AppData/<app>/<root>/ in the person's Puter cloud. */
export function puterBackend(puter, root = 'records') {
  const p = (path) => `${root}/${path}`;
  return {
    kind: 'puter',
    async read(path) {
      try {
        const blob = await puter.fs.read(p(path));
        const text = await blob.text();
        return { text, modified: null, size: blob.size };
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },
    async readBlob(path) {
      try {
        return await puter.fs.read(p(path));
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },
    async write(path, data) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/json' });
      const item = await puter.fs.write(p(path), blob, WRITE_OPTS);
      return { modified: ms(item) || Date.now(), size: item?.size ?? blob.size };
    },
    async stat(path) {
      try {
        const item = await puter.fs.stat(p(path));
        return { modified: ms(item), size: item?.size ?? null };
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },
    async remove(path) {
      try {
        await puter.fs.delete(p(path), { recursive: true });
      } catch (err) {
        if (!isMissing(err)) throw err;
      }
    },
    async copy(from, to) {
      const blob = await puter.fs.read(p(from));
      await puter.fs.write(p(to), blob, WRITE_OPTS);
    },
    async space() {
      try {
        return await puter.fs.space();
      } catch {
        return null;
      }
    },
  };
}

/** In-memory files, for tests. */
export function memoryBackend() {
  const files = new Map();
  let clock = 1_000_000;
  const calls = [];
  return {
    kind: 'memory',
    files,
    calls,
    async read(path) {
      calls.push(['read', path]);
      const f = files.get(path);
      if (!f) return null;
      return { text: typeof f.data === 'string' ? f.data : await f.data.text(), modified: f.modified, size: f.size };
    },
    async readBlob(path) {
      const f = files.get(path);
      if (!f) return null;
      return f.data instanceof Blob ? f.data : new Blob([f.data]);
    },
    async write(path, data) {
      calls.push(['write', path]);
      clock += 1000;
      const size = typeof data === 'string' ? data.length : data.size;
      files.set(path, { data, modified: clock, size });
      return { modified: clock, size };
    },
    async stat(path) {
      const f = files.get(path);
      return f ? { modified: f.modified, size: f.size } : null;
    },
    async remove(path) {
      calls.push(['remove', path]);
      files.delete(path);
      for (const k of [...files.keys()]) if (k.startsWith(`${path}/`)) files.delete(k);
    },
    async copy(from, to) {
      const f = files.get(from);
      if (f) files.set(to, { ...f });
    },
  };
}

/** IndexedDB files, for the ?local development mode. */
export async function indexedDbBackend(name = 'records-local') {
  const db = await openDb(name, 'files');
  const tx = (mode, fn) =>
    new Promise((resolve, reject) => {
      const t = db.transaction('files', mode);
      const req = fn(t.objectStore('files'));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
    });
  return {
    kind: 'local',
    async read(path) {
      const f = await tx('readonly', (s) => s.get(path));
      if (!f) return null;
      const text = typeof f.data === 'string' ? f.data : await new Blob([f.data]).text();
      return { text, modified: f.modified, size: f.size };
    },
    async readBlob(path) {
      const f = await tx('readonly', (s) => s.get(path));
      if (!f) return null;
      return new Blob([f.data], { type: f.type || '' });
    },
    async write(path, data) {
      const stored = typeof data === 'string' ? data : await data.arrayBuffer();
      const modified = Date.now();
      const size = typeof data === 'string' ? data.length : data.size;
      await tx('readwrite', (s) => s.put({ data: stored, modified, size, type: data.type || '' }, path));
      return { modified, size };
    },
    async stat(path) {
      const f = await tx('readonly', (s) => s.get(path));
      return f ? { modified: f.modified, size: f.size } : null;
    },
    async remove(path) {
      const keys = await tx('readonly', (s) => s.getAllKeys());
      await tx('readwrite', (s) => {
        let last = null;
        for (const k of keys) if (k === path || String(k).startsWith(`${path}/`)) last = s.delete(k);
        return last;
      });
    },
    async copy(from, to) {
      const f = await tx('readonly', (s) => s.get(from));
      if (f) await tx('readwrite', (s) => s.put(f, to));
    },
  };
}

export function openDb(name, store) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ------------------------------------------------------------------- kv */

/** Small settings in puter.kv: one entry per setting group, read once. */
export function puterKv(puter) {
  return {
    async get(key) {
      try {
        return await puter.kv.get(key);
      } catch {
        return null;
      }
    },
    async set(key, value) {
      return puter.kv.set(key, value);
    },
  };
}

export function localKv(prefix = 'records-local:') {
  return {
    async get(key) {
      try {
        const v = localStorage.getItem(prefix + key);
        return v === null ? null : JSON.parse(v);
      } catch {
        return null;
      }
    },
    async set(key, value) {
      try {
        localStorage.setItem(prefix + key, JSON.stringify(value));
      } catch {
        /* storage full or blocked */
      }
      return true;
    },
  };
}

export function memoryKv() {
  const data = new Map();
  return {
    data,
    async get(key) {
      return data.has(key) ? structuredClone(data.get(key)) : null;
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
      return true;
    },
  };
}
