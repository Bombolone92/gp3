// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WORKER_SOURCE = fs.readFileSync(path.join(__dirname, '../public/worker/legal-team-worker.js'), 'utf8');
const person = (uuid, username) => ({ puter: { auth: { getUser: async () => ({ uuid, username }) } } });
const OWNER = person('owner-1', 'eleanor');
const URL_ = 'https://legalfirm-abc.puter.work';
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function memoryKV() {
  const data = new Map();
  return {
    data,
    get: async (k) => (data.has(k) ? structuredClone(data.get(k)) : null),
    set: async (k, v) => {
      if (Array.isArray(k)) for (const it of k) data.set(it.key, structuredClone(it.value));
      else data.set(k, structuredClone(v));
      return true;
    },
    del: async (k) => data.delete(k),
    expire: async () => true,
    incr: async (k, paths) => {
      if (typeof paths === 'number') {
        data.set(k, (Number(data.get(k)) || 0) + paths);
        return data.get(k);
      }
      const cur = data.get(k) || {};
      for (const [p, n] of Object.entries(paths)) cur[p] = (cur[p] || 0) + n;
      data.set(k, cur);
      return structuredClone(cur);
    },
    list: async ({ pattern, returnValues }) => ({
      items: [...data.keys()].filter((k) => k.startsWith(pattern)).sort().map((k) => (returnValues ? { key: k, value: structuredClone(data.get(k)) } : k)),
    }),
  };
}

function loadWorker() {
  const routes = new Map();
  const router = { get: (p, fn) => routes.set(`GET ${p}`, fn), post: (p, fn) => routes.set(`POST ${p}`, fn) };
  new Function('router', WORKER_SOURCE)(router);
  const kv = memoryKV();
  const me = { puter: { kv, fs: {}, auth: { getUser: async () => ({ uuid: 'owner-1', username: 'eleanor' }) } } };
  const api = async (user, body) => {
    const res = await routes.get('POST /api')({ me, user, request: { json: async () => structuredClone(body) } });
    return { status: res.status, body: await res.json() };
  };
  const exec = (user) => async (url, init) => routes.get('POST /api')({ me, user, request: { json: async () => JSON.parse(init.body) } });
  return { kv, api, exec };
}

/** Boot the app as one signed-in Puter account. */
async function boot({ hash = '', puter }) {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', `/${hash}`);
  globalThis.puter = puter;
  await import('../src/main.js');
  for (let i = 0; i < 20; i++) await tick(5);
}

const dialogWith = (text) => [...document.querySelectorAll('dialog')].find((d) => d.textContent.includes(text));

beforeEach(() => {
  window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.open = false;
  };
  localStorage.clear();
});
afterEach(() => {
  delete globalThis.puter;
});

