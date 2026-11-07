/**
 * Small storage backends for app-private data (autosave recovery copies,
 * the thumbnail cache). They share one interface:
 *   readBlob(path) -> Blob | null        (null when missing)
 *   writeBlob(path, blob)
 *   readJSON(path) -> value | null
 *   writeJSON(path, value)
 *   remove(path)                         (missing is not an error)
 *   list(dir) -> [{ name, isDir, modified, size }]
 *
 * puterBackend keeps them in the app's Puter appdata folder (relative paths
 * resolve there), opfsBackend in this browser's origin private file system,
 * memoryBackend in memory (tests and last-resort fallback). puter.kv is
 * never used for content.
 */

export function isMissing(err) {
  const code = String(err?.code || err?.error?.code || '');
  const msg = String(err?.message || err?.error?.message || (typeof err === 'string' ? err : ''));
  return code === 'subject_does_not_exist' || code === 'not_found' || code === 'dest_does_not_exist' || err?.status === 404 || err?.name === 'NotFoundError' || /does not exist|not found|no such/i.test(msg);
}

export function puterBackend(puter, root) {
  const p = (path) => (root ? `${root}/${path}` : path);
  const backend = {
    kind: 'puter',
    async readBlob(path) {
      try {
        return await puter.fs.read(p(path));
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },
    async writeBlob(path, blob) {
      await puter.fs.write(p(path), blob, { overwrite: true, createMissingParents: true });
    },
    async readJSON(path) {
      const blob = await backend.readBlob(path);
      if (!blob) return null;
      const text = await blob.text();
      return text ? JSON.parse(text) : null;
    },
    async writeJSON(path, value) {
      await puter.fs.write(p(path), JSON.stringify(value), { overwrite: true, createMissingParents: true });
    },
    async remove(path) {
      try {
        await puter.fs.delete(p(path), { recursive: true });
      } catch (err) {
        if (!isMissing(err)) throw err;
      }
    },
    async list(dir) {
      try {
        const items = await puter.fs.readdir(p(dir));
        return items.map((it) => ({ name: it.name, isDir: Boolean(it.is_dir ?? it.isDir), modified: toMs(it.modified), size: it.size || 0 }));
      } catch (err) {
        if (isMissing(err)) return [];
        throw err;
      }
    },
  };
  return backend;
}

/** Puter timestamps are Unix seconds; normalize to ms. */
export function toMs(t) {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? n * 1000 : n;
}

export function opfsAvailable() {
  return typeof navigator !== 'undefined' && Boolean(navigator.storage?.getDirectory);
}

export function opfsBackend(root = 'vector-studio') {
  const rootDir = async () => {
    const top = await navigator.storage.getDirectory();
    return top.getDirectoryHandle(root, { create: true });
  };
  const resolve = async (path, { create = false, dir = false } = {}) => {
    const parts = path.split('/').filter(Boolean);
    let d = await rootDir();
    const last = dir ? null : parts.pop();
    for (const part of parts) d = await d.getDirectoryHandle(part, { create });
    return dir ? d : { dir: d, name: last };
  };
  const backend = {
    kind: 'local',
    async readBlob(path) {
      try {
        const { dir, name } = await resolve(path);
        const fh = await dir.getFileHandle(name);
        return await fh.getFile();
      } catch (err) {
        if (isMissing(err) || err?.name === 'TypeMismatchError') return null;
        throw err;
      }
    },
    async writeBlob(path, blob) {
      const { dir, name } = await resolve(path, { create: true });
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
    },
    async readJSON(path) {
      const blob = await backend.readBlob(path);
      if (!blob) return null;
      const text = await blob.text();
      return text ? JSON.parse(text) : null;
    },
    async writeJSON(path, value) {
      await backend.writeBlob(path, new Blob([JSON.stringify(value)], { type: 'application/json' }));
    },
    async remove(path) {
      try {
        const { dir, name } = await resolve(path);
        await dir.removeEntry(name, { recursive: true });
      } catch (err) {
        if (!isMissing(err)) throw err;
      }
    },
    async list(path) {
      try {
        const d = await resolve(path, { dir: true });
        const out = [];
        for await (const [name, handle] of d.entries()) {
          if (handle.kind === 'directory') out.push({ name, isDir: true, modified: 0, size: 0 });
          else {
            const f = await handle.getFile();
            out.push({ name, isDir: false, modified: f.lastModified, size: f.size });
          }
        }
        return out;
      } catch (err) {
        if (isMissing(err)) return [];
        throw err;
      }
    },
  };
  return backend;
}

/** In-memory backend (tests, and when no persistent storage is available). */
export function memoryBackend(seed = {}) {
  const files = new Map(Object.entries(seed));
  const backend = {
    kind: 'memory',
    files,
    writes: 0,
    failNext: 0,
    failWith: null,
    async tick() {
      if (backend.failNext > 0) {
        backend.failNext--;
        throw backend.failWith || new Error('Simulated network failure');
      }
    },
    async readBlob(path) {
      await backend.tick();
      return files.has(path) ? files.get(path) : null;
    },
    async writeBlob(path, blob) {
      await backend.tick();
      backend.writes++;
      files.set(path, blob);
    },
    async readJSON(path) {
      await backend.tick();
      if (!files.has(path)) return null;
      const v = files.get(path);
      return typeof v === 'string' ? JSON.parse(v) : v;
    },
    async writeJSON(path, value) {
      await backend.tick();
      backend.writes++;
      files.set(path, JSON.stringify(value));
    },
    async remove(path) {
      await backend.tick();
      for (const key of [...files.keys()]) if (key === path || key.startsWith(path + '/')) files.delete(key);
    },
    async list(dir) {
      await backend.tick();
      const prefix = dir ? (dir.endsWith('/') ? dir : dir + '/') : '';
      const names = new Map();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const [first, ...more] = key.slice(prefix.length).split('/');
        names.set(first, more.length > 0);
      }
      return [...names].map(([name, isDir]) => ({ name, isDir, modified: Date.now(), size: 0 }));
    },
  };
  return backend;
}
