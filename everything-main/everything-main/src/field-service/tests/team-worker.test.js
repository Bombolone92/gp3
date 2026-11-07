import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import { createWorkerBackend, parseJoin, inviteLink, isTrustedWorkerUrl, activeWorker, updateWorkerIfNeeded, loadWorkspaces, saveWorkspaces, enableTeam, carryOverToTeam, switchWorkspace } from '../src/team.js';
import { toast } from '../src/ui/toast.js';
import { app } from '../src/app.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

const SOURCE = fs.readFileSync(new URL('../public/worker/field-service-team-worker.js', import.meta.url), 'utf8');

function fakeKV() {
  const data = new Map();
  // Set latency to make reads and writes take a network round trip.
  const wait = (kv) => (kv.latency ? new Promise((r) => setTimeout(r, kv.latency)) : null);
  return {
    data,
    latency: 0,
    async get(k) {
      await wait(this);
      return data.has(k) ? structuredClone(data.get(k)) : null;
    },
    async set(k, v) {
      await wait(this);
      if (Array.isArray(k)) for (const it of k) data.set(it.key, structuredClone(it.value));
      else data.set(k, structuredClone(v));
      return true;
    },
    async del(k) {
      await wait(this);
      data.delete(k);
      return true;
    },
    async expire() {
      return true;
    },
    async incr(k, paths) {
      const cur = data.get(k) || {};
      for (const [p, n] of Object.entries(paths)) cur[p] = (cur[p] || 0) + n;
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

function loadWorker({ kv = fakeKV() } = {}) {
  const routes = [];
  const router = { get: (p, fn) => routes.push(['GET', p, fn]), post: (p, fn) => routes.push(['POST', p, fn]) };
  new Function('router', SOURCE)(router);
  const fsys = fakeFS();
  const me = { puter: { kv, fs: fsys, auth: { getUser: async () => ({ uuid: 'owner-1', username: 'olivia' }) } } };
  const handler = (method, path) => routes.find(([m, p]) => m === method && p === path)?.[2];
  return {
    kv,
    fsys,
    me,
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
    expect(await w.health()).toEqual({ ok: true, build: '4' });
  });

  it('refuses callers without a session', async () => {
    expect((await w.api(null, { op: 'meta' })).status).toBe(401);
    expect((await w.api({ puter: { auth: { getUser: async () => { throw new Error('expired'); } } } }, { op: 'meta' })).status).toBe(401);
  });

  it('lets the owner read and write records with the app key layout', async () => {
    expect((await w.api(OWNER, { op: 'put', coll: 'clients', records: [{ id: 'c1', firstName: 'Ada' }] })).body.ok).toBe(true);
    expect(w.kv.data.has('fs1:r:clients:c1')).toBe(true);
    expect((await w.api(OWNER, { op: 'load', coll: 'clients' })).body.records).toEqual([{ id: 'c1', firstName: 'Ada' }]);
    expect((await w.api(OWNER, { op: 'bump', names: ['clients'] })).body.meta).toEqual({ clients: 1 });
    expect((await w.api(OWNER, { op: 'next', kind: 'invoice' })).body.number).toBe(1);
    expect((await w.api(OWNER, { op: 'whoami' })).body.role).toBe('owner');
  });

  it('keeps strangers out', async () => {
    const res = await w.api(STRANGER, { op: 'load', coll: 'clients' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_a_member');
  });

  it('validates input', async () => {
    expect((await w.api(OWNER, { op: 'load', coll: 'secrets' })).status).toBe(400);
    expect((await w.api(OWNER, { op: 'put', coll: 'clients', records: [{ id: '../x' }] })).status).toBe(400);
    expect((await w.api(OWNER, { op: 'fileWrite', path: '../../etc', data: 'AA==' })).status).toBe(400);
    expect((await w.api(OWNER, { op: 'fileWrite', path: 'files/../x', data: 'AA==' })).status).toBe(400);
    expect((await w.api(OWNER, { op: 'fileWrite', path: '/files/x', data: 'AA==' })).status).toBe(400);
    expect((await w.api(OWNER, { op: 'fileWrite', path: 'files/./x', data: 'AA==' })).status).toBe(400);
    // Dots inside a name are fine.
    expect((await w.api(OWNER, { op: 'fileWrite', path: 'files/abc-scan...jpg', data: 'AA==' })).status).toBe(200);
    expect((await w.api(OWNER, { op: 'nope' })).status).toBe(400);
  });

  it('runs the invitation flow end to end', async () => {
    const inv = (await w.api(OWNER, { op: 'invite', role: 'member', label: 'Sam' })).body;
    expect(inv.token).toMatch(/^[A-Za-z0-9]{24}$/);
    expect([...w.kv.data.keys()].some((k) => k.includes(inv.token))).toBe(false); // stored hashed
    expect((await w.api(OWNER, { op: 'invites' })).body.invites).toHaveLength(1);

    const joined = await w.api(STRANGER, { op: 'join', token: inv.token });
    expect(joined.body).toMatchObject({ ok: true, role: 'member' });
    expect((await w.api(STRANGER, { op: 'load', coll: 'jobs' })).status).toBe(200);
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

  it('lets only one person use an invitation opened by several at once', async () => {
    const inv = (await w.api(OWNER, { op: 'invite', role: 'admin' })).body;
    const people = ['a', 'b', 'c'].map((id) => person(`user-${id}`, id));
    w.kv.latency = 1;
    const results = await Promise.all(people.map((p) => w.api(p, { op: 'join', token: inv.token })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 410, 410]);
    expect((await w.api(OWNER, { op: 'members' })).body.members).toHaveLength(1);
  });

  it('lets a member reopen a link, and a removed member back in with a new one', async () => {
    const first = (await w.api(OWNER, { op: 'invite', role: 'member' })).body;
    await w.api(STRANGER, { op: 'join', token: first.token });
    await w.api(OWNER, { op: 'setRole', uuid: 'user-2', role: 'admin' });
    // Opening a link again reports the current role.
    expect((await w.api(STRANGER, { op: 'join', token: first.token })).body).toMatchObject({ ok: true, role: 'admin', already: true });
    expect((await w.api(STRANGER, { op: 'whoami' })).body.role).toBe('admin');
    await w.api(OWNER, { op: 'removeMember', uuid: 'user-2' });
    const second = (await w.api(OWNER, { op: 'invite', role: 'member' })).body;
    expect((await w.api(STRANGER, { op: 'join', token: second.token })).body).toMatchObject({ ok: true, role: 'member' });
  });

  it("keeps an invitation when the server can't confirm who its owner is", async () => {
    const inv = (await w.api(OWNER, { op: 'invite', role: 'member' })).body;
    // A freshly started copy of the worker whose lookup of its owner fails.
    const cold = loadWorker({ kv: w.kv });
    const getUser = cold.me.puter.auth.getUser;
    cold.me.puter.auth.getUser = async () => {
      throw new Error('auth service unavailable');
    };
    expect((await cold.api(STRANGER, { op: 'join', token: inv.token })).status).toBe(503);
    cold.me.puter.auth.getUser = getUser;
    expect((await cold.api(STRANGER, { op: 'join', token: inv.token })).body).toMatchObject({ ok: true, role: 'member' });
  });

  it('rejects expired and revoked invitations', async () => {
    const inv = (await w.api(OWNER, { op: 'invite', role: 'member' })).body;
    const key = [...w.kv.data.keys()].find((k) => k.startsWith('fst:i:'));
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
    expect(w.fsys.files.has('field-service-team/receipts/r1.txt')).toBe(true);
    const back = (await w.api(OWNER, { op: 'fileRead', path: 'receipts/r1.txt' })).body;
    expect(Buffer.from(back.data, 'base64').toString()).toBe('hello receipt');
  });

  it('serves the app store through the worker backend for several people', async () => {
    const inv = (await w.api(OWNER, { op: 'invite', role: 'member' })).body;
    await w.api(STRANGER, { op: 'join', token: inv.token });
    const url = 'https://fieldsvc-abc.puter.work';
    const mk = (user) => createStore({ backend: createWorkerBackend(url, { getPuter: () => ({ workers: { exec: w.exec(user) } }) }), flushDelay: 0 });
    const ownerStore = mk(OWNER);
    const memberStore = mk(STRANGER);
    await ownerStore.init();
    await memberStore.init();
    ownerStore.put('clients', { firstName: 'Shared' });
    await ownerStore.flush();
    await memberStore.sync();
    expect(memberStore.all('clients').map((c) => c.firstName)).toEqual(['Shared']);
    memberStore.put('jobs', { title: 'From the field' });
    await memberStore.flush();
    await ownerStore.sync();
    expect(ownerStore.all('jobs').map((j) => j.title)).toEqual(['From the field']);
    expect(await memberStore.nextNumber('quotes')).toBe(1);
  });
});

describe('switching to team sign-in from another device', () => {
  it('brings over changes the team does not have, without overwriting newer team edits', async () => {
    const w = loadWorker();
    const url = 'https://fieldsvc-abc.puter.work';
    const teamBackend = createWorkerBackend(url, { getPuter: () => ({ workers: { exec: w.exec(OWNER) } }) });
    // What the team server got when team sign-in was turned on.
    await teamBackend.putRecords('clients', [
      { id: 'a', firstName: 'Ann', updatedAt: '2026-10-12T09:00:00.000Z' },
      { id: 'b', firstName: 'Bob (edited by the team)', updatedAt: '2026-10-12T11:00:00.000Z' },
      { id: 'gone', firstName: 'Deleted here', updatedAt: '2026-10-01T09:00:00.000Z' },
    ]);
    // The phone kept working in the old storage.
    const phone = createStore({ backend: createMemoryBackend(), flushDelay: 1e9, now: () => '2026-10-12T10:30:00.000Z' });
    await phone.init();
    phone.bulkPut('clients', [
      { id: 'a', firstName: 'Ann' },
      { id: 'b', firstName: 'Bob' },
      { id: 'gone', firstName: 'Deleted here' },
    ]);
    phone.put('clients', { id: 'a', firstName: 'Ann (edited on the phone)' });
    phone.put('clients', { id: 'new', firstName: 'Added on the phone' });
    phone.remove('clients', 'gone');
    await carryOverToTeam(phone, teamBackend, '2026-10-12T10:00:00.000Z');
    const names = Object.fromEntries((await teamBackend.loadCollection('clients')).map((c) => [c.id, c.firstName]));
    expect(names).toEqual({ a: 'Ann (edited on the phone)', b: 'Bob (edited by the team)', new: 'Added on the phone' });
  });
});

describe('team links', () => {
  it('builds and parses invitation links, trusting only puter.work', () => {
    globalThis.location ??= { href: 'https://fieldservice.puter.com/' };
    const link = inviteLink('https://fieldsvc-abc123.puter.work', 'TOKENtoken1234567890');
    expect(link).toMatch(/#\/join\?w=fieldsvc-abc123&t=TOKENtoken1234567890$/);
    const q = Object.fromEntries(new URLSearchParams(link.split('?')[1]));
    expect(parseJoin(q)).toEqual({ url: 'https://fieldsvc-abc123.puter.work', token: 'TOKENtoken1234567890' });
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
    expect((await w.api(OWNER, { op: 'next', kind: 'invoice', atLeast: 57 })).body.number).toBe(57);
    expect((await w.api(OWNER, { op: 'next', kind: 'invoice', atLeast: 1 })).body.number).toBe(58);
  });
});

describe('worker updates', () => {
  async function update(deployed, bundled) {
    const writes = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => ({
      ok: true,
      json: async () => ({ ok: true, build: deployed }),
      text: async () => `// field-service-team-worker build=${bundled}\n`,
    });
    globalThis.puter = { fs: { write: async (path) => writes.push(path) } };
    try {
      const updated = await updateWorkerIfNeeded({ url: 'https://fieldsvc-abc.puter.work', path: 'field-service-team/worker.js' });
      return { updated, writes: writes.length };
    } finally {
      globalThis.fetch = realFetch;
      delete globalThis.puter;
    }
  }

  it('moves the worker forward to a newer build', async () => {
    expect(await update('2', '3')).toEqual({ updated: true, writes: 1 });
  });

  it('never puts an older or the same build back', async () => {
    expect(await update('3', '2')).toEqual({ updated: false, writes: 0 });
    expect(await update('3', '3')).toEqual({ updated: false, writes: 0 });
  });
});

describe('business list', () => {
  it("uses this device's copy when Puter can't be read, and never guesses", async () => {
    const mem = new Map();
    globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
    app.user = { uuid: 'owner-1', username: 'olivia' };
    try {
      const ws = { current: 'own', own: { url: 'https://fieldsvc-abc.puter.work' }, joined: [] };
      const kv = { data: null, async get() { return this.data; }, async set(k, v) { this.data = v; } };
      await saveWorkspaces(kv, ws);
      const failing = { async get() { throw new Error('network'); } };
      expect((await loadWorkspaces(failing)).own.url).toBe('https://fieldsvc-abc.puter.work');
      mem.clear();
      await expect(loadWorkspaces(failing)).rejects.toThrow('network');
    } finally {
      delete globalThis.localStorage;
      app.user = null;
    }
  });

  it('says so, and stays put, when switching business cannot be saved', async () => {
    const reload = vi.fn();
    const realLocation = globalThis.location;
    globalThis.location = { hash: '#/clients', reload };
    globalThis.puter = { kv: { async set() { throw new Error('network'); } } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    app.workspaces = { current: 'own', own: {}, joined: [{ url: 'https://fieldsvc-abc.puter.work' }] };
    try {
      await switchWorkspace('https://fieldsvc-abc.puter.work');
      expect(toast).toHaveBeenCalledWith(expect.stringMatching(/nothing was changed/), { type: 'error' });
      expect(reload).not.toHaveBeenCalled();
      expect(globalThis.location.hash).toBe('#/clients');
    } finally {
      warn.mockRestore();
      globalThis.location = realLocation;
      delete globalThis.puter;
      app.workspaces = null;
    }
  });
});

describe('turning on team sign-in', () => {
  it("copies the business as it is now, including another device's latest changes", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, text: async () => '// field-service-team-worker build=3\n', json: async () => ({ ok: true, build: '3' }) });
    globalThis.puter = {
      fs: { write: async () => ({ path: 'field-service-team-worker.js' }) },
      workers: { create: async (name) => ({ success: true, url: `https://${name}.puter.work` }), delete: async () => {}, exec: w.exec(OWNER) },
    };
    try {
      const own = createMemoryBackend();
      const laptop = createStore({ backend: own, flushDelay: 0 });
      const phone = createStore({ backend: own, flushDelay: 0 });
      await laptop.init();
      const c = laptop.put('clients', { firstName: 'Ann', phone: '' });
      await laptop.flush();
      await phone.init();
      phone.patch('clients', c.id, { phone: '555-0100' });
      await phone.flush();
      // The laptop has not synced since, and turns on team sign-in.
      await enableTeam({ store: laptop });
      const copied = (await w.api(OWNER, { op: 'load', coll: 'clients' })).body.records;
      expect(copied.map((r) => r.phone)).toEqual(['555-0100']);
    } finally {
      globalThis.fetch = realFetch;
      delete globalThis.puter;
    }
  });

  it('removes the new server again when it never comes online', async () => {
    vi.useFakeTimers();
    const realFetch = globalThis.fetch;
    const deleted = [];
    globalThis.fetch = async (url) => ({
      ok: true,
      text: async () => '// field-service-team-worker build=3\n',
      json: async () => ({ ok: false }),
    });
    globalThis.puter = {
      fs: { write: async () => ({ path: 'field-service-team-worker.js' }) },
      workers: { create: async (name) => ({ success: true, url: `https://${name}.puter.work` }), delete: async (name) => deleted.push(name) },
    };
    try {
      const store = createStore({ backend: createMemoryBackend(), flushDelay: 1e9 });
      const done = enableTeam({ store }).then(() => null, (err) => err);
      await vi.advanceTimersByTimeAsync(40000);
      const err = await done;
      expect(err?.message).toMatch(/did not come online/);
      expect(deleted).toHaveLength(1);
      expect(deleted[0]).toMatch(/^fieldsvc-/);
    } finally {
      globalThis.fetch = realFetch;
      delete globalThis.puter;
      vi.useRealTimers();
    }
  });
});