describe('being removed from a firm', () => {
  it('says so and tries again later when the firm list cannot be saved, instead of failing silently', async () => {
    const w = loadWorker(); // Nadia is not a member of this firm (any more).
    const kv = memoryKV();
    kv.data.set('lg1:workspaces', { current: URL_, own: {}, joined: [{ url: URL_, business: 'Rivera Law', role: 'member' }] });
    const set = kv.set;
    kv.set = async (k, v) => {
      if (k === 'lg1:workspaces') throw new TypeError('Failed to fetch');
      return set(k, v);
    };
    const rejections = [];
    const onRejection = (e) => rejections.push(e);
    process.on('unhandledRejection', onRejection);
    try {
      await boot({
        puter: { auth: { isSignedIn: () => true, getUser: async () => ({ uuid: 'u-7', username: 'nadia' }) }, kv, workers: { exec: w.exec(person('u-7', 'nadia')) } },
      });
      await tick(2700);
      const toasts = [...document.querySelectorAll('.toast')].map((t) => t.textContent);
      expect(toasts.filter((t) => t.includes('no longer have access'))).toHaveLength(1);
      expect(toasts.some((t) => t.includes('Could not switch back'))).toBe(true);
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  }, 10000);
});

describe('opening an invitation link', () => {
  it('accepts a new invitation to a firm the person was removed from', async () => {
    const w = loadWorker();
    const daniel = person('u-2', 'daniel');
    const first = (await w.api(OWNER, { op: 'invite' })).body;
    await w.api(daniel, { op: 'join', token: first.token });
    await w.api(OWNER, { op: 'removeMember', uuid: 'u-2' });
    const again = (await w.api(OWNER, { op: 'invite' })).body;
    // Daniel's device still lists the firm: he has not opened it since.
    const kv = memoryKV();
    kv.data.set('lg1:workspaces', { current: 'own', own: {}, joined: [{ url: URL_, business: 'Rivera Law', role: 'member' }] });
    await boot({
      hash: `#/join?w=legalfirm-abc&t=${again.token}`,
      puter: { auth: { isSignedIn: () => true, getUser: async () => ({ uuid: 'u-2', username: 'daniel' }) }, kv, workers: { exec: w.exec(daniel) } },
    });
    const confirm = dialogWith('Join a firm?');
    if (confirm) [...confirm.querySelectorAll('button')].find((b) => b.textContent === 'Join firm').click();
    for (let i = 0; i < 20; i++) await tick(5);
    expect(w.kv.data.get('lgt:m:u-2')).toMatchObject({ role: 'member' });
  });
});

describe('opening an invitation link again', () => {
  it('opens a firm already on the list when the server cannot be reached', async () => {
    const kv = memoryKV();
    kv.data.set('lg1:workspaces', { current: 'own', own: {}, joined: [{ url: URL_, business: 'Rivera Law', role: 'member' }] });
    await boot({
      hash: '#/join?w=legalfirm-abc&t=UsedToken0123456',
      puter: {
        auth: { isSignedIn: () => true, getUser: async () => ({ uuid: 'u-2', username: 'daniel' }) },
        kv,
        workers: {
          exec: async () => {
            throw new TypeError('Failed to fetch');
          },
        },
      },
    });
    expect(globalThis.__legal.team?.url).toBe(URL_);
    await tick(700);
    expect(document.querySelector('.toast.error')).toBeNull();
  });
});

describe('the join prompt', () => {
  it('says that the firm server acts with the person\'s Puter sign-in, not only that it sees their username', async () => {
    const w = loadWorker();
    const inv = (await w.api(OWNER, { op: 'invite' })).body;
    await boot({
      hash: `#/join?w=legalfirm-abc&t=${inv.token}`,
      puter: { auth: { isSignedIn: () => true, getUser: async () => ({ uuid: 'u-7', username: 'nadia' }) }, kv: memoryKV(), workers: { exec: w.exec(person('u-7', 'nadia')) } },
    });
    const text = dialogWith('Join a firm?')?.textContent || '';
    expect(text).toContain('legalfirm-abc.puter.work');
    expect(text).toContain('your Puter sign-in');
    expect(text).toContain('your own firm');
  });
});

describe('starting without a connection', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  });

  it('opens the firm from this device when Puter cannot be reached', async () => {
    const kv = memoryKV();
    kv.data.set('lg1:settings', { firm: { name: 'Rivera Law' }, onboarded: true });
    kv.data.set('lg1:r:users:u1', { id: 'u1', name: 'Eleanor Rivera', puterUsername: 'eleanor', active: true });
    kv.data.set('lg1:meta', { settings: 1, users: 1 });
    const online = { auth: { isSignedIn: () => true, getUser: async () => ({ uuid: 'owner-1', username: 'eleanor' }) }, kv };
    await boot({ puter: online });
    expect(document.querySelector('.brand-name')?.textContent).toBe('Rivera Law');
    await tick(800); // the local snapshot is written shortly after a load

    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    const down = async () => {
      throw new TypeError('Failed to fetch');
    };
    const offline = { auth: { isSignedIn: () => true, getUser: down }, kv: { get: down, set: down, list: down, incr: down, del: down } };
    await boot({ puter: offline });
    expect(document.querySelector('.welcome')).toBeNull();
    expect(document.querySelector('.brand-name')?.textContent).toBe('Rivera Law');
  });
});
