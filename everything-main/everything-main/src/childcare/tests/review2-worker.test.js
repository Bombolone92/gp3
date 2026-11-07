/**
 * Regression tests from the second adversarial review of the school worker
 * and the team client (src/team.js). Each test names the issue it guards.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { isUnread } from '../src/core/messages.js';
import { fakeKV, fakeFS } from './helpers.js';

const SOURCE = fs.readFileSync(new URL('../public/worker/childcare-team-worker.js', import.meta.url), 'utf8');

const person = (uuid, username) => ({ puter: { auth: { getUser: async () => ({ uuid, username }) } } });

/** The worker with Puter's fs semantics for `overwrite: false`. */
function strictFS() {
  const f = fakeFS();
  const write = f.write;
  f.write = async (path, blob, opts = {}) => {
    if (opts.overwrite === false && f.files.has(path)) throw Object.assign(new Error('exists'), { code: 'item_with_same_name_exists' });
    return write(path, blob, opts);
  };
  return f;
}

function loadWorker() {
  const routes = [];
  const router = { get: (p, fn) => routes.push(['GET', p, fn]), post: (p, fn) => routes.push(['POST', p, fn]) };
  new Function('router', SOURCE)(router);
  const kv = fakeKV();
  const fsys = strictFS();
  const me = { puter: { kv, fs: fsys, auth: { getUser: async () => ({ uuid: 'owner-1', username: 'director' }) } } };
  const handler = (method, path) => routes.find(([m, p]) => m === method && p === path)?.[2];
  return {
    kv,
    fsys,
    handler,
    me,
    async api(user, body) {
      const res = await handler('POST', '/api')({ me, user, request: { json: async () => body, headers: new Headers() } });
      return { status: res.status, body: await res.json() };
    },
    async upload(user, path, blob) {
      const form = new FormData();
      form.append('path', path);
      form.append('file', blob, 'f');
      const res = await handler('POST', '/files')({ me, user, request: new Request('https://w.puter.work/files', { method: 'POST', body: form }) });
      return { status: res.status, body: await res.json() };
    },
    async download(user, query) {
      return handler('GET', '/files')({ me, user, request: new Request(`https://w.puter.work/files?${new URLSearchParams(query)}`) });
    },
  };
}

const OWNER = person('owner-1', 'director');
const TEACHER = person('user-2', 'teacher');
const PARENT = person('user-3', 'parent');

let w;
beforeEach(() => {
  w = loadWorker();
});

async function seed() {
  await w.api(OWNER, { op: 'put', coll: 'students', records: [{ id: 'kid1', firstName: 'Ava', roomId: 'r1', doctor: { name: 'Dr A', phone: '1' }, allergies: '' }, { id: 'kid2', firstName: 'Ben', roomId: 'r2' }] });
  await w.api(OWNER, { op: 'put', coll: 'guardians', records: [{ id: 'g1', firstName: 'Mia', studentIds: ['kid1'], pin: '1234' }, { id: 'g2', firstName: 'Other', studentIds: ['kid2'], pin: '9999' }] });
  await w.api(OWNER, { op: 'put', coll: 'staff', records: [{ id: 't1', firstName: 'Tess', pin: '5555' }, { id: 't2', firstName: 'Ola', pin: '7777' }] });
  await w.api(OWNER, { op: 'saveSettings', settings: { school: { name: 'Acorn' }, access: {} } });
}

async function join(user, invite) {
  const inv = (await w.api(OWNER, { op: 'invite', ...invite })).body;
  return w.api(user, { op: 'join', token: inv.token });
}

describe('worker: staff cannot widen a signed-up family', () => {
  it('refuses a staff delete of a signed-up family member (delete + re-create would relink their children)', async () => {
    await seed();
    await join(TEACHER, { role: 'staff', staffId: 't1' });
    await join(PARENT, { role: 'parent', guardianId: 'g1' });
    const del = await w.api(TEACHER, { op: 'del', coll: 'guardians', ids: ['g1'] });
    expect(del.status).toBe(403);
    await w.api(TEACHER, { op: 'put', coll: 'guardians', records: [{ id: 'g1', firstName: 'Mia', studentIds: ['kid1', 'kid2'] }] });
    expect((await w.api(PARENT, { op: 'whoami' })).body.studentIds).toEqual(['kid1']);
    // Family members who have not signed up can still be removed by staff.
    expect((await w.api(TEACHER, { op: 'del', coll: 'guardians', ids: ['g2'] })).status).toBe(200);
    expect(w.kv.data.has('cc1:r:guardians:g2')).toBe(false);
  });
});

