/**
 * Identity, membership, notification and invite routes: what the fourteenth
 * review pass found.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';

const { alice, bob, carol, dave } = USERS;
const SERVER = 'teamchat-api.test';
const DAY = 86400_000;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

const MIN = 60_000;

async function upload(u, wsId, name = 'a.txt') {
  const fd = new FormData();
  fd.append('file', new Blob(['hello'], { type: 'text/plain' }), name);
  const r = await as(u).post(`/api/ws/${wsId}/files`, fd);
  expect(r.ok).toBe(true);
  return r.data.id;
}
const there = (wsId, id) => rt.fs._files.has(`teamchat-files/${wsId}/${id}`);
const due = async (wsId, id, at = Date.now() - 1) => {
  await rt.kv.update(KEYS.sched(wsId), { [`m.${id}.dueAt`]: at });
  await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
};

describe('a scheduled message whose author is no longer in the workspace when its time comes', () => {
  it('goes off the queue with the file it waited with, as a deletion lets the file go', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const file = await upload(bob, wsId, 'draft.txt');
    const id = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', attachments: [{ id: file }], dueAt: Date.now() + 5 * MIN })).data.scheduled.id;
    // Bob's card goes while his entry stays: the entry he scheduled in the
    // moment an admin was removing him, written after the removal had
    // emptied his part of the queue.
    await rt.kv.remove(KEYS.ws(wsId), `members.${bob.uuid}`);
    await due(wsId, id);
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.sched(wsId)))?.m?.[id]).toBeUndefined();
    expect(await rt.kv.get(KEYS.file(file))).toBeFalsy();
    expect(there(wsId, file)).toBe(false);
    // Nothing was posted under a name that is gone.
    const texts = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.map((m) => m.text);
    expect(texts).not.toContain('later');
  });
});

describe('a scheduled message the store failed under, poll after poll', () => {
  it('goes off the queue after its last try with the file it waited with, as the author\'s deletion would take it', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const file = await upload(bob, wsId, 'draft.txt');
    const id = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', attachments: [{ id: file }], dueAt: Date.now() + 5 * MIN })).data.scheduled.id;
    // Four polls have tried and failed under the store already; this one is the last.
    await rt.kv.update(KEYS.sched(wsId), { [`m.${id}.tries`]: 4 });
    await due(wsId, id);
    const incr = rt.kv.incr;
    rt.kv.incr = async (k, ...rest) => { if (k === KEYS.seq(general.id)) throw new Error('store down'); return incr(k, ...rest); };
    try {
      expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    } finally {
      rt.kv.incr = incr;
    }
    expect((await rt.kv.get(KEYS.sched(wsId)))?.m?.[id]).toBeUndefined();
    expect((await rt.kv.get(KEYS.activity(wsId))).nd).toBeUndefined();
    expect(await rt.kv.get(KEYS.file(file))).toBeFalsy();
    expect(there(wsId, file)).toBe(false);
    const texts = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.map((m) => m.text);
    expect(texts).not.toContain('later');
  });

  it('is tried again, its file kept, while tries remain', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const file = await upload(bob, wsId, 'draft.txt');
    const id = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', attachments: [{ id: file }], dueAt: Date.now() + 5 * MIN })).data.scheduled.id;
    await due(wsId, id);
    const incr = rt.kv.incr;
    rt.kv.incr = async (k, ...rest) => { if (k === KEYS.seq(general.id)) throw new Error('store down'); return incr(k, ...rest); };
    try {
      expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    } finally {
      rt.kv.incr = incr;
    }
    const e = (await rt.kv.get(KEYS.sched(wsId))).m[id];
    expect(e.tries).toBe(1);
    expect(e.retryAt).toBeGreaterThan(Date.now());
    expect(there(wsId, file)).toBe(true);
    // The store back, the next poll due sends it, held by the message it became.
    await rt.kv.update(KEYS.sched(wsId), { [`m.${id}.retryAt`]: Date.now() - 1 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.sched(wsId)))?.m?.[id]).toBeUndefined();
    expect((await rt.kv.get(KEYS.file(file))).refs).toBe(1);
    expect(there(wsId, file)).toBe(true);
  });
});

describe('the admins\' list of guests', () => {
  it('names to an admin the channels they can see, and how many private ones are kept from them, as the integrations list does', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
    // Dave comes in as a guest of #secret; carol as a guest of #open.
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${secret}/invites`, {});
    expect((await as(dave).post('/api/join', { code: inv.data.code })).ok).toBe(true);
    const inv2 = await as(alice).post(`/api/ws/${wsId}/channels/${open}/invites`, {});
    expect((await as(carol).post('/api/join', { code: inv2.data.code })).ok).toBe(true);
    const row = (list, u) => list.data.guests.find((g) => g.uuid === u);
    // Alice, in #secret, sees it; bob, an admin outside it, is told only that one channel is kept from him.
    const mine = await as(alice).get(`/api/ws/${wsId}/guests`);
    expect(row(mine, dave.uuid)).toEqual({ uuid: dave.uuid, channels: [secret], joinedAt: expect.any(Number) });
    expect(row(mine, carol.uuid)).toEqual({ uuid: carol.uuid, channels: [open], joinedAt: expect.any(Number) });
    const theirs = await as(bob).get(`/api/ws/${wsId}/guests`);
    expect(theirs.ok).toBe(true);
    expect(row(theirs, dave.uuid)).toEqual({ uuid: dave.uuid, channels: [], hidden: 1, joinedAt: expect.any(Number) });
    expect(row(theirs, carol.uuid)).toEqual({ uuid: carol.uuid, channels: [open], joinedAt: expect.any(Number) });
    expect(JSON.stringify(theirs.data)).not.toContain(secret);
    // Added to #secret, bob sees it like alice.
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${secret}/members`, { uuids: [bob.uuid] })).data.added).toEqual([bob.uuid]);
    expect(row(await as(bob).get(`/api/ws/${wsId}/guests`), dave.uuid)).toEqual({ uuid: dave.uuid, channels: [secret], joinedAt: expect.any(Number) });
    expect(general).toBeTruthy();
  });
});

/** Acme (alice, carol) hosts #design (private unless told otherwise); Globex (alice, bob admin, dave) is the partner; bob and dave are in the channel on Acme. */
async function sharedPrivate({ priv = true } = {}) {
  const acme = await workspaceWith(alice, [carol], 'Acme');
  const globex = await workspaceWith(alice, [bob, dave], 'Globex');
  expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
  const design = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'design', private: priv })).data.channel.id;
  if (priv) expect((await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/members`, { uuids: [carol.uuid] })).data.added).toEqual([carol.uuid]);
  else expect((await as(carol).post(`/api/ws/${acme.wsId}/channels/${design}/join`)).ok).toBe(true);
  const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/connect/invites`, { inviteTtl: '7d' });
  const acc = await as(bob).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' }, profile: { name: 'Bob B.' } });
  expect(acc.ok).toBe(true);
  const added = await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, {
    ref: `${acme.wsId}@${SERVER}`, ch: design, conn: acc.data.conn, secret: acc.data.secret, name: 'design-with-acme', host: 'Acme',
  });
  const local = added.data.channel.id;
  for (const u of [bob, dave]) {
    const j = u === bob ? await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {}) : await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/join`);
    const att = u === bob ? j.data : j.data.shared;
    expect((await as(u).post('/api/connect/join', { conn: att.conn, token: att.token, profile: { name: u.username } })).ok).toBe(true);
  }
  return { acme, globex, design, local, conn: acc.data.conn };
}

describe('two people from a connected workspace let go of by one bootstrap, a month after their standing ran out', () => {
  it('both come off the private channel\'s member list, its counts and the workspace', async () => {
    const { acme, design, conn } = await sharedPrivate();
    const sorted = (xs) => [...xs].sort();
    let ws = await rt.kv.get(KEYS.ws(acme.wsId));
    expect(sorted(ws.channels[design].members)).toEqual(sorted([alice.uuid, carol.uuid, bob.uuid, dave.uuid]));
    expect(ws.channels[design].count).toBe(4);
    await rt.kv.update(KEYS.ws(acme.wsId), { [`members.${bob.uuid}.exp`]: Date.now() - 40 * DAY, [`members.${dave.uuid}.exp`]: Date.now() - 40 * DAY });
    const boot = await as(alice).get(`/api/ws/${acme.wsId}`);
    expect(boot.ok).toBe(true);
    ws = await rt.kv.get(KEYS.ws(acme.wsId));
    expect(ws.members[bob.uuid]).toBeUndefined();
    expect(ws.members[dave.uuid]).toBeUndefined();
    expect(sorted(ws.channels[design].members)).toEqual(sorted([alice.uuid, carol.uuid]));
    expect(ws.channels[design].count).toBe(2);
    expect(ws.channels[design].connections[conn].count).toBe(0);
    // The answer being put together shows the channel as it now stands, and so does its member list.
    expect(sorted(boot.data.workspace.channels[design].members)).toEqual(sorted([alice.uuid, carol.uuid]));
    expect(sorted((await as(alice).get(`/api/ws/${acme.wsId}/channels/${design}/members`)).data.members)).toEqual(sorted([alice.uuid, carol.uuid]));
    // With nobody gone left on the list, the last real member is still held in.
    expect((await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/members`, { uuids: [] })).ok).toBe(true);
    expect((await as(carol).post(`/api/ws/${acme.wsId}/channels/${design}/leave`)).ok).toBe(true);
    const last = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/leave`);
    expect(last.status).toBe(400);
    expect(last.data.code).toBe('last_member');
  });
});

describe('someone from a connected workspace, a month past their standing, accepting the workspace\'s own invite while a bootstrap lets go of their card', () => {
  /** The workspace as it stands: bob a member in his own right, every count matching who holds what. */
  async function settled(acme, design, conn, generalId) {
    const ws = await rt.kv.get(KEYS.ws(acme.wsId));
    const doc = await rt.kv.get(KEYS.member(acme.wsId, bob.uuid));
    expect(ws.members[bob.uuid]).toMatchObject({ role: 'member', username: 'bob' });
    expect(ws.members[bob.uuid].org).toBeUndefined();
    expect(ws.members[bob.uuid].lapse).toBeUndefined();
    expect(ws.former?.[bob.uuid]).toBeUndefined();
    expect(doc.channels).toContain(generalId);
    // Alice, carol and bob in #general; dave (still external) with them in #design, and bob when he kept his seat there.
    expect(ws.channels[generalId].count).toBe(3);
    expect(ws.channels[design].count).toBe(doc.channels.includes(design) ? 4 : 3);
    expect(ws.channels[design].connections[conn].count).toBe(1);
    expect((await rt.kv.get(KEYS.user(bob.uuid))).workspaces).toContain(acme.wsId);
    const boot = await as(bob).get(`/api/ws/${acme.wsId}`);
    expect(boot.ok).toBe(true);
    expect(boot.data.me.role).toBe('member');
  }

  for (const [order, label] of [['boot-first', 'the bootstrap ahead'], ['join-first', 'the join ahead']]) {
    it(`ends with bob a member and every count right, ${label}`, async () => {
      const { acme, design, conn } = await sharedPrivate({ priv: false });
      const generalId = Object.values((await rt.kv.get(KEYS.ws(acme.wsId))).channels).find((c) => c.def).id;
      await rt.kv.update(KEYS.ws(acme.wsId), { [`members.${bob.uuid}.exp`]: Date.now() - 40 * DAY });
      const code = (await rt.kv.get(KEYS.ws(acme.wsId))).invite;
      const boot = () => as(carol).get(`/api/ws/${acme.wsId}`);
      const join = () => as(bob).post('/api/join', { code });
      const [b, j] = order === 'boot-first' ? await Promise.all([boot(), join()]) : (await Promise.all([join(), boot()])).reverse();
      expect(b.ok).toBe(true);
      // One of the two wrote the card. The join that lost the claim says so, and the link opened again joins bob afresh.
      if (j.status === 409) {
        expect(j.data.code).toBe('retry');
        const ws = await rt.kv.get(KEYS.ws(acme.wsId));
        expect(ws.members[bob.uuid]).toBeUndefined();
        expect(ws.channels[design].count).toBe(3);
        expect(ws.channels[design].connections[conn].count).toBe(1);
        expect(await rt.kv.get(KEYS.member(acme.wsId, bob.uuid))).toBeFalsy();
        const again = await join();
        expect(again.ok).toBe(true);
        expect(again.data.guest).toBe(false);
      } else {
        expect(j.ok).toBe(true);
      }
      await settled(acme, design, conn, generalId);
    });
  }

  it('is refused, and told to open the link again, while a bootstrap holds the claim on the card', async () => {
    const { acme, design, conn } = await sharedPrivate({ priv: false });
    await rt.kv.update(KEYS.ws(acme.wsId), { [`members.${bob.uuid}.exp`]: Date.now() - 40 * DAY, [`members.${bob.uuid}.lapse`]: 1, [`members.${bob.uuid}.lapseAt`]: Date.now() });
    const code = (await rt.kv.get(KEYS.ws(acme.wsId))).invite;
    const j = await as(bob).post('/api/join', { code });
    expect(j.status).toBe(409);
    expect(j.data.code).toBe('retry');
    const ws = await rt.kv.get(KEYS.ws(acme.wsId));
    expect(ws.members[bob.uuid].role).toBe('external');
    expect(ws.channels[design].connections[conn].count).toBe(2);
  });
});
