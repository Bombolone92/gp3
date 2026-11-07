import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createPuterBackend } from '../src/core/backend.js';
import { createStore } from '../src/core/store.js';
import { createWorkerBackend, parseJoin, isTrustedWorkerUrl, activeWorker, inviteLink } from '../src/team.js';

/**
 * A fake of the parts of puter.kv the app uses, following the documented
 * semantics: prefix list with cursor paging and optional values, batch set,
 * and incr with a path map that returns the whole object.
 */
function fakeKV({ pageSize = 1000 } = {}) {
  const data = new Map();
  const calls = { list: 0, set: 0, get: 0, incr: 0, del: 0 };
  return {
    data,
    calls,
    async get(k) {
      calls.get++;
      return data.has(k) ? structuredClone(data.get(k)) : null;
    },
    async set(k, v) {
      calls.set++;
      if (Array.isArray(k)) for (const it of k) data.set(it.key, structuredClone(it.value));
      else data.set(k, structuredClone(v));
      return true;
    },
    async del(k) {
      calls.del++;
      data.delete(k);
      return true;
    },
    async expire() {
      return true;
    },
    async incr(k, paths) {
      calls.incr++;
      if (typeof paths === 'number') {
        const n = (Number(data.get(k)) || 0) + paths;
        data.set(k, n);
        return n;
      }
      const cur = data.get(k) || {};
      for (const [p, n] of Object.entries(paths)) cur[p] = (cur[p] || 0) + n;
      data.set(k, cur);
      return structuredClone(cur);
    },
    async list({ pattern, returnValues, limit = pageSize, cursor }) {
      calls.list++;
      const keys = [...data.keys()].filter((k) => k.startsWith(pattern)).sort();
      const start = cursor ? Number(cursor) : 0;
      const n = Math.min(limit, pageSize);
      const slice = keys.slice(start, start + n);
      return { items: slice.map((k) => (returnValues ? { key: k, value: structuredClone(data.get(k)) } : k)), cursor: start + n < keys.length ? String(start + n) : undefined };
    },
  };
}

describe('Puter KV backend', () => {
  it('stores one item per record under a collection prefix', async () => {
    const kv = fakeKV();
    const b = createPuterBackend({ kv });
    await b.putRecords('matters', [
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ]);
    expect([...kv.data.keys()].sort()).toEqual(['lg1:r:matters:a', 'lg1:r:matters:b']);
    expect(kv.calls.set).toBe(1); // one batch write
  });

  it('pages through large collections with the cursor', async () => {
    const kv = fakeKV({ pageSize: 3 });
    const b = createPuterBackend({ kv });
    const recs = Array.from({ length: 10 }, (_, i) => ({ id: `r${String(i).padStart(2, '0')}` }));
    await b.putRecords('activities', recs);
    const out = await b.loadCollection('activities');
    expect(out).toHaveLength(10);
    expect(kv.calls.list).toBe(4);
  });

  it('does not mix collections that share a name prefix', async () => {
    const kv = fakeKV();
    const b = createPuterBackend({ kv });
    await b.putRecords('tasks', [{ id: 'x' }]);
    await b.putRecords('taskLists', [{ id: 'y' }]);
    expect((await b.loadCollection('tasks')).map((r) => r.id)).toEqual(['x']);
  });

  it('bumps versions and numbers atomically with incr', async () => {
    const kv = fakeKV();
    const b = createPuterBackend({ kv });
    expect(await b.bumpVersions(['matters', 'bills'])).toEqual({ matters: 1, bills: 1 });
    expect(await b.nextNumber('bill', 1)).toBe(1);
    expect(await b.nextNumber('bill', 40)).toBe(40);
    expect(await b.nextNumber('bill', 1)).toBe(41);
  });

  it('runs the store end to end', async () => {
    const kv = fakeKV();
    const store = createStore({ backend: createPuterBackend({ kv }), flushDelay: 0 });
    await store.init();
    const t = store.put('tasks', { name: 'File motion' });
    await store.flush();
    store.remove('tasks', t.id);
    await store.flush();
    expect([...kv.data.keys()].filter((k) => k.startsWith('lg1:r:'))).toEqual([]);
    expect(kv.data.get('lg1:meta').tasks).toBe(2);
  });
});

// ---- Team worker -------------------------------------------------------------------

const SOURCE = fs.readFileSync(new URL('../public/worker/legal-team-worker.js', import.meta.url), 'utf8');
const person = (uuid, username) => ({ puter: { auth: { getUser: async () => ({ uuid, username }) } } });