describe('worker: family uploads', () => {
  it('never lets a family overwrite a file already in their conversation (a photo staff sent)', async () => {
    await seed();
    await join(PARENT, { role: 'parent', guardianId: 'g1' });
    await w.upload(OWNER, 'messages/kid1/abc-photo.jpg', new Blob(['from school'], { type: 'image/jpeg' }));
    const res = await w.upload(PARENT, 'messages/kid1/abc-photo.jpg', new Blob(['tampered'], { type: 'image/jpeg' }));
    expect(res.status).toBe(409);
    expect(await w.fsys.files.get('childcare-team/messages/kid1/abc-photo.jpg').text()).toBe('from school');
    // New files still upload.
    expect((await w.upload(PARENT, 'messages/kid1/new-photo.jpg', new Blob(['new']))).status).toBe(200);
  });

  it('keeps family message attachments to their own conversation and known fields', async () => {
    await seed();
    await join(PARENT, { role: 'parent', guardianId: 'g1' });
    await w.api(PARENT, {
      op: 'put',
      coll: 'messages:kid1',
      records: [{ id: 'm1', text: 'hi', media: [{ id: 'f1', name: 'a.jpg', type: 'image/jpeg', size: 3, path: 'messages/kid1/f1-a.jpg', thumb: 'messages/kid2/other-family.jpg', junk: 'x'.repeat(5000) }] }],
    });
    const [m] = w.kv.data.get('cc1:r:messages:kid1:m1').media;
    expect(m.thumb).toBeUndefined();
    expect(m.junk).toBeUndefined();
    expect(m).toMatchObject({ id: 'f1', name: 'a.jpg', type: 'image/jpeg', size: 3, path: 'messages/kid1/f1-a.jpg' });
  });
});

describe('worker: kiosk PIN guessing', () => {
  it('throttles wrong kiosk PINs from one account so PINs cannot be enumerated', async () => {
    await seed();
    await join(TEACHER, { role: 'staff', staffId: 't1' });
    let blocked = null;
    for (let i = 0; i < 200 && !blocked; i++) {
      const pin = String(1000 + i * 37).padStart(4, '0');
      if (['1234', '9999', '5555', '7777'].includes(pin)) continue;
      const res = await w.api(TEACHER, { op: 'kioskLookup', pin });
      if (res.status === 429) blocked = i;
    }
    expect(blocked).not.toBeNull();
    expect(blocked).toBeGreaterThanOrEqual(30); // a busy morning of typos still works
    // Even a right PIN waits once the limit is hit.
    expect((await w.api(TEACHER, { op: 'kioskLookup', pin: '7777' })).status).toBe(429);
    // Leaving a kiosk without an exit PIN is never blocked.
    expect((await w.api(TEACHER, { op: 'kioskExit', pin: '0000' })).body.match).toBe(true);
  });

  it('counts the exit PIN against the same limit', async () => {
    await seed();
    await join(TEACHER, { role: 'staff', staffId: 't1' });
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('4321')))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await w.api(OWNER, { op: 'saveSettings', settings: { kioskPinHash: hash } });
    let status = 200;
    for (let i = 0; i < 200 && status === 200; i++) status = (await w.api(TEACHER, { op: 'kioskExit', pin: String(i).padStart(4, '0') })).status;
    expect(status).toBe(429);
  });

  it('still lets the right exit PIN leave a kiosk after wrong check-in PINs hit the limit', async () => {
    await seed();
    await join(TEACHER, { role: 'staff', staffId: 't1' });
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('4321')))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await w.api(OWNER, { op: 'saveSettings', settings: { kioskPinHash: hash } });
    // A child pressing keys on the PIN pad all morning.
    let status = 200;
    for (let i = 0; i < 200 && status === 200; i++) status = (await w.api(TEACHER, { op: 'kioskLookup', pin: String(2000 + i) })).status;
    expect(status).toBe(429);
    const exit = await w.api(TEACHER, { op: 'kioskExit', pin: '4321' });
    expect(exit.status).toBe(200);
    expect(exit.body.match).toBe(true);
  });

  it('never limits the director, who can read every PIN anyway', async () => {
    await seed();
    for (let i = 0; i < 60; i++) await w.api(OWNER, { op: 'kioskLookup', pin: String(2000 + i) });
    expect((await w.api(OWNER, { op: 'kioskLookup', pin: '2100' })).status).toBe(200);
  });
});

