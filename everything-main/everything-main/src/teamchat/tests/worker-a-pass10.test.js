/**
 * Identity, membership and channel routes: what the tenth review pass found.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';

const { alice, bob, carol, dave } = USERS;
const SERVER = 'teamchat-api.test';
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

const post = (u, wsId, conv, text) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text });
const messages = async (u, wsId, conv) => (await as(u).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages;

/** Acme (alice, carol) hosts #design; Globex (alice, bob admin, dave) is the partner; bob is in the channel on Acme. */
async function shared() {
  const acme = await workspaceWith(alice, [carol], 'Acme');
  const globex = await workspaceWith(alice, [bob, dave], 'Globex');
  expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
  const design = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'design' })).data.channel.id;
  await as(carol).post(`/api/ws/${acme.wsId}/channels/${design}/join`);
  const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/connect/invites`, { inviteTtl: '7d' });
  const acc = await as(bob).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' }, profile: { name: 'Bob B.' } });
  expect(acc.ok).toBe(true);
  const added = await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, {
    ref: `${acme.wsId}@${SERVER}`, ch: design, conn: acc.data.conn, secret: acc.data.secret, name: 'design-with-acme', host: 'Acme',
  });
  const local = added.data.channel.id;
  const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
  const j = await as(bob).post('/api/connect/join', { conn: att.data.conn, token: att.data.token, profile: { name: 'Bob B.' } });
  expect(j.ok).toBe(true);
  return { acme, globex, design, local, conn: acc.data.conn };
}

describe('an account renamed on Puter', () => {
  it('carries its new handle on every card of theirs, and is mentioned by it', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const other = await workspaceWith(alice, [bob], 'Other');
    const robert = { uuid: bob.uuid, username: 'robert' };
    const me = await as(robert).get('/api/me');
    expect(me.data.profile.username).toBe('robert');
    for (const w of [wsId, other.wsId]) {
      expect((await as(alice).get(`/api/ws/${w}`)).data.workspace.members[bob.uuid].username).toBe('robert');
    }
    await post(alice, wsId, general.id, 'hey @robert');
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).mentions[general.id]).toBe(1);
  });
});

describe('an external member whose standing on the host has lapsed', () => {
  const lapse = (wsId) => rt.kv.update(KEYS.ws(wsId), { [`members.${bob.uuid}.exp`]: Date.now() - 1 });

  it('can still leave the shared channel, and with it the workspace, so no seat lingers for want of a renewal', async () => {
    const { acme, design, conn } = await shared();
    await lapse(acme.wsId);
    // Every other door stays shut until their workspace vouches again.
    expect((await as(bob).get(`/api/ws/${acme.wsId}`)).data.code).toBe('reattest');
    expect((await post(bob, acme.wsId, design, 'x')).data.code).toBe('reattest');
    expect((await as(bob).post(`/api/ws/${acme.wsId}/channels/${design}/leave`)).ok).toBe(true);
    const ws = (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace;
    expect(ws.members[bob.uuid]).toBeUndefined();
    expect(ws.channels[design].count).toBe(2);
    expect(ws.channels[design].connections[conn].count).toBe(0);
    expect(ws.former[bob.uuid]).toMatchObject({ name: 'Bob B.', org: { name: 'Globex' } });
    expect(await rt.kv.get(KEYS.member(acme.wsId, bob.uuid))).toBeNull();
  });

  it('can still take themselves out of the workspace, while an admin\'s hand is asked of nobody else', async () => {
    const { acme, design, conn } = await shared();
    await lapse(acme.wsId);
    expect((await as(bob).del(`/api/ws/${acme.wsId}/members/${carol.uuid}`)).status).toBe(403);
    expect((await as(bob).del(`/api/ws/${acme.wsId}/members/${bob.uuid}`)).ok).toBe(true);
    const ws = (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace;
    expect(ws.members[bob.uuid]).toBeUndefined();
    expect(ws.channels[design].count).toBe(2);
    expect(ws.channels[design].connections[conn].count).toBe(0);
    expect(ws.removed).toBeUndefined(); // leaving is not being shown the door
  });
});

describe('an external member accepting the host\'s own invite from two tabs at once', () => {
  it('is made a member once: counted into the defaults once, announced once, off the connection\'s count once', async () => {
    const { acme, design, conn } = await shared();
    const code = (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.invite;
    const [a, b] = await Promise.all([as(bob).post('/api/join', { code }), as(bob).post('/api/join', { code })]);
    expect(a.ok && b.ok).toBe(true);
    const ws = (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace;
    const general = Object.values(ws.channels).find((c) => c.name === 'general');
    expect(ws.members[bob.uuid]).toMatchObject({ role: 'member', name: 'Bob B.' });
    expect(ws.members[bob.uuid].org).toBeUndefined();
    expect(general.count).toBe(3);
    expect(ws.channels[design].count).toBe(3);
    expect(ws.channels[design].connections[conn].count).toBe(0);
    expect((await messages(alice, acme.wsId, general.id)).filter((m) => m.text === 'Bob B. joined')).toHaveLength(1);
    const doc = await rt.kv.get(KEYS.member(acme.wsId, bob.uuid));
    expect(doc.channels.sort()).toEqual([design, general.id].sort());
    // Caught up past their own "joined" line, in the channel they were in already too.
    const me = await as(bob).get(`/api/ws/${acme.wsId}`);
    expect(me.data.me.role).toBe('member');
    expect(me.data.me.reads[general.id]).toBe(await rt.kv.get(KEYS.seq(general.id)));
    expect(me.data.me.reads[design]).toBeGreaterThan(0);
  });
});

describe('what someone had waiting to be sent', () => {
  const DAY = 86400_000;

  it('leaves the queue with them when they are removed, and the next due time follows what is left', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const soon = Date.now() + 30 * DAY;
    const later = Date.now() + 200 * DAY;
    expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'from bob', dueAt: soon })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq: 1, dueAt: soon })).ok).toBe(true);
    const kept = await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'from alice', dueAt: later });
    expect(kept.ok).toBe(true);
    expect((await rt.kv.get(KEYS.activity(wsId))).nd).toBe(soon);
    expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    const queue = await rt.kv.get(KEYS.sched(wsId));
    expect(Object.keys(queue.m)).toEqual([kept.data.scheduled.id]);
    expect((await rt.kv.get(KEYS.activity(wsId))).nd).toBe(later);
    // Nothing of anyone's left: the due time goes too.
    expect((await as(alice).del(`/api/ws/${wsId}/scheduled/${kept.data.scheduled.id}`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.activity(wsId))).nd).toBeUndefined();
  });

  it('leaves the host\'s queue with an external member who leaves their last shared channel there', async () => {
    const { acme, design } = await shared();
    const r = await as(bob).post(`/api/ws/${acme.wsId}/scheduled`, { conv: design, text: 'from globex', dueAt: Date.now() + DAY });
    expect(r.ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${acme.wsId}/channels/${design}/leave`)).ok).toBe(true);
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.members[bob.uuid]).toBeUndefined();
    expect((await rt.kv.get(KEYS.sched(acme.wsId)))?.m || {}).toEqual({});
    expect((await rt.kv.get(KEYS.activity(acme.wsId))).nd).toBeUndefined();
  });
});
