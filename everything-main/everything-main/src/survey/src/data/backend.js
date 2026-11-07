/**
 * The platform the app runs on: Puter (the real thing), or local demo mode,
 * which keeps everything in this browser and runs the collector worker
 * in-page. Local mode starts with ?local in the URL and exists for trying the
 * app without an account, for development, and for tests. Everything above
 * this file sees the same small interface either way.
 */
import { createLocalKv } from './local-kv.js';
import { LOCAL_WORKER_URL, LOCAL_WORKER_FILE_KEY, localWorkerFetch, localWorkerFile } from './local-worker.js';

function puterBackend(puter) {
  return {
    mode: 'puter',
    env: puter.env,
    kv: puter.kv,
    fs: {
      write: (path, data, opts) => puter.fs.write(path, data, opts),
      async readText(path) {
        const blob = await puter.fs.read(path);
        return blob.text();
      },
      delete: (path) => puter.fs.delete(path),
    },
    workers: puter.workers,
    auth: {
      isSignedIn: async () => !!(await puter.auth.isSignedIn()),
      signIn: () => puter.auth.signIn(),
      signOut: () => puter.auth.signOut(),
      getUser: () => puter.auth.getUser(),
      getProfilePicture: () =>
        typeof puter.auth.getProfilePicture === 'function' ? puter.auth.getProfilePicture() : Promise.resolve(null),
    },
    fetchWorker: (url, init) => fetch(url, init),
    ai: puter.ai,
  };
}

function localBackend(storage = globalThis.localStorage) {
  const kv = createLocalKv({ storage, namespace: 'sv-local-kv:' });
  const fsKey = (path) => `sv-local-fs:${String(path).replace(/^\/+/, '')}`;
  const fs = {
    async write(path, data) {
      const text = typeof data === 'string' ? data : await new Response(data).text();
      storage.setItem(fsKey(path), JSON.stringify(text));
      return { path };
    },
    async readText(path) {
      const raw = storage.getItem(fsKey(path));
      if (raw == null) {
        const err = new Error('File not found');
        err.code = 'subject_does_not_exist';
        throw err;
      }
      return JSON.parse(raw);
    },
    async delete(path) {
      storage.removeItem(fsKey(path));
    },
  };
  const workers = {
    async create(name, filePath) {
      storage.setItem(LOCAL_WORKER_FILE_KEY, filePath);
      return { name, url: LOCAL_WORKER_URL, file_path: filePath };
    },
    async get(name) {
      return { name, url: LOCAL_WORKER_URL, file_path: localWorkerFile(storage) };
    },
    async delete() {
      return true;
    },
  };
  const user = { username: 'local', uuid: 'local' };
  return {
    mode: 'local',
    env: 'web',
    kv,
    fs,
    workers,
    auth: {
      isSignedIn: async () => true,
      signIn: async () => user,
      signOut: async () => {},
      getUser: async () => user,
      getProfilePicture: async () => null,
    },
    fetchWorker: localWorkerFetch(storage),
    ai: null,
  };
}

export function isLocalMode(loc = globalThis.location) {
  try {
    return new URLSearchParams(loc.search).has('local');
  } catch {
    return false;
  }
}

/** Wait for the Puter SDK (loaded with `defer`) for up to `ms`. */
export function waitForPuter(ms = 8000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (globalThis.puter && globalThis.puter.kv) return resolve(globalThis.puter);
      if (Date.now() - start > ms) return resolve(null);
      setTimeout(tick, 50);
    };
    tick();
  });
}

export async function createBackend({ local = isLocalMode() } = {}) {
  if (local) return localBackend();
  const puter = await waitForPuter();
  if (!puter) return null;
  return puterBackend(puter);
}

export { localBackend as createLocalBackend };