describe('worker: conversation times use one clock', () => {
  let clock = Date.parse('2026-10-12T15:00:00.000Z');
  const later = () => vi.setSystemTime((clock += 1000));
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: clock }));
  afterEach(() => vi.useRealTimers());

  it('does not hide a family message from staff whose device clock runs ahead', async () => {
    await seed();
    await join(TEACHER, { role: 'staff', staffId: 't1' });
    await join(PARENT, { role: 'parent', guardianId: 'g1' });
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    await w.api(PARENT, { op: 'put', coll: 'threads', records: [{ id: 'kid1', lastAt: iso(now), lastFrom: 'family', lastText: 'first' }] });
    later();
    // Staff reads it on a tablet whose clock is an hour fast.
    const t = w.kv.data.get('cc1:r:threads:kid1');
    await w.api(TEACHER, { op: 'put', coll: 'threads', records: [{ ...t, staffReadAt: iso(now + 3600e3) }] });
    later();
    // The family writes again a moment later.
    await w.api(PARENT, { op: 'put', coll: 'threads', records: [{ ...w.kv.data.get('cc1:r:threads:kid1'), lastAt: iso(now + 1000), lastFrom: 'family', lastText: 'second' }] });
    expect(isUnread(w.kv.data.get('cc1:r:threads:kid1'), { role: 'staff' })).toBe(true);
  });

  it('does not pin a staff reply as unread for families when the staff clock runs ahead', async () => {
    await seed();
    await join(TEACHER, { role: 'staff', staffId: 't1' });
    await join(PARENT, { role: 'parent', guardianId: 'g1' });
    const iso = (ms) => new Date(ms).toISOString();
    await w.api(PARENT, { op: 'put', coll: 'threads', records: [{ id: 'kid1', lastAt: iso(Date.now()), lastFrom: 'family', lastText: 'hi' }] });
    later();
    const t = w.kv.data.get('cc1:r:threads:kid1');
    await w.api(TEACHER, { op: 'put', coll: 'threads', records: [{ ...t, lastAt: iso(Date.now() + 3600e3), lastFrom: 'staff', lastText: 'reply', staffReadAt: iso(Date.now() + 3600e3) }] });
    later();
    // The family opens the conversation.
    await w.api(PARENT, { op: 'put', coll: 'threads', records: [{ ...w.kv.data.get('cc1:r:threads:kid1'), familyReadAt: { 'user-3': iso(Date.now()) } }] });
    expect(isUnread(w.kv.data.get('cc1:r:threads:kid1'), { role: 'family', uuid: 'user-3' })).toBe(false);
  });

  it('keeps the times of conversations copied in when access is turned on', async () => {
    await w.api(OWNER, { op: 'put', coll: 'threads', records: [{ id: 'kid1', lastAt: '2026-01-02T03:04:05.000Z', lastFrom: 'family', staffReadAt: '2026-01-01T00:00:00.000Z' }] });
    expect(w.kv.data.get('cc1:r:threads:kid1')).toMatchObject({ lastAt: '2026-01-02T03:04:05.000Z', staffReadAt: '2026-01-01T00:00:00.000Z' });
  });
});

describe('worker: family health details keep their shape', () => {
  it('stores the doctor as { name, phone } and the other health fields as text only', async () => {
    await seed();
    await join(PARENT, { role: 'parent', guardianId: 'g1' });
    await w.api(PARENT, { op: 'put', coll: 'students', records: [{ id: 'kid1', doctor: 'Dr Who', allergies: { name: 'x', phone: 'y' }, medications: ['a', 'b'] }] });
    const s = w.kv.data.get('cc1:r:students:kid1');
    expect(s.doctor).toEqual({ name: 'Dr A', phone: '1' });
    expect(s.allergies).toBe('');
    expect(s.medications).toBeUndefined();
    await w.api(PARENT, { op: 'put', coll: 'students', records: [{ id: 'kid1', doctor: { name: 'Dr B', phone: '2' }, allergies: 'Peanuts' }] });
    expect(w.kv.data.get('cc1:r:students:kid1')).toMatchObject({ doctor: { name: 'Dr B', phone: '2' }, allergies: 'Peanuts' });
  });
});

describe('worker: read-only conversations', () => {
  it('does not let a family change the inbox preview when the school turned family messages off', async () => {
    await seed();
    await join(PARENT, { role: 'parent', guardianId: 'g1' });
    await w.api(OWNER, { op: 'put', coll: 'threads', records: [{ id: 'kid1', lastAt: '2026-10-12T10:00:00.000Z', lastFrom: 'staff', lastText: 'Ava had a great day' }] });
    await w.api(OWNER, { op: 'saveSettings', settings: { access: { parentsCanMessage: false } } });
    await w.api(PARENT, { op: 'put', coll: 'threads', records: [{ id: 'kid1', lastAt: '2026-10-12T11:00:00.000Z', lastFrom: 'family', lastText: 'URGENT: call me now', familyReadAt: { 'user-3': '2026-10-12T11:00:00.000Z' } }] });
    const t = w.kv.data.get('cc1:r:threads:kid1');
    expect(t).toMatchObject({ lastFrom: 'staff', lastText: 'Ava had a great day' });
    // Reading still counts.
    expect(t.familyReadAt['user-3']).toBeTruthy();
  });
});

