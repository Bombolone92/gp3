import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import { createWorkerBackend, parseJoin, inviteLink, isTrustedWorkerUrl, activeWorker } from '../src/team.js';
import { createStore } from '../src/core/store.js';
import { bumpPlan, metaSlot } from '../src/core/keys.js';
import { fakeKV, fakeFS } from './helpers.js';

const SOURCE = fs.readFileSync(new URL('../public/worker/childcare-team-worker.js', import.meta.url), 'utf8');

const person = (uuid, username) => ({ puter: { auth: { getUser: async () => ({ uuid, username }) } } });

function loadWorker() {
  const routes = [];
  const router = { get: (p, fn) => routes.push(['GET', p, fn]), post: (p, fn) => routes.push(['POST', p, fn]) };
  new Function('router', SOURCE)(router);
  const kv = fakeKV();
  const fsys = fakeFS();
  const me = { puter: { kv, fs: fsys, auth: { getUser: async () => ({ uuid: 'owner-1', username: 'director' }) } } };
  const handler = (method, path) => routes.find(([m, p]) => m === method && p === path)?.[2];
  const request = (url, init = {}) => {
    const r = new Request(url, init);
    return r;
  };
  return {
    kv,
    fsys,
    async api(user, body) {
      const res = await handler('POST', '/api')({ me, user, request: { json: async () => body, headers: new Headers() } });
      return { status: res.status, body: await res.json() };
    },
    async upload(user, path, blob) {
      const form = new FormData();
      form.append('path', path);
      form.append('file', blob, 'f');
      const res = await handler('POST', '/files')({ me, user, request: request('https://w.puter.work/files', { method: 'POST', body: form }) });
      return { status: res.status, body: await res.json() };
    },
    async download(user, query) {
      const res = await handler('GET', '/files')({ me, user, request: request(`https://w.puter.work/files?${new URLSearchParams(query)}`) });
      return res;
    },
    async health() {
      return (await handler('GET', '/health')({ me })).json();
    },
    exec(user) {
      return async (url, init) => handler('POST', '/api')({ me, user, request: { json: async () => JSON.parse(init.body), headers: new Headers() } });
    },
  };
}

const OWNER = person('owner-1', 'director');
const TEACHER = person('user-2', 'teacher');
const PARENT = person('user-3', 'parent');
const STRANGER = person('user-4', 'stranger');

let w;
beforeEach(() => {
  w = loadWorker();
});

/** A small school: two children, one family linked to the first. */
async function seed() {
  await w.api(OWNER, { op: 'put', coll: 'students', records: [{ id: 'kid1', firstName: 'Ava', roomId: 'r1', staffNotes: 'secret', allergies: '' }, { id: 'kid2', firstName: 'Ben', roomId: 'r2' }] });
  await w.api(OWNER, { op: 'put', coll: 'guardians', records: [{ id: 'g1', firstName: 'Mia', studentIds: ['kid1'], pin: '1234' }, { id: 'g2', firstName: 'Other', studentIds: ['kid2'], pin: '9999' }] });
  await w.api(OWNER, { op: 'put', coll: 'staff', records: [{ id: 't1', firstName: 'Tess', pin: '5555', phone: '1' }] });
  await w.api(OWNER, { op: 'put', coll: 'activities:2026-10-12', records: [{ id: 'a1', studentId: 'kid1', type: 'nap' }, { id: 'a2', studentId: 'kid1', type: 'observation', staffOnly: true }, { id: 'a3', studentId: 'kid2', type: 'meal', media: [{ path: 'media/2026-10/p2.jpg' }] }, { id: 'a4', studentId: 'kid1', type: 'photo', media: [{ path: 'media/2026-10/p1.jpg', thumb: 'media/2026-10/p1-t.jpg' }] }] });
  await w.api(OWNER, { op: 'put', coll: 'invoices', records: [{ id: 'i1', studentId: 'kid1' }, { id: 'i2', studentId: 'kid2' }] });
  await w.api(OWNER, { op: 'put', coll: 'events', records: [{ id: 'e1', roomIds: [] }, { id: 'e2', roomIds: ['r1'] }, { id: 'e3', roomIds: ['r2'] }] });
  await w.api(OWNER, { op: 'saveSettings', settings: { school: { name: 'Acorn' }, kioskPinHash: 'x', access: { parentsCanEditInfo: true } } });
}

