/**
 * Dev-only stand-in for the Puter SDK, used by /mock.html. Key-value data is
 * kept in localStorage so a reload keeps your test books; add ?reset to the
 * URL to start over. Files live in memory. Never part of the production build.
 */
import { createMemoryKV } from './mock-kv.js';

const LS = 'bookkeeping:mock-kv';
if (location.search.includes('reset')) {
  localStorage.removeItem(LS);
  indexedDB.deleteDatabase('bookkeeping:mock-user');
}
const kv = createMemoryKV();
try {
  const saved = JSON.parse(localStorage.getItem(LS) || '[]');
  for (const [k, v] of saved) kv.data.set(k, v);
} catch {}
const persist = () => {
  try { localStorage.setItem(LS, JSON.stringify([...kv.data.entries()])); } catch {}
};
for (const m of ['set', 'del', 'incr', 'update', 'flush']) {
  const fn = kv[m];
  kv[m] = async (...args) => {
    // A little latency, like the real network.
    await new Promise((r) => setTimeout(r, 30));
    const out = await fn(...args);
    persist();
    return out;
  };
}
const files = new Map();
const missing = (path) => Object.assign(new Error(`No such file: ${path}`), { code: 'subject_does_not_exist' });

window.puter = {
  env: new URLSearchParams(location.search).get('env') || 'web',
  auth: {
    isSignedIn: () => true,
    getUser: async () => ({ username: 'demo', uuid: 'mock-user' }),
    getProfilePicture: async () => null,
    signIn: async () => true,
    signOut: () => {},
  },
  kv,
  fs: {
    write: async (path, data) => {
      const blob = data instanceof Blob ? data : new Blob([data]);
      files.set(path, blob);
      return { path, name: path.split('/').pop(), size: blob.size };
    },
    read: async (path) => {
      if (!files.has(path)) throw missing(path);
      return files.get(path);
    },
    delete: async (path) => { files.delete(path); },
    mkdir: async () => ({}),
    readdir: async () => [],
  },
};
