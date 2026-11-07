/**
 * Minimal in-memory Puter SDK for store tests. Mirrors the real surface the
 * store touches: kv get/set, fs read/write/delete, auth.getUser.
 */
export function installMockPuter() {
  const kv = new Map();
  const files = new Map();
  let failNextFsWrite = false;
  let failNextKvSet = false;
  /** While true every fs/kv call fails the way an unreachable host does. */
  let offline = false;

  const transportError = () => {
    // What fetch() rejects with when it can't reach the host at all.
    const err = new TypeError('Failed to fetch');
    return err;
  };

  globalThis.puter = {
    env: 'web',
    auth: {
      isSignedIn: () => true,
      getUser: async () => ({ username: 'test', uuid: 'test-user' }),
      signIn: async () => true,
      signOut: () => {},
    },
    kv: {
      get: async (k) => {
        if (offline) throw transportError();
        return kv.has(k) ? kv.get(k) : null;
      },
      set: async (k, v) => {
        if (offline) throw transportError();
        if (failNextKvSet) {
          failNextKvSet = false;
          throw new Error('kv write failed');
        }
        kv.set(k, v);
        return true;
      },
      del: async (k) => { kv.delete(k); return true; },
    },
    fs: {
      read: async (path) => {
        if (offline) throw transportError();
        if (!files.has(path)) {
          const err = new Error(`No such file: ${path}`);
          err.code = 'subject_does_not_exist';
          throw err;
        }
        // The real SDK returns a Blob; a text()-shaped object is all the
        // store uses.
        return { text: async () => files.get(path) };
      },
      write: async (path, data) => {
        if (offline) throw transportError();
        if (failNextFsWrite) {
          failNextFsWrite = false;
          throw new Error('fs write failed');
        }
        files.set(path, typeof data === 'string' ? data : String(data));
        return { path };
      },
      delete: async (path) => {
        if (offline) throw transportError();
        files.delete(path);
      },
      readdir: async (path) => {
        if (offline) throw transportError();
        const prefix = `${path}/`;
        return [...files.keys()]
          .filter((p) => p.startsWith(prefix))
          .map((p) => ({ name: p.slice(prefix.length) }));
      },
    },
  };

  return {
    kv,
    files,
    failNextFsWrite: () => { failNextFsWrite = true; },
    failNextKvSet: () => { failNextKvSet = true; },
    /** Cut the network: every call rejects like an unreachable host. */
    goOffline: () => { offline = true; },
    goOnline: () => { offline = false; },
    uninstall: () => { delete globalThis.puter; },
  };
}

/**
 * A minimal localStorage for the node test environment, so the offline outbox
 * (which is deliberately synchronous and local) can be exercised.
 */
export function installMockStorage() {
  const data = new Map();
  const store = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  };
  const hadStorage = 'localStorage' in globalThis;
  const hadNavigator = 'navigator' in globalThis;
  globalThis.localStorage = store;
  if (!hadNavigator) globalThis.navigator = { onLine: true };
  return {
    data,
    /** What navigator.onLine reports; the store treats false as "definitely offline". */
    setOnLine: (value) => {
      try {
        Object.defineProperty(globalThis.navigator, 'onLine', { value, configurable: true });
      } catch {
        globalThis.navigator = { ...globalThis.navigator, onLine: value };
      }
    },
    uninstall: () => {
      if (!hadStorage) delete globalThis.localStorage;
      if (!hadNavigator) delete globalThis.navigator;
    },
  };
}