async function join(user, invite) {
  const inv = (await w.api(OWNER, { op: 'invite', ...invite })).body;
  return w.api(user, { op: 'join', token: inv.token });
}

describe('school worker', () => {
  it('reports its build', async () => {
    expect(await w.health()).toEqual({ ok: true, build: '3' });
  });

  it('refuses callers without a session, and strangers', async () => {
    expect((await w.api(null, { op: 'meta', keys: ['cc1:meta'] })).status).toBe(401);
    expect((await w.api({ puter: { auth: { getUser: async () => { throw new Error('expired'); } } } }, { op: 'meta' })).status).toBe(401);
    const res = await w.api(STRANGER, { op: 'load', names: ['students'] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_a_member');
  });

  it('uses the same key layout as the app', async () => {
    await w.api(OWNER, { op: 'put', coll: 'activities:2026-10-12', records: [{ id: 'a' }] });
    expect(w.kv.data.has('cc1:r:activities:2026-10-12:a')).toBe(true);
    const names = ['students', 'settings', 'activities:2026-10-12', 'attendance:2026-09-01', 'messages:kid1'];
    const { items } = (await w.api(OWNER, { op: 'bump', names })).body;
    for (const n of names) expect(items[metaSlot(n).key][metaSlot(n).path], n).toBe(1);
    expect(Object.keys(items).sort()).toEqual(Object.keys(bumpPlan(names)).sort());
  });

  it('validates names, ids, and operations', async () => {
    expect((await w.api(OWNER, { op: 'load', names: ['secrets'] })).status).toBe(400);
    expect((await w.api(OWNER, { op: 'load', names: ['activities:../x'] })).status).toBe(400);
    expect((await w.api(OWNER, { op: 'put', coll: 'students', records: [{ id: '../x' }] })).status).toBe(400);
    expect((await w.api(OWNER, { op: 'nope' })).status).toBe(400);
    for (const op of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect((await w.api(OWNER, { op })).status, op).toBe(400);
  });

  it('runs the invitation flow and links the profile', async () => {
    await seed();
    const inv = (await w.api(OWNER, { op: 'invite', role: 'parent', guardianId: 'g1', label: 'Mia' })).body;
    expect(inv.token).toMatch(/^[A-Za-z0-9]{24}$/);
    expect([...w.kv.data.keys()].some((k) => k.includes(inv.token))).toBe(false); // stored hashed
    const joined = await w.api(PARENT, { op: 'join', token: inv.token });
    expect(joined.body).toMatchObject({ ok: true, role: 'parent', school: 'Acorn' });
    expect(w.kv.data.get('cc1:r:guardians:g1').memberUuid).toBe('user-3');
    // Single use.
    expect((await w.api(STRANGER, { op: 'join', token: inv.token })).status).toBe(410);
    const me = (await w.api(PARENT, { op: 'whoami' })).body;
    expect(me).toMatchObject({ role: 'parent', guardianId: 'g1', studentIds: ['kid1'] });
  });

  it('needs a real family profile to invite a family member', async () => {
    expect((await w.api(OWNER, { op: 'invite', role: 'parent', guardianId: 'nobody' })).status).toBe(400);
  });

  it('rejects expired and revoked invitations', async () => {
    const inv = (await w.api(OWNER, { op: 'invite', role: 'staff' })).body;
    const key = [...w.kv.data.keys()].find((k) => k.startsWith('cct:i:'));
    w.kv.data.set(key, { ...w.kv.data.get(key), expiresAt: Date.now() - 1 });
    expect((await w.api(TEACHER, { op: 'join', token: inv.token })).status).toBe(410);
    const inv2 = (await w.api(OWNER, { op: 'invite', role: 'staff' })).body;
    const id = (await w.api(OWNER, { op: 'invites' })).body.invites[0].id;
    await w.api(OWNER, { op: 'revokeInvite', id });
    expect((await w.api(TEACHER, { op: 'join', token: inv2.token })).status).toBe(410);
  });

  it('voids invitations made by an admin who was removed', async () => {
    await join(TEACHER, { role: 'admin' });
    const own = (await w.api(TEACHER, { op: 'invite', role: 'staff' })).body;
    await w.api(OWNER, { op: 'removeMember', uuid: 'user-2' });
    expect((await w.api(STRANGER, { op: 'join', token: own.token })).status).toBe(410);
  });

  it('only lets the director make admins', async () => {
    await join(TEACHER, { role: 'admin' });
    expect((await w.api(TEACHER, { op: 'invite', role: 'admin' })).status).toBe(403);
    expect((await w.api(TEACHER, { op: 'invite', role: 'staff' })).status).toBe(200);
  });
});

describe('staff access', () => {
  beforeEach(async () => {
    await seed();
    await join(TEACHER, { role: 'staff', staffId: 't1' });
  });

  it('reads classrooms but not billing, and never staff PINs', async () => {
    const { records } = (await w.api(TEACHER, { op: 'load', names: ['students', 'invoices', 'staff', 'activities:2026-10-12'] })).body;
    expect(records.students).toHaveLength(2);
    expect(records.invoices).toEqual([]);
    expect(records.staff[0].pin).toBeUndefined();
    expect(records['activities:2026-10-12']).toHaveLength(4);
  });

  it('logs activities but cannot touch billing, staff, settings, or people', async () => {
    expect((await w.api(TEACHER, { op: 'put', coll: 'activities:2026-10-12', records: [{ id: 'n1', studentId: 'kid2', type: 'note' }] })).status).toBe(200);
    expect((await w.api(TEACHER, { op: 'put', coll: 'invoices', records: [{ id: 'i9' }] })).status).toBe(403);
    expect((await w.api(TEACHER, { op: 'del', coll: 'payments', ids: ['p1'] })).status).toBe(403);
    expect((await w.api(TEACHER, { op: 'put', coll: 'staff', records: [{ id: 't1', pin: '0000' }] })).status).toBe(403);
    expect((await w.api(TEACHER, { op: 'saveSettings', settings: {} })).status).toBe(403);
    expect((await w.api(TEACHER, { op: 'members' })).status).toBe(403);
    expect((await w.api(TEACHER, { op: 'next', kind: 'invoice' })).status).toBe(403);
  });
});

describe('family access', () => {
  beforeEach(async () => {
    await seed();
    await join(PARENT, { role: 'parent', guardianId: 'g1' });
  });

  const load = async (names) => (await w.api(PARENT, { op: 'load', names })).body.records;

  it('sees only their own child, without staff notes', async () => {
    const r = await load(['students', 'guardians', 'invoices', 'events']);
    expect(r.students.map((s) => s.id)).toEqual(['kid1']);
    expect(r.students[0].staffNotes).toBeUndefined();
    expect(r.guardians.map((g) => g.id)).toEqual(['g1']);
    expect(r.invoices.map((i) => i.id)).toEqual(['i1']);
    expect(r.events.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('sees shared activities for their child only', async () => {
    const r = await load(['activities:2026-10-12']);
    expect(r['activities:2026-10-12'].map((a) => a.id).sort()).toEqual(['a1', 'a4']);
  });

  it('cannot read another family\'s conversation, or the kiosk PIN', async () => {
    await w.api(OWNER, { op: 'put', coll: 'messages:kid2', records: [{ id: 'm1', text: 'private' }] });
    expect((await load(['messages:kid2']))['messages:kid2']).toEqual([]);
    expect((await w.api(PARENT, { op: 'settings' })).body.settings.kioskPinHash).toBeUndefined();
    const meta = (await w.api(OWNER, { op: 'bump', names: ['messages:kid1', 'messages:kid2'] })).body.items;
    expect(Object.keys(meta['cc1:meta:m']).sort()).toEqual(['tkid1', 'tkid2']);
    const mine = (await w.api(PARENT, { op: 'meta', keys: ['cc1:meta:m'] })).body.items['cc1:meta:m'];
    expect(Object.keys(mine)).toEqual(['tkid1']);
  });

  it('can message about their own child, as themselves only', async () => {
    const ok = await w.api(PARENT, { op: 'put', coll: 'messages:kid1', records: [{ id: 'm1', from: 'staff', author: 'Mia', authorUuid: 'someone-else', text: 'Hi' }] });
    expect(ok.status).toBe(200);
    const stored = w.kv.data.get('cc1:r:messages:kid1:m1');
    expect(stored).toMatchObject({ from: 'family', authorUuid: 'user-3', text: 'Hi' });
    expect((await w.api(PARENT, { op: 'put', coll: 'messages:kid2', records: [{ id: 'm2', text: 'x' }] })).status).toBe(403);
    await w.api(OWNER, { op: 'put', coll: 'messages:kid1', records: [{ id: 'm3', from: 'staff', text: 'From teacher' }] });
    expect((await w.api(PARENT, { op: 'put', coll: 'messages:kid1', records: [{ id: 'm3', text: 'edited' }] })).status).toBe(403);
  });

  it('can report an absence but not check in or rewrite attendance', async () => {
    const res = await w.api(PARENT, { op: 'put', coll: 'attendance:2026-10-13', records: [{ id: 's-kid1', studentId: 'kid1', events: [{ type: 'in', at: '08:00' }], absent: { reason: 'Sick' } }] });
    expect(res.status).toBe(200);
    const stored = w.kv.data.get('cc1:r:attendance:2026-10-13:s-kid1');
    expect(stored.events).toEqual([]);
    expect(stored.absent).toMatchObject({ reason: 'Sick', byFamily: true });
    expect((await w.api(PARENT, { op: 'put', coll: 'attendance:2026-10-13', records: [{ id: 's-kid2', studentId: 'kid2', absent: { reason: 'x' } }] })).status).toBe(403);
    await w.api(OWNER, { op: 'put', coll: 'attendance:2026-10-14', records: [{ id: 's-kid1', studentId: 'kid1', events: [{ type: 'in', at: '08:00' }] }] });
    expect((await w.api(PARENT, { op: 'put', coll: 'attendance:2026-10-14', records: [{ id: 's-kid1', studentId: 'kid1', absent: { reason: 'x' } }] })).status).toBe(409);
  });

  it('can update health details only, and only when allowed', async () => {
    await w.api(PARENT, { op: 'put', coll: 'students', records: [{ id: 'kid1', allergies: 'Peanuts', staffNotes: 'hacked', roomId: 'r2' }] });
    const s = w.kv.data.get('cc1:r:students:kid1');
    expect(s).toMatchObject({ allergies: 'Peanuts', staffNotes: 'secret', roomId: 'r1' });
    await w.api(OWNER, { op: 'saveSettings', settings: { access: { parentsCanEditInfo: false } } });
    expect((await w.api(PARENT, { op: 'put', coll: 'students', records: [{ id: 'kid1', allergies: 'None' }] })).status).toBe(403);
  });

  it('cannot write anything else or delete', async () => {
    expect((await w.api(PARENT, { op: 'put', coll: 'activities:2026-10-12', records: [{ id: 'z', studentId: 'kid1' }] })).status).toBe(403);
    expect((await w.api(PARENT, { op: 'put', coll: 'invoices', records: [{ id: 'i1', studentId: 'kid1', status: 'void' }] })).status).toBe(403);
    expect((await w.api(PARENT, { op: 'del', coll: 'messages:kid1', ids: ['m1'] })).status).toBe(403);
    expect((await w.api(PARENT, { op: 'invite', role: 'parent', guardianId: 'g1' })).status).toBe(403);
  });

  it('loses access to a child as soon as the school unlinks them', async () => {
    await w.api(OWNER, { op: 'put', coll: 'guardians', records: [{ id: 'g1', firstName: 'Mia', studentIds: [] }] });
    expect((await load(['students'])).students).toEqual([]);
  });
});

describe('files', () => {
  beforeEach(async () => {
    await seed();
    await join(PARENT, { role: 'parent', guardianId: 'g1' });
  });

  it('stores uploads in the director\'s drive', async () => {
    const res = await w.upload(OWNER, 'media/2026-10/p1.jpg', new Blob(['jpg'], { type: 'image/jpeg' }));
    expect(res.body.ok).toBe(true);
    expect(w.fsys.files.has('childcare-team/media/2026-10/p1.jpg')).toBe(true);
    expect((await w.upload(OWNER, '../etc/passwd', new Blob(['x']))).status).toBe(400);
  });

  it('serves a family the photos of their child\'s shared entries only', async () => {
    await w.upload(OWNER, 'media/2026-10/p1.jpg', new Blob(['mine'], { type: 'image/jpeg' }));
    await w.upload(OWNER, 'media/2026-10/p2.jpg', new Blob(['theirs'], { type: 'image/jpeg' }));
    const ok = await w.download(PARENT, { path: 'media/2026-10/p1.jpg', ref: 'activities:2026-10-12', id: 'a4' });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('mine');
    expect((await w.download(PARENT, { path: 'media/2026-10/p2.jpg', ref: 'activities:2026-10-12', id: 'a3' })).status).toBe(404);
    expect((await w.download(PARENT, { path: 'media/2026-10/p2.jpg', ref: 'activities:2026-10-12', id: 'a4' })).status).toBe(404);
    expect((await w.download(PARENT, { path: 'media/2026-10/p2.jpg' })).status).toBe(404);
    expect((await w.download(OWNER, { path: 'media/2026-10/p2.jpg' })).status).toBe(200);
  });

  it('lets families attach files only to their own conversation', async () => {
    expect((await w.upload(PARENT, 'messages/kid1/f.jpg', new Blob(['x']))).status).toBe(200);
    expect((await w.upload(PARENT, 'messages/kid2/f.jpg', new Blob(['x']))).status).toBe(403);
    expect((await w.upload(PARENT, 'media/2026-10/f.jpg', new Blob(['x']))).status).toBe(403);
    expect((await w.download(PARENT, { path: 'messages/kid1/f.jpg' })).status).toBe(200);
  });

  it('keeps student documents from families', async () => {
    await w.upload(OWNER, 'students/kid1/report.pdf', new Blob(['doc']));
    expect((await w.download(PARENT, { path: 'students/kid1/report.pdf' })).status).toBe(404);
  });
});

describe('hardening', () => {
  beforeEach(async () => {
    await seed();
  });

  it('keeps staff from widening what a family can see or changing tuition', async () => {
    await join(TEACHER, { role: 'staff', staffId: 't1' });
    await join(PARENT, { role: 'parent', guardianId: 'g1' });
    await w.api(OWNER, { op: 'put', coll: 'students', records: [{ id: 'kid1', firstName: 'Ava', plans: [{ planId: 'p1' }] }] });
    await w.api(TEACHER, { op: 'put', coll: 'guardians', records: [{ id: 'g1', firstName: 'Mia', studentIds: ['kid1', 'kid2'], memberUuid: 'x' }] });
    expect(w.kv.data.get('cc1:r:guardians:g1')).toMatchObject({ studentIds: ['kid1'], memberUuid: 'user-3' });
    await w.api(TEACHER, { op: 'put', coll: 'students', records: [{ id: 'kid1', firstName: 'Ava B', plans: [{ planId: 'p1', amountCents: 0 }] }] });
    expect(w.kv.data.get('cc1:r:students:kid1')).toMatchObject({ firstName: 'Ava B', plans: [{ planId: 'p1' }] });
    // Families who have not signed up can still be linked by staff.
    await w.api(TEACHER, { op: 'put', coll: 'guardians', records: [{ id: 'g2', firstName: 'Other', studentIds: ['kid2', 'kid1'] }] });
    expect(w.kv.data.get('cc1:r:guardians:g2').studentIds).toEqual(['kid2', 'kid1']);
  });

  it('records who signed up itself, never from a client', async () => {
    await w.api(OWNER, { op: 'put', coll: 'guardians', records: [{ id: 'g9', firstName: 'Fake', studentIds: ['kid1'], memberUuid: 'user-3' }] });
    expect(w.kv.data.get('cc1:r:guardians:g9').memberUuid).toBeUndefined();
  });

  it('shows staff only public details of colleagues', async () => {
    await w.api(OWNER, { op: 'put', coll: 'staff', records: [{ id: 't2', firstName: 'Ola', notes: 'review due', pin: '1111', certifications: [{ name: 'CPR' }] }] });
    await join(TEACHER, { role: 'staff', staffId: 't1' });
    const { staff } = (await w.api(TEACHER, { op: 'load', names: ['staff'] })).body.records;
    const other = staff.find((m) => m.id === 't2');
    expect(other.notes).toBeUndefined();
    expect(other.pin).toBeUndefined();
    expect(other.certifications).toBeUndefined();
  });

  it('stamps family messages and threads with the server clock and their real name', async () => {
    await join(PARENT, { role: 'parent', guardianId: 'g1' });
    await w.api(PARENT, { op: 'put', coll: 'messages:kid1', records: [{ id: 'm1', at: '9999-01-01T00:00:00.000Z', author: 'Director', text: 'Hi' }] });
    const m = w.kv.data.get('cc1:r:messages:kid1:m1');
    expect(m.author).toBe('Mia');
    expect(m.at < '9999').toBe(true);
    await w.api(PARENT, { op: 'put', coll: 'threads', records: [{ id: 'kid1', lastAt: '9999-01-01T00:00:00.000Z', lastFrom: 'family', lastText: 'Hi', lastAuthor: 'Director', familyReadAt: { 'user-3': '9999-01-01T00:00:00.000Z' } }] });
    const t = w.kv.data.get('cc1:r:threads:kid1');
    expect(t.lastAt < '9999').toBe(true);
    expect(t.lastAuthor).toBe('Mia');
    expect(t.familyReadAt['user-3'] < '9999').toBe(true);
  });

  it('does not let a family overwrite an absence the school recorded', async () => {
    await join(PARENT, { role: 'parent', guardianId: 'g1' });
    await w.api(OWNER, { op: 'put', coll: 'attendance:2026-10-15', records: [{ id: 's-kid1', kind: 'student', studentId: 'kid1', events: [], absent: { reason: 'Vacation' } }] });
    expect((await w.api(PARENT, { op: 'put', coll: 'attendance:2026-10-15', records: [{ id: 's-kid1', studentId: 'kid1', absent: null }] })).status).toBe(403);
  });

  it('lets families announce changes only to what they can write', async () => {
    await join(PARENT, { role: 'parent', guardianId: 'g1' });
    const { items } = (await w.api(PARENT, { op: 'bump', names: ['invoices', 'staff', 'messages:kid2', 'threads'] })).body;
    expect(Object.keys(items)).toEqual(['cc1:meta']);
    expect(items['cc1:meta'].threads).toBe(1);
    expect(items['cc1:meta'].invoices).toBeUndefined();
    expect(items['cc1:meta'].staff).toBeUndefined();
  });

  it('never removes the director', async () => {
    await join(TEACHER, { role: 'admin' });
    expect((await w.api(TEACHER, { op: 'removeMember', uuid: 'owner-1' })).status).toBe(403);
  });

  it('checks kiosk PINs for staff devices, and the exit PIN', async () => {
    await join(TEACHER, { role: 'staff', staffId: 't1' });
    expect((await w.api(TEACHER, { op: 'kioskLookup', pin: '5555' })).body.match).toEqual({ kind: 'staff', id: 't1' });
    expect((await w.api(TEACHER, { op: 'kioskLookup', pin: '1234' })).body.match).toEqual({ kind: 'guardian', id: 'g1' });
    expect((await w.api(TEACHER, { op: 'kioskLookup', pin: '0000' })).body.match).toBeNull();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('4321')))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await w.api(OWNER, { op: 'saveSettings', settings: { kioskPinHash: hash } });
    expect((await w.api(TEACHER, { op: 'kioskExit', pin: '' })).body.match).toBe(false);
    expect((await w.api(TEACHER, { op: 'kioskExit', pin: '4321' })).body.match).toBe(true);
    await join(PARENT, { role: 'parent', guardianId: 'g1' });
    expect((await w.api(PARENT, { op: 'kioskLookup', pin: '5555' })).status).toBe(403);
  });
});

describe('the app on top of the worker', () => {
  it('syncs a staff device and a family device through the worker backend', async () => {
    await seed();
    await join(TEACHER, { role: 'staff' });
    await join(PARENT, { role: 'parent', guardianId: 'g1' });
    const url = 'https://childcare-abc.puter.work';
    const mk = (user) => createStore({ backend: createWorkerBackend(url, { getPuter: () => ({ workers: { exec: w.exec(user) } }) }), flushDelay: 0 });
    const staff = mk(TEACHER);
    const family = mk(PARENT);
    await staff.init();
    await family.init();
    expect(family.all('students').map((s) => s.id)).toEqual(['kid1']);
    await staff.open(['activities:2026-10-13']);
    await family.open(['activities:2026-10-13']);
    staff.put('activities:2026-10-13', { type: 'nap', studentId: 'kid1' });
    staff.put('activities:2026-10-13', { type: 'nap', studentId: 'kid2' });
    staff.put('activities:2026-10-13', { type: 'note', studentId: 'kid1', staffOnly: true });
    await staff.flush();
    await family.sync();
    expect(family.all('activities:2026-10-13').map((a) => a.studentId)).toEqual(['kid1']);
  });
});

describe('team links', () => {
  it('builds and parses invitation links, trusting only puter.work', () => {
    globalThis.location ??= { href: 'https://childcare.puter.com/' };
    const link = inviteLink('https://childcare-abc123.puter.work', 'TOKENtoken1234567890');
    expect(link).toMatch(/#\/join\?w=childcare-abc123&t=TOKENtoken1234567890$/);
    const q = Object.fromEntries(new URLSearchParams(link.split('?')[1]));
    expect(parseJoin(q)).toEqual({ url: 'https://childcare-abc123.puter.work', token: 'TOKENtoken1234567890' });
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
