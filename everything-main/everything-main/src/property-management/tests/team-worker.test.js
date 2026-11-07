import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import { createWorkerBackend, parseJoin, inviteLink, isTrustedWorkerUrl, activeWorker, enableTeam, loadWorkspaces, refreshMembership } from '../src/team.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { createStore } from '../src/core/store.js';

const SOURCE = fs.readFileSync(new URL('../public/worker/property-management-team-worker.js', import.meta.url), 'utf8');

/**
 * kv.incr on a path map, as Puter documents it: dots in a path nest
 * ("a.b" -> { a: { b } }) and ["a.b"] names one field with a dot in it.
 */
function incrPaths(cur, paths) {
  for (const [p, n] of Object.entries(paths)) {
    const quoted = /^\["(.*)"\]$/.exec(p);
    const parts = quoted ? [quoted[1]] : p.split('.');
    let o = cur;
    for (const k of parts.slice(0, -1)) o = o[k] && typeof o[k] === 'object' ? o[k] : (o[k] = {});
    const last = parts[parts.length - 1];
    o[last] = (o[last] || 0) + n;
  }
  return cur;
}

function fakeKV() {
  const data = new Map();
  return {
    data,
    async get(k) {
      return data.has(k) ? structuredClone(data.get(k)) : null;
    },
    async set(k, v) {
      if (Array.isArray(k)) for (const it of k) data.set(it.key, structuredClone(it.value));
      else data.set(k, structuredClone(v));
      return true;
    },
    async del(k) {
      data.delete(k);
      return true;
    },
    async expire() {
      return true;
    },
    async incr(k, paths) {
      if (!paths || typeof paths !== 'object') {
        const n = (Number(data.get(k)) || 0) + (Number(paths) || 1);
        data.set(k, n);
        return n;
      }
      const cur = incrPaths(data.get(k) || {}, paths);
      data.set(k, cur);
      return structuredClone(cur);
    },
    async list({ pattern, returnValues }) {
      const keys = [...data.keys()].filter((k) => k.startsWith(pattern)).sort();
      return { items: keys.map((k) => (returnValues ? { key: k, value: structuredClone(data.get(k)) } : k)) };
    },
  };
}

function fakeFS() {
  const files = new Map();
  return {
    files,
    async write(path, blob) {
      files.set(path, blob);
    },
    async read(path) {
      if (!files.has(path)) throw new Error('not found');
      return files.get(path);
    },
    async delete(path) {
      files.delete(path);
    },
  };
}

const person = (uuid, username) => ({ puter: { auth: { getUser: async () => ({ uuid, username }) } } });

function loadWorker() {
  const routes = [];
  const router = { get: (p, fn) => routes.push(['GET', p, fn]), post: (p, fn) => routes.push(['POST', p, fn]) };
  new Function('router', SOURCE)(router);
  const kv = fakeKV();
  const fsys = fakeFS();
  const me = { puter: { kv, fs: fsys, auth: { getUser: async () => ({ uuid: 'owner-1', username: 'olivia' }) } } };
  const handler = (method, path) => routes.find(([m, p]) => m === method && p === path)?.[2];
  return {
    kv,
    fsys,
    async api(user, body) {
      const res = await handler('POST', '/api')({ me, user, request: { json: async () => body, headers: new Headers() } });
      return { status: res.status, body: await res.json() };
    },
    async health() {
      return (await handler('GET', '/health')({ me })).json();
    },
    /** A puter.workers.exec stand-in for the app-side client. */
    exec(user) {
      return async (url, init) => {
        const res = await handler('POST', '/api')({ me, user, request: { json: async () => JSON.parse(init.body), headers: new Headers() } });
        return res;
      };
    },
  };
}

const OWNER = person('owner-1', 'olivia');
const STRANGER = person('user-2', 'sam');
const OTHER = person('user-3', 'alex');

let w;
beforeEach(() => {
  w = loadWorker();
});

