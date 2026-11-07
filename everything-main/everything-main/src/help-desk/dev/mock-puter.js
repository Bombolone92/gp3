/**
 * Development stand-in for the Puter SDK, used by mock.html. It keeps each
 * pretend user's key-value store in localStorage, runs deployed "workers"
 * in this page with the real backend code, and routes plain fetch() calls
 * to *.puter.work there too, so the whole app (help center included) can
 * be exercised without a Puter account.
 *
 *   mock.html?as=olivia   sign in as another pretend user (default: olivia)
 *   mock.html?env=app     behave as if running inside the Puter desktop
 *   mock.html?signedout   start signed out
 */
import { MemoryKV } from '../src/server/memory-kv.js';
import { createBackend } from '../src/server/backend.js';

const params = new URLSearchParams(location.search);
const username = (params.get('as') || 'olivia').toLowerCase();
const env = params.get('env') || 'web';
const users = {};

function userRecord(name) {
  users[name] ||= { uuid: `uuid-${name}`, username: name, email: `${name}@example.com` };
  return users[name];
}

const kvs = new Map();
function kvFor(name) {
  if (kvs.has(name)) return kvs.get(name);
  const storageKey = `mock-puter:kv:${name}`;
  let timer = null;
  const kv = new MemoryKV({
    persist: (self) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(storageKey, JSON.stringify(self.dump()));
        } catch (e) {
          console.warn('mock kv persist failed', e);
        }
      }, 50);
    },
  });
  try {
    kv.load(JSON.parse(localStorage.getItem(storageKey) || '[]'));
  } catch {
    /* fresh */
  }
  window.addEventListener('storage', (e) => {
    if (e.key === storageKey && e.newValue) kv.load(JSON.parse(e.newValue));
  });
  kvs.set(name, kv);
  return kv;
}

const files = new Map();
const fsApi = {
  async write(path, data) {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const full = path.startsWith('/') ? path : `/${username}/AppData/help-desk/${path}`;
    files.set(full, blob);
    return { path: full, name: full.split('/').pop() };
  },
  async read(path) {
    const blob = files.get(path) || files.get(`/${username}/AppData/help-desk/${path}`);
    if (!blob) throw Object.assign(new Error('not found'), { code: 'subject_does_not_exist' });
    return blob;
  },
  async delete(path) {
    const full = path.startsWith('/') ? path : `/${username}/AppData/help-desk/${path}`;
    for (const k of [...files.keys()]) if (k === full || k.startsWith(`${full}/`)) files.delete(k);
  },
};

/* Workers registry: name -> owner. Stored so other pretend users can reach it. */
const WORKERS_KEY = 'mock-puter:workers';
function workers() {
  try {
    return JSON.parse(localStorage.getItem(WORKERS_KEY) || '{}');
  } catch {
    return {};
  }
}

// Report the shipped bundle's build, so the app sees deployed mock servers as current.
let bundleBuild = { id: 'dev', at: Date.now() };
fetch('./worker/help-desk-worker.js', { cache: 'no-cache' })
  .then((r) => r.text())
  .then((src) => {
    const m = /help-desk-worker build=([a-z0-9]+) at=(\d+)/.exec(src.slice(0, 200));
    if (m) bundleBuild = { id: m[1], at: Number(m[2]) };
  })
  .catch(() => {});

const backends = new Map();
function backendFor(name) {
  const w = workers()[name];
  if (!w) return null;
  if (!backends.has(name)) {
    backends.set(name, createBackend({
      kv: kvFor(w.owner),
      fs: fsApi,
      email: async (msg) => {
        console.info('[mock email]', msg.to, msg.subject, '\n', msg.text);
        return { failed: [] };
      },
      ownerUuid: async () => userRecord(w.owner).uuid,
      get build() { return bundleBuild; },
      log: console.error,
    }));
  }
  return backends.get(name);
}

async function dispatch(url, init = {}, who) {
  const u = new URL(url);
  const name = u.hostname.split('.')[0];
  const b = backendFor(name);
  if (!b) return new Response('Not found', { status: 404 });
  await new Promise((r) => setTimeout(r, 40 + Math.random() * 60));
  const headers = {};
  const h = new Headers(init.headers || {});
  for (const k of ['content-type', 'x-file-name']) if (h.get(k)) headers[k] = h.get(k);
  headers['x-real-ip'] = '127.0.0.1';
  let body = null;
  let raw = null;
  const method = (init.method || 'GET').toUpperCase();
  if (init.body instanceof Blob) raw = init.body;
  else if (typeof init.body === 'string') body = JSON.parse(init.body || 'null');
  const res = await b.handle({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers, body, raw, who: async () => who });
  if (res.response) return res.response;
  return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'Content-Type': 'application/json' } });
}

let signedIn = !params.has('signedout');
const me = userRecord(username);

const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (/^https:\/\/[^/]+\.puter\.work\//.test(url)) return dispatch(url, init, null);
  return realFetch(input, init);
};

window.puter = {
  env,
  appID: 'mock-help-desk',
  auth: {
    isSignedIn: () => signedIn,
    async signIn() {
      signedIn = true;
      return me;
    },
    async signOut() {
      signedIn = false;
    },
    async getUser() {
      if (!signedIn) throw new Error('not signed in');
      return me;
    },
    async getProfilePicture() {
      return null;
    },
  },
  kv: kvFor(username),
  fs: fsApi,
  workers: {
    async create(name, path) {
      const all = workers();
      if (all[name]) throw new Error('name taken');
      all[name] = { owner: username, path, created_at: new Date().toISOString() };
      localStorage.setItem(WORKERS_KEY, JSON.stringify(all));
      return { url: `https://${name}.puter.work`, file_path: path };
    },
    async list() {
      return Object.entries(workers()).filter(([, w]) => w.owner === username).map(([name, w]) => ({ name, url: `https://${name}.puter.work`, file_path: w.path, created_at: w.created_at }));
    },
    async get(name) {
      const w = workers()[name];
      return w && w.owner === username ? { name, file_path: w.path } : undefined;
    },
    exec: (url, init) => dispatch(url, init, signedIn ? { uuid: me.uuid, username: me.username } : null),
  },
  teams: {
    async list() {
      return [];
    },
  },
  ai: {
    async chat(prompt) {
      await new Promise((r) => setTimeout(r, 500));
      const text = Array.isArray(prompt) ? prompt[prompt.length - 1].content : String(prompt);
      return { message: { content: `(Demo AI response)\n\n${String(text).slice(0, 200)}` }, toString() { return this.message.content; } };
    },
  },
  ui: {},
  print: console.log,
};

// Surface errors on <html data-errors> so tooling outside the page can read them.
const recordError = (msg) => {
  const el = document.documentElement;
  const prev = el.getAttribute('data-errors') || '';
  el.setAttribute('data-errors', `${prev}${prev ? '\n' : ''}${String(msg).slice(0, 500)}`);
};
window.addEventListener('error', (e) => recordError(`${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => recordError(`unhandled: ${e.reason?.stack || e.reason}`));