describe('worker: staff changes to a signed-up family member', () => {
  it("keeps a signed-up family member's children when staff save the card, and saves the rest", async () => {
    await seed();
    await join(TEACHER, { role: 'staff', staffId: 't1' });
    await join(PARENT, { role: 'parent', guardianId: 'g1' });
    const g1 = w.kv.data.get('cc1:r:guardians:g1');
    // A staff device with a stale copy (or a crafted request) sends other
    // children with a phone change: the phone saves, the children stay.
    const res = await w.api(TEACHER, { op: 'put', coll: 'guardians', records: [{ ...g1, studentIds: [], phone: '555' }] });
    expect(res.status).toBe(200);
    expect(w.kv.data.get('cc1:r:guardians:g1').studentIds).toEqual(['kid1']);
    expect(w.kv.data.get('cc1:r:guardians:g1').phone).toBe('555');
  });
});

describe('worker: family read times', () => {
  it('marks a conversation read for the family even when its last message is stamped ahead of the server clock', async () => {
    await seed();
    await join(PARENT, { role: 'parent', guardianId: 'g1' });
    // Written by a staff device an hour fast, before the worker stamped staff times.
    const ahead = new Date(Date.now() + 3600e3).toISOString();
    w.kv.data.set('cc1:r:threads:kid1', { id: 'kid1', lastAt: ahead, lastFrom: 'staff', lastText: 'Pickup at 3' });
    const t = w.kv.data.get('cc1:r:threads:kid1');
    await w.api(PARENT, { op: 'put', coll: 'threads', records: [{ ...t, familyReadAt: { 'user-3': new Date().toISOString() } }] });
    expect(isUnread(w.kv.data.get('cc1:r:threads:kid1'), { role: 'family', uuid: 'user-3' })).toBe(false);
  });
});

describe('worker: deleting a signed-up family member', () => {
  it('ends their access, and re-creating the same card id does not bring it back', async () => {
    await seed();
    await join(TEACHER, { role: 'staff', staffId: 't1' });
    await join(PARENT, { role: 'parent', guardianId: 'g1' });
    expect((await w.api(OWNER, { op: 'del', coll: 'guardians', ids: ['g1'] })).status).toBe(200);
    const after = await w.api(PARENT, { op: 'load', names: ['students'] });
    expect(after.status).toBe(403);
    expect(after.body.error).toBe('not_a_member');
    // They no longer show as a member in Settings.
    expect((await w.api(OWNER, { op: 'members' })).body.members.map((m) => m.uuid)).not.toContain('user-3');
    // A card re-created under the old id (by staff, or an undo) is not theirs.
    await w.api(TEACHER, { op: 'put', coll: 'guardians', records: [{ id: 'g1', firstName: 'Mia', studentIds: ['kid1', 'kid2'] }] });
    expect((await w.api(PARENT, { op: 'whoami' })).status).toBe(403);
  });

  it('also cuts off a member left pointing at a card deleted before this build', async () => {
    await seed();
    await join(TEACHER, { role: 'staff', staffId: 't1' });
    await join(PARENT, { role: 'parent', guardianId: 'g1' });
    // An older worker deleted the card but kept the membership.
    w.kv.data.delete('cc1:r:guardians:g1');
    await w.api(TEACHER, { op: 'put', coll: 'guardians', records: [{ id: 'g1', firstName: 'Mia', studentIds: ['kid1', 'kid2'] }] });
    const res = await w.api(PARENT, { op: 'load', names: ['students'] });
    expect(res.status).toBe(403);
    // They can join again with a new invitation.
    expect((await join(PARENT, { role: 'parent', guardianId: 'g2' })).body).toMatchObject({ ok: true, role: 'parent' });
    expect((await w.api(PARENT, { op: 'whoami' })).body.studentIds).toEqual(['kid2']);
  });
});

describe('worker: staff writes to many conversations', () => {
  it('reads the stored conversations in parallel, not one after another', async () => {
    await seed();
    await join(TEACHER, { role: 'staff', staffId: 't1' });
    const get = w.kv.get;
    let active = 0;
    let peak = 0;
    w.kv.get = async (key) => {
      if (!key.includes(':threads:')) return get(key);
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return get(key);
    };
    const at = new Date().toISOString();
    const records = Array.from({ length: 12 }, (_, i) => ({ id: `kid${i}`, studentId: `kid${i}`, lastAt: at, lastText: 'Hello', staffReadAt: at }));
    const res = await w.api(TEACHER, { op: 'put', coll: 'threads', records });
    w.kv.get = get;
    expect(res.status).toBe(200);
    expect(peak).toBeGreaterThan(1);
  });
});
