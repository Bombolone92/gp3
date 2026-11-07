/**
 * In-memory stand-in for the Puter SDK, close enough for store tests:
 * kv stores strings, fs stores blobs by path and rejects missing reads
 * with { code: 'subject_does_not_exist' } like the real backend.
 */
export function createPuterMock({ username = 'testuser' } = {}) {
  const kv = new Map();
  const fs = new Map();
  const meta = new Map(); // path → { modified } so stat() can move on its own

  return {
    env: 'web',
    _kv: kv,
    _fs: fs,
    _meta: meta,
    auth: {
      isSignedIn: () => true,
      getUser: async () => ({ username, uuid: 'test-uuid' }),
      signIn: async () => true,
      signOut: () => {},
    },
    kv: {
      async get(key) {
        return kv.has(key) ? kv.get(key) : null;
      },
      async set(key, value) {
        kv.set(key, value);
        return true;
      },
      async del(key) {
        kv.delete(key);
        return true;
      },
    },
    fs: {
      async write(path, data) {
        const blob = data instanceof Blob ? data : new Blob([data]);
        fs.set(path, blob);
        meta.set(path, { modified: (meta.get(path)?.modified ?? 0) + 1 });
        return { path };
      },
      /** Direct children of a directory, the shape puter.fs.readdir returns. */
      async readdir(dir) {
        const prefix = `${dir}/`;
        const seen = new Map();
        for (const [key, blob] of fs) {
          if (!key.startsWith(prefix)) continue;
          const rest = key.slice(prefix.length);
          const cut = rest.indexOf('/');
          const name = cut < 0 ? rest : rest.slice(0, cut);
          if (seen.has(name)) continue;
          seen.set(name, {
            name,
            path: `${prefix}${name}`,
            is_dir: cut >= 0,
            size: cut < 0 ? blob.size : 0,
            modified: meta.get(key)?.modified ?? 0,
          });
        }
        if (!seen.size) {
          const err = new Error(`No such directory: ${dir}`);
          err.code = 'subject_does_not_exist';
          throw err;
        }
        return [...seen.values()];
      },
      async stat(path) {
        if (!fs.has(path)) {
          const err = new Error(`No such file: ${path}`);
          err.code = 'subject_does_not_exist';
          throw err;
        }
        return { path, modified: meta.get(path)?.modified ?? 0, size: fs.get(path).size };
      },
      async read(path) {
        if (!fs.has(path)) {
          const err = new Error(`No such file: ${path}`);
          err.code = 'subject_does_not_exist';
          throw err;
        }
        return fs.get(path);
      },
      async delete(path, { recursive = false } = {}) {
        if (fs.has(path)) { fs.delete(path); meta.delete(path); return; }
        if (recursive) {
          for (const key of [...fs.keys()]) {
            if (key.startsWith(`${path}/`)) { fs.delete(key); meta.delete(key); }
          }
        }
      },
    },
  };
}

export function installPuterMock(options) {
  const mock = createPuterMock(options);
  globalThis.puter = mock;
  return mock;
}