function loadWorker() {
  const routes = [];
  const router = { get: (p, fn) => routes.push(['GET', p, fn]), post: (p, fn) => routes.push(['POST', p, fn]) };
  new Function('router', SOURCE)(router);
  const kv = fakeKV();
  const files = new Map();
  const fsys = {
    async write(p, blob) {
      files.set(p, blob);
    },
    async read(p) {
      if (!files.has(p)) throw new Error('not found');
      return files.get(p);
    },
    async delete(p) {
      files.delete(p);
    },
  };
  const me = { puter: { kv, fs: fsys, auth: { getUser: async () => ({ uuid: 'owner-1', username: 'eleanor' }) } } };
  const handler = (method, path) => routes.find(([m, p]) => m === method && p === path)?.[2];
  const api = async (user, body) => {
    const res = await handler('POST', '/api')({ me, user, request: { json: async () => body } });
    return { status: res.status, body: await res.json() };
  };
  const exec = (user) => async (url, init) => {
    const res = await handler('POST', '/api')({ me, user, request: { json: async () => JSON.parse(init.body) } });
    return res;
  };
  return { kv, me, files, fsys, api, exec, health: async () => (await handler('GET', '/health')({ me })).json() };
}

describe('firm team worker', () => {
  const owner = person('owner-1', 'eleanor');
  const daniel = person('u-2', 'daniel');
  const stranger = person('u-9', 'mallory');

  it('reports its build', async () => {
    const w = loadWorker();
    expect(await w.health()).toEqual({ ok: true, build: '3' });
  });

  it('requires a session and membership', async () => {
    const w = loadWorker();
    expect((await w.api(null, { op: 'meta' })).status).toBe(401);
    expect((await w.api(stranger, { op: 'meta' })).status).toBe(403);
    expect((await w.api(owner, { op: 'meta' })).status).toBe(200);
  });

  it('lets an invited person join exactly once, and identifies them from their session', async () => {
    const w = loadWorker();
    const inv = (await w.api(owner, { op: 'invite', role: 'member' })).body;
    // The body cannot claim to be someone else.
    const joined = await w.api(daniel, { op: 'join', token: inv.token, uuid: 'owner-1' });
    expect(joined.body).toMatchObject({ ok: true, role: 'member' });
    expect(w.kv.data.has('lgt:m:u-2')).toBe(true);
    expect((await w.api(stranger, { op: 'join', token: inv.token })).status).toBe(410);
    expect((await w.api(daniel, { op: 'members' })).status).toBe(403);
    expect((await w.api(daniel, { op: 'put', coll: 'matters', records: [{ id: 'm1' }] })).status).toBe(200);
  });

  it('stores invite tokens only as hashes', async () => {
    const w = loadWorker();
    const { token } = (await w.api(owner, { op: 'invite' })).body;
    const raw = JSON.stringify([...w.kv.data.entries()]);
    expect(raw).not.toContain(token);
  });

  it('validates collections, ids, and file paths', async () => {
    const w = loadWorker();
    expect((await w.api(owner, { op: 'put', coll: 'secrets', records: [{ id: 'a' }] })).status).toBe(400);
    expect((await w.api(owner, { op: 'put', coll: 'matters', records: [{ id: '../x' }] })).status).toBe(400);
    expect((await w.api(owner, { op: 'fileWrite', path: '../etc/passwd', data: 'aGk=' })).status).toBe(400);
    expect((await w.api(owner, { op: 'fileWrite', path: 'docs/m1/a.txt', data: 'aGk=', type: 'text/plain' })).status).toBe(200);
    expect(w.files.has('legal-team/docs/m1/a.txt')).toBe(true);
  });

  it('says so when a document file is missing', async () => {
    const w = loadWorker();
    const res = await w.api(owner, { op: 'fileRead', path: 'docs/m1/x-missing.pdf' });
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not on the firm server/);
  });

  it('only touches single document files, never whole folders', async () => {
    const w = loadWorker();
    await w.api(owner, { op: 'fileWrite', path: 'docs/m1/a.txt', data: 'aGk=' });
    await w.api(owner, { op: 'fileWrite', path: 'docs/m2/b.txt', data: 'aGk=' });
    const deleted = [];
    w.fsys.delete = async (p) => void deleted.push(p);
    for (const path of ['docs/m1', 'docs/m1/.', 'docs/./m1', 'docs/m1/', 'docs/.', 'docs/m1/a.txt/x']) {
      expect((await w.api(owner, { op: 'fileDelete', path })).status, path).toBe(400);
    }
    expect(deleted).toEqual([]);
    expect((await w.api(owner, { op: 'fileDelete', path: 'docs/m1/a.txt' })).status).toBe(200);
    expect(deleted).toEqual(['legal-team/docs/m1/a.txt']);
  });

  it('runs the app store unchanged through the worker backend', async () => {
    const w = loadWorker();
    const backend = createWorkerBackend('https://legalfirm-abc.puter.work', { getPuter: () => ({ workers: { exec: w.exec(owner) } }) });
    const store = createStore({ backend, flushDelay: 0 });
    await store.init();
    store.put('matters', { description: 'Shared matter' });
    await store.flush();
    expect([...w.kv.data.keys()].some((k) => k.startsWith('lg1:r:matters:'))).toBe(true);
    expect(await store.nextNumber('matters')).toBe(1);
  });

  it('lets only the owner manage admins', async () => {
    const w = loadWorker();
    const a1 = (await w.api(owner, { op: 'invite', role: 'admin' })).body;
    await w.api(daniel, { op: 'join', token: a1.token });
    const a2 = (await w.api(owner, { op: 'invite', role: 'admin' })).body;
    await w.api(person('u-3', 'sofia'), { op: 'join', token: a2.token });
    // An admin cannot demote, remove, or mint another admin.
    expect((await w.api(daniel, { op: 'setRole', uuid: 'u-3', role: 'member' })).status).toBe(403);
    expect((await w.api(daniel, { op: 'removeMember', uuid: 'u-3' })).status).toBe(403);
    expect((await w.api(daniel, { op: 'invite', role: 'admin' })).status).toBe(403);
    expect((await w.api(daniel, { op: 'invite', role: 'member' })).status).toBe(200);
    expect((await w.api(owner, { op: 'setRole', uuid: 'u-3', role: 'member' })).status).toBe(200);
  });

  it('keeps an invitation when the firm server briefly cannot check its sender', async () => {
    const w = loadWorker();
    const inv = (await w.api(owner, { op: 'invite' })).body;
    // A freshly started server that cannot identify its owner at that moment.
    const fresh = loadWorker();
    fresh.me.puter.kv = w.kv;
    const getUser = fresh.me.puter.auth.getUser;
    fresh.me.puter.auth.getUser = async () => {
      throw new Error('503');
    };
    expect((await fresh.api(daniel, { op: 'join', token: inv.token })).status).toBe(503);
    fresh.me.puter.auth.getUser = getUser;
    expect((await fresh.api(daniel, { op: 'join', token: inv.token })).body).toMatchObject({ ok: true, role: 'member' });
  });

  it('does not tell the owner they are not a member when it cannot identify them', async () => {
    const w = loadWorker();
    w.me.puter.auth.getUser = async () => {
      throw new Error('503');
    };
    const res = await w.api(owner, { op: 'meta' });
    expect(res.status).toBe(503);
    expect(res.body.error).not.toBe('not_a_member');
  });

  it('redeems an invitation only once even when two people race', async () => {
    const w = loadWorker();
    const inv = (await w.api(owner, { op: 'invite' })).body;
    const [a, b] = await Promise.all([w.api(daniel, { op: 'join', token: inv.token }), w.api(stranger, { op: 'join', token: inv.token })]);
    expect([a.status, b.status].sort()).toEqual([200, 410]);
  });

  it('lets a member leave the firm for good, but not the owner', async () => {
    const w = loadWorker();
    const inv = (await w.api(owner, { op: 'invite', role: 'admin' })).body;
    await w.api(daniel, { op: 'join', token: inv.token });
    const second = (await w.api(daniel, { op: 'invite' })).body;
    expect((await w.api(daniel, { op: 'leave' })).status).toBe(200);
    expect((await w.api(daniel, { op: 'meta' })).status).toBe(403);
    expect((await w.api(owner, { op: 'members' })).body.members).toEqual([]);
    // Invitations they sent stop working with them.
    expect((await w.api(stranger, { op: 'join', token: second.token })).status).toBe(410);
    expect((await w.api(owner, { op: 'leave' })).status).toBe(400);
  });

  it('demoting an admin revokes the invitations they sent', async () => {
    const w = loadWorker();
    const inv = (await w.api(owner, { op: 'invite', role: 'admin' })).body;
    await w.api(daniel, { op: 'join', token: inv.token });
    const second = (await w.api(daniel, { op: 'invite', label: 'Paralegal' })).body;
    expect((await w.api(owner, { op: 'invites' })).body.invites).toHaveLength(1);
    await w.api(owner, { op: 'setRole', uuid: 'u-2', role: 'member' });
    expect((await w.api(owner, { op: 'invites' })).body.invites).toEqual([]);
    expect((await w.api(stranger, { op: 'join', token: second.token })).status).toBe(410);
  });

  it('refuses to remove someone who is not a member, keeping the invitations they sent', async () => {
    const w = loadWorker();
    const a = (await w.api(owner, { op: 'invite', role: 'admin' })).body;
    await w.api(daniel, { op: 'join', token: a.token });
    const ownerInvite = (await w.api(owner, { op: 'invite', role: 'member' })).body;
    // An admin naming the owner (or anyone else not in the firm) changes nothing.
    const res = await w.api(daniel, { op: 'removeMember', uuid: 'owner-1' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_a_member');
    expect((await w.api(owner, { op: 'invites' })).body.invites).toHaveLength(1);
    expect((await w.api(stranger, { op: 'join', token: ownerInvite.token })).status).toBe(200);
  });

  it('lets only the owner revoke an invitation to become an admin', async () => {
    const w = loadWorker();
    const a = (await w.api(owner, { op: 'invite', role: 'admin' })).body;
    await w.api(daniel, { op: 'join', token: a.token });
    await w.api(owner, { op: 'invite', role: 'admin', label: 'Partner' });
    await w.api(owner, { op: 'invite', role: 'member', label: 'Clerk' });
    const list = (await w.api(owner, { op: 'invites' })).body.invites;
    const adminInv = list.find((i) => i.label === 'Partner');
    const memberInv = list.find((i) => i.label === 'Clerk');
    expect((await w.api(daniel, { op: 'revokeInvite', id: adminInv.id })).status).toBe(403);
    expect((await w.api(daniel, { op: 'revokeInvite', id: memberInv.id })).status).toBe(200);
    expect((await w.api(owner, { op: 'invites' })).body.invites.map((i) => i.label)).toEqual(['Partner']);
    expect((await w.api(owner, { op: 'revokeInvite', id: adminInv.id })).status).toBe(200);
  });

  it('removing a member revokes their invitations', async () => {
    const w = loadWorker();
    const inv = (await w.api(owner, { op: 'invite', role: 'admin' })).body;
    await w.api(daniel, { op: 'join', token: inv.token });
    const second = (await w.api(daniel, { op: 'invite' })).body;
    await w.api(owner, { op: 'removeMember', uuid: 'u-2' });
    expect((await w.api(daniel, { op: 'meta' })).status).toBe(403);
    expect((await w.api(stranger, { op: 'join', token: second.token })).status).toBe(410);
  });
});

describe('team links', () => {
  it('only trusts Puter worker hosts', () => {
    expect(isTrustedWorkerUrl('https://legalfirm-x1.puter.work')).toBe(true);
    expect(isTrustedWorkerUrl('http://legalfirm-x1.puter.work')).toBe(false);
    expect(isTrustedWorkerUrl('https://evil.example.com')).toBe(false);
    expect(isTrustedWorkerUrl('https://a.puter.work/api')).toBe(false);
  });

  it('parses invitation links strictly', () => {
    expect(parseJoin({ w: 'legalfirm-abc123', t: 'AbCdEfGh1234' })).toEqual({ url: 'https://legalfirm-abc123.puter.work', token: 'AbCdEfGh1234' });
    expect(parseJoin({ w: 'evil.com/x', t: 'AbCdEfGh1234' })).toBeNull();
    expect(parseJoin({ w: 'legalfirm-abc', t: 'short' })).toBeNull();
  });

  it('round-trips an invite link', () => {
    globalThis.location = { href: 'https://legal.puter.com/?x=1#/settings' };
    const link = inviteLink('https://legalfirm-abc.puter.work', 'AbCdEfGh1234');
    expect(link).toBe('https://legal.puter.com/#/join?w=legalfirm-abc&t=AbCdEfGh1234');
    const q = Object.fromEntries(new URLSearchParams(link.split('?')[1]));
    expect(parseJoin(q).url).toBe('https://legalfirm-abc.puter.work');
  });

  it('chooses the active firm', () => {
    expect(activeWorker({ current: 'own', own: {}, joined: [] })).toBeNull();
    expect(activeWorker({ current: 'own', own: { url: 'https://o.puter.work' }, joined: [] })).toBe('https://o.puter.work');
    expect(activeWorker({ current: 'https://j.puter.work', own: {}, joined: [{ url: 'https://j.puter.work' }] })).toBe('https://j.puter.work');
  });
});