describe('team worker', () => {
  it('reports its build', async () => {
    expect(await w.health()).toEqual({ ok: true, build: '5' });
  });

  it('refuses callers without a session', async () => {
    expect((await w.api(null, { op: 'meta' })).status).toBe(401);
    expect((await w.api({ puter: { auth: { getUser: async () => { throw new Error('expired'); } } } }, { op: 'meta' })).status).toBe(401);
  });

  it('lets the owner read and write records with the app key layout', async () => {
    expect((await w.api(OWNER, { op: 'put', coll: 'tenants', records: [{ id: 'c1', firstName: 'Ada' }] })).body.ok).toBe(true);
    expect(w.kv.data.has('pm1:r:tenants:c1')).toBe(true);
    expect((await w.api(OWNER, { op: 'load', coll: 'tenants' })).body.records).toEqual([{ id: 'c1', firstName: 'Ada' }]);
    expect((await w.api(OWNER, { op: 'bump', names: ['tenants'] })).body.meta).toEqual({ tenants: 1 });
    expect((await w.api(OWNER, { op: 'next', kind: 'task' })).body.number).toBe(1);
    expect((await w.api(OWNER, { op: 'whoami' })).body.role).toBe('owner');
  });

  it('keeps strangers out', async () => {
    const res = await w.api(STRANGER, { op: 'load', coll: 'tenants' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_a_member');
  });

  it('validates input', async () => {
    expect((await w.api(OWNER, { op: 'load', coll: 'secrets' })).status).toBe(400);
    expect((await w.api(OWNER, { op: 'put', coll: 'tenants', records: [{ id: '../x' }] })).status).toBe(400);
    expect((await w.api(OWNER, { op: 'fileWrite', path: '../../etc', data: 'AA==' })).status).toBe(400);
    expect((await w.api(OWNER, { op: 'nope' })).status).toBe(400);
  });

  it('runs the invitation flow end to end', async () => {
    const inv = (await w.api(OWNER, { op: 'invite', role: 'member', label: 'Sam' })).body;
    expect(inv.token).toMatch(/^[A-Za-z0-9]{24}$/);
    expect([...w.kv.data.keys()].some((k) => k.includes(inv.token))).toBe(false); // stored hashed
    expect((await w.api(OWNER, { op: 'invites' })).body.invites).toHaveLength(1);

    const joined = await w.api(STRANGER, { op: 'join', token: inv.token });
    expect(joined.body).toMatchObject({ ok: true, role: 'member' });
    expect((await w.api(STRANGER, { op: 'load', coll: 'workOrders' })).status).toBe(200);
    expect((await w.api(STRANGER, { op: 'invite', role: 'admin' })).status).toBe(403);

    // Single use.
    expect((await w.api(OTHER, { op: 'join', token: inv.token })).status).toBe(410);

    const { members } = (await w.api(OWNER, { op: 'members' })).body;
    expect(members.map((m) => [m.username, m.role])).toEqual([['sam', 'member']]);

    await w.api(OWNER, { op: 'setRole', uuid: 'user-2', role: 'admin' });
    expect((await w.api(STRANGER, { op: 'invites' })).status).toBe(200);

    await w.api(OWNER, { op: 'removeMember', uuid: 'user-2' });
    expect((await w.api(STRANGER, { op: 'meta' })).status).toBe(403);
  });

  it('lets only one of two people use the same invitation at once', async () => {
    const inv = (await w.api(OWNER, { op: 'invite', role: 'admin' })).body;
    const [a, b] = await Promise.all([w.api(STRANGER, { op: 'join', token: inv.token }), w.api(OTHER, { op: 'join', token: inv.token })]);
    expect([a.status, b.status].sort()).toEqual([200, 410]);
    expect((await w.api(OWNER, { op: 'members' })).body.members).toHaveLength(1);
  });

  it('accepts monthly ledger collections and refuses malformed ones', async () => {
    expect((await w.api(OWNER, { op: 'put', coll: 'tx.2026-10', records: [{ id: 'p1', date: '2026-10-03' }] })).status).toBe(200);
    expect((await w.api(OWNER, { op: 'load', coll: 'tx.2026-13' })).status).toBe(400);
    expect((await w.api(OWNER, { op: 'load', coll: 'tx.0000-00' })).status).toBe(400);
    expect((await w.api(OWNER, { op: 'bump', names: ['tx.2026-10', 'evil'] })).body.meta).toEqual({ 'tx.2026-10': 1 });
  });

  it('rejects expired and revoked invitations', async () => {
    const inv = (await w.api(OWNER, { op: 'invite', role: 'member' })).body;
    const key = [...w.kv.data.keys()].find((k) => k.startsWith('pmt:i:'));
    w.kv.data.set(key, { ...w.kv.data.get(key), expiresAt: Date.now() - 1 });
    expect((await w.api(STRANGER, { op: 'join', token: inv.token })).status).toBe(410);

    const inv2 = (await w.api(OWNER, { op: 'invite', role: 'member' })).body;
    const id = (await w.api(OWNER, { op: 'invites' })).body.invites[0].id;
    await w.api(OWNER, { op: 'revokeInvite', id });
    expect((await w.api(STRANGER, { op: 'join', token: inv2.token })).status).toBe(410);
  });

  it('stores files in the owner drive and reads them back', async () => {
    const data = Buffer.from('hello receipt').toString('base64');
    expect((await w.api(OWNER, { op: 'fileWrite', path: 'receipts/r1.txt', data, type: 'text/plain' })).body.ok).toBe(true);
    expect(w.fsys.files.has('property-management-team/receipts/r1.txt')).toBe(true);
    const back = (await w.api(OWNER, { op: 'fileRead', path: 'receipts/r1.txt' })).body;
    expect(Buffer.from(back.data, 'base64').toString()).toBe('hello receipt');
  });

  it("a passing failure to look up the owner keeps invitations and access", async () => {
    // A fresh worker whose first look-up of its owner fails.
    const routes = [];
    new Function('router', SOURCE)({ get: (p, fn) => routes.push(['GET', p, fn]), post: (p, fn) => routes.push(['POST', p, fn]) });
    const api = routes.find(([m, p]) => m === 'POST' && p === '/api')[2];
    let blip = false;
    const me = { puter: { kv: w.kv, fs: w.fsys, auth: { getUser: async () => (blip ? Promise.reject(new Error('blip')) : { uuid: 'owner-1', username: 'olivia' }) } } };
    const call = async (user, body) => {
      const res = await api({ me, user, request: { json: async () => body, headers: new Headers() } });
      return { status: res.status, body: await res.json() };
    };
    const inv = (await w.api(OWNER, { op: 'invite', role: 'member' })).body;
    blip = true;
    expect((await call(STRANGER, { op: 'join', token: inv.token })).status).toBe(503);
    expect((await call(OWNER, { op: 'members' })).status).toBe(503);
    blip = false;
    // The invitation still works once the owner can be looked up.
    const joined = await call(STRANGER, { op: 'join', token: inv.token });
    expect(joined.status).toBe(200);
    expect(joined.body.role).toBe('member');
  });

  it("a member promoted after joining gets the new role on their next start", async () => {
    const url = 'https://propmgmt-abc.puter.work';
    const inv = (await w.api(OWNER, { op: 'invite', role: 'member' })).body;
    await w.api(STRANGER, { op: 'join', token: inv.token });
    await w.api(OWNER, { op: 'setRole', uuid: 'user-2', role: 'admin' });
    const saved = [];
    const kv = { set: async (k, v) => saved.push(v) };
    const ws = { current: url, own: {}, joined: [{ url, role: 'member', business: 'Old name' }] };
    const entry = await refreshMembership(kv, ws, url, { getPuter: () => ({ workers: { exec: w.exec(STRANGER) } }) });
    expect(entry.role).toBe('admin');
    expect(saved[0].joined[0].role).toBe('admin');
  });

  it('accepts dots inside a file name but not as a folder', async () => {
    const data = Buffer.from('x').toString('base64');
    const write = async (path) => (await w.api(OWNER, { op: 'fileWrite', path, data, type: 'application/pdf' })).status;
    expect(await write('files/abc-Lease final..pdf')).toBe(200);
    for (const path of ['../secret', 'files/../../x', 'files/./x', '..', '/files/x']) expect(await write(path), path).toBe(400);
  });

  it('serves the app store through the worker backend for several people', async () => {
    const inv = (await w.api(OWNER, { op: 'invite', role: 'member' })).body;
    await w.api(STRANGER, { op: 'join', token: inv.token });
    const url = 'https://propmgmt-abc.puter.work';
    const mk = (user) => createStore({ backend: createWorkerBackend(url, { getPuter: () => ({ workers: { exec: w.exec(user) } }) }), flushDelay: 0 });
    const ownerStore = mk(OWNER);
    const memberStore = mk(STRANGER);
    await ownerStore.init();
    await memberStore.init();
    ownerStore.put('tenants', { firstName: 'Shared' });
    await ownerStore.flush();
    await memberStore.sync();
    expect(memberStore.all('tenants').map((c) => c.firstName)).toEqual(['Shared']);
    memberStore.put('workOrders', { title: 'From the field' });
    memberStore.put('transactions', { date: '2026-10-05', kind: 'charge', lines: [] });
    await memberStore.flush();
    await ownerStore.sync();
    expect(ownerStore.all('workOrders').map((j) => j.title)).toEqual(['From the field']);
    expect(ownerStore.all('transactions')).toHaveLength(1);
    expect(w.kv.data.has(`pm1:r:tx.2026-10:${ownerStore.all('transactions')[0].id}`)).toBe(true);
    // The ledger month is one version field, so the writer keeps its entry too.
    expect(w.kv.data.get('pm1:meta')).toMatchObject({ 'tx.2026-10': 1 });
    await new Promise((r) => setTimeout(r, 0));
    await memberStore.sync();
    expect(memberStore.all('transactions')).toHaveLength(1);
    expect(await memberStore.nextNumber('workOrders')).toBe(1);
  });
});

describe('turning on team sign-in', () => {
  it("copies records another device added since this one loaded", async () => {
    const backend = createMemoryBackend();
    const here = createStore({ backend, flushDelay: 0, timeoutMs: 0 });
    const phone = createStore({ backend, flushDelay: 0, timeoutMs: 0 });
    await here.init();
    await phone.init();
    phone.put('tenants', { id: 'from-phone', firstName: 'Phone' });
    await phone.flush();
    here.put('tenants', { id: 'from-laptop', firstName: 'Laptop' });
    const saved = { puter: globalThis.puter, fetch: globalThis.fetch };
    globalThis.puter = {
      fs: { write: async (path) => ({ path }), read: async () => new Blob([]) },
      workers: { create: async (name) => ({ url: `https://${name}.puter.work` }), exec: w.exec(OWNER) },
    };
    globalThis.fetch = async (url) => (String(url).endsWith('/health') ? { ok: true, json: () => w.health() } : { ok: true, text: async () => SOURCE });
    try {
      await enableTeam({ store: here });
    } finally {
      globalThis.puter = saved.puter;
      globalThis.fetch = saved.fetch;
    }
    expect(w.kv.data.has('pm1:r:tenants:from-phone')).toBe(true);
    expect(w.kv.data.has('pm1:r:tenants:from-laptop')).toBe(true);
  });
});

describe('a team setup that fails', () => {
  it('removes the server it created', async () => {
    const backend = createMemoryBackend();
    const store = createStore({ backend, flushDelay: 0, timeoutMs: 0 });
    await store.init();
    store.put('tenants', { id: 't1' });
    const deleted = [];
    const saved = { puter: globalThis.puter, fetch: globalThis.fetch };
    globalThis.puter = {
      fs: { write: async (path) => ({ path }) },
      workers: {
        create: async (name) => ({ url: `https://${name}.puter.work` }),
        delete: async (name) => deleted.push(name),
        exec: async () => {
          throw new Error('offline');
        },
      },
    };
    globalThis.fetch = async (url) => (String(url).endsWith('/health') ? { ok: true, json: () => w.health() } : { ok: true, text: async () => SOURCE });
    try {
      await expect(enableTeam({ store })).rejects.toThrow();
    } finally {
      globalThis.puter = saved.puter;
      globalThis.fetch = saved.fetch;
    }
    expect(deleted).toHaveLength(1);
  });
});

describe('loading workspaces', () => {
  it('retries a brief failure and never guesses after a lasting one', async () => {
    let fails = 2;
    const kv = { get: async () => (fails-- > 0 ? Promise.reject(new Error('blip')) : { current: 'https://t.puter.work', own: { url: 'https://o.puter.work' }, joined: [{ url: 'https://t.puter.work' }] }) };
    expect((await loadWorkspaces(kv, { wait: 1 })).own.url).toBe('https://o.puter.work');
    const down = { get: async () => Promise.reject(new Error('down')) };
    await expect(loadWorkspaces(down, { wait: 1 })).rejects.toThrow('down');
  });
});

describe('team links', () => {
  it('builds and parses invitation links, trusting only puter.work', () => {
    globalThis.location ??= { href: 'https://properties.puter.com/' };
    const link = inviteLink('https://propmgmt-abc123.puter.work', 'TOKENtoken1234567890');
    expect(link).toMatch(/#\/join\?w=propmgmt-abc123&t=TOKENtoken1234567890$/);
    const q = Object.fromEntries(new URLSearchParams(link.split('?')[1]));
    expect(parseJoin(q)).toEqual({ url: 'https://propmgmt-abc123.puter.work', token: 'TOKENtoken1234567890' });
    expect(parseJoin({ w: 'evil.example.com/x', t: 'TOKENtoken1234567890' })).toBeNull();
    expect(isTrustedWorkerUrl('https://evil.example.com')).toBe(false);
    expect(isTrustedWorkerUrl('http://a.puter.work')).toBe(false);
  });

  it('picks the active workspace', () => {
    expect(activeWorker({ current: 'own', own: {}, joined: [] })).toBeNull();
    expect(activeWorker({ current: 'own', own: { url: 'https://a.puter.work' }, joined: [] })).toBe('https://a.puter.work');
    expect(activeWorker({ current: 'https://b.puter.work', own: {}, joined: [{ url: 'https://b.puter.work' }] })).toBe('https://b.puter.work');
  });
});

describe('team worker hardening', () => {
  it('does not resolve operations through the prototype', async () => {
    for (const op of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const res = await w.api(OWNER, { op });
      expect(res.status, op).toBe(400);
      expect(JSON.stringify(res.body)).not.toMatch(/authToken|puter/);
    }
  });

  it('voids invitations made by someone who was removed', async () => {
    const inv = (await w.api(OWNER, { op: 'invite', role: 'admin' })).body;
    await w.api(STRANGER, { op: 'join', token: inv.token });
    const own = (await w.api(STRANGER, { op: 'invite', role: 'admin' })).body;
    await w.api(OWNER, { op: 'removeMember', uuid: 'user-2' });
    expect((await w.api(STRANGER, { op: 'join', token: own.token })).status).toBe(410);
    expect((await w.api(OTHER, { op: 'join', token: own.token })).status).toBe(410);
  });

  it('keeps document numbers ahead of existing ones', async () => {
    expect((await w.api(OWNER, { op: 'next', kind: 'task', atLeast: 57 })).body.number).toBe(57);
    expect((await w.api(OWNER, { op: 'next', kind: 'task', atLeast: 1 })).body.number).toBe(58);
  });
});
