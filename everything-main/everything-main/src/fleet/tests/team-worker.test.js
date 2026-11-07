import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import { createWorkerBackend, parseJoin, inviteLink, isTrustedWorkerUrl, activeWorker } from '../src/team.js';
import { createStore } from '../src/core/store.js';
import { bucketOf } from '../src/core/schema.js';

const SOURCE = fs.readFileSync(new URL('../public/worker/fleet-team-worker.js', import.meta.url), 'utf8');

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
    async write(path, blob, opts = {}) {
      if (opts.overwrite === false && files.has(path)) throw new Error('exists');
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

async function invite(role, user) {
  const inv = (await w.api(OWNER, { op: 'invite', role })).body;
  return (await w.api(user, { op: 'join', token: inv.token })).body;
}

describe('team worker', () => {
  it('reports its build', async () => {
    expect(await w.health()).toEqual({ ok: true, build: '3' });
  });

  it('refuses callers without a session', async () => {
    expect((await w.api(null, { op: 'meta' })).status).toBe(401);
    expect((await w.api({ puter: { auth: { getUser: async () => { throw new Error('expired'); } } } }, { op: 'meta' })).status).toBe(401);
  });

  it('lets the owner read and write buckets with the app key layout', async () => {
    expect((await w.api(OWNER, { op: 'put', bucket: 'vehicles', records: [{ id: 'v1', name: 'Van' }] })).body.ok).toBe(true);
    expect(w.kv.data.has('fl1:r:vehicles:v1')).toBe(true);
    expect((await w.api(OWNER, { op: 'put', bucket: 'fuel_202610', records: [{ id: 'f1', date: '2026-10-01' }] })).body.ok).toBe(true);
    expect(w.kv.data.has('fl1:r:fuel_202610:f1')).toBe(true);
    expect((await w.api(OWNER, { op: 'load', bucket: 'vehicles' })).body.records).toEqual([{ id: 'v1', name: 'Van' }]);
    expect((await w.api(OWNER, { op: 'bump', names: ['vehicles', 'fuel_202610'] })).body.meta).toEqual({ vehicles: 1, fuel_202610: 1 });
    expect((await w.api(OWNER, { op: 'next', kind: 'workOrder' })).body.number).toBe(1);
    expect((await w.api(OWNER, { op: 'whoami' })).body.role).toBe('owner');
  });

  it('rejects unknown and malformed buckets', async () => {
    expect((await w.api(OWNER, { op: 'load', bucket: 'secrets' })).status).toBe(400);
    expect((await w.api(OWNER, { op: 'load', bucket: 'fuel' })).status).toBe(400); // fuel is monthly
    expect((await w.api(OWNER, { op: 'load', bucket: 'vehicles_202610' })).status).toBe(400);
    expect((await w.api(OWNER, { op: 'put', bucket: 'vehicles', records: [{ id: '../x' }] })).status).toBe(400);
    expect((await w.api(OWNER, { op: 'fileWrite', path: '../../etc', data: 'AA==' })).status).toBe(400);
    expect((await w.api(OWNER, { op: 'nope' })).status).toBe(400);
  });

  it('keeps strangers out', async () => {
    const res = await w.api(STRANGER, { op: 'load', bucket: 'vehicles' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_a_member');
  });

  it('limits drivers to inspections, fuel, issues, meters, and comments', async () => {
    expect((await invite('driver', STRANGER)).role).toBe('driver');
    expect((await w.api(STRANGER, { op: 'load', bucket: 'vehicles' })).status).toBe(200);
    expect((await w.api(STRANGER, { op: 'put', bucket: 'fuel_202610', records: [{ id: 'f1', date: '2026-10-02' }] })).status).toBe(200);
    expect((await w.api(STRANGER, { op: 'put', bucket: 'inspections_202610', records: [{ id: 'i1', date: '2026-10-02' }] })).status).toBe(200);
    expect((await w.api(STRANGER, { op: 'put', bucket: 'issues', records: [{ id: 'is1' }] })).status).toBe(200);
    expect((await w.api(STRANGER, { op: 'next', kind: 'issue' })).status).toBe(200);
    expect((await w.api(STRANGER, { op: 'put', bucket: 'vehicles', records: [{ id: 'v1' }] })).status).toBe(403);
    expect((await w.api(STRANGER, { op: 'del', bucket: 'workOrders', ids: ['w1'] })).status).toBe(403);
    expect((await w.api(STRANGER, { op: 'del', bucket: 'fuel_202610', ids: ['f1'] })).status).toBe(403);
    expect((await w.api(STRANGER, { op: 'next', kind: 'workOrder' })).status).toBe(403);
    expect((await w.api(STRANGER, { op: 'saveSettings', settings: { company: { name: 'x' } } })).status).toBe(403);
    expect((await w.api(STRANGER, { op: 'invite', role: 'admin' })).status).toBe(403);
  });

  it('lets drivers update only a vehicle meter, delete only their own comments, and add but not replace files', async () => {
    await w.api(OWNER, { op: 'put', bucket: 'vehicles', records: [{ id: 'v1', name: 'Van', meter: 100, meterDate: '2026-10-01', updatedAt: 'a' }] });
    await w.api(OWNER, { op: 'put', bucket: 'comments', records: [{ id: 'k1', text: 'owner note', authorUuid: 'owner-1' }] });
    await invite('driver', STRANGER);
    expect((await w.api(STRANGER, { op: 'put', bucket: 'vehicles', records: [{ id: 'v1', name: 'Van', meter: 150, meterDate: '2026-10-02', updatedAt: 'b' }] })).status).toBe(200);
    expect((await w.api(STRANGER, { op: 'put', bucket: 'vehicles', records: [{ id: 'v1', name: 'Renamed', meter: 150, meterDate: '2026-10-02', updatedAt: 'c' }] })).status).toBe(403);
    expect((await w.api(STRANGER, { op: 'put', bucket: 'vehicles', records: [{ id: 'v2', meter: 1 }] })).status).toBe(403);
    await w.api(STRANGER, { op: 'put', bucket: 'comments', records: [{ id: 'k2', text: 'mine', authorUuid: 'user-2' }] });
    expect((await w.api(STRANGER, { op: 'del', bucket: 'comments', ids: ['k2'] })).status).toBe(200);
    expect((await w.api(STRANGER, { op: 'del', bucket: 'comments', ids: ['k1'] })).status).toBe(403);
    const data = Buffer.from('x').toString('base64');
    expect((await w.api(STRANGER, { op: 'fileWrite', path: 'files/a.txt', data })).status).toBe(200);
    expect((await w.api(STRANGER, { op: 'fileDelete', path: 'files/a.txt' })).status).toBe(403);
    expect((await w.api(STRANGER, { op: 'next', kind: 'issue', atLeast: 1e9 })).body.number).toBe(1);
  });

  it('lets members edit records but not settings or the team', async () => {
    await invite('member', STRANGER);
    expect((await w.api(STRANGER, { op: 'put', bucket: 'vehicles', records: [{ id: 'v1' }] })).status).toBe(200);
    expect((await w.api(STRANGER, { op: 'saveSettings', settings: {} })).status).toBe(403);
    expect((await w.api(STRANGER, { op: 'members' })).status).toBe(403);
  });

  it('runs the invitation flow end to end', async () => {
    const inv = (await w.api(OWNER, { op: 'invite', role: 'member', label: 'Sam' })).body;
    expect(inv.token).toMatch(/^[A-Za-z0-9]{24}$/);
    expect([...w.kv.data.keys()].some((k) => k.includes(inv.token))).toBe(false); // stored hashed
    expect((await w.api(OWNER, { op: 'invites' })).body.invites).toHaveLength(1);
    const joined = await w.api(STRANGER, { op: 'join', token: inv.token });
    expect(joined.body).toMatchObject({ ok: true, role: 'member' });
    // Single use.
    expect((await w.api(OTHER, { op: 'join', token: inv.token })).status).toBe(410);
    const { members } = (await w.api(OWNER, { op: 'members' })).body;
    expect(members.map((m) => [m.username, m.role])).toEqual([['sam', 'member']]);
    await w.api(OWNER, { op: 'setRole', uuid: 'user-2', role: 'admin' });
    expect((await w.api(STRANGER, { op: 'invites' })).status).toBe(200);
    await w.api(OWNER, { op: 'removeMember', uuid: 'user-2' });
    expect((await w.api(STRANGER, { op: 'meta' })).status).toBe(403);
  });

  it('rejects expired and revoked invitations', async () => {
    const inv = (await w.api(OWNER, { op: 'invite', role: 'member' })).body;
    const key = [...w.kv.data.keys()].find((k) => k.startsWith('flt:i:'));
    w.kv.data.set(key, { ...w.kv.data.get(key), expiresAt: Date.now() - 1 });
    expect((await w.api(STRANGER, { op: 'join', token: inv.token })).status).toBe(410);
    const inv2 = (await w.api(OWNER, { op: 'invite', role: 'member' })).body;
    const id = (await w.api(OWNER, { op: 'invites' })).body.invites[0].id;
    await w.api(OWNER, { op: 'revokeInvite', id });
    expect((await w.api(STRANGER, { op: 'join', token: inv2.token })).status).toBe(410);
  });

  it('stores files in the owner drive and reads them back', async () => {
    const data = Buffer.from('hello receipt').toString('base64');
    expect((await w.api(OWNER, { op: 'fileWrite', path: 'files/fuel/r1.txt', data, type: 'text/plain' })).body.ok).toBe(true);
    expect(w.fsys.files.has('fleet-team/files/fuel/r1.txt')).toBe(true);
    const back = (await w.api(OWNER, { op: 'fileRead', path: 'files/fuel/r1.txt' })).body;
    expect(Buffer.from(back.data, 'base64').toString()).toBe('hello receipt');
  });

  it('serves the app store through the worker backend for several people', async () => {
    await invite('driver', STRANGER);
    const url = 'https://fleet-abc.puter.work';
    const mk = (user) => createStore({ backend: createWorkerBackend(url, { getPuter: () => ({ workers: { exec: w.exec(user) } }) }), flushDelay: 0 });
    const ownerStore = mk(OWNER);
    const driverStore = mk(STRANGER);
    await ownerStore.init();
    await driverStore.init();
    ownerStore.put('vehicles', { name: 'Shared van' });
    await ownerStore.flush();
    await driverStore.sync();
    expect(driverStore.all('vehicles').map((c) => c.name)).toEqual(['Shared van']);
    driverStore.put('fuel', { date: '2026-10-03', volume: 12 });
    await driverStore.flush();
    await ownerStore.sync();
    expect(ownerStore.all('fuel').map((f) => f.volume)).toEqual([12]);
    expect(w.kv.data.has(`fl1:r:${bucketOf('fuel', { date: '2026-10-03' })}:${ownerStore.all('fuel')[0].id}`)).toBe(true);
    // A driver's change outside their role is rejected and does not retry forever.
    driverStore.put('vehicles', { name: 'Not allowed' });
    await driverStore.flush();
    expect(driverStore.pendingCount()).toBe(0);
    expect(driverStore.state.error).toMatch(/permission/);
  });
});

describe('team links', () => {
  it('builds and parses invitation links, trusting only puter.work', () => {
    globalThis.location ??= { href: 'https://fleet.puter.com/' };
    const link = inviteLink('https://fleet-abc123.puter.work', 'TOKENtoken1234567890');
    expect(link).toMatch(/#\/join\?w=fleet-abc123&t=TOKENtoken1234567890$/);
    const q = Object.fromEntries(new URLSearchParams(link.split('?')[1]));
    expect(parseJoin(q)).toEqual({ url: 'https://fleet-abc123.puter.work', token: 'TOKENtoken1234567890' });
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

  it('keeps numbers ahead of existing ones', async () => {
    expect((await w.api(OWNER, { op: 'next', kind: 'issue', atLeast: 57 })).body.number).toBe(57);
    expect((await w.api(OWNER, { op: 'next', kind: 'issue', atLeast: 1 })).body.number).toBe(58);
  });
});
