/**
 * In-memory Puter SDK double for store tests. Records every call so tests can
 * assert what went to KV versus the file system.
 */
export function fakePuter({ env = 'web', user = { username: 'tester', uuid: 'u1' }, readDelay = 0 } = {}) {
  const wait = () => (readDelay ? new Promise((r) => setTimeout(r, readDelay)) : Promise.resolve());
  const kv = new Map();
  const files = new Map();
  const calls = [];
  const record = (name, ...args) => calls.push({ name, args });
  const notFound = (path) => Object.assign(new Error(`No such file: ${path}`), { code: 'subject_does_not_exist' });

  const sdk = {
    env,
    auth: {
      isSignedIn: () => true,
      getUser: async () => user,
      signIn: async () => true,
      signOut: () => record('signOut'),
    },
    kv: {
      get: async (k) => { record('kv.get', k); return kv.has(k) ? kv.get(k) : undefined; },
      set: async (k, v) => { record('kv.set', k, v); kv.set(k, JSON.parse(JSON.stringify(v))); return true; },
      del: async (k) => { record('kv.del', k); kv.delete(k); return true; },
    },
    fs: {
      read: async (path) => {
        record('fs.read', path);
        await wait();
        if (!files.has(path)) throw notFound(path);
        const v = files.get(path);
        return v instanceof Blob ? v : new Blob([v]);
      },
      write: async (path, data, opts) => {
        record('fs.write', path, opts);
        files.set(path, data instanceof Blob ? data : String(data));
        return { path, name: path.split('/').pop() };
      },
      delete: async (paths) => {
        record('fs.delete', paths);
        for (const p of [].concat(paths)) {
          files.delete(p);
          for (const k of [...files.keys()]) if (k.startsWith(`${p}/`)) files.delete(k);
        }
      },
      mkdir: async () => ({}),
      readdir: async () => [],
    },
    ai: {
      chat: async () => { throw new Error('not stubbed'); },
      img2txt: async () => { throw new Error('not stubbed'); },
    },
    _kv: kv,
    _files: files,
    _calls: calls,
  };
  return sdk;
}

export const readJsonFile = async (sdk, path) => JSON.parse(await (await sdk.fs.read(path)).text());
