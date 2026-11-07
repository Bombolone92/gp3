/**
 * End-to-end tests of the worker against the in-memory Puter runtime: the
 * real route code, real block math, fake storage.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { BLOCK_SIZE, KEYS, threadConvId, overlayKey } from '../src/shared/blocks.js';
import { LIMITS } from '../src/shared/limits.js';
import { dmConvId } from '../src/shared/ids.js';
import {
  SEARCH_PAGE, SEARCH_QUERY_TOKENS, SEARCH_VERSION, SEARCH_FOLD_EVERY, SEARCH_LOG_TAIL, SEARCH_POSTINGS_PER_TOKEN,
  shardOf, bucketOf, indexTokens, encodePosting, authorToken, scopedToken,
} from '../src/shared/search.js';
import { deleteIndex } from '../worker/search.js';

const { alice, bob, carol, dave } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  // The whole design rests on never scanning the store.
  expect(rt.kv._calls.list).toBe(0);
});

describe('identity', () => {
  it('rejects anonymous callers', async () => {
    const res = await as(null).get('/api/me');
    expect(res.status).toBe(401);
    expect(res.data.code).toBe('unauthorized');
  });

  it('creates a profile on first contact and updates it', async () => {
    const me = await as(alice).get('/api/me');
    expect(me.ok).toBe(true);
    expect(me.data.profile).toMatchObject({ uuid: alice.uuid, username: 'alice', name: 'alice' });
    expect(me.data.profile.prefs).toBeUndefined(); // preferences live in the user's own account
    expect(me.data.workspaces).toEqual([]);
    expect(me.data.build).toBe('dev');
    expect(me.data.owner).toBe(true);
    expect((await as(bob).get('/api/me')).data.owner).toBe(false);

    const upd = await as(alice).put('/api/me', { name: '  Alice A. ', title: 'Design', color: 3 });
    expect(upd.data.profile).toMatchObject({ name: 'Alice A.', title: 'Design', color: 3 });

    const bad = await as(alice).put('/api/me', { name: '   ' });
    expect(bad.status).toBe(400);
  });

  it('seeds the member card from the profile sent with create and join', async () => {
    const c = await as(alice).post('/api/workspaces', { name: 'Acme', profile: { name: ' Alice A. ', title: 'Design', color: 3 } });
    const wsId = c.data.workspace.id;
    const code = (await as(alice).get(`/api/ws/${wsId}`)).data.workspace.invite;
    await as(bob).post('/api/join', { code, profile: { name: 'Bobby', title: 'Ops', color: 99, junk: 1 } });
    const b = await as(bob).get(`/api/ws/${wsId}`);
    expect(b.data.workspace.members[alice.uuid]).toMatchObject({ name: 'Alice A.', title: 'Design', color: 3, role: 'owner' });
    expect(b.data.workspace.members[bob.uuid]).toMatchObject({ name: 'Bobby', title: 'Ops', role: 'member' });
    expect(b.data.workspace.members[bob.uuid].color).not.toBe(99);
    // Later edits reach every workspace card on this worker.
    await as(bob).put('/api/me', { name: 'Robert', title: '' });
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.members[bob.uuid]).toMatchObject({ name: 'Robert', title: '' });
  });

  it('does not write a member card into a workspace the caller is not in', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    // A workspace id left behind in the user's list (a removal whose cleanup
    // did not finish) must not become a way back in.
    await rt.kv.remove(KEYS.ws(wsId), `members.${bob.uuid}`);
    expect((await rt.kv.get(KEYS.user(bob.uuid))).workspaces).toContain(wsId);

    const upd = await as(bob).put('/api/me', { name: 'Sneaky' });
    expect(upd.ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid]).toBeUndefined();
    expect((await as(bob).get(`/api/ws/${wsId}`)).status).toBe(403);
  });
});

describe('server ownership', () => {
  it('only the account the worker runs in creates workspaces, unless opened', async () => {
    const denied = await as(bob).post('/api/workspaces', { name: 'Nope' });
    expect(denied.status).toBe(403);
    expect(denied.data.code).toBe('not_owner');
    expect((await as(bob).post('/api/workspaces/sample')).status).toBe(403);
    expect((await as(alice).post('/api/workspaces', { name: 'Mine' })).ok).toBe(true);

    const info = await as(bob).get('/api/server');
    expect(info.data).toEqual({ build: 'dev', owner: false, claimed: true, open: false });
    expect((await as(bob).put('/api/server', { open: true })).status).toBe(403);
    const opened = await as(alice).put('/api/server', { open: true });
    expect(opened.data.open).toBe(true);
    expect((await as(bob).post('/api/workspaces', { name: 'Now fine' })).ok).toBe(true);
    expect((await as(alice).put('/api/server', { open: false })).data.open).toBe(false);
    expect((await as(carol).post('/api/workspaces', { name: 'Nope' })).status).toBe(403);
  });

  it('is claimed by the first creator when the runtime cannot name its owner', async () => {
    rt = await boot({ owner: null });
    expect((await as(bob).get('/api/server')).data.claimed).toBe(false);
    expect((await as(bob).post('/api/workspaces', { name: 'Bobs' })).ok).toBe(true);
    expect((await as(bob).get('/api/server')).data).toMatchObject({ owner: true, claimed: true });
    expect((await as(alice).post('/api/workspaces', { name: 'Nope' })).status).toBe(403);
  });

  it('reports its build on /health without a session', async () => {
    const h = await as(null).get('/health');
    expect(h.data).toMatchObject({ ok: true, build: 'dev' });
    expect(h.data.runtime).toBeNull();

    globalThis.__PUTER_PREAMBLE_VERSION__ = '2.6.2+63f857ce3';
    try {
      const h2 = await as(null).get('/health');
      expect(h2.data.runtime).toBe('2.6.2+63f857ce3');
    } finally {
      delete globalThis.__PUTER_PREAMBLE_VERSION__;
    }
  });
});

describe('workspaces', () => {
  it('creates a workspace with a default #general and an invite', async () => {
    const { wsId, code, general } = await workspaceWith(alice);
    expect(general).toMatchObject({ name: 'general', def: true, count: 1 });
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // Invites expire: the doc carries the deadline and the key has a TTL.
    const invite = await rt.kv.get(KEYS.invite(code));
    expect(invite.exp).toBeGreaterThan(Date.now() + 6 * 86400_000);
    expect(rt.kv._ttl.get(KEYS.invite(code))).toBe(7 * 86400);

    const b = await as(alice).get(`/api/ws/${wsId}`);
    expect(b.data.workspace.members[alice.uuid].role).toBe('owner');
    expect(b.data.me.channels).toEqual([general.id]);
    expect(b.data.activity.c[general.id].s).toBe(1); // the "created #general" system line

    const me = await as(alice).get('/api/me');
    expect(me.data.workspaces).toEqual([{ id: wsId, name: 'Acme', members: 1, sample: false, role: 'owner' }]);
  });

  it('caps an account at twenty workspaces of its own, not counting hosts it only takes part in from elsewhere', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const p = await rt.kv.get(KEYS.user(alice.uuid));
    // Nineteen ids of hosts alice is not a member of (shared-channel hosts, or workspaces since deleted).
    await rt.kv.update(KEYS.user(alice.uuid), { workspaces: [...p.workspaces, ...Array.from({ length: 19 }, (_, i) => `host${i}`)] });
    expect((await as(alice).post('/api/workspaces', { name: 'Another' })).ok).toBe(true);
    // Twenty real memberships are the cap.
    const many = Array.from({ length: 18 }, (_, i) => `ws${i}`);
    for (const id of many) await rt.kv.set(KEYS.ws(id), { id, name: id, members: { [alice.uuid]: { role: 'member' } }, channels: {} });
    await rt.kv.update(KEYS.user(alice.uuid), { workspaces: [...(await rt.kv.get(KEYS.user(alice.uuid))).workspaces, ...many] });
    expect((await as(alice).post('/api/workspaces', { name: 'One too many' })).status).toBe(400);
    expect(wsId).toBeTruthy();
  });

  it('deletes a workspace\'s threads with it, counters and blocks alike', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const root = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root' })).data.message;
    const t = threadConvId(general.id, root.seq);
    await as(bob).post(`/api/ws/${wsId}/conv/${t}/messages`, { text: 'a reply' });
    expect(await rt.kv.get(KEYS.seq(t))).toBe(1);
    expect(await rt.kv.get(KEYS.block(t, 0))).toBeTruthy();
    expect((await as(alice).del(`/api/ws/${wsId}`)).data).toEqual({ deleted: true });
    expect(await rt.kv.get(KEYS.seq(general.id))).toBeFalsy();
    expect(await rt.kv.get(KEYS.seq(t))).toBeFalsy();
    expect(await rt.kv.get(KEYS.block(t, 0))).toBeFalsy();
    expect(await rt.kv.get(KEYS.ws(wsId))).toBeFalsy();
  });

  it('refuses a join or a private-channel addition when the workspace document is at its ceiling, as it refuses a channel', async () => {
    const { wsId, code } = await workspaceWith(alice, [bob]);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    await rt.kv.update(KEYS.ws(wsId), { pad: 'x'.repeat(310_000) });
    expect((await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'one-more' })).status).toBe(400);
    expect((await as(carol).post('/api/join', { code })).status).toBe(400);
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${secret}/members`, { uuids: [bob.uuid] })).status).toBe(400);
    // Nothing was half-done: carol is not in, bob is not on the list.
    const ws = (await as(alice).get(`/api/ws/${wsId}`)).data.workspace;
    expect(ws.members[carol.uuid]).toBeUndefined();
    expect(ws.channels[secret].members).toEqual([alice.uuid]);
  });

  it('lets others join by invite code, case and spacing insensitive', async () => {
    const { wsId, code, general } = await workspaceWith(alice);
    const j = await as(bob).post('/api/join', { code: code.toLowerCase().replace(/-/g, ' ') });
    expect(j.ok).toBe(true);
    expect(j.data.workspace.id).toBe(wsId);

    const again = await as(bob).post('/api/join', { code });
    expect(again.data.already).toBe(true);

    const b = await as(bob).get(`/api/ws/${wsId}`);
    expect(b.data.workspace.members[bob.uuid].role).toBe('member');
    expect(b.data.workspace.invite).toBeNull(); // members do not see the code
    expect(b.data.workspace.channels[general.id].count).toBe(2);
    expect(b.data.me.channels).toEqual([general.id]);

    expect((await as(carol).post('/api/join', { code: 'nope' })).status).toBe(400);
    expect((await as(carol).post('/api/join', { code: 'AAAA-AAAA-AAAA' })).status).toBe(404);
  });

  it('puts the workspace back on the list when a member joins again', async () => {
    const { wsId, code } = await workspaceWith(alice, [bob]);
    // A join cut short after writing the membership: bob is in the workspace
    // but his list does not say so, so /api/me would not name it and the app
    // would drop a workspace he is really in.
    await rt.kv.update(KEYS.user(bob.uuid), { workspaces: [] });

    const again = await as(bob).post('/api/join', { code });
    expect(again.data.already).toBe(true);
    expect((await as(bob).get('/api/me')).data.workspaces).toMatchObject([{ id: wsId }]);
  });

  it('throttles an account that keeps guessing codes', async () => {
    const { code } = await workspaceWith(alice);
    for (let i = 0; i < LIMITS.joinAttempts; i++) {
      expect((await as(bob).post('/api/join', { code: 'ZZZZ-ZZZZ-ZZZ' + (i % 9 + 2) })).status).toBe(404);
    }
    // Over budget: even the right code is refused, and without a lookup.
    const opsBefore = rt.kv._calls.ops;
    const blocked = await as(bob).post('/api/join', { code });
    expect(blocked.status).toBe(429);
    expect(blocked.data.code).toBe('too_many_attempts');
    expect(rt.kv._calls.ops - opsBefore).toBe(1); // only the budget read
    expect(rt.kv._ttl.get('tc:joinfail:' + bob.uuid)).toBe(LIMITS.joinWindowSeconds);
    // Another account is unaffected, and its success does not count against it.
    expect((await as(carol).post('/api/join', { code })).ok).toBe(true);
    expect(await rt.kv.get('tc:joinfail:' + carol.uuid)).toBeNull();
  });

  it('refuses expired invites and lets admins pick a new duration', async () => {
    const { wsId, code } = await workspaceWith(alice);
    // Force the deadline into the past (the real store would also have dropped the key).
    await rt.kv.update(KEYS.invite(code), { exp: Date.now() - 1000 });
    expect((await as(bob).post('/api/join', { code })).status).toBe(404);
    expect((await as(alice).put(`/api/ws/${wsId}`, { rotateInvite: true, inviteTtl: '2y' })).status).toBe(400);
    const r = await as(alice).put(`/api/ws/${wsId}`, { rotateInvite: true, inviteTtl: '1d' });
    expect(r.data.workspace.invite).not.toBe(code);
    expect(r.data.workspace.inviteExp).toBeLessThan(Date.now() + 86400_000 + 5000);
    expect(rt.kv._ttl.get(KEYS.invite(r.data.workspace.invite))).toBe(86400);
    expect(await rt.kv.get(KEYS.invite(code))).toBeNull();
    expect((await as(bob).post('/api/join', { code: r.data.workspace.invite })).ok).toBe(true);
    const boot = await as(alice).get(`/api/ws/${wsId}`);
    expect(boot.data.workspace.inviteExp).toBe(r.data.workspace.inviteExp);
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.workspace.inviteExp).toBeNull();
  });

  it('keeps non-members out', async () => {
    const { wsId, general } = await workspaceWith(alice);
    expect((await as(bob).get(`/api/ws/${wsId}`)).status).toBe(403);
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).status).toBe(403);
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).status).toBe(403);
    expect((await as(bob).get('/api/ws/zzzzzzzzzz')).status).toBe(404);
  });

  it('admins rename and rotate the invite; old codes die', async () => {
    const { wsId, code } = await workspaceWith(alice, [bob]);
    expect((await as(bob).put(`/api/ws/${wsId}`, { name: 'Nope' })).status).toBe(403);
    const r = await as(alice).put(`/api/ws/${wsId}`, { name: 'Acme Inc', rotateInvite: true });
    expect(r.data.workspace.name).toBe('Acme Inc');
    expect(r.data.workspace.invite).not.toBe(code);
    expect((await as(carol).post('/api/join', { code })).status).toBe(404);
    expect((await as(carol).post('/api/join', { code: r.data.workspace.invite })).ok).toBe(true);
  });

  it('deactivates the invite without replacing it', async () => {
    const { wsId, code } = await workspaceWith(alice, [bob]);
    expect((await as(bob).put(`/api/ws/${wsId}`, { revokeInvite: true })).status).toBe(403);
    const r = await as(alice).put(`/api/ws/${wsId}`, { revokeInvite: true });
    expect(r.data.workspace.invite).toBeNull();
    expect(r.data.workspace.inviteExp).toBeNull();
    expect(await rt.kv.get(KEYS.invite(code))).toBeNull();
    expect((await as(carol).post('/api/join', { code })).status).toBe(404);
    const boot = await as(alice).get(`/api/ws/${wsId}`);
    expect(boot.data.workspace.invite).toBeNull();
    // Revoking again is a no-op, and a fresh link works as ever.
    expect((await as(alice).put(`/api/ws/${wsId}`, { revokeInvite: true })).ok).toBe(true);
    const again = await as(alice).put(`/api/ws/${wsId}`, { rotateInvite: true });
    expect((await as(carol).post('/api/join', { code: again.data.workspace.invite })).ok).toBe(true);
  });

  it('members leave, admins remove, the owner deletes', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    expect((await as(bob).del(`/api/ws/${wsId}/members/${carol.uuid}`)).status).toBe(403);
    expect((await as(bob).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    expect((await as(bob).get(`/api/ws/${wsId}`)).status).toBe(403);
    expect((await as(bob).get('/api/me')).data.workspaces).toEqual([]);

    expect((await as(alice).del(`/api/ws/${wsId}/members/${carol.uuid}`)).ok).toBe(true);
    const b = await as(alice).get(`/api/ws/${wsId}`);
    expect(Object.keys(b.data.workspace.members)).toEqual([alice.uuid]);
    expect(b.data.workspace.channels[general.id].count).toBe(1);
    expect((await as(alice).del(`/api/ws/${wsId}/members/${alice.uuid}`)).status).toBe(400);

    expect((await as(carol).del(`/api/ws/${wsId}`)).status).toBe(403);
    expect((await as(alice).del(`/api/ws/${wsId}`)).ok).toBe(true);
    expect((await as(alice).get(`/api/ws/${wsId}`)).status).toBe(404);
    expect((await as(alice).get('/api/me')).data.workspaces).toEqual([]);
    expect(await rt.kv.get(KEYS.block(general.id, 0))).toBeNull();
  });
});

describe('channels', () => {
  it('creates, joins, leaves, and refuses duplicates', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const c = await as(alice).post(`/api/ws/${wsId}/channels`, { name: ' Design Team ', topic: 'Pixels' });
    expect(c.ok).toBe(true);
    expect(c.data.channel).toMatchObject({ name: 'design-team', topic: 'Pixels', private: false, count: 1 });
    const ch = c.data.channel.id;

    expect((await as(bob).post(`/api/ws/${wsId}/channels`, { name: 'design-team' })).status).toBe(409);
    expect((await as(bob).post(`/api/ws/${wsId}/channels`, { name: '!!!' })).status).toBe(400);

    // Bob can preview a public channel but not post until joined.
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${ch}/messages`)).ok).toBe(true);
    const denied = await as(bob).post(`/api/ws/${wsId}/conv/${ch}/messages`, { text: 'hi' });
    expect(denied.status).toBe(403);
    expect(denied.data.code).toBe('not_joined');

    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`)).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${ch}/messages`, { text: 'hi' })).ok).toBe(true);
    let b = await as(bob).get(`/api/ws/${wsId}`);
    expect(b.data.me.channels).toContain(ch);
    expect(b.data.workspace.channels[ch].count).toBe(2);

    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/leave`)).ok).toBe(true);
    b = await as(bob).get(`/api/ws/${wsId}`);
    expect(b.data.me.channels).not.toContain(ch);
    expect(b.data.workspace.channels[ch].count).toBe(1);
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${general.id}/leave`)).status).toBe(400);
  });

  it('hides private channels until someone adds you', async () => {
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    const c = await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true });
    const ch = c.data.channel.id;
    expect(c.data.channel.members).toEqual([alice.uuid]);

    let b = await as(bob).get(`/api/ws/${wsId}`);
    expect(b.data.workspace.channels[ch]).toBeUndefined();
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${ch}/messages`)).status).toBe(404);
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`)).status).toBe(404);

    const add = await as(alice).post(`/api/ws/${wsId}/channels/${ch}/members`, { uuids: [bob.uuid, 'nobody'] });
    expect(add.data.added).toEqual([bob.uuid]);
    b = await as(bob).get(`/api/ws/${wsId}`);
    expect(b.data.workspace.channels[ch].members.sort()).toEqual([alice.uuid, bob.uuid].sort());
    expect(b.data.me.channels).toContain(ch);
    expect(b.data.activity.u[bob.uuid]).toBeGreaterThan(0); // poked to refetch

    const members = await as(bob).get(`/api/ws/${wsId}/channels/${ch}/members`);
    expect(members.data.members.sort()).toEqual([alice.uuid, bob.uuid].sort());
    expect((await as(carol).get(`/api/ws/${wsId}/channels/${ch}/members`)).status).toBe(404);
  });

  it('keeps the last person in a private channel from leaving it where nobody could reach it', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ch = (await as(bob).post(`/api/ws/${wsId}/channels`, { name: 'ours', private: true })).data.channel.id;
    await as(bob).post(`/api/ws/${wsId}/conv/${ch}/messages`, { text: 'kept' });
    const alone = await as(bob).post(`/api/ws/${wsId}/channels/${ch}/leave`);
    expect(alone.status).toBe(400);
    expect(alone.data.code).toBe('last_member');
    let b = await as(bob).get(`/api/ws/${wsId}`);
    expect(b.data.me.channels).toContain(ch);
    expect(b.data.workspace.channels[ch]).toMatchObject({ members: [bob.uuid], count: 1 });
    // With someone else in it, leaving is what it was; the one left is then held the same way.
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/members`, { uuids: [alice.uuid] })).data.added).toEqual([alice.uuid]);
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/leave`)).ok).toBe(true);
    b = await as(bob).get(`/api/ws/${wsId}`);
    expect(b.data.me.channels).not.toContain(ch);
    expect(b.data.workspace.channels[ch]).toBeUndefined();
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.channels[ch]).toMatchObject({ members: [alice.uuid], count: 1 });
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${ch}/leave`)).data.code).toBe('last_member');
    // An admin alone in it deletes it instead.
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${ch}`)).ok).toBe(true);
  });

  it('lists public channel members from member documents', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const c = await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' });
    await as(carol).post(`/api/ws/${wsId}/channels/${c.data.channel.id}/join`);
    const m = await as(bob).get(`/api/ws/${wsId}/channels/${c.data.channel.id}/members`);
    expect(m.data.members.sort()).toEqual([alice.uuid, carol.uuid].sort());
    const g = await as(bob).get(`/api/ws/${wsId}/channels/${general.id}/members`);
    expect(g.data.members).toHaveLength(3);
  });

  it('edits, archives, and deletes with the right permissions', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const c = await as(bob).post(`/api/ws/${wsId}/channels`, { name: 'bobs' });
    const ch = c.data.channel.id;
    // Carol has not joined: cannot edit.
    expect((await as(carol).put(`/api/ws/${wsId}/channels/${ch}`, { topic: 'x' })).status).toBe(403);
    // Creator can edit and archive.
    expect((await as(bob).put(`/api/ws/${wsId}/channels/${ch}`, { topic: 'Topic', name: 'Bobs Place' })).data.channel).toMatchObject({ topic: 'Topic', name: 'bobs-place' });
    // A description is a separate, longer field, trimmed like the topic.
    const described = await as(bob).put(`/api/ws/${wsId}/channels/${ch}`, { description: `  What this place is for.${'x'.repeat(600)}` });
    expect(described.data.channel.description.startsWith('What this place is for.')).toBe(true);
    expect(described.data.channel.description.length).toBeLessThanOrEqual(LIMITS.channelDescription);
    expect(described.data.channel.topic).toBe('Topic');
    const said = await as(bob).post(`/api/ws/${wsId}/conv/${ch}/messages`, { text: 'before the end' });
    const reply = await as(bob).post(`/api/ws/${wsId}/conv/${threadConvId(ch, said.data.message.seq)}/messages`, { text: 'a reply' });
    expect((await as(bob).put(`/api/ws/${wsId}/channels/${ch}`, { archived: true })).ok).toBe(true);
    const denied = await as(bob).post(`/api/ws/${wsId}/conv/${ch}/messages`, { text: 'hi' });
    expect(denied.data.code).toBe('archived');
    // Archived means read-only altogether: no reactions and no edits, in the
    // channel or the threads inside it; the author may still delete.
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${ch}/messages/${said.data.message.seq}/reactions`, { reaction: 'thumbsup' })).data.code).toBe('archived');
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${ch}/messages/${said.data.message.seq}`, { text: 'changed' })).data.code).toBe('archived');
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${threadConvId(ch, said.data.message.seq)}/messages/${reply.data.message.seq}`, { text: 'changed' })).data.code).toBe('archived');
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${ch}/messages/${said.data.message.seq}`)).ok).toBe(true);
    // Default channel: no archive, no delete, rename only by admins.
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { archived: true })).status).toBe(400);
    expect((await as(bob).put(`/api/ws/${wsId}/channels/${general.id}`, { name: 'lobby' })).status).toBe(403);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${general.id}`)).status).toBe(400);
    expect((await as(bob).del(`/api/ws/${wsId}/channels/${ch}`)).status).toBe(403);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${ch}`)).ok).toBe(true);
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.channels[ch]).toBeUndefined();
  });

  it('deletes a channel’s invite documents when the channel is deleted', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'project' })).data.channel.id;
    const guest = await as(alice).post(`/api/ws/${wsId}/channels/${ch}/invites`, { inviteTtl: '30d' });
    const share = await as(alice).post(`/api/ws/${wsId}/channels/${ch}/connect/invites`, { inviteTtl: '30d' });
    expect(guest.ok && share.ok).toBe(true);
    expect(await rt.kv.get(KEYS.invite(guest.data.code))).toBeTruthy();
    expect(await rt.kv.get(KEYS.invite(share.data.code))).toBeTruthy();
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${ch}`)).ok).toBe(true);
    // Both invite documents go with the channel, not left to linger to their TTL.
    expect(await rt.kv.get(KEYS.invite(guest.data.code))).toBeFalsy();
    expect(await rt.kv.get(KEYS.invite(share.data.code))).toBeFalsy();
  });

  it('lands a newcomer caught up, with no unread for their own “joined” line', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const b = (await as(bob).get(`/api/ws/${wsId}`)).data;
    const latest = b.activity.c[general.id]?.s || 0;
    expect(latest).toBeGreaterThan(0); // the "bob joined" line exists in #general
    expect(b.me.reads[general.id]).toBe(latest); // and bob has already read past it
    // Joining a channel from the browse dialog holds the same line.
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'watercooler' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`)).ok).toBe(true);
    const b2 = (await as(bob).get(`/api/ws/${wsId}`)).data;
    const joined = b2.activity.c[ch]?.s || 0;
    expect(joined).toBeGreaterThan(0); // the "bob joined" line exists in #watercooler
    expect(b2.me.reads[ch]).toBe(joined);
  });

  it('limits posting to admins on request, enforced in the worker', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const ann = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'announcements' })).data.channel.id;
    await as(bob).post(`/api/ws/${wsId}/channels/${ann}/join`);
    const earlier = (await as(bob).post(`/api/ws/${wsId}/conv/${ann}/messages`, { text: 'before the rule' })).data.message;
    // Members cannot set the policy; unknown values are refused.
    expect((await as(bob).put(`/api/ws/${wsId}/channels/${ann}`, { postPolicy: 'admins' })).status).toBe(403);
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ann}`, { postPolicy: 'nobody' })).status).toBe(400);
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ann}`, { threadPolicy: 'sometimes' })).status).toBe(400);
    const r = await as(alice).put(`/api/ws/${wsId}/channels/${ann}`, { postPolicy: 'admins' });
    expect(r.data.channel.postPolicy).toBe('admins');
    // Announced in the channel, like other structural changes.
    let page = await as(bob).get(`/api/ws/${wsId}/conv/${ann}/messages`);
    expect(page.data.messages.at(-1)).toMatchObject({ kind: 'sys', text: 'alice limited posting to admins' });

    const denied = await as(bob).post(`/api/ws/${wsId}/conv/${ann}/messages`, { text: 'me too' });
    expect(denied.status).toBe(403);
    expect(denied.data.code).toBe('read_only');
    expect(denied.data.message).toBe('Only admins can post in #announcements');
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${ann}/messages`, { text: 'release 2.0' })).ok).toBe(true);
    // Reactions stay open; so do threads by default; so does editing and deleting your own older message.
    const seq = (await as(alice).get(`/api/ws/${wsId}/conv/${ann}/messages`)).data.messages.at(-1).seq;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${ann}/messages/${seq}/reactions`, { reaction: 'tada' })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${threadConvId(ann, seq)}/messages`, { text: 'congrats' })).ok).toBe(true);
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${ann}/messages/${earlier.seq}`, { text: 'before the rule, edited' })).ok).toBe(true);
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${ann}/messages/${earlier.seq}`)).ok).toBe(true);
    // Other channels are untouched.
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'still fine' })).ok).toBe(true);
    // Back to everyone.
    await as(alice).put(`/api/ws/${wsId}/channels/${ann}`, { postPolicy: 'members' });
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${ann}/messages`, { text: 'me too' })).ok).toBe(true);
    page = await as(bob).get(`/api/ws/${wsId}/conv/${ann}/messages`);
    expect(page.data.messages.some((m) => m.kind === 'sys' && m.text === 'alice opened posting to everyone in the channel')).toBe(true);
  });

  it('thread replies can be limited to admins or turned off, independently', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const seq = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root' })).data.message.seq;
    const t = threadConvId(general.id, seq);
    expect((await as(bob).put(`/api/ws/${wsId}/channels/${general.id}`, { threadPolicy: 'off' })).status).toBe(403);
    await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { threadPolicy: 'admins' });
    let denied = await as(bob).post(`/api/ws/${wsId}/conv/${t}/messages`, { text: 'reply' });
    expect(denied.status).toBe(403);
    expect(denied.data.code).toBe('threads_admins');
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${t}/messages`, { text: 'admin reply' })).ok).toBe(true);
    // The main channel is still open to members.
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'top level' })).ok).toBe(true);
    await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { threadPolicy: 'off' });
    denied = await as(alice).post(`/api/ws/${wsId}/conv/${t}/messages`, { text: 'even admins' });
    expect(denied.data.code).toBe('threads_off');
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${t}/messages`)).ok).toBe(true); // reading is fine
    await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { threadPolicy: 'everyone' });
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${t}/messages`, { text: 'open again' })).ok).toBe(true);
    // Archived beats everything, as before.
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'old', postPolicy: 'admins' })).data.channel.id;
    await as(alice).put(`/api/ws/${wsId}/channels/${ch}`, { archived: true });
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${ch}/messages`, { text: 'x' })).data.code).toBe('archived');
  });

  it('admins can be promoted and demoted, never the owner', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    expect((await as(bob).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' })).status).toBe(403);
    expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    expect((await as(bob).put(`/api/ws/${wsId}`, { name: 'Renamed by admin' })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/members/${alice.uuid}/role`, { role: 'member' })).status).toBe(400);
  });
});

describe('messages', () => {
  const post = (u, wsId, conv, text) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text });

  it('assigns increasing sequence numbers and returns the newest page', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const a = await post(alice, wsId, general.id, 'first');
    const b = await post(bob, wsId, general.id, 'second');
    expect(a.data.message.seq).toBeLessThan(b.data.message.seq);
    expect(b.data.message).toMatchObject({ user: bob.uuid, text: 'second', kind: 'msg' });

    const page = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(page.data.seq).toBe(b.data.message.seq);
    expect(page.data.hasMore).toBe(false);
    const texts = page.data.messages.map((m) => m.text);
    expect(texts.slice(-2)).toEqual(['first', 'second']);
    expect(page.data.messages[0].kind).toBe('sys');

    expect((await post(alice, wsId, general.id, '   ')).status).toBe(400);
    expect((await post(alice, wsId, general.id, 'x'.repeat(5000))).data.message.text).toHaveLength(4000);
  });

  it('pages backwards through blocks without gaps or duplicates', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const total = BLOCK_SIZE * 2 + 17; // plus the system line: spans three blocks
    for (let i = 1; i <= total; i++) await post(alice, wsId, general.id, `m${i}`);

    const seen = [];
    let res = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    seen.unshift(...res.data.messages.map((m) => m.seq));
    let guard = 0;
    while (res.data.hasMore && guard++ < 10) {
      const oldest = seen[0];
      res = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages?before=${oldest}`);
      seen.unshift(...res.data.messages.map((m) => m.seq));
    }
    expect(seen.length).toBe(total + 1);
    expect(seen).toEqual(Array.from({ length: total + 1 }, (_, i) => i + 1));
    // Blocks were created ahead of time, so the store holds an empty tail block.
    expect(await rt.kv.get(KEYS.block(general.id, 3))).toEqual({ m: [], x: {} });
  });

  it('fetches only what is newer with ?after and re-reads ranges', async () => {
    const { wsId, general } = await workspaceWith(alice);
    for (let i = 1; i <= 5; i++) await post(alice, wsId, general.id, `m${i}`);
    const r = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages?after=3`);
    expect(r.data.messages.map((m) => m.seq)).toEqual([4, 5, 6]);
    expect(r.data.hasMore).toBe(false);
    const none = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages?after=6`);
    expect(none.data.messages).toEqual([]);
    const range = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages?from=2&to=4`);
    expect(range.data.messages.map((m) => m.seq)).toEqual([2, 3, 4]);
  });

  it('survives concurrent senders in the same block', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const senders = [alice, bob, carol];
    await Promise.all(Array.from({ length: 30 }, (_, i) => post(senders[i % 3], wsId, general.id, `c${i}`)));
    const page = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    const seqs = page.data.messages.map((m) => m.seq);
    // 30 posts + "created #general" + two join notices
    expect(seqs).toHaveLength(33);
    expect(new Set(seqs).size).toBe(33);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('falls back safely when the store refuses add on a missing block', async () => {
    rt = await boot({ strictAdd: true });
    const { wsId, general } = await workspaceWith(alice);
    for (let i = 1; i <= BLOCK_SIZE + 2; i++) await post(alice, wsId, general.id, `m${i}`);
    const page = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(page.data.seq).toBe(BLOCK_SIZE + 3);
    expect(page.data.messages.at(-1).text).toBe(`m${BLOCK_SIZE + 2}`);
  });

  it('edits and deletes with ownership rules; admins may delete', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await post(bob, wsId, general.id, 'typo')).data.message;
    const path = `/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}`;
    expect((await as(alice).put(path, { text: 'hijack' })).status).toBe(403);
    expect((await as(bob).put(path, { text: '' })).status).toBe(400);
    const e = await as(bob).put(path, { text: 'fixed' });
    expect(e.ok).toBe(true);
    let page = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    const edited = page.data.messages.find((x) => x.seq === m.seq);
    expect(edited.text).toBe('fixed');
    expect(edited.editedAt).toBeGreaterThan(0);
    // System lines cannot be edited.
    expect((await as(alice).put(`/api/ws/${wsId}/conv/${general.id}/messages/1`, { text: 'x' })).status).toBe(403);

    expect((await as(alice).del(path)).ok).toBe(true); // admin
    page = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(page.data.messages.find((x) => x.seq === m.seq)).toBeUndefined();
    expect((await as(bob).put(path, { text: 'zombie' })).status).toBe(404);

    const m2 = (await post(alice, wsId, general.id, 'mine')).data.message;
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${general.id}/messages/${m2.seq}`)).status).toBe(403);
  });

  it('caps the reactions a message carries in all, not only the distinct kinds', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await post(alice, wsId, general.id, 'popular')).data.message;
    const crowd = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`u${String(i).padStart(4, '0')}`, 1]));
    await rt.kv.update(KEYS.block(general.id, 0), { [`x.${overlayKey(m.seq)}.r.heart`]: crowd });
    const path = `/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/reactions`;
    const refused = await as(bob).post(path, { reaction: 'tada' });
    expect(refused.status).toBe(400);
    expect(refused.data.code).toBe('limit');
    expect((await as(bob).post(path, { reaction: 'heart' })).status).toBe(400); // joining a full one is no better
    // Taking one away always works, and makes room: 999 others and bob's own make a full thousand.
    const fewer = Object.fromEntries(Object.entries(crowd).slice(1));
    await rt.kv.update(KEYS.block(general.id, 0), { [`x.${overlayKey(m.seq)}.r.heart`]: { ...fewer, [bob.uuid]: 1 } });
    expect((await as(bob).post(path, { reaction: 'tada' })).status).toBe(400);
    expect((await as(bob).post(path, { reaction: 'heart', on: false })).ok).toBe(true);
    expect((await as(bob).post(path, { reaction: 'tada' })).ok).toBe(true);
  });

  it('toggles reactions per user', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await post(alice, wsId, general.id, 'react to me')).data.message;
    const path = `/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/reactions`;
    expect((await as(bob).post(path, { reaction: 'nope' })).status).toBe(400);
    // Only known shortcodes (and the legacy icon names) become storage paths.
    for (const bad of ['x.y', 'tada-tone9', 'party-popper-tone2', '__proto__', 'a'.repeat(60), '', null, 7]) {
      expect((await as(bob).post(path, { reaction: bad })).status, String(bad)).toBe(400);
    }
    expect((await as(bob).post(path, { reaction: 'tada' })).data.on).toBe(true);
    expect((await as(bob).post(path, { reaction: 'wave-tone3' })).data.on).toBe(true);
    expect((await as(bob).post(path, { reaction: '+1' })).data.on).toBe(true);
    expect((await as(bob).post(path, { reaction: 'party-popper' })).data.on).toBe(true); // legacy icon still accepted
    let withEmoji = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(Object.keys(withEmoji.data.messages.find((x) => x.seq === m.seq).reactions).sort()).toEqual(['+1', 'party-popper', 'tada', 'wave-tone3']);
    for (const k of ['tada', 'wave-tone3', '+1', 'party-popper']) await as(bob).post(path, { reaction: k, on: false });
    withEmoji = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(withEmoji.data.messages.find((x) => x.seq === m.seq).reactions).toEqual({});
    expect((await as(bob).post(path, { reaction: 'heart' })).data.on).toBe(true);
    expect((await as(alice).post(path, { reaction: 'heart' })).data.on).toBe(true);
    let page = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(page.data.messages.find((x) => x.seq === m.seq).reactions).toEqual({ heart: { [bob.uuid]: 1, [alice.uuid]: 1 } });
    expect((await as(bob).post(path, { reaction: 'heart' })).data.on).toBe(false);
    page = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(page.data.messages.find((x) => x.seq === m.seq).reactions).toEqual({ heart: { [alice.uuid]: 1 } });
    const sync = await as(alice).get(`/api/ws/${wsId}/sync?since=0`);
    expect(sync.data.c[general.id].x).toBeGreaterThan(0);
  });

  it('caps the distinct reactions on one message', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await post(alice, wsId, general.id, 'popular')).data.message;
    const path = `/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/reactions`;
    const keys = ['tada', 'heart', 'joy', 'eyes', 'rocket', 'fire', '+1', '-1', 'wave', 'ok_hand', 'clap', 'pray',
      'star', 'sparkles', 'zap', 'bulb', 'bug', 'ship', 'sunny', 'cloud', 'coffee', 'pizza', 'cake', 'beer'];
    for (const k of keys) expect((await as(alice).post(path, { reaction: k })).ok, k).toBe(true);
    const over = await as(bob).post(path, { reaction: 'taco' });
    expect(over.status).toBe(400);
    expect(over.data.code).toBe('limit');
    // Joining an existing reaction is always fine; so is adding one after another was removed.
    expect((await as(bob).post(path, { reaction: 'tada' })).ok).toBe(true);
    await as(alice).post(path, { reaction: 'beer', on: false });
    expect((await as(bob).post(path, { reaction: 'taco' })).ok).toBe(true);
  });

  it('threads are conversations of their own and count on the parent', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await post(alice, wsId, general.id, 'parent')).data.message;
    const t = threadConvId(general.id, m.seq);
    const r1 = await post(bob, wsId, t, 'reply one');
    const r2 = await post(alice, wsId, t, 'reply two');
    expect(r1.data.message.seq).toBe(1);
    expect(r2.data.message.seq).toBe(2);
    const replies = await as(bob).get(`/api/ws/${wsId}/conv/${t}/messages`);
    expect(replies.data.messages.map((x) => x.text)).toEqual(['reply one', 'reply two']);
    const page = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    const parent = page.data.messages.find((x) => x.seq === m.seq);
    expect(parent.replyCount).toBe(2);
    expect(parent.lastReplyAt).toBeGreaterThan(0);
    // Thread access follows the parent's access.
    expect((await as(carol).get(`/api/ws/${wsId}/conv/${t}/messages`)).status).toBe(403);
    expect((await as(alice).get(`/api/ws/${wsId}/conv/zzz_t1/messages`)).status).toBe(404);
  });

  it('takes a deleted reply off its root\'s count, so the count says what the thread holds', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await post(alice, wsId, general.id, 'parent')).data.message;
    const t = threadConvId(general.id, m.seq);
    const r1 = (await post(bob, wsId, t, 'reply one')).data.message;
    const r2 = (await post(alice, wsId, t, 'reply two')).data.message;
    const root = async () => (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.find((x) => x.seq === m.seq);
    expect((await root()).replyCount).toBe(2);
    const before = (await rt.kv.get(KEYS.activity(wsId))).c[general.id].x;
    await new Promise((r) => setTimeout(r, 2));
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${t}/messages/${r1.seq}`)).ok).toBe(true);
    expect((await root()).replyCount).toBe(1);
    // The root's conversation is stamped too, so an open channel refetches the root with its count.
    expect((await rt.kv.get(KEYS.activity(wsId))).c[general.id].x).toBeGreaterThan(before);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${t}/messages/${r2.seq}`)).ok).toBe(true);
    expect((await root()).replyCount).toBe(0);
    // A reply already gone is refused, and the count never falls below what is there.
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${t}/messages/${r2.seq}`)).status).toBe(404);
    expect((await root()).replyCount).toBe(0);
  });

  it('resolves @mentions to members and tracks mention counts until read', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = await post(alice, wsId, general.id, 'hey @bob and @nobody, look at this');
    expect(m.data.message.mentions).toEqual([bob.uuid]);
    let b = await as(bob).get(`/api/ws/${wsId}`);
    expect(b.data.me.mentions[general.id]).toBe(1);
    // Joining leaves Bob read through his own "joined" line (seq 1 "created
    // #general", seq 2 "bob joined"); Alice's @bob that followed is the unread.
    expect(b.data.me.reads[general.id]).toBe(2);
    // Alice's own cursor followed her post.
    const a = await as(alice).get(`/api/ws/${wsId}`);
    expect(a.data.me.reads[general.id]).toBe(m.data.message.seq);

    await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: m.data.message.seq });
    b = await as(bob).get(`/api/ws/${wsId}`);
    expect(b.data.me.mentions[general.id]).toBe(0);
    expect(b.data.me.reads[general.id]).toBe(m.data.message.seq);
    // Cursors never move backwards.
    await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: 1 });
    b = await as(bob).get(`/api/ws/${wsId}`);
    expect(b.data.me.reads[general.id]).toBe(m.data.message.seq);
  });

  it('a mention of someone who cannot read the conversation is only text', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    // A private channel bob is not in: no counter, no inbox entry, nothing to badge.
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel;
    const m = await post(alice, wsId, secret.id, 'hey @bob, this is private');
    expect(m.data.message.mentions).toEqual([]);
    expect(m.data.notified).toBe(0);
    let b = await as(bob).get(`/api/ws/${wsId}`);
    expect(b.data.me.mentions[secret.id]).toBeUndefined();
    expect(b.data.me.inbox).toBe(0);
    expect((await rt.kv.get(KEYS.inbox(wsId, bob.uuid)))?.items || []).toHaveLength(0);
    // The same inside a thread of that channel, and in a direct message.
    const t = await post(alice, wsId, threadConvId(secret.id, m.data.message.seq), '@bob still private');
    expect(t.data.message.mentions).toEqual([]);
    const dm = (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [carol.uuid] })).data.conv;
    const d = await post(alice, wsId, dm, '@bob not for you; @carol is');
    expect(d.data.message.mentions).toEqual([carol.uuid]);
    b = await as(bob).get(`/api/ws/${wsId}`);
    expect(b.data.me.inbox).toBe(0);
    expect((await as(carol).get(`/api/ws/${wsId}`)).data.me.mentions[dm]).toBe(1);
    // Once bob is in the private channel, mentions there reach him like anywhere else.
    await as(alice).post(`/api/ws/${wsId}/channels/${secret.id}/members`, { uuids: [bob.uuid] });
    const ok = await post(alice, wsId, secret.id, '@bob welcome');
    expect(ok.data.message.mentions).toEqual([bob.uuid]);
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.me.mentions[secret.id]).toBe(1);
  });
});

describe('broadcast mentions', () => {
  const post = (u, wsId, conv, text) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text });
  const mentions = async (u, wsId, conv) => (await as(u).get(`/api/ws/${wsId}`)).data.me.mentions[conv] || 0;

  it('clears the mention badge only when the conversation is read to its end', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    await post(alice, wsId, general.id, 'one');
    const m = (await post(alice, wsId, general.id, 'hey @bob')).data.message;
    expect(await mentions(bob, wsId, general.id)).toBe(1);
    // Read up to the message before it (the end of a window opened at a permalink): the badge stands.
    await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: m.seq - 1 });
    expect(await mentions(bob, wsId, general.id)).toBe(1);
    await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: m.seq });
    expect(await mentions(bob, wsId, general.id)).toBe(0);
  });

  it('@channel reaches the channel, @here only the present, and the kind is stored', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol, dave]);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    await as(bob).post(`/api/ws/${wsId}/channels/${ops}/join`);
    await as(carol).post(`/api/ws/${wsId}/channels/${ops}/join`);
    // dave is not in #ops. Only bob has a recent heartbeat.
    await as(bob).get(`/api/ws/${wsId}/sync?since=0&hb=1`);

    const r = await post(carol, wsId, ops, 'heads up @channel, deploy in 5');
    expect(r.ok).toBe(true);
    expect(r.data.message.broadcast).toBe('channel');
    expect(r.data.message.mentions).toEqual([]); // the list is not stored
    expect(r.data.notified).toBe(2); // alice and bob, not carol herself, not dave
    expect(await mentions(alice, wsId, ops)).toBe(1);
    expect(await mentions(bob, wsId, ops)).toBe(1);
    expect(await mentions(dave, wsId, ops)).toBe(0);
    const page = await as(alice).get(`/api/ws/${wsId}/conv/${ops}/messages`);
    expect(page.data.messages.at(-1)).toMatchObject({ broadcast: 'channel', mentions: [] });
    // Everyone poked in one activity write.
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.u[alice.uuid]).toBeGreaterThan(0);
    expect(act.u[bob.uuid]).toBeGreaterThan(0);

    const here = await post(carol, wsId, ops, '@here quick one');
    expect(here.data.message.broadcast).toBe('here');
    expect(here.data.notified).toBe(1);
    expect(await mentions(bob, wsId, ops)).toBe(2);
    expect(await mentions(alice, wsId, ops)).toBe(1);

    // A person mentioned alongside is counted once.
    const both = await post(carol, wsId, ops, '@channel and @bob especially');
    expect(both.data.message.mentions).toEqual([bob.uuid]);
    expect(both.data.notified).toBe(2);
    expect(await mentions(bob, wsId, ops)).toBe(3);
    // Nothing broadcast-like in a normal message.
    expect((await post(carol, wsId, general.id, 'hello all')).data.message.broadcast).toBeNull();
  });

  it('@channel inside a thread of a direct message reaches the other people in it', async () => {
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    const dm = (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid, carol.uuid] })).data.conv;
    const root = (await post(alice, wsId, dm, 'root')).data.message;
    const tid = threadConvId(dm, root.seq);
    // A thread inherits its parent's members: the reply is a broadcast to
    // the conversation, not a server error, and reaches everyone but the sender.
    const r = await post(alice, wsId, tid, '@channel have a look');
    expect(r.ok).toBe(true);
    expect(r.data.message.broadcast).toBe('channel');
    expect(r.data.notified).toBe(2);
    expect(await mentions(bob, wsId, dm)).toBe(1);
    expect(await mentions(carol, wsId, dm)).toBe(1);
    expect(await mentions(alice, wsId, dm)).toBe(0);
    // @here follows presence there too, and @everyone still belongs to the default channel.
    await as(bob).get(`/api/ws/${wsId}/sync?since=0&hb=1`);
    expect((await post(alice, wsId, tid, '@here now')).data.notified).toBe(1);
    expect((await post(alice, wsId, tid, '@everyone all')).data.code).toBe('broadcast_scope');
  });

  it('is admins-only in the default channel unless opened, and @everyone stays there', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const denied = await post(bob, wsId, general.id, '@channel anyone?');
    expect(denied.status).toBe(403);
    expect(denied.data.code).toBe('broadcast_forbidden');
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.some((m) => m.text.includes('anyone'))).toBe(false);
    const ok = await post(alice, wsId, general.id, '@everyone welcome');
    expect(ok.data.message.broadcast).toBe('everyone');
    expect(ok.data.notified).toBe(2);
    // @everyone outside a default channel is refused, with a hint.
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    const scope = await post(alice, wsId, ops, '@everyone look');
    expect(scope.status).toBe(400);
    expect(scope.data.code).toBe('broadcast_scope');
    // Admins can open the default channel, or close another one.
    expect((await as(bob).put(`/api/ws/${wsId}/channels/${general.id}`, { broadcast: 'everyone' })).status).toBe(403);
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { broadcast: 'sometimes' })).status).toBe(400);
    await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { broadcast: 'everyone' });
    expect((await post(bob, wsId, general.id, '@channel now allowed')).ok).toBe(true);
    await as(alice).put(`/api/ws/${wsId}/channels/${ops}`, { broadcast: 'admins' });
    await as(bob).post(`/api/ws/${wsId}/channels/${ops}/join`);
    expect((await post(bob, wsId, ops, '@here?')).data.code).toBe('broadcast_forbidden');
    expect((await post(bob, wsId, ops, 'plain text is fine')).ok).toBe(true);
  });

  it('fans out to a large channel in bounded, batched writes', async () => {
    const { wsId, general } = await workspaceWith(alice);
    // Sixty members, joined directly into the store to keep the test quick.
    const uuids = Array.from({ length: 60 }, (_, i) => `u-many-${String(i).padStart(3, '0')}`);
    const members = {};
    for (const u of uuids) members[`members.${u}`] = { username: u, name: u, title: '', color: 1, role: 'member', joinedAt: 1 };
    await rt.kv.update(KEYS.ws(wsId), members);
    for (const u of uuids) await rt.kv.set(KEYS.member(wsId, u), { channels: [general.id], dms: {}, reads: {}, mentions: {} });
    const before = rt.kv._calls.ops;
    const r = await post(alice, wsId, general.id, '@channel all hands');
    expect(r.ok).toBe(true);
    expect(r.data.notified).toBe(60);
    // 60 member reads (who is in the channel), then per recipient a counter
    // bump, an inbox append and its counter, and one read each for the first
    // 50 to see whether they want a push: bounded, and documented.
    expect(rt.kv._calls.ops - before).toBeLessThan(60 + 60 * 3 + 50 + 30);
    const doc = await rt.kv.get(KEYS.member(wsId, uuids[59]));
    expect(doc.mentions[general.id]).toBe(1);
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(Object.keys(act.u).filter((u) => u.startsWith('u-many-'))).toHaveLength(60);
  });
});

describe('notification settings', () => {
  const post = (u, wsId, conv, text) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text });

  it('stores a level and mute per conversation in the member document', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${general.id}/notify`, { level: 'loud' })).status).toBe(400);
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${general.id}/notify`, { mute: 'yes' })).status).toBe(400);
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${general.id}/notify`, {})).status).toBe(400);
    expect((await as(bob).put(`/api/ws/${wsId}/conv/nope/notify`, { level: 'all' })).status).toBe(404);
    const r = await as(bob).put(`/api/ws/${wsId}/conv/${general.id}/notify`, { level: 'all' });
    expect(r.data.notify).toEqual({ level: 'all' });
    await as(bob).put(`/api/ws/${wsId}/conv/${general.id}/notify`, { mute: true });
    const b = await as(bob).get(`/api/ws/${wsId}`);
    expect(b.data.me.notify[general.id]).toEqual({ level: 'all', mute: true });
    // Alice's document is untouched: the setting is the member's own.
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.me.notify).toEqual({});
    // Following is for threads only.
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${general.id}/notify`, { follow: true })).status).toBe(400);
  });

  it('counts a reply, and a reaction, only for followers who can still read the thread, and zeroes a counter left behind', async () => {
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel;
    await as(alice).post(`/api/ws/${wsId}/channels/${secret.id}/members`, { uuids: [bob.uuid, carol.uuid] });
    const root = (await post(alice, wsId, secret.id, 'root')).data.message;
    const t = threadConvId(secret.id, root.seq);
    const me = async (u) => (await as(u).get(`/api/ws/${wsId}`)).data.me;
    const bobsReply = (await post(bob, wsId, t, 'bob follows now')).data.message;
    await post(carol, wsId, t, 'unread for bob');
    expect((await me(bob)).threads[t]).toBe(1);
    // Bob leaves the channel with that reply unread: nothing new reaches him.
    await as(bob).post(`/api/ws/${wsId}/channels/${secret.id}/leave`);
    const inboxBefore = (await as(bob).get(`/api/ws/${wsId}/inbox`)).data.unread;
    await post(carol, wsId, t, 'after bob left');
    await as(carol).post(`/api/ws/${wsId}/conv/${t}/messages/${bobsReply.seq}/reactions`, { reaction: 'heart', on: true });
    expect((await me(alice)).threads[t]).toBe(3);
    expect((await me(bob)).threads[t]).toBe(1); // the one from before he left, no more
    expect((await as(bob).get(`/api/ws/${wsId}/inbox`)).data.unread).toBe(inboxBefore);
    // The Threads view cannot show that thread to him, so it lets the counter go.
    expect((await as(bob).get(`/api/ws/${wsId}/threads`)).data.threads).toEqual([]);
    expect((await me(bob)).threads[t] || 0).toBe(0);
    // Followers still in the channel are counted as before.
    expect((await as(alice).get(`/api/ws/${wsId}/threads`)).data.threads[0]).toMatchObject({ seq: root.seq, unread: 3 });
  });

  it('adds someone back to a private channel whose list still names them after a lost leave', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${secret}/members`, { uuids: [bob.uuid] })).data.added).toEqual([bob.uuid]);
    // Bob's leave lands on his document but its rewrite of the list is lost: the list still names him, he is out.
    const doc = await rt.kv.get(KEYS.member(wsId, bob.uuid));
    await rt.kv.update(KEYS.member(wsId, bob.uuid), { channels: doc.channels.filter((c) => c !== secret) });
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${secret}/messages`)).status).toBe(404);
    const again = await as(alice).post(`/api/ws/${wsId}/channels/${secret}/members`, { uuids: [bob.uuid] });
    expect(again.data.added).toEqual([bob.uuid]);
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${secret}/messages`)).ok).toBe(true);
    // The list names him once.
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.channels[secret].members.filter((u) => u === bob.uuid)).toHaveLength(1);
    // Someone truly in already is not added twice.
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${secret}/members`, { uuids: [bob.uuid] })).data.added).toEqual([]);
  });

  it('tells the reader\'s other tabs when a read clears a badge, and not for every cursor move', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const stamp = async () => (await as(bob).get(`/api/ws/${wsId}`)).data.activity.u?.[bob.uuid] || 0;
    const m1 = (await post(alice, wsId, general.id, 'plain')).data.message;
    const s0 = await stamp();
    await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: m1.seq });
    expect(await stamp()).toBe(s0); // a cursor moved, nothing to badge: the other tabs need not refetch
    const m2 = (await post(alice, wsId, general.id, 'hey @bob')).data.message;
    const s1 = await stamp(); // the mention itself pokes bob
    await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: m2.seq });
    expect(await stamp()).toBeGreaterThan(s1); // the badge cleared: the other tabs learn of it on their next poll
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.me.mentions[general.id]).toBe(0);
  });

  it('counts unread replies for a thread\'s followers, and lets them unfollow', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol, dave]);
    const root = (await post(alice, wsId, general.id, 'root')).data.message;
    const t = threadConvId(general.id, root.seq);
    const threads = async (u) => (await as(u).get(`/api/ws/${wsId}`)).data.me.threads[t] || 0;
    // Bob replies: the author is notified, the replier is not; bob now follows.
    await post(bob, wsId, t, 'first reply');
    expect(await threads(alice)).toBe(1);
    expect(await threads(bob)).toBe(0);
    expect(await threads(carol)).toBe(0);
    const page = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(page.data.messages.find((m) => m.seq === root.seq).followers).toEqual({ [bob.uuid]: 1 });
    // Carol replies: alice and bob hear about it.
    await post(carol, wsId, t, 'second');
    expect(await threads(alice)).toBe(2);
    expect(await threads(bob)).toBe(1);
    // A mention inside the thread is a mention, not also a reply.
    await post(carol, wsId, t, 'hey @bob');
    expect(await threads(bob)).toBe(1);
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.me.mentions[general.id]).toBe(1);
    // Dave follows without having replied; alice unfollows her own thread.
    await as(dave).put(`/api/ws/${wsId}/conv/${t}/notify`, { follow: true });
    await as(alice).put(`/api/ws/${wsId}/conv/${t}/notify`, { follow: false });
    expect(await threads(alice)).toBe(0); // unfollowing clears the counter
    await post(bob, wsId, t, 'third');
    expect(await threads(dave)).toBe(1);
    expect(await threads(alice)).toBe(0);
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.me.notify[t]).toEqual({ follow: false });
    // Reading the thread clears the counter.
    await as(dave).post(`/api/ws/${wsId}/conv/${t}/read`, { seq: 4 });
    expect(await threads(dave)).toBe(0);
    // Sample teammates never get counters.
    const sample = (await as(alice).post('/api/workspaces/sample')).data.workspace.id;
    const sb = await as(alice).get(`/api/ws/${sample}`);
    const g = Object.values(sb.data.workspace.channels).find((c) => c.name === 'general');
    const threaded = (await as(alice).get(`/api/ws/${sample}/conv/${g.id}/messages`)).data.messages.find((m) => m.replyCount > 0);
    expect((await post(alice, sample, threadConvId(g.id, threaded.seq), 'me too')).ok).toBe(true);
  });

  it('counts a broadcast in a reply as a mention for the followers it reaches, not also as a reply', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const root = (await post(alice, wsId, general.id, 'root')).data.message;
    const t = threadConvId(general.id, root.seq);
    await post(bob, wsId, t, 'bob follows now');
    const me = async (u) => (await as(u).get(`/api/ws/${wsId}`)).data.me;
    const kinds = async (u) => (await as(u).get(`/api/ws/${wsId}/inbox`)).data.items.map((e) => e.k);
    // Alice may broadcast in #general: bob, a follower, is reached by it
    // and hears of the reply as a mention, once.
    await post(alice, wsId, t, '@channel please look');
    const bobs = await me(bob);
    expect(bobs.mentions[general.id]).toBe(1);
    expect(bobs.threads[t] || 0).toBe(0);
    expect(await kinds(bob)).toEqual(['mention']);
    // Carol is not in the thread: the broadcast is her only notice too.
    const carols = await me(carol);
    expect(carols.mentions[general.id]).toBe(1);
    expect(carols.threads[t] || 0).toBe(0);
    // A follower a broadcast does not reach (@here, away) is still told of the reply.
    await post(alice, wsId, t, '@here anyone?');
    expect((await me(bob)).threads[t]).toBe(1);
    expect(await kinds(bob)).toEqual(['reply', 'mention']);
  });
});

describe('pins and bookmarks', () => {
  const post = (u, wsId, conv, text, extra = {}) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text, ...extra });

  it('pins and unpins with the right permissions, announced in the conversation', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const m = (await post(bob, wsId, general.id, 'decision: ship Friday')).data.message;
    const path = `/api/ws/${wsId}/conv/${general.id}/pins`;
    // A member not in the channel (or a system line) cannot pin.
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    const opsMsg = (await post(alice, wsId, ops, 'x')).data.message;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${ops}/pins`, { seq: opsMsg.seq })).status).toBe(403);
    expect((await as(bob).post(path, { seq: 1 })).status).toBe(400); // "created #general"
    expect((await as(bob).post(path, { seq: 9999 })).status).toBe(404);

    const r = await as(carol).post(path, { seq: m.seq });
    expect(r.ok).toBe(true);
    expect(r.data.pin).toMatchObject({ seq: m.seq, by: carol.uuid });
    expect((await as(carol).post(path, { seq: m.seq })).data.already).toBe(true);
    let page = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(page.data.messages.find((x) => x.seq === m.seq).pinned).toBe(true);
    expect(page.data.messages.at(-1)).toMatchObject({ kind: 'sys', text: 'carol pinned a message' });
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.c[general.id].pc).toBe(1);

    const pins = await as(bob).get(path);
    expect(pins.data.pins).toHaveLength(1);
    expect(pins.data.pins[0].message).toMatchObject({ seq: m.seq, text: 'decision: ship Friday', user: bob.uuid });
    // Bob did not pin it and is not an admin: he cannot unpin; carol and alice can.
    expect((await as(bob).del(`${path}/${m.seq}`)).status).toBe(403);
    expect((await as(alice).del(`${path}/${m.seq}`)).ok).toBe(true);
    expect((await as(alice).del(`${path}/${m.seq}`)).status).toBe(404);
    page = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(page.data.messages.find((x) => x.seq === m.seq).pinned).toBe(false);
    expect((await rt.kv.get(KEYS.activity(wsId))).c[general.id].pc).toBe(0);
    // Deleting a pinned message removes the pin.
    await as(carol).post(path, { seq: m.seq });
    await as(bob).del(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}`);
    expect((await as(bob).get(path)).data.pins).toEqual([]);
    // Threads and DMs pin too.
    const t = threadConvId(general.id, (await post(alice, wsId, general.id, 'root')).data.message.seq);
    const reply = (await post(bob, wsId, t, 'reply')).data.message;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${t}/pins`, { seq: reply.seq })).ok).toBe(true);
    const dm = (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] })).data.conv;
    const dmMsg = (await post(alice, wsId, dm, 'psst')).data.message;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${dm}/pins`, { seq: dmMsg.seq })).ok).toBe(true);
    expect((await as(carol).get(`/api/ws/${wsId}/conv/${dm}/pins`)).status).toBe(404);
  });

  it('caps pins per conversation and follows the posting policy', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const path = `/api/ws/${wsId}/conv/${general.id}/pins`;
    for (let i = 0; i < LIMITS.pinsPerConversation; i++) {
      const m = (await post(alice, wsId, general.id, `p${i}`)).data.message;
      expect((await as(alice).post(path, { seq: m.seq })).ok).toBe(true);
    }
    const extra = (await post(alice, wsId, general.id, 'one more')).data.message;
    const over = await as(alice).post(path, { seq: extra.seq });
    expect(over.status).toBe(400);
    expect(over.data.code).toBe('limit');
    // Bounded reads: the list comes back with messages for the newest pins.
    const before = rt.kv._calls.ops;
    const pins = await as(bob).get(path);
    expect(pins.data.pins).toHaveLength(LIMITS.pinsPerConversation);
    expect(pins.data.pins[0].message).toBeTruthy();
    expect(rt.kv._calls.ops - before).toBeLessThanOrEqual(2 + 1 + 12);
    // Admin-only posting means admin-only pinning.
    const ann = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ann', postPolicy: 'admins' })).data.channel.id;
    await as(alice).put(`/api/ws/${wsId}/channels/${ann}`, { postPolicy: 'admins' });
    await as(bob).post(`/api/ws/${wsId}/channels/${ann}/join`);
    const a = (await post(alice, wsId, ann, 'notice')).data.message;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${ann}/pins`, { seq: a.seq })).data.code).toBe('read_only');
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${ann}/pins`, { seq: a.seq })).ok).toBe(true);
  });

  it('keeps up to ten validated bookmarks on a channel, in order', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const put = (u, body) => as(u).put(`/api/ws/${wsId}/channels/${general.id}`, body);
    expect((await put(bob, { bookmarks: 'nope' })).status).toBe(400);
    expect((await put(bob, { bookmarks: [{ label: 'x', url: 'javascript:alert(1)' }] })).status).toBe(400);
    expect((await put(bob, { bookmarks: [{ label: '', url: 'https://a.io' }] })).status).toBe(400);
    expect((await put(bob, { bookmarks: [{ label: 'f', file: 'notafile1' }] })).status).toBe(400);
    const r = await put(bob, { bookmarks: [{ label: 'Docs', url: 'https://docs.example.com/x' }, { label: 'Tracker', url: 'http://tracker.local' }] });
    expect(r.ok).toBe(true);
    const list = r.data.channel.bookmarks;
    expect(list.map((b) => b.label)).toEqual(['Docs', 'Tracker']);
    expect(list[0].id).toMatch(/^[a-z0-9]{8}$/);
    // Reorder keeps ids.
    const swapped = await put(alice, { bookmarks: [list[1], list[0]] });
    expect(swapped.data.channel.bookmarks.map((b) => b.id)).toEqual([list[1].id, list[0].id]);
    // An attachment from this workspace can be bookmarked and gets its name.
    const fd = new FormData();
    fd.append('file', new File(['x'], 'brief.pdf', { type: 'application/pdf' }));
    const file = (await as(alice).post(`/api/ws/${wsId}/files`, fd)).data;
    const withFile = await put(alice, { bookmarks: [...list, { label: 'Brief', file: file.id }] });
    expect(withFile.data.channel.bookmarks.at(-1)).toMatchObject({ label: 'Brief', file: file.id, name: 'brief.pdf' });
    // Cap.
    const many = Array.from({ length: 11 }, (_, i) => ({ label: `b${i}`, url: `https://x.io/${i}` }));
    expect((await put(alice, { bookmarks: many })).data.code).toBe('limit');
    expect((await put(alice, { bookmarks: many.slice(0, 10) })).ok).toBe(true);
    // Not in the channel: not yours to curate.
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    expect((await as(carol).put(`/api/ws/${wsId}/channels/${ops}`, { bookmarks: [] })).status).toBe(403);
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.workspace.channels[general.id].bookmarks).toHaveLength(10);
  });
});

describe('channel deletion', () => {
  it('does not let go of a deleted root\'s files a second time when its channel goes', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    const fd = new FormData();
    fd.append('file', new File(['shared on'], 'b.txt', { type: 'text/plain' }));
    const file = (await as(alice).post(`/api/ws/${wsId}/files`, fd)).data;
    // A root with the file and a reply (so its deletion leaves a tombstone
    // that still lists the file), the file forwarded on into #general.
    const root = (await as(alice).post(`/api/ws/${wsId}/conv/${ops}/messages`, { text: 'here', attachments: [{ id: file.id }] })).data.message;
    await as(alice).post(`/api/ws/${wsId}/conv/${threadConvId(ops, root.seq)}/messages`, { text: 'a reply' });
    const fwd = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'forwarded', attachments: [{ id: file.id }] })).data.message;
    expect((await rt.kv.get(KEYS.file(file.id))).refs).toBe(2);
    await as(alice).del(`/api/ws/${wsId}/conv/${ops}/messages/${root.seq}`);
    expect((await rt.kv.get(KEYS.file(file.id))).refs).toBe(1);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${ops}`)).ok).toBe(true);
    // Still held by the forwarded copy, bytes and all.
    expect((await rt.kv.get(KEYS.file(file.id))).refs).toBe(1);
    expect(rt.fs._files.has(`teamchat-files/${wsId}/${file.id}`)).toBe(true);
    expect((await as(bob).get(`/api/ws/${wsId}/files/${file.id}`)).ok).toBe(true);
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.find((m) => m.seq === fwd.seq).attachments[0].id).toBe(file.id);
  });

  it('takes the messages, threads, pins, counters and attachment bytes with the channel', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    await as(bob).post(`/api/ws/${wsId}/channels/${ops}/join`);
    // Enough messages for two blocks, a thread, a pin, and two files: one
    // shared in the channel alone, one forwarded on into #general.
    for (let i = 0; i < BLOCK_SIZE + 2; i++) await as(bob).post(`/api/ws/${wsId}/conv/${ops}/messages`, { text: `m${i}` });
    const fd = new FormData();
    fd.append('file', new File(['only here'], 'a.txt', { type: 'text/plain' }));
    const only = (await as(alice).post(`/api/ws/${wsId}/files`, fd)).data;
    const fd2 = new FormData();
    fd2.append('file', new File(['shared on'], 'b.txt', { type: 'text/plain' }));
    const kept = (await as(alice).post(`/api/ws/${wsId}/files`, fd2)).data;
    const root = (await as(alice).post(`/api/ws/${wsId}/conv/${ops}/messages`, { text: 'files', attachments: [{ id: only.id }, { id: kept.id }] })).data.message;
    // The channel's own file shared a second time there: held twice, let go of twice.
    await as(bob).post(`/api/ws/${wsId}/conv/${ops}/messages`, { text: 'again', attachments: [{ id: only.id }] });
    expect((await rt.kv.get(KEYS.file(only.id))).refs).toBe(2);
    await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'forwarded', attachments: [{ id: kept.id }] });
    const thread = threadConvId(ops, root.seq);
    await as(bob).post(`/api/ws/${wsId}/conv/${thread}/messages`, { text: 'a reply' });
    await as(alice).post(`/api/ws/${wsId}/conv/${ops}/pins`, { seq: root.seq });
    await as(bob).post(`/api/ws/${wsId}/conv/${ops}/typing`, {});
    const before = await rt.kv.get(KEYS.activity(wsId));
    expect(before.c[ops]).toBeTruthy();
    expect(before.c[thread]).toBeTruthy();
    expect(before.t[ops][bob.uuid]).toBeTruthy();
    expect(await rt.kv.get(KEYS.block(ops, 1))).toBeTruthy();
    expect(rt.fs._files.has(`teamchat-files/${wsId}/${only.id}`)).toBe(true);

    expect((await as(bob).del(`/api/ws/${wsId}/channels/${ops}`)).status).toBe(403);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${ops}`)).ok).toBe(true);

    // Gone: the channel, its blocks and counter, its thread's, its pins, and
    // its entries in the activity document.
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.channels[ops]).toBeUndefined();
    for (let n = 0; n <= 2; n++) expect(await rt.kv.get(KEYS.block(ops, n))).toBeNull();
    expect(await rt.kv.get(KEYS.seq(ops))).toBeNull();
    expect(await rt.kv.get(KEYS.block(thread, 0))).toBeNull();
    expect(await rt.kv.get(KEYS.seq(thread))).toBeNull();
    expect(await rt.kv.get(KEYS.pins(wsId, ops))).toBeNull();
    const after = await rt.kv.get(KEYS.activity(wsId));
    expect(after.c[ops]).toBeUndefined();
    expect(after.c[thread]).toBeUndefined();
    expect(after.t?.[ops]).toBeUndefined();
    expect(after.c[general.id]).toBeTruthy();
    // The file shared only there is let go of; the one forwarded on is still held by #general.
    expect(rt.fs._files.has(`teamchat-files/${wsId}/${only.id}`)).toBe(false);
    expect(await rt.kv.get(KEYS.file(only.id))).toBeNull();
    expect(rt.fs._files.has(`teamchat-files/${wsId}/${kept.id}`)).toBe(true);
    expect((await rt.kv.get(KEYS.file(kept.id))).refs).toBe(1);
    expect((await as(bob).get(`/api/ws/${wsId}/files/${kept.id}`)).ok).toBe(true);
    // Nothing is reachable under the old id, and #general is untouched.
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${ops}/messages`)).status).toBe(404);
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.length).toBeGreaterThan(1);
  });
});

describe('inbox, threads, and later', () => {
  const post = (u, wsId, conv, text) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text });

  it('collects mentions, followed-thread replies and reactions, newest first, with a badge', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const root = (await post(alice, wsId, general.id, 'root for @bob')).data.message;
    const t = threadConvId(general.id, root.seq);
    await post(carol, wsId, t, 'a reply');
    await as(carol).post(`/api/ws/${wsId}/conv/${general.id}/messages/${root.seq}/reactions`, { reaction: 'tada' });
    // Nothing for the actor themselves; alice hears about the reply and the reaction.
    const inbox = await as(alice).get(`/api/ws/${wsId}/inbox`);
    expect(inbox.data.items.map((e) => e.k)).toEqual(['reaction', 'reply']);
    expect(inbox.data.items[0]).toMatchObject({ by: carol.uuid, r: 'tada', c: general.id, s: root.seq });
    expect(inbox.data.items[0].message.text).toBe('root for @bob');
    expect(inbox.data.items[1].message.text).toBe('a reply');
    expect(inbox.data.unread).toBe(2);
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.me.inbox).toBe(2);
    const bobs = await as(bob).get(`/api/ws/${wsId}/inbox?kind=mention`);
    expect(bobs.data.items).toHaveLength(1);
    expect(bobs.data.items[0]).toMatchObject({ k: 'mention', by: alice.uuid });
    expect((await as(carol).get(`/api/ws/${wsId}/inbox`)).data.items).toEqual([]);
    // Opening the inbox clears the badge, not the items.
    await as(alice).post(`/api/ws/${wsId}/inbox/read`);
    expect((await as(alice).get(`/api/ws/${wsId}/inbox`)).data.unread).toBe(0);
    expect((await as(alice).get(`/api/ws/${wsId}/inbox`)).data.items).toHaveLength(2);
    // A broadcast lands in every recipient's inbox, marked as such.
    await post(alice, wsId, general.id, '@channel heads up');
    expect((await as(bob).get(`/api/ws/${wsId}/inbox`)).data.items[0]).toMatchObject({ k: 'mention', bc: 'channel' });
    // Items from a conversation the reader can no longer see are dropped.
    const priv = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    await as(alice).post(`/api/ws/${wsId}/channels/${priv}/members`, { uuids: [bob.uuid] });
    await post(alice, wsId, priv, 'psst @bob');
    expect((await as(bob).get(`/api/ws/${wsId}/inbox`)).data.items[0].c).toBe(priv);
    await as(bob).post(`/api/ws/${wsId}/channels/${priv}/leave`);
    expect((await as(bob).get(`/api/ws/${wsId}/inbox`)).data.items.some((e) => e.c === priv)).toBe(false);
  });

  it('caps the inbox ring', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    await rt.kv.set(KEYS.inbox(wsId, bob.uuid), { items: Array.from({ length: LIMITS.inboxItems }, (_, i) => ({ k: 'mention', c: general.id, s: 1, by: alice.uuid, ts: i })) });
    await post(alice, wsId, general.id, 'new @bob');
    const doc = await rt.kv.get(KEYS.inbox(wsId, bob.uuid));
    expect(doc.items).toHaveLength(LIMITS.inboxItems);
    expect(doc.items.at(-1).ts).toBeGreaterThan(1000);
  });

  it('lists the threads a member is in, newest activity first, with unread counts', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const r1 = (await post(alice, wsId, general.id, 'first root')).data.message;
    const r2 = (await post(bob, wsId, general.id, 'second root')).data.message;
    await post(bob, wsId, threadConvId(general.id, r1.seq), 'reply to first');
    await new Promise((r) => setTimeout(r, 3));
    await post(carol, wsId, threadConvId(general.id, r2.seq), 'reply to second');
    const a = await as(alice).get(`/api/ws/${wsId}/threads`);
    expect(a.data.threads.map((t) => t.seq)).toEqual([r1.seq]); // alice is only in her own thread
    expect(a.data.threads[0]).toMatchObject({ conv: general.id, unread: 1 });
    expect(a.data.threads[0].root.text).toBe('first root');
    const b = await as(bob).get(`/api/ws/${wsId}/threads`);
    expect(b.data.threads.map((t) => t.seq)).toEqual([r2.seq, r1.seq]); // his root got the newest reply
    expect(b.data.threads.map((t) => t.unread)).toEqual([1, 0]);
    // Unfollowing hides the thread; reading clears the count.
    await as(bob).put(`/api/ws/${wsId}/conv/${threadConvId(general.id, r2.seq)}/notify`, { follow: false });
    expect((await as(bob).get(`/api/ws/${wsId}/threads`)).data.threads.map((t) => t.seq)).toEqual([r1.seq]);
    await as(alice).post(`/api/ws/${wsId}/conv/${threadConvId(general.id, r1.seq)}/read`, { seq: 1 });
    expect((await as(alice).get(`/api/ws/${wsId}/threads`)).data.threads[0].unread).toBe(0);
    expect((await as(dave).get(`/api/ws/${wsId}/threads`)).status).toBe(403);
  });

  it('moves a thread up a follower\'s list when a reply names them, as it does when one does not', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const r1 = (await post(alice, wsId, general.id, 'first root')).data.message;
    const r2 = (await post(alice, wsId, general.id, 'second root')).data.message;
    const t1 = threadConvId(general.id, r1.seq);
    const t2 = threadConvId(general.id, r2.seq);
    await post(bob, wsId, t1, 'bob in the first');
    await new Promise((r) => setTimeout(r, 3));
    await post(bob, wsId, t2, 'bob in the second');
    expect((await as(bob).get(`/api/ws/${wsId}/threads`)).data.threads.map((t) => t.seq)).toEqual([r2.seq, r1.seq]);
    // The newest reply is in the first thread and names bob: a mention for
    // him rather than an unread reply, and the thread with the latest word.
    await new Promise((r) => setTimeout(r, 3));
    await post(carol, wsId, t1, 'hey @bob, this one');
    const list = (await as(bob).get(`/api/ws/${wsId}/threads`)).data.threads;
    expect(list.map((t) => t.seq)).toEqual([r1.seq, r2.seq]);
    expect(list[0].unread).toBe(0);
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.me.mentions[general.id]).toBe(1);
  });

  it('saves messages for later, toggles done, and removes them', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await post(bob, wsId, general.id, 'read this later')).data.message;
    expect((await as(alice).post(`/api/ws/${wsId}/saved`, { conv: 'nope', seq: m.seq })).status).toBe(404);
    expect((await as(alice).post(`/api/ws/${wsId}/saved`, { conv: general.id, seq: 'x' })).status).toBe(400);
    expect((await as(alice).post(`/api/ws/${wsId}/saved`, { conv: general.id, seq: m.seq })).data.saved).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/saved`, { conv: general.id, seq: m.seq })).data.already).toBe(true);
    let list = await as(alice).get(`/api/ws/${wsId}/saved`);
    expect(list.data.items).toHaveLength(1);
    expect(list.data.items[0]).toMatchObject({ c: general.id, s: m.seq, done: false });
    expect(list.data.items[0].message.text).toBe('read this later');
    expect((await as(bob).get(`/api/ws/${wsId}/saved`)).data.items).toEqual([]);
    await as(alice).post(`/api/ws/${wsId}/saved`, { conv: general.id, seq: m.seq, done: true });
    expect((await as(alice).get(`/api/ws/${wsId}/saved`)).data.items[0].done).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/saved`, { conv: general.id, seq: 999, done: true })).status).toBe(404);
    await as(alice).post(`/api/ws/${wsId}/saved`, { conv: general.id, seq: m.seq, remove: true });
    expect((await as(alice).get(`/api/ws/${wsId}/saved`)).data.items).toEqual([]);
  });

  it('marks a conversation unread by moving the cursor back', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    for (let i = 0; i < 3; i++) await post(alice, wsId, general.id, `m${i}`);
    const seq = (await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.seq;
    await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq });
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.me.reads[general.id]).toBe(seq);
    await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: seq - 2, back: true });
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.me.reads[general.id]).toBe(seq - 2);
    // A plain read never goes backwards.
    await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: 1 });
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.me.reads[general.id]).toBe(seq - 2);
  });
});

describe('scheduled messages and reminders', () => {
  it('answers a refusal to "Send now" and keeps the entry, rather than dropping the message', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    await as(bob).post(`/api/ws/${wsId}/channels/${ops}/join`);
    const sid = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: ops, text: 'later then', dueAt: Date.now() + 60_000 })).data.scheduled.id;
    await as(alice).put(`/api/ws/${wsId}/channels/${ops}`, { archived: true });
    const refused = await as(bob).put(`/api/ws/${wsId}/scheduled/${sid}`, { sendNow: true });
    expect(refused.ok).toBe(false);
    expect(refused.data.code).toBe('archived');
    const listed = async () => JSON.stringify((await as(bob).get(`/api/ws/${wsId}/scheduled`)).data).includes(sid);
    expect(await listed()).toBe(true);
    const texts = async () => (await as(bob).get(`/api/ws/${wsId}/conv/${ops}/messages`)).data.messages.filter((m) => m.text === 'later then');
    expect(await texts()).toHaveLength(0);
    // Allowed to post again: sent, once, and the entry gone.
    await as(alice).put(`/api/ws/${wsId}/channels/${ops}`, { archived: false });
    expect((await as(bob).put(`/api/ws/${wsId}/scheduled/${sid}`, { sendNow: true })).data).toMatchObject({ ok: true, sent: true });
    expect(await texts()).toHaveLength(1);
    expect(await listed()).toBe(false);
  });

  const post = (u, wsId, conv, text) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text });
  const sync = (u, wsId) => as(u).get(`/api/ws/${wsId}/sync?since=0`);

  it('delivers a due message through the normal post path, exactly once, on the first poll after its time', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const future = Date.now() + 60_000;
    expect((await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', dueAt: Date.now() - 120_000 })).status).toBe(400);
    expect((await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: 'nope', text: 'later', dueAt: future })).status).toBe(404);
    const r = await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'good morning @bob', dueAt: future });
    expect(r.ok).toBe(true);
    const sid = r.data.scheduled.id;
    expect((await rt.kv.get(KEYS.activity(wsId))).nd).toBe(future);
    // Private to the author until delivered; not yet in the channel.
    expect((await as(bob).get(`/api/ws/${wsId}/scheduled`)).data.scheduled).toEqual([]);
    expect((await as(alice).get(`/api/ws/${wsId}/scheduled`)).data.scheduled.map((e) => e.id)).toEqual([sid]);
    let page = await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(page.data.messages.some((m) => m.text.startsWith('good morning'))).toBe(false);
    // A poll before the time reads nothing extra.
    const before = rt.kv._calls.ops;
    await sync(bob, wsId);
    // Two round trips: the workspace and the activity document in one batched
    // read, then bob's own (its key is his uuid, which nothing knew until
    // Puter answered). Exactly the usual reads and nothing extra.
    expect(rt.kv._calls.ops - before).toBe(2);
    // Time passes: several clients poll at once, the message lands once.
    await rt.kv.update(KEYS.sched(wsId), { [`m.${sid}.dueAt`]: Date.now() - 1 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
    await Promise.all([sync(bob, wsId), sync(alice, wsId), sync(bob, wsId)]);
    page = await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    const delivered = page.data.messages.filter((m) => m.text === 'good morning @bob');
    expect(delivered).toHaveLength(1);
    expect(delivered[0].user).toBe(alice.uuid);
    expect(delivered[0].mentions).toEqual([bob.uuid]); // mentions resolved as on a live post
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.me.mentions[general.id]).toBe(1);
    expect((await as(alice).get(`/api/ws/${wsId}/scheduled`)).data.scheduled).toEqual([]);
    expect((await rt.kv.get(KEYS.activity(wsId))).nd).toBeUndefined();
  });

  it('does not deliver an entry another poll delivered and removed while this one was working', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const future = Date.now() + 60_000;
    const first = (await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'first due', dueAt: future })).data.scheduled.id;
    const second = (await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'second due', dueAt: future })).data.scheduled.id;
    await rt.kv.update(KEYS.sched(wsId), { [`m.${first}.dueAt`]: Date.now() - 1, [`m.${second}.dueAt`]: Date.now() - 1 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
    // Between this poll's read of the queue and its claim of the second
    // entry, another poll delivers and removes it: played here by taking the
    // entry out just before the claim's increment lands.
    const incr = rt.kv.incr.bind(rt.kv);
    let raced = false;
    rt.kv.incr = async (k, paths, ...rest) => {
      if (!raced && paths && typeof paths === 'object' && Object.keys(paths).some((p) => p.endsWith(`m.${second}.claims`))) {
        raced = true;
        await rt.kv.remove(k, `m.${second}`);
      }
      return incr(k, paths, ...rest);
    };
    try {
      await sync(bob, wsId);
    } finally {
      rt.kv.incr = incr;
    }
    expect(raced).toBe(true);
    const page = await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(page.data.messages.filter((m) => m.text === 'first due')).toHaveLength(1);
    expect(page.data.messages.filter((m) => m.text === 'second due')).toHaveLength(0); // the other poll's to post, not this one's
    // Nothing of the second entry is left behind, not even the claim counter.
    expect((await rt.kv.get(KEYS.sched(wsId)))?.m?.[second]).toBeUndefined();
    expect((await rt.kv.get(KEYS.activity(wsId))).nd).toBeUndefined();
  });

  it('keeps an entry whose delivery failed under it and tries again later, rather than dropping it unsent', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const sid = (await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'fragile', dueAt: Date.now() + 60_000 })).data.scheduled.id;
    await rt.kv.update(KEYS.sched(wsId), { [`m.${sid}.dueAt`]: Date.now() - 1 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
    // The store fails under the post: the conversation's counter cannot move.
    const incr = rt.kv.incr.bind(rt.kv);
    rt.kv.incr = async (k, ...rest) => { if (k === KEYS.seq(general.id)) throw new Error('store down'); return incr(k, ...rest); };
    try { await sync(bob, wsId); } finally { rt.kv.incr = incr; }
    const texts = async () => (await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.filter((m) => m.text === 'fragile');
    expect(await texts()).toHaveLength(0);
    // Still the author's, still listed, due again shortly rather than now.
    expect((await as(alice).get(`/api/ws/${wsId}/scheduled`)).data.scheduled.map((e) => e.id)).toEqual([sid]);
    const entry = (await rt.kv.get(KEYS.sched(wsId))).m[sid];
    expect(entry.tries).toBe(1);
    expect(entry.claims).toBeUndefined();
    expect(entry.retryAt).toBeGreaterThan(Date.now());
    expect((await rt.kv.get(KEYS.activity(wsId))).nd).toBe(entry.retryAt);
    // A poll before the retry leaves it; once the retry is due it lands, once, whoever polls.
    await sync(bob, wsId);
    expect(await texts()).toHaveLength(0);
    await rt.kv.update(KEYS.sched(wsId), { [`m.${sid}.retryAt`]: Date.now() - 1 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
    await Promise.all([sync(bob, wsId), sync(alice, wsId)]);
    expect(await texts()).toHaveLength(1);
    expect((await as(alice).get(`/api/ws/${wsId}/scheduled`)).data.scheduled).toEqual([]);
    expect((await rt.kv.get(KEYS.activity(wsId))).nd).toBeUndefined();
  });

  it('takes over an entry a delivery died holding, and keeps it its author\'s meanwhile', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const sid = (await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'orphaned', dueAt: Date.now() + 60_000 })).data.scheduled.id;
    // A poll claimed it a moment ago: the delivery is under way, so it is hidden and not to be edited (and said to be going out).
    await rt.kv.update(KEYS.sched(wsId), { [`m.${sid}.dueAt`]: Date.now() - 1, [`m.${sid}.claims`]: 1, [`m.${sid}.claimedAt`]: Date.now() - 1000 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
    expect((await as(alice).get(`/api/ws/${wsId}/scheduled`)).data.scheduled).toEqual([]);
    expect((await as(alice).put(`/api/ws/${wsId}/scheduled/${sid}`, { text: 'edited' })).status).toBe(409);
    await sync(bob, wsId); // leaves it to that delivery, and comes back when the claim would be stale
    const messages = async () => (await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.filter((m) => m.text.startsWith('orphaned'));
    expect(await messages()).toHaveLength(0);
    const nd = (await rt.kv.get(KEYS.activity(wsId))).nd;
    expect(nd).toBeGreaterThan(Date.now() + 4 * 60_000);
    // Six minutes on, that delivery is dead: the entry is the author's again, and the next poll sends it.
    await rt.kv.update(KEYS.sched(wsId), { [`m.${sid}.claimedAt`]: Date.now() - 6 * 60_000 });
    expect((await as(alice).get(`/api/ws/${wsId}/scheduled`)).data.scheduled.map((e) => e.id)).toEqual([sid]);
    expect((await as(alice).put(`/api/ws/${wsId}/scheduled/${sid}`, { text: 'orphaned, edited' })).ok).toBe(true);
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
    await Promise.all([sync(bob, wsId), sync(alice, wsId)]);
    expect((await messages()).map((m) => m.text)).toEqual(['orphaned, edited']);
    expect((await rt.kv.get(KEYS.sched(wsId)))?.m?.[sid]).toBeUndefined();
  });

  it('can be edited, rescheduled, sent now, or deleted by its author only', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const future = Date.now() + 3600_000;
    const sid = (await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'draft', dueAt: future })).data.scheduled.id;
    expect((await as(bob).put(`/api/ws/${wsId}/scheduled/${sid}`, { text: 'hijack' })).status).toBe(404);
    expect((await as(bob).del(`/api/ws/${wsId}/scheduled/${sid}`)).status).toBe(404);
    await as(alice).put(`/api/ws/${wsId}/scheduled/${sid}`, { text: 'final wording', dueAt: future + 60_000 });
    const mine = (await as(alice).get(`/api/ws/${wsId}/scheduled`)).data.scheduled;
    expect(mine[0]).toMatchObject({ text: 'final wording', dueAt: future + 60_000 });
    expect((await rt.kv.get(KEYS.activity(wsId))).nd).toBe(future + 60_000);
    await as(alice).put(`/api/ws/${wsId}/scheduled/${sid}`, { sendNow: true });
    const page = await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(page.data.messages.at(-1).text).toBe('final wording');
    expect((await as(alice).get(`/api/ws/${wsId}/scheduled`)).data.scheduled).toEqual([]);
    const other = (await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'x', dueAt: future })).data.scheduled.id;
    expect((await as(alice).del(`/api/ws/${wsId}/scheduled/${other}`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.activity(wsId))).nd).toBeUndefined();
  });

  it('measures an edit that grows a scheduled message against the queue\'s room, as scheduling it is', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const future = Date.now() + 60_000;
    // Two members' short entries (each member may hold 50), then each grown to the message cap.
    const ids = [];
    for (const u of [alice, bob]) for (let i = 0; i < 35; i++) ids.push([u, (await as(u).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'x', dueAt: future })).data.scheduled.id]);
    const long = 'y'.repeat(4000);
    const statuses = [];
    for (const [u, sid] of ids) statuses.push((await as(u).put(`/api/ws/${wsId}/scheduled/${sid}`, { text: long })).status);
    expect(statuses[0]).toBe(200);
    expect(statuses).toContain(400);
    expect(JSON.stringify(await rt.kv.get(KEYS.sched(wsId))).length).toBeLessThan(260_000);
    // Shortening is always fine, and so is rescheduling.
    expect((await as(alice).put(`/api/ws/${wsId}/scheduled/${ids[0][1]}`, { text: 'short again' })).ok).toBe(true);
    expect((await as(bob).put(`/api/ws/${wsId}/scheduled/${ids[ids.length - 1][1]}`, { dueAt: future + 1000 })).ok).toBe(true);
  });

  it('keeps a scheduled message its author can no longer send, marked as not sent, and drops one whose author was removed', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    await as(bob).post(`/api/ws/${wsId}/channels/${ops}/join`);
    const s1 = (await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: ops, text: 'to an archived channel', dueAt: Date.now() + 60_000 })).data.scheduled.id;
    const s2 = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'from a removed member', dueAt: Date.now() + 60_000 })).data.scheduled.id;
    await rt.kv.update(KEYS.sched(wsId), { [`m.${s1}.dueAt`]: Date.now() - 1, [`m.${s2}.dueAt`]: Date.now() - 1 });
    // A channel closed meanwhile refuses the post at its time (a deleted one
    // takes its entries with it at once, see worker-b-pass11).
    await as(alice).put(`/api/ws/${wsId}/channels/${ops}`, { archived: true });
    // A removed member's entries go with them at once; the other waits for its time.
    await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`);
    expect(Object.keys((await rt.kv.get(KEYS.sched(wsId))).m)).toEqual([s1]);
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
    await sync(alice, wsId);
    const page = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(page.data.messages.some((m) => m.text === 'from a removed member')).toBe(false);
    expect((await as(alice).get(`/api/ws/${wsId}/conv/${ops}/messages`)).data.messages.some((m) => m.text === 'to an archived channel')).toBe(false);
    // Refused at its time, the message waits for its author, marked with the reason (pass 13); the removed member's went with them.
    const left = (await rt.kv.get(KEYS.sched(wsId))).m;
    expect(Object.keys(left)).toEqual([s1]);
    expect(left[s1].failed.code).toBe('archived');
  });

  it('delivers reminders to the inbox and the member\'s own space, with snooze and done', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await post(alice, wsId, general.id, 'follow up on this')).data.message;
    const due = Date.now() + 60_000;
    expect((await as(bob).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq: 999, dueAt: due })).status).toBe(404);
    const r = await as(bob).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq: m.seq, dueAt: due, note: 'ask about budget' });
    expect(r.ok).toBe(true);
    const rid = r.data.reminder.id;
    let list = await as(bob).get(`/api/ws/${wsId}/scheduled`);
    expect(list.data.reminders[0]).toMatchObject({ id: rid, conv: general.id, seq: m.seq, note: 'ask about budget' });
    expect(list.data.reminders[0].message.text).toBe('follow up on this');
    // Snooze moves the time; a reminder cannot be "sent now".
    await as(bob).put(`/api/ws/${wsId}/scheduled/${rid}`, { dueAt: due + 3600_000 });
    expect((await as(bob).get(`/api/ws/${wsId}/scheduled`)).data.reminders[0].dueAt).toBe(due + 3600_000);
    expect((await as(bob).put(`/api/ws/${wsId}/scheduled/${rid}`, { sendNow: true })).status).toBe(400);
    // Due: the next poll delivers it once.
    await rt.kv.update(KEYS.sched(wsId), { [`m.${rid}.dueAt`]: Date.now() - 1 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
    await Promise.all([sync(alice, wsId), sync(bob, wsId)]);
    const inbox = await as(bob).get(`/api/ws/${wsId}/inbox`);
    expect(inbox.data.items.filter((e) => e.k === 'reminder')).toHaveLength(1);
    expect(inbox.data.items[0]).toMatchObject({ k: 'reminder', c: general.id, s: m.seq, note: 'ask about budget' });
    const b = await as(bob).get(`/api/ws/${wsId}`);
    const self = Object.keys(b.data.me.dms).find((c) => b.data.me.dms[c].members.length === 1);
    expect(self).toBeTruthy();
    const own = await as(bob).get(`/api/ws/${wsId}/conv/${self}/messages`);
    expect(own.data.messages.at(-1)).toMatchObject({ kind: 'rem', text: 'Reminder: ask about budget', ref: { c: general.id, s: m.seq } });
    // Written for bob, not by him: unread in his own space, and the activity
    // entry names the system as its author, so his open tab does not take it
    // for a line he sent from another tab and read as it was written.
    expect(b.data.activity.c[self]).toMatchObject({ s: own.data.messages.at(-1).seq, u: 'sys' });
    expect(b.data.me.reads[self] || 0).toBeLessThan(b.data.activity.c[self].s);
    expect((await as(bob).get(`/api/ws/${wsId}/scheduled`)).data.reminders).toEqual([]);
    // Done before it fires: removed cleanly. A reminder about a deleted message never fires.
    const r2 = (await as(bob).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq: m.seq, dueAt: due })).data.reminder.id;
    expect((await as(bob).del(`/api/ws/${wsId}/scheduled/${r2}`)).ok).toBe(true);
    const r3 = (await as(bob).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq: m.seq, dueAt: due })).data.reminder.id;
    await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}`);
    await rt.kv.update(KEYS.sched(wsId), { [`m.${r3}.dueAt`]: Date.now() - 1 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
    await sync(bob, wsId);
    // No second entry landed in the ring (the list itself now leaves out the
    // first, since the message it is about is gone).
    expect((await rt.kv.get(KEYS.inbox(wsId, bob.uuid))).items.filter((e) => e.k === 'reminder')).toHaveLength(1);
    expect((await as(bob).get(`/api/ws/${wsId}/inbox`)).data.items.filter((e) => e.k === 'reminder')).toEqual([]);
    expect((await rt.kv.get(KEYS.sched(wsId))).m).toEqual({});
  });
});

describe('guests', () => {
  const post = (u, wsId, conv, text) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text });

  /** A workspace with #general, a public #project, a private #secret, and a guest (dave) in #project. */
  async function withGuest() {
    const { wsId, general, code } = await workspaceWith(alice, [bob, carol]);
    const project = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'project' })).data.channel.id;
    await as(bob).post(`/api/ws/${wsId}/channels/${project}/join`);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    await as(alice).post(`/api/ws/${wsId}/channels/${secret}/members`, { uuids: [carol.uuid] });
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${project}/invites`, { inviteTtl: '7d' });
    expect(inv.ok).toBe(true);
    const j = await as(dave).post('/api/join', { code: inv.data.code });
    expect(j.ok).toBe(true);
    expect(j.data.guest).toBe(true);
    return { wsId, general, project, secret, code, guestCode: inv.data.code };
  }

  it('mints a channel invite (admins only) that lands the joiner in that channel alone, as a guest', async () => {
    const { wsId, general, project, secret } = await withGuest();
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${project}/invites`, {})).status).toBe(403);
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${general.id}/invites`, {})).status).toBe(400); // default channels: use the workspace invite
    const b = await as(dave).get(`/api/ws/${wsId}`);
    expect(b.data.me.role).toBe('guest');
    expect(b.data.me.channels).toEqual([project]);
    // Caught up on the way in: the guest's own "joined as a guest" line is read.
    expect(b.data.me.reads[project]).toBe(b.data.activity.c[project].s);
    expect(Object.keys(b.data.workspace.channels)).toEqual([project]);
    expect(b.data.workspace.invite).toBeNull();
    expect(b.data.workspace.channels[project].guestInvite).toBeUndefined();
    // Members they share a channel with, and nobody else (carol is only in #general and #secret).
    expect(Object.keys(b.data.workspace.members).sort()).toEqual([alice.uuid, bob.uuid, dave.uuid].sort());
    expect(Object.keys(b.data.activity.c)).toEqual([project]);
    // Nor who is typing where, or whose state moved, outside what they see.
    await as(carol).post(`/api/ws/${wsId}/conv/${secret.id}/typing`, {});
    await as(alice).post(`/api/ws/${wsId}/conv/${project}/typing`, {});
    const b2 = (await as(dave).get(`/api/ws/${wsId}`)).data.activity;
    expect(Object.keys(b2.t)).toEqual([project]);
    expect(Object.keys(b2.u).every((u) => u === dave.uuid)).toBe(true);
    expect(Object.keys(b2.p).every((u) => b.data.workspace.members[u])).toBe(true);
    const a = await as(alice).get(`/api/ws/${wsId}`);
    expect(a.data.workspace.members[dave.uuid].role).toBe('guest');
    expect(a.data.workspace.channels[project].guests).toBe(1);
    expect(a.data.workspace.channels[project].guestInvite).toBeTruthy(); // admins see the channel's code
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.workspace.channels[project].guestInvite).toBeUndefined();
    // The edit route answers with the channel too: a non-admin member of it
    // (bob is in #project) never learns its code that way; an admin still does.
    expect((await as(bob).put(`/api/ws/${wsId}/channels/${project}`, {})).data.channel.guestInvite).toBeUndefined();
    expect((await as(bob).put(`/api/ws/${wsId}/channels/${project}`, { topic: 'set by bob' })).data.channel.guestInvite).toBeUndefined();
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${project}`, {})).data.channel.guestInvite).toBeTruthy();
    const page = await as(dave).get(`/api/ws/${wsId}/conv/${project}/messages`);
    expect(page.data.messages.at(-1).text).toBe('dave joined as a guest');
    // The guest takes part in their channel like anyone.
    const hello = await post(dave, wsId, project, 'hello from outside');
    expect(hello.ok).toBe(true);
    // (Reacting to a message a member wrote: a line the worker wrote, such as the channel's first, takes none.)
    expect((await as(dave).post(`/api/ws/${wsId}/conv/${project}/messages/${hello.data.message.seq}/reactions`, { reaction: 'tada' })).ok).toBe(true);
    void secret;
  });

  it('keeps a guest out of everything else, enforced per route', async () => {
    const { wsId, general, project, secret } = await withGuest();
    // Read, post, join, browse, create, invite, list members, pins, search.
    expect((await as(dave).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).status).toBe(404);
    expect((await post(dave, wsId, general.id, 'x')).status).toBe(404);
    expect((await as(dave).post(`/api/ws/${wsId}/channels/${general.id}/join`)).status).toBe(404);
    expect((await as(dave).post(`/api/ws/${wsId}/channels`, { name: 'mine' })).status).toBe(403);
    expect((await as(dave).put(`/api/ws/${wsId}`, { rotateInvite: true })).status).toBe(403);
    expect((await as(dave).post(`/api/ws/${wsId}/channels/${project}/invites`, {})).status).toBe(403);
    expect((await as(dave).get(`/api/ws/${wsId}/channels/${general.id}/members`)).status).toBe(404);
    expect((await as(dave).get(`/api/ws/${wsId}/channels/${secret}/members`)).status).toBe(404);
    expect((await as(dave).get(`/api/ws/${wsId}/conv/${general.id}/pins`)).status).toBe(404);
    expect((await as(dave).post(`/api/ws/${wsId}/channels/${project}/members`, { uuids: [carol.uuid] })).status).toBe(403);
    expect((await as(dave).get(`/api/ws/${wsId}/guests`)).status).toBe(403);
    // Search only finds what they can read.
    await post(alice, wsId, general.id, 'internal roadmap numbers');
    await post(bob, wsId, project, 'project roadmap draft');
    const r = await as(dave).get(`/api/ws/${wsId}/search?q=roadmap`);
    expect(r.data.results.map((m) => m.conv)).toEqual([project]);
    // Direct messages: only with people in their channels, in both directions.
    expect((await as(dave).post(`/api/ws/${wsId}/dms`, { members: [carol.uuid] })).status).toBe(403);
    expect((await as(carol).post(`/api/ws/${wsId}/dms`, { members: [dave.uuid] })).status).toBe(403);
    expect((await as(dave).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/dms`, { members: [dave.uuid, carol.uuid] })).status).toBe(403);
    // Threads, inbox and the like are filtered by the same rule.
    const root = (await post(alice, wsId, general.id, 'root @dave')).data.message; // a mention of someone who cannot see it
    expect((await as(dave).get(`/api/ws/${wsId}/inbox`)).data.items.every((e) => e.c !== general.id)).toBe(true);
    expect((await as(dave).get(`/api/ws/${wsId}/conv/${threadConvId(general.id, root.seq)}/messages`)).status).toBe(404);
  });

  it('shows a guest only the activity and typing of their own channels', async () => {
    const { wsId, general, project, secret } = await withGuest();
    await post(alice, wsId, general.id, 'general news');
    await post(alice, wsId, secret, 'secret news');
    await post(bob, wsId, project, 'project news');
    await as(alice).post(`/api/ws/${wsId}/conv/${secret}/typing`, {});
    await as(bob).post(`/api/ws/${wsId}/conv/${project}/typing`, {});
    const s = await as(dave).get(`/api/ws/${wsId}/sync?since=0`);
    expect(Object.keys(s.data.c)).toEqual([project]);
    expect(Object.keys(s.data.t || {})).toEqual([project]);
    // A member sees everything they may read (private channels they are in included).
    const full = await as(carol).get(`/api/ws/${wsId}/sync?since=0`);
    expect(Object.keys(full.data.c).sort()).toEqual([general.id, project, secret].sort());
    // Their own direct messages, and the threads inside them and inside
    // their channels, are theirs to follow live as well.
    const dm = (await as(dave).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] })).data.conv;
    const root = (await post(dave, wsId, dm, 'root')).data.message;
    const dmThread = threadConvId(dm, root.seq);
    await post(bob, wsId, dmThread, 'a reply');
    const chRoot = (await post(bob, wsId, project, 'project root')).data.message;
    const chThread = threadConvId(project, chRoot.seq);
    await post(bob, wsId, chThread, 'a project reply');
    const again = await as(dave).get(`/api/ws/${wsId}/sync?since=0`);
    expect(Object.keys(again.data.c).sort()).toEqual([project, dm, dmThread, chThread].sort());
    expect(Object.keys((await as(dave).get(`/api/ws/${wsId}`)).data.activity.c).sort()).toEqual([project, dm, dmThread, chThread].sort());
  });

  it('lets admins add a guest to another channel, promote them, or remove them', async () => {
    const { wsId, general, project, secret } = await withGuest();
    // Anyone in a channel brings workspace members in; a
    // guest entering a public channel widens what they see, so a non-admin's
    // attempt at that is quietly dropped.
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${general.id}/members`, { uuids: [dave.uuid] })).data.added).toEqual([]);
    // A member who has not joined a public channel is told to join it first (it is theirs to see and to join).
    const outside = await as(carol).post(`/api/ws/${wsId}/channels/${project}/members`, { uuids: [bob.uuid] });
    expect(outside.status).toBe(403);
    expect(outside.data.code).toBe('not_joined');
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${project}/members`, { uuids: [carol.uuid] })).data.added).toEqual([carol.uuid]);
    expect((await as(carol).get(`/api/ws/${wsId}`)).data.me.channels).toContain(project);
    // Into the private channel (carol, a member of it, can do that) ...
    expect((await as(carol).post(`/api/ws/${wsId}/channels/${secret}/members`, { uuids: [dave.uuid] })).data.added).toEqual([dave.uuid]);
    let b = await as(dave).get(`/api/ws/${wsId}`);
    expect(Object.keys(b.data.workspace.channels).sort()).toEqual([project, secret].sort());
    expect(Object.keys(b.data.workspace.members).sort()).toEqual([alice.uuid, bob.uuid, carol.uuid, dave.uuid].sort());
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.channels[secret].guests).toBe(1);
    const guests = await as(alice).get(`/api/ws/${wsId}/guests`);
    expect(guests.data.guests).toEqual([{ uuid: dave.uuid, channels: expect.arrayContaining([project, secret]), joinedAt: expect.any(Number) }]);
    // Promote: a member now, landing in the defaults too.
    expect((await as(bob).post(`/api/ws/${wsId}/members/${dave.uuid}/role`, { role: 'member' })).status).toBe(403);
    expect((await as(alice).post(`/api/ws/${wsId}/members/${dave.uuid}/role`, { role: 'member' })).ok).toBe(true);
    b = await as(dave).get(`/api/ws/${wsId}`);
    expect(b.data.me.role).toBe('member');
    expect(b.data.me.channels.sort()).toEqual([project, secret, general.id].sort());
    expect(Object.keys(b.data.workspace.channels).length).toBe(3);
    expect(Object.keys(b.data.workspace.members)).toHaveLength(4);
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.channels[project].guests).toBe(0);
    expect((await as(dave).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).ok).toBe(true);
    // Removal works the same as for a member.
    expect((await as(alice).del(`/api/ws/${wsId}/members/${dave.uuid}`)).ok).toBe(true);
    expect((await as(dave).get(`/api/ws/${wsId}`)).status).toBe(403);
  });

  it('takes someone already in the workspace into the channel a channel invite names', async () => {
    const { wsId, project, secret, guestCode } = await withGuest();
    // A guest accepting a second channel's invite enters that channel (they
    // can join nothing themselves); the answer names it so the app opens it.
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${secret}/invites`, { inviteTtl: '7d' });
    const j = await as(dave).post('/api/join', { code: inv.data.code });
    expect(j.ok).toBe(true);
    expect(j.data).toMatchObject({ already: true, joined: true, channel: { id: secret, name: 'secret' } });
    const b = await as(dave).get(`/api/ws/${wsId}`);
    expect(b.data.me.role).toBe('guest');
    expect(b.data.me.channels.sort()).toEqual([project, secret].sort());
    const a = await as(alice).get(`/api/ws/${wsId}`);
    expect(a.data.workspace.channels[secret].members).toContain(dave.uuid);
    expect(a.data.workspace.channels[secret].guests).toBe(1);
    expect(a.data.workspace.channels[secret].count).toBe(3);
    // Caught up from the moment they entered, and announced there.
    const page = await as(dave).get(`/api/ws/${wsId}/conv/${secret}/messages`);
    expect(page.data.messages.at(-1).text).toBe('dave joined');
    expect(b.data.me.reads[secret]).toBeGreaterThanOrEqual(page.data.seq - 1);
    // Accepting it again changes nothing.
    const again = await as(dave).post('/api/join', { code: inv.data.code });
    expect(again.data).toMatchObject({ already: true, channel: { id: secret } });
    expect(again.data.joined).toBeUndefined();
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.channels[secret].count).toBe(3);
    // A member handed a private channel's link enters it too, as a member.
    const jb = await as(bob).post('/api/join', { code: inv.data.code });
    expect(jb.data).toMatchObject({ already: true, joined: true });
    const ws = (await as(alice).get(`/api/ws/${wsId}`)).data.workspace;
    expect(ws.channels[secret].guests).toBe(1);
    expect(ws.channels[secret].count).toBe(4);
    // The guest's own first invite, accepted again, adds nothing.
    expect((await as(dave).post('/api/join', { code: guestCode })).data.joined).toBeUndefined();
    // A newcomer's answer names the channel as well.
    const erin = { uuid: 'u-erin-0000', username: 'erin' };
    expect((await as(erin).post('/api/join', { code: guestCode })).data).toMatchObject({ guest: true, channel: { id: project, name: 'project' } });
  });

  it('rotates and revokes channel invites; workspace invites are untouched', async () => {
    const { wsId, project, code, guestCode } = await withGuest();
    // The workspace invite still makes members.
    const j = await as(carol).post('/api/join', { code });
    expect(j.data.already).toBe(true);
    const fresh = { uuid: 'u-erin-0000', username: 'erin' };
    expect((await as(fresh).post('/api/join', { code })).data.guest).toBe(false);
    expect((await as(fresh).get(`/api/ws/${wsId}`)).data.me.role).toBe('member');
    // Minting again replaces the channel code; the old one dies like a rotated workspace code.
    const again = await as(alice).post(`/api/ws/${wsId}/channels/${project}/invites`, { inviteTtl: '1d' });
    expect(again.data.code).not.toBe(guestCode);
    const frank = { uuid: 'u-frank-0000', username: 'frank' };
    expect((await as(frank).post('/api/join', { code: guestCode })).status).toBe(404);
    expect((await as(frank).post('/api/join', { code: again.data.code })).data.guest).toBe(true);
    // Revoke: nothing left to accept.
    expect((await as(bob).del(`/api/ws/${wsId}/channels/${project}/invites`)).status).toBe(403);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${project}/invites`)).ok).toBe(true);
    const grace = { uuid: 'u-grace-0000', username: 'grace' };
    expect((await as(grace).post('/api/join', { code: again.data.code })).status).toBe(404);
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.channels[project].guestInvite).toBeUndefined();
  });
});

describe('integrations', () => {
  it('posts through a webhook without a session, as an app, never as a member', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await as(bob).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).status).toBe(403);
    expect((await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: 'nope', name: 'CI' })).status).toBe(404);
    const made = await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: '  Deploys ', color: 3 });
    expect(made.ok).toBe(true);
    expect(made.data.token).toMatch(/^tch_[a-z0-9]{10}_[a-z0-9]{32}$/);
    expect(made.data.name).toBe('Deploys');
    // Only a hash is stored, and the list never shows the token.
    const rec = await rt.kv.get(KEYS.hook(made.data.id));
    expect(rec.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rec)).not.toContain(made.data.token.split('_')[2]);
    const list = await as(alice).get(`/api/ws/${wsId}/webhooks`);
    expect(list.data.webhooks[0]).toMatchObject({ id: made.data.id, ch: general.id, name: 'Deploys', lastUsed: null });
    expect(JSON.stringify(list.data)).not.toContain('tch_');
    expect((await as(bob).get(`/api/ws/${wsId}/webhooks`)).status).toBe(403);

    // The unauthenticated route.
    const hit = await as(null).post(`/webhook/${made.data.token}`, { text: 'build 42 **passed**' });
    expect(hit.ok).toBe(true);
    expect(hit.data.seq).toBeGreaterThan(0);
    const page = await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    const m = page.data.messages.at(-1);
    expect(m).toMatchObject({ text: 'build 42 **passed**', bot: { name: 'Deploys', color: 3 } });
    expect(m.user).toBe(`hook_${made.data.id}`); // not any member's uuid
    expect(Object.keys((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.members)).not.toContain(m.user);
    expect((await as(alice).get(`/api/ws/${wsId}/webhooks`)).data.webhooks[0].lastUsed).toBeGreaterThan(0);
    // Blocks-shaped payloads work too; mentions are not resolved for apps.
    const blocksPost = await as(null).post(`/webhook/${made.data.token}`, { blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'from blocks @bob' } }] });
    expect(blocksPost.ok).toBe(true);
    const page2 = await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(page2.data.messages.at(-1)).toMatchObject({ text: 'from blocks @bob', mentions: [] });
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.me.mentions[general.id]).toBeUndefined();
    // Live for everyone: the activity document advanced.
    expect((await rt.kv.get(KEYS.activity(wsId))).c[general.id].s).toBe(page2.data.seq);
    // It cannot read.
    expect((await as(null).get(`/webhook/${made.data.token}`)).status).toBe(405);
  });

  it('rejects bad, revoked, rotated, and over-eager tokens, and oversized bodies, without writing', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const made = await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' });
    const [kind, id] = made.data.token.split('_');
    expect((await as(null).post('/webhook/nonsense', { text: 'x' })).status).toBe(401);
    expect((await as(null).post(`/webhook/${kind}_${id}_${'a'.repeat(32)}`, { text: 'x' })).status).toBe(401);
    // Malformed and oversized payloads touch nothing.
    const opsBefore = rt.kv._calls.ops;
    expect((await as(null).post(`/webhook/${made.data.token}`, { text: '' })).status).toBe(400);
    const big = await rt.dispatch(`https://teamchat-api.test/webhook/${made.data.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(LIMITS.webhookBodyBytes + 10) }) }, null);
    expect(big.status).toBe(413);
    const seqAfter = await rt.kv.get(KEYS.seq(general.id));
    expect(seqAfter).toBe(1); // only "created #general"
    expect(rt.kv._calls.ops - opsBefore).toBeLessThanOrEqual(6); // token lookups and rate counters, no message writes
    // Rotation: the old token dies, the new one works.
    const rotated = await as(alice).post(`/api/ws/${wsId}/webhooks/${id}/rotate`);
    expect((await as(null).post(`/webhook/${made.data.token}`, { text: 'old' })).status).toBe(401);
    expect((await as(null).post(`/webhook/${rotated.data.token}`, { text: 'new' })).ok).toBe(true);
    // Rate limit per token.
    for (let i = 0; i < LIMITS.hookRatePerMinute; i++) await as(null).post(`/webhook/${rotated.data.token}`, { text: `n${i}` });
    const limited = await as(null).post(`/webhook/${rotated.data.token}`, { text: 'one more' });
    expect(limited.status).toBe(429);
    expect(rt.kv._ttl.get(`tc:hookrate:${id}`)).toBe(60);
    // Revoked: gone for good.
    expect((await as(alice).del(`/api/ws/${wsId}/webhooks/${id}`)).ok).toBe(true);
    expect((await as(null).post(`/webhook/${rotated.data.token}`, { text: 'zombie' })).status).toBe(401);
    expect((await as(alice).get(`/api/ws/${wsId}/webhooks`)).data.webhooks).toEqual([]);
  });

  it('bot tokens post to, read, and react in the channels they are added to, within their scopes', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    const bot = await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Helper', channels: [ops], scopes: ['post', 'read'] });
    expect(bot.ok).toBe(true);
    expect(bot.data.token).toMatch(/^tcb_/);
    expect((await as(null).post(`/bot/${bot.data.token}/channels/${general.id}/messages`, { text: 'hi' })).status).toBe(404); // not added there
    expect((await as(null).post(`/bot/${bot.data.token}/channels/${ops}/messages`, { text: 'hello ops' })).ok).toBe(true);
    const read = await as(null).get(`/bot/${bot.data.token}/channels/${ops}/messages`);
    expect(read.ok).toBe(true);
    expect(read.data.messages.at(-1)).toMatchObject({ text: 'hello ops', bot: { name: 'Helper' } });
    expect((await as(null).get(`/bot/${bot.data.token}/channels/${general.id}/messages`)).status).toBe(404);
    const seq = read.data.messages.at(-1).seq;
    expect((await as(null).post(`/bot/${bot.data.token}/channels/${ops}/messages/${seq}/reactions`, { reaction: 'tada' })).status).toBe(403); // no react scope
    await as(alice).put(`/api/ws/${wsId}/bots/${bot.data.id}`, { scopes: ['post', 'read', 'react'], channels: [ops, general.id] });
    expect((await as(null).post(`/bot/${bot.data.token}/channels/${ops}/messages/${seq}/reactions`, { reaction: 'tada' })).data.on).toBe(true);
    expect((await as(null).post(`/bot/${bot.data.token}/channels/${general.id}/messages`, { text: 'now here too' })).ok).toBe(true);
    // A webhook token cannot use bot routes and vice versa.
    const hook = await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: ops, name: 'H' });
    expect((await as(null).post(`/bot/${hook.data.token}/channels/${ops}/messages`, { text: 'x' })).status).toBe(401);
    expect((await as(null).post(`/webhook/${bot.data.token}`, { text: 'x' })).status).toBe(401);
    expect((await as(alice).del(`/api/ws/${wsId}/bots/${bot.data.id}`)).ok).toBe(true);
    expect((await as(null).post(`/bot/${bot.data.token}/channels/${ops}/messages`, { text: 'gone' })).status).toBe(401);
  });
});

describe('export, import, transfer', () => {
  const post = (u, wsId, conv, text, extra = {}) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text, ...extra });

  /** Walk the export pages the way the client does. */
  async function exportAll(u, wsId) {
    let res = await as(u).get(`/api/ws/${wsId}/export`);
    expect(res.ok).toBe(true);
    const header = res.data.header;
    const pages = [...res.data.pages];
    const files = [...res.data.files];
    let guard = 0;
    while (!res.data.done && guard++ < 100) {
      res = await as(u).get(`/api/ws/${wsId}/export?cursor=${encodeURIComponent(JSON.stringify(res.data.cursor))}`);
      expect(res.ok).toBe(true);
      pages.push(...res.data.pages);
      files.push(...res.data.files);
    }
    return { header, pages, files, calls: guard + 1 };
  }

  /** Import an archive onto the (same, in tests) worker as `owner`; returns the new id. */
  async function importAll(owner, archive, from) {
    const created = await as(owner).post('/api/workspaces/import', { header: archive.header, from });
    expect(created.ok).toBe(true);
    const wsId = created.data.workspace.id;
    for (const page of archive.pages) {
      expect((await as(owner).post(`/api/ws/${wsId}/import`, { conv: page.conv, seq: page.seq, messages: page.messages })).ok).toBe(true);
    }
    expect((await as(owner).post(`/api/ws/${wsId}/import/finish`)).ok).toBe(true);
    return wsId;
  }

  it('exports everything in pages, and an import reproduces it with ids intact', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops', topic: 'Ops things' })).data.channel.id;
    await as(bob).post(`/api/ws/${wsId}/channels/${ops}/join`);
    for (let i = 0; i < 12; i++) await as(alice).post(`/api/ws/${wsId}/channels`, { name: `room-${i}` }); // enough blocks to need several pages
    for (let i = 0; i < BLOCK_SIZE * 3 + 7; i++) await post(alice, wsId, general.id, `history ${i}`);
    const root = (await post(bob, wsId, general.id, 'thread root')).data.message;
    await post(carol, wsId, threadConvId(general.id, root.seq), 'a reply');
    await as(carol).post(`/api/ws/${wsId}/conv/${general.id}/messages/${root.seq}/reactions`, { reaction: 'tada' });
    await as(bob).put(`/api/ws/${wsId}/conv/${general.id}/messages/${root.seq}`, { text: 'thread root, edited' });
    await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/pins`, { seq: root.seq });
    const dm = (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] })).data.conv;
    await post(alice, wsId, dm, 'private note');
    const fd = new FormData();
    fd.append('file', new File(['bytes'], 'plan.txt', { type: 'text/plain' }));
    const file = (await as(alice).post(`/api/ws/${wsId}/files`, fd)).data;
    await post(alice, wsId, ops, 'see attached', { attachments: [{ id: file.id }] });
    await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' });

    expect((await as(carol).get(`/api/ws/${wsId}/export`)).status).toBe(403);
    const archive = await exportAll(alice, wsId);
    expect(archive.calls).toBeGreaterThan(1); // more than one page
    expect(archive.header.format).toBe('teamchat-export');
    expect(archive.header.workspace.id).toBe(wsId);
    expect(archive.header.channels[ops]).toMatchObject({ name: 'ops', topic: 'Ops things' });
    expect(Object.keys(archive.header.members)).toHaveLength(3);
    expect(archive.header.dms[dm]).toBeTruthy();
    expect(archive.header.pins[general.id]).toHaveLength(1);
    expect(archive.header.memberDocs[bob.uuid].channels).toContain(ops);
    const all = archive.pages.flatMap((p) => p.messages);
    expect(all.filter((m) => m.text.startsWith('history'))).toHaveLength(BLOCK_SIZE * 3 + 7);
    expect(archive.pages.some((p) => p.conv === threadConvId(general.id, root.seq))).toBe(true);
    expect(archive.pages.some((p) => p.conv === dm)).toBe(true);
    expect(archive.files).toEqual([expect.objectContaining({ id: file.id, name: 'plan.txt', conv: ops })]);
    expect(JSON.stringify(archive.header)).not.toContain(archive.header.workspace.invite || 'XXXX');

    // Import onto another worker, bob's own (a fresh runtime): bob takes it
    // over, and every id, the workspace's included, keeps its shape.
    rt = await boot({ owner: bob });
    const newId = await importAll(bob, archive, `${wsId}@old-server`);
    expect(newId).toBe(wsId);
    const b = await as(bob).get(`/api/ws/${newId}`);
    expect(b.data.workspace.owner).toBe(bob.uuid);
    expect(b.data.workspace.members[alice.uuid].role).toBe('admin'); // the old owner keeps admin
    expect(b.data.workspace.members[carol.uuid].role).toBe('member');
    expect(Object.keys(b.data.workspace.channels)).toHaveLength(14);
    expect(b.data.me.channels.sort()).toEqual([general.id, ops].sort());
    expect(b.data.me.dms[dm]).toBeTruthy();
    expect(b.data.workspace.importing).toBe(false);
    // Members reach it without re-joining, and their lists know it.
    expect((await as(carol).get(`/api/ws/${newId}`)).ok).toBe(true);
    expect((await as(carol).get('/api/me')).data.workspaces.map((w) => w.id)).toContain(newId);
    // Messages, threads, reactions, edits, pins, and DMs, with the same seqs.
    const page = await as(carol).get(`/api/ws/${newId}/conv/${general.id}/messages`);
    const rootAgain = page.data.messages.find((m) => m.seq === root.seq);
    expect(rootAgain).toMatchObject({ text: 'thread root, edited', replyCount: 1, pinned: true, reactions: { tada: { [carol.uuid]: 1 } } });
    expect(rootAgain.editedAt).toBeGreaterThan(0);
    const older = await as(carol).get(`/api/ws/${newId}/conv/${general.id}/messages?before=${page.data.messages[0].seq}`);
    expect(older.data.messages.length).toBeGreaterThan(0);
    expect((await as(carol).get(`/api/ws/${newId}/conv/${threadConvId(general.id, root.seq)}/messages`)).data.messages[0].text).toBe('a reply');
    expect((await as(bob).get(`/api/ws/${newId}/conv/${dm}/messages`)).data.messages[0].text).toBe('private note');
    expect((await as(bob).get(`/api/ws/${newId}/conv/${general.id}/pins`)).data.pins[0].seq).toBe(root.seq);
    // New messages continue after the imported ones, and search finds the imported history.
    const next = await post(carol, newId, general.id, 'life goes on');
    expect(next.data.message.seq).toBe(page.data.seq + 1);
    expect((await as(carol).get(`/api/ws/${newId}/search?q=history`)).data.results.length).toBeGreaterThan(0);
    // Attachment bytes come across under the same id.
    const upf = new FormData();
    upf.append('file', new File(['bytes'], 'plan.txt', { type: 'text/plain' }));
    upf.append('id', file.id);
    upf.append('owner', alice.uuid);
    expect((await as(bob).post(`/api/ws/${newId}/import/file`, upf)).status).toBe(409); // finished already: closed
  });

  it('lands an importer the archive does not know in the default channels, caught up', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    for (let i = 0; i < 5; i++) await post(alice, wsId, general.id, `history ${i}`);
    const archive = await exportAll(alice, wsId);
    const count = archive.header.channels[general.id].count;
    expect(archive.header.memberDocs[dave.uuid]).toBeUndefined();

    rt = await boot({ owner: dave });
    const created = await as(dave).post('/api/workspaces/import', { header: archive.header });
    expect(created.ok).toBe(true);
    const newId = created.data.workspace.id;
    for (const page of archive.pages) expect((await as(dave).post(`/api/ws/${newId}/import`, { conv: page.conv, seq: page.seq, messages: page.messages })).ok).toBe(true);
    // Not before the history is in: the seat is taken at finish, and the cursor sits at the end of what was written.
    expect((await as(dave).get(`/api/ws/${newId}`)).data.me.channels).toEqual([]);
    expect((await as(dave).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    const opened = await as(dave).get(`/api/ws/${newId}`);
    expect(opened.data.me.channels).toEqual([general.id]);
    expect(opened.data.me.reads[general.id]).toBe(opened.data.activity.c[general.id].s);
    expect(opened.data.workspace.channels[general.id].count).toBe(count + 1);
    // Someone the archive did know keeps the channels it gave them, uncounted twice.
    rt = await boot({ owner: bob });
    const again = await as(bob).post('/api/workspaces/import', { header: archive.header });
    for (const page of archive.pages) await as(bob).post(`/api/ws/${again.data.workspace.id}/import`, { conv: page.conv, seq: page.seq, messages: page.messages });
    await as(bob).post(`/api/ws/${again.data.workspace.id}/import/finish`);
    expect((await as(bob).get(`/api/ws/${again.data.workspace.id}`)).data.workspace.channels[general.id].count).toBe(count);
  });

  it('carries the scheduled messages and reminders across, delivered once the copy is open', async () => {
    const sync = (u, id) => as(u).get(`/api/ws/${id}/sync?since=0`);
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await post(bob, wsId, general.id, 'remember this')).data.message;
    const s = await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later, from alice', dueAt: Date.now() + 3600_000 });
    expect(s.ok).toBe(true);
    const r = await as(bob).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq: m.seq, dueAt: Date.now() + 3600_000, note: 'budget' });
    expect(r.ok).toBe(true);
    // Both come due while the archive is being replayed.
    await rt.kv.update(KEYS.sched(wsId), { [`m.${s.data.scheduled.id}.dueAt`]: Date.now() - 1, [`m.${r.data.reminder.id}.dueAt`]: Date.now() - 1 });
    const archive = await exportAll(alice, wsId);
    expect(archive.header.sched.map((e) => e.kind).sort()).toEqual(['message', 'reminder']);
    expect(archive.header.sched.every((e) => e.claims === undefined)).toBe(true);

    rt = await boot({ owner: dave });
    const created = await as(dave).post('/api/workspaces/import', { header: archive.header });
    expect(created.ok).toBe(true);
    const newId = created.data.workspace.id;
    // Nothing is delivered into a copy whose history is still being written: a poll meanwhile leaves the queue alone.
    await sync(alice, newId);
    expect((await as(alice).get(`/api/ws/${newId}/scheduled`)).data.scheduled).toHaveLength(1);
    for (const page of archive.pages) expect((await as(dave).post(`/api/ws/${newId}/import`, { conv: page.conv, seq: page.seq, messages: page.messages })).ok).toBe(true);
    expect((await as(dave).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    await sync(alice, newId);
    const page = await as(alice).get(`/api/ws/${newId}/conv/${general.id}/messages`);
    expect(page.data.messages.at(-1)).toMatchObject({ user: alice.uuid, text: 'later, from alice' });
    expect((await as(alice).get(`/api/ws/${newId}/scheduled`)).data.scheduled).toEqual([]);
    const inbox = await as(bob).get(`/api/ws/${newId}/inbox`);
    expect(inbox.data.items.some((e) => e.k === 'reminder' && e.s === m.seq && e.note === 'budget')).toBe(true);
    expect((await as(bob).get(`/api/ws/${newId}/scheduled`)).data.reminders).toEqual([]);
  });

  it('carries the names of people who left across an export and import', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const said = await post(bob, wsId, general.id, 'I was here');
    expect(said.ok).toBe(true);
    expect((await as(bob).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    const archive = await exportAll(alice, wsId);
    expect(archive.header.former[bob.uuid]).toMatchObject({ name: 'bob', username: 'bob' });
    // Something that is not a card, and a card for someone the archive still
    // lists as a member, are left out; the rest is admitted in the app's own shape.
    archive.header.former['not a uuid!'] = { name: 'x' };
    archive.header.former[carol.uuid] = { name: 'carol', username: 'carol' };
    archive.header.former[dave.uuid] = { name: `<b>${'d'.repeat(200)}`, username: 'DAVE', color: 99, at: 'soon', org: { name: 'Globex', ref: 'nonsense' } };

    rt = await boot({ owner: dave });
    const created = await as(dave).post('/api/workspaces/import', { header: archive.header });
    expect(created.ok).toBe(true);
    const newId = created.data.workspace.id;
    for (const page of archive.pages) expect((await as(dave).post(`/api/ws/${newId}/import`, { conv: page.conv, seq: page.seq, messages: page.messages })).ok).toBe(true);
    expect((await as(dave).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    const former = (await as(dave).get(`/api/ws/${newId}`)).data.workspace.former;
    expect(former[bob.uuid]).toMatchObject({ name: 'bob', username: 'bob' });
    expect(former['not a uuid!']).toBeUndefined();
    expect(former[carol.uuid]).toBeUndefined();
    expect(former[dave.uuid]).toBeUndefined(); // the importer is the owner now
    expect(Object.keys(former)).toHaveLength(1);
    const msg = (await as(dave).get(`/api/ws/${newId}/conv/${general.id}/messages`)).data.messages.find((m) => m.text === 'I was here');
    expect(msg.user).toBe(bob.uuid);
  });

  it('counts an imported file once per message that carries it, so deleting one of them keeps it', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const fd = new FormData();
    fd.append('file', new File(['bytes'], 'plan.txt', { type: 'text/plain' }));
    const file = (await as(alice).post(`/api/ws/${wsId}/files`, fd)).data;
    await post(alice, wsId, general.id, 'first copy', { attachments: [{ id: file.id }] });
    await post(alice, wsId, general.id, 'second copy', { attachments: [{ id: file.id }] });
    const archive = await exportAll(alice, wsId);
    expect(archive.files.filter((f) => f.id === file.id).length).toBeGreaterThanOrEqual(1);

    rt = await boot({ owner: bob });
    const created = await as(bob).post('/api/workspaces/import', { header: archive.header, from: `${wsId}@old-server` });
    const newId = created.data.workspace.id;
    for (const page of archive.pages) expect((await as(bob).post(`/api/ws/${newId}/import`, { conv: page.conv, seq: page.seq, messages: page.messages })).ok).toBe(true);
    // The pages went first, as the app sends them; the bytes follow, twice
    // over as the app may send a file listed twice.
    for (let i = 0; i < 2; i++) {
      const upf = new FormData();
      upf.append('file', new File(['bytes'], 'plan.txt', { type: 'text/plain' }));
      upf.append('id', file.id);
      upf.append('owner', alice.uuid);
      expect((await as(bob).post(`/api/ws/${newId}/import/file`, upf)).ok).toBe(true);
    }
    expect((await as(bob).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.file(file.id))).refs).toBe(2);
    const page = await as(bob).get(`/api/ws/${newId}/conv/${general.id}/messages`);
    const copies = page.data.messages.filter((m) => m.attachments?.some((a) => a.id === file.id));
    expect(copies).toHaveLength(2);
    expect((await as(bob).get(`/api/ws/${newId}/files/${file.id}`)).status).toBe(200);
    expect((await as(bob).del(`/api/ws/${newId}/conv/${general.id}/messages/${copies[0].seq}`)).ok).toBe(true);
    expect((await as(bob).get(`/api/ws/${newId}/files/${file.id}`)).status).toBe(200); // the other message still has it
    expect((await as(bob).del(`/api/ws/${newId}/conv/${general.id}/messages/${copies[1].seq}`)).ok).toBe(true);
    expect((await as(bob).get(`/api/ws/${newId}/files/${file.id}`)).status).toBe(404);
  });

  it('admits only what the app itself writes from an archive', async () => {
    // An export is a file the importing admin picked from a drive: a doctored
    // one must not plant a javascript: preview link, a reaction under a key
    // that is not one, or a name of any length into a workspace every member
    // then renders.
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m1 = (await post(bob, wsId, general.id, 'see https://example.com/x')).data.message;
    const m2 = (await post(bob, wsId, general.id, 'and https://example.com/y')).data.message;
    const archive = await exportAll(alice, wsId);
    const page = archive.pages.find((p) => p.conv === general.id);
    // The import here lands on the same fake worker, where the source's
    // blocks already hold these seqs and are kept; the doctored records are
    // added as new messages so their raw records are the ones written.
    const s1 = page.seq + 1;
    const s2 = page.seq + 2;
    const s3 = page.seq + 3;
    page.messages.push({
      ...page.messages.find((x) => x.seq === m1.seq), seq: s1,
      unfurl: { url: 'javascript:alert(1)', title: 'x' },
      reactions: { 'not a key': { [bob.uuid]: 1 }, tada: { [bob.uuid]: 1, 'bad uuid!': 1, [alice.uuid]: 'yes' } },
      ref: { c: '../etc', s: 'x' },
      followers: { [bob.uuid]: 1, 'x y': 1 },
      mentions: ['fine-uuid', 'not fine!'],
      broadcast: 'world',
    }, {
      ...page.messages.find((x) => x.seq === m2.seq), seq: s2,
      unfurl: { url: 'https://example.com/y', title: 'Y', desc: 'd', site: 'example.com', image: 'a'.repeat(64), kind: 'page', ts: 5 },
      ref: { c: general.id, s: m1.seq },
    }, {
      // No timestamp at all, and a seq that is not one: the first is stored
      // with the time of the import, the second is not stored.
      seq: s3, user: bob.uuid, text: 'quince without a timestamp',
    }, {
      seq: 'x', user: bob.uuid, text: 'quince under a bad seq', ts: 1,
    });
    page.seq = s3;
    archive.header.members[bob.uuid].name = `<b>${'x'.repeat(200)}`;
    archive.header.members[bob.uuid].color = 99;
    archive.header.channels[general.id].name = 'Gen eral!!';
    archive.header.channels[general.id].topic = 'y'.repeat(1000);
    archive.header.pins = { [general.id]: [{ seq: 'x' }, { seq: m1.seq, by: 'bad uuid!' }] };
    const newId = await importAll(alice, archive, `${wsId}@test`);
    const b = await as(alice).get(`/api/ws/${newId}`);
    expect(b.data.workspace.members[bob.uuid].name).toHaveLength(LIMITS.displayName);
    expect(b.data.workspace.members[bob.uuid].color).toBeGreaterThanOrEqual(1);
    expect(b.data.workspace.members[bob.uuid].color).toBeLessThanOrEqual(8);
    // The copy landed on the worker that holds the original, so its #general
    // got a fresh id (the archive's is in use here); the pages and pins named
    // the old one and were translated.
    const gen = Object.values(b.data.workspace.channels).find((c) => c.name === 'gen-eral');
    expect(gen.id).not.toBe(general.id);
    expect(gen.topic).toHaveLength(LIMITS.channelTopic);
    const msgs = (await as(alice).get(`/api/ws/${newId}/conv/${gen.id}/messages`)).data.messages;
    const got1 = msgs.find((x) => x.seq === s1);
    expect(got1.unfurl).toBeNull();
    expect(got1.reactions).toEqual({ tada: { [bob.uuid]: 1 } });
    expect(got1.ref).toBeNull();
    expect(got1.followers).toEqual({ [bob.uuid]: 1 });
    expect(got1.mentions).toEqual(['fine-uuid']);
    expect(got1.broadcast).toBeNull();
    const got2 = msgs.find((x) => x.seq === s2);
    expect(got2.unfurl).toEqual({ url: 'https://example.com/y', title: 'Y', desc: 'd', site: 'example.com', image: 'a'.repeat(64), kind: 'page', ts: 5 });
    expect(got2.ref).toEqual({ c: gen.id, s: m1.seq });
    const pins = await as(alice).get(`/api/ws/${newId}/conv/${gen.id}/pins`);
    expect(pins.data.pins).toHaveLength(1);
    expect(pins.data.pins[0]).toMatchObject({ seq: m1.seq, by: alice.uuid });
    // The index names the records as stored: the message without a
    // timestamp is found under the time it was given, in this month's
    // bucket rather than one for a garbage date, and the record that was
    // not stored was not indexed either.
    const got3 = msgs.find((x) => x.seq === s3);
    expect(got3.ts).toBeGreaterThan(0);
    const quince = (await as(alice).get(`/api/ws/${newId}/search?q=quince`)).data;
    expect(quince.results.map((x) => [x.seq, x.ts])).toEqual([[s3, got3.ts]]);
    expect(Object.keys((await rt.kv.get(KEYS.searchMeta(newId))).months)).toEqual([bucketOf(Date.now())]);
  });

  it('marks the old copy as moved: read-only, and every door points at the new home', async () => {
    const { wsId, general, code } = await workspaceWith(alice, [bob, carol]);
    await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    // Only the owner nominates, and only an admin can be nominated.
    expect((await as(bob).post(`/api/ws/${wsId}/transfer`, { to: bob.uuid })).status).toBe(403);
    expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { to: carol.uuid })).status).toBe(400);
    expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { to: bob.uuid })).ok).toBe(true);
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.workspace.transferTo).toBe(bob.uuid);
    // Integrations and a scheduled message that comes due after the move.
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data.token;
    const bot = (await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Helper', channels: [general.id], scopes: ['post', 'read', 'react'] })).data.token;
    const sched = (await as(carol).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'scheduled before the move', dueAt: Date.now() - 30_000 })).data.scheduled.id;
    // Carol cannot complete; bob (the nominee) can.
    expect((await as(carol).post(`/api/ws/${wsId}/transfer/complete`, { to: 'abcdef1234@teamchat-new' })).status).toBe(403);
    expect((await as(bob).post(`/api/ws/${wsId}/transfer/complete`, { to: 'not a ref' })).status).toBe(400);
    expect((await as(bob).post(`/api/ws/${wsId}/transfer/complete`, { to: 'abcdef1234@teamchat-new' })).data.movedTo).toBe('abcdef1234@teamchat-new');
    // Reads still work; writes are refused with the new reference.
    const b = await as(carol).get(`/api/ws/${wsId}`);
    expect(b.data.workspace.movedTo).toBe('abcdef1234@teamchat-new');
    expect((await as(carol).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).ok).toBe(true);
    for (const attempt of [
      post(carol, wsId, general.id, 'too late'),
      as(alice).post(`/api/ws/${wsId}/channels`, { name: 'new' }),
      as(alice).post(`/api/ws/${wsId}/dms`, { members: [carol.uuid] }),
      as(carol).post(`/api/ws/${wsId}/conv/${general.id}/messages/1/reactions`, { reaction: 'tada' }),
      as(carol).post(`/api/ws/${wsId}/channels/${general.id}/leave`),
      as(alice).post(`/api/ws/${wsId}/members/${carol.uuid}/role`, { role: 'admin' }),
      as(alice).del(`/api/ws/${wsId}/members/${carol.uuid}`),
      as(carol).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq: 1, dueAt: Date.now() + 60_000 }),
      as(alice).post(`/api/ws/${wsId}/webhooks`, { name: 'hook', channel: general.id }),
      as(alice).post(`/api/ws/${wsId}/channels/${general.id}/invites`, {}),
      as(carol).put(`/api/ws/${wsId}/scheduled/${sched}`, { sendNow: true }),
      // The sessionless routes write into the same copy and are refused the same way.
      as(null).post(`/webhook/${hook}`, { text: 'build passed' }),
      as(null).post(`/bot/${bot}/channels/${general.id}/messages`, { text: 'hello' }),
      as(null).post(`/bot/${bot}/channels/${general.id}/messages/1/reactions`, { reaction: 'tada' }),
    ]) {
      const r = await attempt;
      expect(r.status).toBe(423);
      expect(r.data.code).toBe('moved');
    }
    expect((await as(null).get(`/bot/${bot}/channels/${general.id}/messages`)).ok).toBe(true); // reads still answer
    // The poll that would have delivered the scheduled message leaves it where it is.
    expect((await as(carol).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.sched(wsId))).m[sched]).toMatchObject({ text: 'scheduled before the move' });
    expect((await as(carol).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.some((m) => m.text === 'scheduled before the move')).toBe(false);
    // Old invite links say where to go to the members carried across; the list says so too.
    const j = await as(carol).post('/api/join', { code });
    expect(j.data.movedTo).toBe('abcdef1234@teamchat-new');
    // Someone new is told the invite is no longer valid instead (the copy minted its own): the new address opens nothing for them.
    expect((await as(dave).post('/api/join', { code })).data.code).toBe('invite_not_found');
    expect((await as(dave).get(`/api/ws/${wsId}`)).status).toBe(403); // not a member of the old copy
    expect((await as(carol).get('/api/me')).data.workspaces.find((w) => w.id === wsId).movedTo).toBe('abcdef1234@teamchat-new');
    // The old owner can still delete the read-only copy.
    expect((await as(alice).del(`/api/ws/${wsId}`)).ok).toBe(true);
  });

  it('lists an imported workspace for a member the first time they open it', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const archive = await exportAll(alice, wsId);
    // Erin was a member of the exported workspace but has never called this worker.
    const erin = { uuid: 'u-erin-0000', username: 'erin' };
    archive.header.members[erin.uuid] = { username: 'erin', name: 'Erin', role: 'member' };
    archive.header.memberDocs[erin.uuid] = { channels: Object.keys(archive.header.channels), dms: {}, reads: {}, notify: {} };
    const newId = await importAll(alice, archive, wsId);
    expect((await as(erin).get('/api/me')).data.workspaces).toEqual([]);
    // Following the link once is enough: /api/me names it from then on, so
    // the app's reconciliation keeps it rather than dropping it.
    expect((await as(erin).get(`/api/ws/${newId}`)).ok).toBe(true);
    expect((await as(erin).get('/api/me')).data.workspaces.map((w) => w.id)).toEqual([newId]);
    // Bob had a profile here already and was listed by the import itself; opening it adds nothing twice.
    await as(bob).get(`/api/ws/${newId}`);
    expect((await rt.kv.get(KEYS.user(bob.uuid))).workspaces.filter((w) => w === newId)).toHaveLength(1);
  });

  it('withdraws a nomination when the nominee stops being an admin', async () => {
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    await as(alice).post(`/api/ws/${wsId}/transfer`, { to: bob.uuid });
    // Demoted: bob may no longer mark the workspace as moved, and the
    // settings no longer show a transfer waiting for him.
    await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'member' });
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.transferTo).toBeNull();
    expect((await as(bob).post(`/api/ws/${wsId}/transfer/complete`, { to: 'abcdef1234@teamchat-else' })).status).toBe(403);
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.movedTo).toBeNull();
    // Removed: the same.
    await as(alice).post(`/api/ws/${wsId}/members/${carol.uuid}/role`, { role: 'admin' });
    await as(alice).post(`/api/ws/${wsId}/transfer`, { to: carol.uuid });
    await as(alice).del(`/api/ws/${wsId}/members/${carol.uuid}`);
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.transferTo).toBeNull();
    // The owner can still complete on their own.
    expect((await as(alice).post(`/api/ws/${wsId}/transfer/complete`, { to: 'abcdef1234@teamchat-new' })).ok).toBe(true);
  });

  it('leaves the original untouched when an import stops halfway', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    for (let i = 0; i < 5; i++) await post(alice, wsId, general.id, `keep ${i}`);
    await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    const archive = await exportAll(bob, wsId);
    await as(alice).put('/api/server', { open: true });
    const created = await as(bob).post('/api/workspaces/import', { header: archive.header });
    const newId = created.data.workspace.id;
    // One page lands, then the browser closes: the new copy is half full and
    // still marked importing; nothing about the original changed.
    await as(bob).post(`/api/ws/${newId}/import`, { conv: archive.pages[0].conv, seq: archive.pages[0].seq, messages: archive.pages[0].messages.slice(0, 2) });
    const copy = (await as(bob).get(`/api/ws/${newId}`)).data.workspace;
    expect(copy.importing).toBe(true);
    const gen = Object.values(copy.channels).find((c) => c.name === 'general');
    expect((await post(bob, newId, gen.id, 'x')).data.code).toBe('importing');
    const original = await as(alice).get(`/api/ws/${wsId}`);
    expect(original.data.workspace.movedTo).toBeNull();
    expect((await post(alice, wsId, general.id, 'still fine')).ok).toBe(true);
    expect((await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.filter((m) => m.text.startsWith('keep'))).toHaveLength(5);
    // Import is idempotent per message: resuming re-sends the page without duplicates.
    await as(bob).post(`/api/ws/${newId}/import`, { conv: archive.pages[0].conv, seq: archive.pages[0].seq, messages: archive.pages[0].messages });
    await as(bob).post(`/api/ws/${newId}/import/finish`);
    const page = await as(bob).get(`/api/ws/${newId}/conv/${gen.id}/messages`);
    expect(page.data.messages.map((m) => m.seq)).toEqual([...new Set(page.data.messages.map((m) => m.seq))]);
    expect(page.data.messages.filter((m) => m.text.startsWith('keep'))).toHaveLength(5);
    // Rubbish is not an export.
    expect((await as(bob).post('/api/workspaces/import', { header: { format: 'zip' } })).status).toBe(400);
  });

  it('keeps a copy made on the same worker apart from the original, and an import out of every other workspace', async () => {
    // Conversation keys carry no workspace: a copy that reused the archive's
    // ids on the worker holding the original would share its blocks, and
    // deleting either would empty the other. On an open worker the same
    // hole let any member write into a workspace they were merely in.
    const w1 = await workspaceWith(alice, [bob, carol], 'Victim');
    const g = w1.general.id;
    await post(alice, w1.wsId, g, 'original from alice');
    const before = (await as(alice).get(`/api/ws/${w1.wsId}/conv/${g}/messages`)).data;
    const head = before.seq;
    const dm = (await as(alice).post(`/api/ws/${w1.wsId}/dms`, { members: [carol.uuid] })).data.conv;
    await post(alice, w1.wsId, dm, 'secret');
    const fd = new FormData();
    fd.append('file', new File(['bytes'], 'plan.txt', { type: 'text/plain' }));
    const file = (await as(alice).post(`/api/ws/${w1.wsId}/files`, fd)).data;
    await as(alice).put('/api/server', { open: true });

    // A faithful copy: its channels and DMs live under ids of their own.
    const archive = await exportAll(alice, w1.wsId);
    const copyId = await importAll(alice, archive, `${w1.wsId}@test`);
    const copy = (await as(alice).get(`/api/ws/${copyId}`)).data;
    const copyGeneral = Object.values(copy.workspace.channels).find((c) => c.name === 'general');
    expect(copyGeneral.id).not.toBe(g);
    expect(Object.keys(copy.me.dms)).toEqual([dmConvId([alice.uuid, carol.uuid], copyId)]);
    expect(copy.workspace.importMap).toBeUndefined();
    expect((await as(alice).get(`/api/ws/${copyId}/conv/${copyGeneral.id}/messages`)).data.messages.map((m) => m.text)).toContain('original from alice');
    expect((await as(alice).get(`/api/ws/${copyId}/conv/${dmConvId([alice.uuid, carol.uuid], copyId)}/messages`)).data.messages[0].text).toBe('secret');
    // Deleting the copy leaves the original whole.
    await as(alice).del(`/api/ws/${copyId}`);
    expect((await as(alice).get(`/api/ws/${w1.wsId}/conv/${g}/messages`)).data.messages.map((m) => m.text)).toContain('original from alice');
    expect((await as(alice).get(`/api/ws/${w1.wsId}/conv/${dm}/messages`)).data.messages[0].text).toBe('secret');

    // Bob, a plain member of Victim who knows its channel id and can derive
    // alice and carol's DM id, imports an archive naming both.
    const header = {
      format: 'teamchat-export', version: 1,
      workspace: { id: 'zzzzzzzzzz', name: 'Attacker' },
      channels: { [g]: { name: 'general', def: true } },
      members: { [bob.uuid]: { username: 'bob', name: 'Bob', role: 'owner' } },
      memberDocs: { [bob.uuid]: { channels: [g], dms: { [dm]: { members: [alice.uuid, carol.uuid] } } } },
    };
    const w2 = (await as(bob).post('/api/workspaces/import', { header })).data.workspace.id;
    const r = await as(bob).post(`/api/ws/${w2}/import`, {
      conv: g, seq: head + 1,
      messages: [
        { seq: head + 1, user: alice.uuid, text: 'I resign', ts: Date.now() },
        { seq: 1, user: alice.uuid, text: 'ALTERED', ts: 1, editedAt: Date.now() },
      ],
    });
    expect(r.ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${w2}/import`, { conv: dm, seq: 2, messages: [{ seq: 2, user: carol.uuid, text: 'planted', ts: Date.now() }] })).ok).toBe(true);
    const upf = new FormData();
    upf.append('file', new File(['x'], 'x.txt', { type: 'text/plain' }));
    upf.append('id', file.id);
    expect((await as(bob).post(`/api/ws/${w2}/import/file`, upf)).status).toBe(409);
    // Everything landed in bob's own workspace, under ids of its own.
    const after = (await as(carol).get(`/api/ws/${w1.wsId}/conv/${g}/messages`)).data;
    expect(after.seq).toBe(head);
    expect(after.messages.map((m) => m.text)).not.toContain('I resign');
    expect(after.messages.map((m) => m.text)).not.toContain('ALTERED');
    expect((await as(alice).get(`/api/ws/${w1.wsId}/conv/${dm}/messages`)).data.messages.map((m) => m.text)).toEqual(['secret']);
    expect((await as(alice).get(`/api/ws/${w1.wsId}/files/${file.id}`)).status).toBe(200);
    const his = (await as(bob).get(`/api/ws/${w2}`)).data.workspace;
    const hisGeneral = Object.values(his.channels).find((c) => c.name === 'general');
    expect(hisGeneral.id).not.toBe(g);
    expect((await as(bob).get(`/api/ws/${w2}/conv/${hisGeneral.id}/messages`)).data.messages.map((m) => m.text)).toContain('I resign');
  });
});

describe('direct messages', () => {
  it('keep each workspace apart, and still find a conversation made before ids were scoped', async () => {
    const one = await workspaceWith(alice, [bob], 'One');
    const two = await workspaceWith(alice, [bob], 'Two');
    const d1 = (await as(alice).post(`/api/ws/${one.wsId}/dms`, { members: [bob.uuid] })).data.conv;
    const d2 = (await as(bob).post(`/api/ws/${two.wsId}/dms`, { members: [alice.uuid] })).data.conv;
    expect(d1).not.toBe(d2);
    await as(alice).post(`/api/ws/${one.wsId}/conv/${d1}/messages`, { text: 'in one' });
    expect((await as(bob).get(`/api/ws/${two.wsId}/conv/${d2}/messages`)).data.messages).toEqual([]);
    expect((await as(bob).get(`/api/ws/${two.wsId}/conv/${d1}/messages`)).status).toBe(404);
    // Deleting one workspace leaves the other's conversation untouched.
    await as(alice).del(`/api/ws/${two.wsId}`);
    expect((await as(bob).get(`/api/ws/${one.wsId}/conv/${d1}/messages`)).data.messages.map((m) => m.text)).toEqual(['in one']);
    // A conversation from before ids carried the workspace is found under its old id, from either side.
    const legacy = dmConvId([alice.uuid, bob.uuid]);
    const three = await workspaceWith(alice, [bob], 'Three');
    await rt.kv.update(KEYS.member(three.wsId, bob.uuid), { [`dms.${legacy}`]: { members: [alice.uuid, bob.uuid].sort(), createdAt: 1 } });
    await rt.kv.set(KEYS.block(legacy, 0), { m: [], x: {} });
    const found = await as(alice).post(`/api/ws/${three.wsId}/dms`, { members: [bob.uuid] });
    expect(found.data.conv).toBe(legacy);
    expect(found.data.already).toBe(false); // alice did not have it yet; now both sides do
    expect((await as(alice).get(`/api/ws/${three.wsId}`)).data.me.dms[legacy]).toBeTruthy();
    expect((await as(alice).post(`/api/ws/${three.wsId}/dms`, { members: [bob.uuid] })).data.already).toBe(true);
    // Its blocks survive the workspace being deleted: another workspace may share it.
    await as(alice).post(`/api/ws/${three.wsId}/conv/${legacy}/messages`, { text: 'old style' });
    await as(alice).del(`/api/ws/${three.wsId}`);
    expect((await rt.kv.get(KEYS.block(legacy, 0))).m.some((m) => m.t === 'old style')).toBe(true);
  });

  it('are deterministic per set of people and private to them', async () => {
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    const d1 = await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] });
    const d2 = await as(bob).post(`/api/ws/${wsId}/dms`, { members: [alice.uuid] });
    expect(d1.data.conv).toBe(d2.data.conv);
    expect(d2.data.already).toBe(true);
    const conv = d1.data.conv;

    await as(alice).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text: 'psst' });
    const bobView = await as(bob).get(`/api/ws/${wsId}/conv/${conv}/messages`);
    expect(bobView.data.messages.map((m) => m.text)).toEqual(['psst']);
    expect((await as(carol).get(`/api/ws/${wsId}/conv/${conv}/messages`)).status).toBe(404);

    const b = await as(bob).get(`/api/ws/${wsId}`);
    expect(b.data.me.dms[conv].members.sort()).toEqual([alice.uuid, bob.uuid].sort());
    expect(b.data.activity.u[bob.uuid]).toBeGreaterThan(0);

    expect((await as(alice).post(`/api/ws/${wsId}/dms`, { members: [] })).status).toBe(400);
    expect((await as(alice).post(`/api/ws/${wsId}/dms`, { members: [dave.uuid] })).status).toBe(400);
    const g = await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid, carol.uuid] });
    expect(g.data.members).toHaveLength(3);
    expect(g.data.conv).not.toBe(conv);
  });

  it('gives the conversation back to a member who lost it', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const conv = (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] })).data.conv;
    // Bob leaves and comes back: his member document, and with it the
    // conversation, is gone, while alice still has it.
    await rt.kv.remove(KEYS.member(wsId, bob.uuid), `dms.${conv}`);
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${conv}/messages`)).status).toBe(404);

    const again = await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] });
    expect(again.data.already).toBe(true);
    expect(again.data.conv).toBe(conv);
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.me.dms[conv].members.sort()).toEqual([alice.uuid, bob.uuid].sort());
    await as(alice).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text: 'still here?' });
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.map((m) => m.text)).toEqual(['still here?']);
  });
});

describe('sync', () => {
  it('makes every change to the workspace visible to a poller, two in one millisecond included', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const stamps = async () => (await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).data;
    const s0 = await stamps();
    await as(alice).put(`/api/ws/${wsId}`, { name: 'One' });
    const s1 = await stamps();
    expect(s1.w).toBeGreaterThan(s0.w);
    await as(alice).put(`/api/ws/${wsId}`, { name: 'Two' });
    const s2 = await stamps();
    expect(s2.w).toBeGreaterThan(s1.w);
    // The same for what one member is told about their own state (creating a channel joins its creator).
    await as(bob).post(`/api/ws/${wsId}/channels`, { name: 'one' });
    const s3 = await stamps();
    expect(s3.u).toBeGreaterThan(s2.u);
    await as(bob).post(`/api/ws/${wsId}/channels`, { name: 'two' });
    expect((await stamps()).u).toBeGreaterThan(s3.u);
  });

  it('returns only activity newer than since, plus presence heartbeats', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const first = await as(alice).get(`/api/ws/${wsId}/sync?since=0&hb=1`);
    expect(first.data.c[general.id].s).toBeGreaterThan(0);
    expect(first.data.w).toBeGreaterThan(0);
    // The worker's clock rides along, exact; `now` is held back for the next since.
    expect(first.data.ts - first.data.now).toBe(2000);
    expect(Math.abs(first.data.ts - Date.now())).toBeLessThan(5000);
    const later = first.data.now + 10_000; // well past everything so far
    const quiet = await as(alice).get(`/api/ws/${wsId}/sync?since=${later}`);
    expect(quiet.data.c).toEqual({});
    expect(Object.keys(quiet.data.p)).toEqual([]);

    // A heartbeat from Bob shows up for Alice, and a new message does too.
    await as(bob).get(`/api/ws/${wsId}/sync?since=0&hb=1`);
    const stamp = (await rt.kv.get(KEYS.activity(wsId))).p[bob.uuid];
    const seen = await as(alice).get(`/api/ws/${wsId}/sync?since=${stamp - 1}`);
    expect(seen.data.p[bob.uuid]).toBe(stamp);
    await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'new' });
    const act = await rt.kv.get(KEYS.activity(wsId));
    const delta = await as(alice).get(`/api/ws/${wsId}/sync?since=${act.c[general.id].t - 1}`);
    expect(delta.data.c[general.id].s).toBe(act.c[general.id].s);
  });
});

describe('search rebuild', () => {
  it('reads only the conversations of its own workspace, whatever list a step brings back', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'ours' });
    // Enough channels that one step does not finish the walk.
    for (let i = 0; i < 24; i++) await as(alice).post(`/api/ws/${wsId}/channels`, { name: `room-${i}` });
    // Another workspace on the same worker, with a channel of its own.
    const other = await workspaceWith(alice, [], 'Other');
    await as(alice).post(`/api/ws/${other.wsId}/conv/${other.general.id}/messages`, { text: 'theirs zebra' });
    const first = await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state: null });
    expect(first.ok).toBe(true);
    expect(first.data.done).toBe(false);
    const total = first.data.progress.total;
    // A tampered list: the other workspace's channel, and a thread spelt wrong.
    const state = first.data.state;
    state.convs = [other.general.id, ...state.convs, `${general.id}_t007`];
    state.i = 1; // pointing past the foreign entry, at the first real one
    let res = await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state });
    expect(res.ok).toBe(true);
    expect(res.data.progress.total).toBeLessThanOrEqual(total);
    expect((res.data.state?.convs || []).includes(other.general.id)).toBe(false);
    let steps = 0;
    while (!res.data.done && steps++ < 20) res = await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state: res.data.state });
    expect(res.data.done).toBe(true);
    expect(await rt.kv.get(KEYS.searchWalk(wsId))).toBeNull();
    expect((await as(alice).get(`/api/ws/${wsId}/search?q=zebra`)).data.results).toEqual([]);
    // A step without a walk record (a rebuild begun elsewhere) starts over.
    expect((await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state: { convs: [general.id], i: 0, n: 0 } })).status).toBe(400);
  });
});

describe('profile photos', () => {
  it('are stored for the people in a workspace here, not for any account that knows the address', async () => {
    const upload = (u) => {
      const fd = new FormData();
      fd.append('file', new File([new Uint8Array(64)], 'me.png', { type: 'image/png' }));
      return as(u).post('/api/me/avatar', fd);
    };
    // The owner may, before the first workspace exists; a stranger may not.
    expect((await upload(alice)).ok).toBe(true);
    const stranger = await upload(bob);
    expect(stranger.status).toBe(403);
    const { code } = await workspaceWith(alice);
    expect((await upload(bob)).status).toBe(403);
    await as(bob).post('/api/join', { code });
    expect((await upload(bob)).ok).toBe(true);
  });
});

describe('sample workspaces', () => {
  it('keep their direct messages apart when one owner has two', async () => {
    const first = (await as(alice).post('/api/workspaces/sample')).data.workspace.id;
    const dms1 = Object.keys((await as(alice).get(`/api/ws/${first}`)).data.me.dms);
    expect(dms1.length).toBe(2);
    const dm = dms1[0];
    const mine = await as(alice).post(`/api/ws/${first}/conv/${dm}/messages`, { text: 'typed into the first sample' });
    expect(mine.ok).toBe(true);
    const second = (await as(alice).post('/api/workspaces/sample')).data.workspace.id;
    const dms2 = Object.keys((await as(alice).get(`/api/ws/${second}`)).data.me.dms);
    expect(dms2.some((d) => dms1.includes(d))).toBe(false);
    const page = await as(alice).get(`/api/ws/${first}/conv/${dm}/messages`);
    expect(page.data.messages.some((m) => m.text === 'typed into the first sample')).toBe(true);
  });
});

describe('import bounds', () => {
  it('refuses a counter or a message number beyond what a conversation can hold', async () => {
    const conv = 'impgen0001';
    const header = { format: 'teamchat-export', version: 1, workspace: { id: 'imp0000001', name: 'Old' }, channels: { [conv]: { name: 'general', def: true } }, members: { [alice.uuid]: { name: 'alice', username: 'alice', role: 'owner' } }, memberDocs: {}, dms: {}, pins: {} };
    const created = await as(alice).post('/api/workspaces/import', { header, from: 'imp0000001@old' });
    expect(created.ok).toBe(true);
    const newId = created.data.workspace.id;
    const msg = (seq) => ({ seq, user: alice.uuid, text: 'x', ts: Date.now() });
    expect((await as(alice).post(`/api/ws/${newId}/import`, { conv, seq: 1e15, messages: [msg(1)] })).status).toBe(400);
    expect((await as(alice).post(`/api/ws/${newId}/import`, { conv, seq: 'Infinity', messages: [msg(1)] })).status).toBe(400);
    expect((await as(alice).post(`/api/ws/${newId}/import`, { conv, seq: 2, messages: [msg(1), msg(1e15)] })).status).toBe(400);
    expect(Number(await rt.kv.get(KEYS.seq(conv))) || 0).toBeLessThan(10);
    // A sane page still lands, its counter ahead of the page when the archive says so.
    expect((await as(alice).post(`/api/ws/${newId}/import`, { conv, seq: 120, messages: [msg(1), msg(2)] })).ok).toBe(true);
    expect(Number(await rt.kv.get(KEYS.seq(conv)))).toBe(120);
  });
});

describe('adding people to a channel', () => {
  it('starts them at the present, and refuses an archived channel', async () => {
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    for (let i = 0; i < 3; i++) await as(alice).post(`/api/ws/${wsId}/conv/${ch}/messages`, { text: `before bob ${i}` });
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${ch}/members`, { uuids: [bob.uuid] })).data.added).toEqual([bob.uuid]);
    const b = await as(bob).get(`/api/ws/${wsId}`);
    expect(b.data.me.channels).toContain(ch);
    // Everything before the "added" line (the creation line and the three
    // messages) is read at arrival; the line itself is what is new.
    const head = b.data.activity.c[ch].s;
    expect(head).toBe(5);
    expect(b.data.me.reads[ch]).toBe(head - 1);
    await as(alice).put(`/api/ws/${wsId}/channels/${ch}`, { archived: true });
    const late = await as(alice).post(`/api/ws/${wsId}/channels/${ch}/members`, { uuids: [carol.uuid] });
    expect(late.status).toBe(403);
    expect(late.data.code).toBe('archived');
    expect((await as(carol).get(`/api/ws/${wsId}`)).data.me.channels).not.toContain(ch);
  });
});

describe('a moved workspace', () => {
  it('refuses its settings, and link previews on its messages, like every other write', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'see https://example.com/page' })).data.message;
    await rt.kv.update(KEYS.ws(wsId), { movedTo: 'abcdef1234@teamchat-new' });
    const rename = await as(alice).put(`/api/ws/${wsId}`, { name: 'Renamed' });
    expect(rename.status).toBe(423);
    expect(rename.data.code).toBe('moved');
    expect((await as(alice).put(`/api/ws/${wsId}`, { rotateInvite: true })).status).toBe(423);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/unfurl`)).status).toBe(423);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/unfurl`)).status).toBe(423);
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.name).toBe('Acme');
  });
});

describe('activity document size', () => {
  it('drops direct-message entries quiet the longest as it drops threads, and keeps channels and recent ones', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const dm = (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] })).data.conv;
    await as(alice).post(`/api/ws/${wsId}/conv/${dm}/messages`, { text: 'hi' });
    // A large workspace whose members opened a thousand direct messages over the years.
    const old = Date.now() - 200 * 24 * 3600 * 1000;
    const patch = {};
    for (let i = 0; i < 1000; i++) patch[`c.dm_old${String(i).padStart(4, '0')}`] = { s: 1, t: old + i, u: bob.uuid };
    patch['c.dm_recent'] = { s: 1, t: Date.now() - 7 * 24 * 3600 * 1000, u: bob.uuid };
    await rt.kv.update(KEYS.activity(wsId), patch);
    const before = Object.keys((await rt.kv.get(KEYS.activity(wsId))).c).length;
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(Object.keys(act.c).length).toBe(before - 100);
    for (let i = 0; i < 100; i++) expect(act.c[`dm_old${String(i).padStart(4, '0')}`]).toBeUndefined();
    expect(act.c.dm_old0100).toBeDefined();
    expect(act.c.dm_recent).toBeDefined();
    expect(act.c[general.id]).toBeDefined();
    expect(act.c[dm]).toBeDefined(); // written a moment ago
  });

  it('drops the thread entries quiet the longest once the document is large, and keeps the rest', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const root = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root' });
    const thread = threadConvId(general.id, root.data.message.seq);
    await as(bob).post(`/api/ws/${wsId}/conv/${thread}/messages`, { text: 'reply' });
    // A workspace with a long history: a thousand threads that went quiet
    // months ago, and one that went quiet last week.
    const old = Date.now() - 200 * 24 * 3600 * 1000;
    const patch = {};
    for (let i = 0; i < 1000; i++) patch[`c.${general.id}_t${1000 + i}`] = { s: 1, t: old + i, u: bob.uuid };
    patch[`c.${general.id}_t5000`] = { s: 1, t: Date.now() - 7 * 24 * 3600 * 1000, u: bob.uuid };
    await rt.kv.update(KEYS.activity(wsId), patch);
    const before = Object.keys((await rt.kv.get(KEYS.activity(wsId))).c).length;
    expect(before).toBeGreaterThan(1000);

    const sync = await as(alice).get(`/api/ws/${wsId}/sync?since=0`);
    expect(sync.ok).toBe(true);
    const act = await rt.kv.get(KEYS.activity(wsId));
    const keys = Object.keys(act.c);
    expect(keys.length).toBe(before - 100);
    // The oldest hundred went; the channel, the live thread and the recent one stay.
    for (let i = 0; i < 100; i++) expect(act.c[`${general.id}_t${1000 + i}`]).toBeUndefined();
    expect(act.c[`${general.id}_t1100`]).toBeDefined();
    expect(act.c[general.id]).toBeDefined();
    expect(act.c[thread]).toBeDefined();
    expect(act.c[`${general.id}_t5000`]).toBeDefined();
    // A reply in a pruned thread writes its entry back.
    // (The thread ids above are not real threads; the live one shows the write path.)
    await as(bob).post(`/api/ws/${wsId}/conv/${thread}/messages`, { text: 'again' });
    expect((await rt.kv.get(KEYS.activity(wsId))).c[thread].s).toBe(2);
  });

  it('leaves a small document alone', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const old = Date.now() - 200 * 24 * 3600 * 1000;
    await rt.kv.update(KEYS.activity(wsId), { [`c.${general.id}_t7`]: { s: 1, t: old, u: bob.uuid } });
    await as(alice).get(`/api/ws/${wsId}/sync?since=0`);
    expect((await rt.kv.get(KEYS.activity(wsId))).c[`${general.id}_t7`]).toBeDefined();
  });

  it('lets go of the stamps of someone who left or was removed', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    // A mention pokes each of them; a heartbeat places them.
    await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'hi @bob @carol' });
    await as(bob).get(`/api/ws/${wsId}/sync?since=0&hb=1`);
    await as(carol).get(`/api/ws/${wsId}/sync?since=0&hb=1`);
    let act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.u[bob.uuid]).toBeTruthy();
    expect(act.u[carol.uuid]).toBeTruthy();
    expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true); // removed
    expect((await as(carol).del(`/api/ws/${wsId}/members/${carol.uuid}`)).ok).toBe(true); // left
    act = await rt.kv.get(KEYS.activity(wsId));
    for (const u of [bob.uuid, carol.uuid]) {
      expect(act.u[u]).toBeUndefined();
      expect(act.p[u]).toBeUndefined();
    }
    expect(act.u[alice.uuid] ?? act.w).toBeTruthy(); // the rest of the document stands
  });
});

describe('typing', () => {
  it('shows fresh typing to others through sync, never to the typist, and stops on request', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const quiet = await as(alice).get(`/api/ws/${wsId}/sync?since=0`);
    expect(quiet.data.t).toBeUndefined(); // nothing to say, nothing sent
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/typing`, {})).ok).toBe(true);
    const seen = await as(alice).get(`/api/ws/${wsId}/sync?since=0`);
    expect(Object.keys(seen.data.t[general.id])).toEqual([bob.uuid]);
    const own = await as(bob).get(`/api/ws/${wsId}/sync?since=0`);
    expect(own.data.t).toBeUndefined();
    await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/typing`, { stop: true });
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).data.t).toBeUndefined();
    // Where you cannot post, you cannot be seen typing either.
    expect((await as(carol).post(`/api/ws/${wsId}/conv/${general.id}/typing`, {})).status).toBe(403);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${ops}/typing`, {})).ok).toBe(true); // not joined: accepted, ignored
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).data.t).toBeUndefined();
  });

  it('expires entries by time and prunes the map once it grows', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const old = Date.now() - 120_000;
    const entries = {};
    for (let i = 0; i < 30; i++) entries[`t.conv${i}.u${i}`] = old;
    entries[`t.${general.id}.${bob.uuid}`] = Date.now() - 20_000; // stale but recent: hidden, not yet pruned
    await rt.kv.update(KEYS.activity(wsId), entries);
    const r = await as(alice).get(`/api/ws/${wsId}/sync?since=0`);
    expect(r.data.t).toBeUndefined();
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(Object.keys(act.t).filter((c) => c.startsWith('conv')).every((c) => !Object.keys(act.t[c]).length)).toBe(true);
    expect(act.t[general.id][bob.uuid]).toBeDefined();
  });
});

describe('profile photos and status', () => {
  it('stores a photo per worker and serves it to members of a shared workspace', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const png = new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], 'me.png', { type: 'image/png' });
    const fd = new FormData();
    fd.append('file', png);
    const up = await as(alice).post('/api/me/avatar', fd);
    expect(up.ok).toBe(true);
    expect(up.data.avatar).toBeGreaterThan(0);
    const b = await as(bob).get(`/api/ws/${wsId}`);
    expect(b.data.workspace.members[alice.uuid].avatar).toBe(up.data.avatar);
    const img = await as(bob).get(`/api/ws/${wsId}/members/${alice.uuid}/avatar`);
    expect(img.status).toBe(200);
    expect(img.data.headers.get('content-type')).toBe('image/png');
    expect((await img.data.arrayBuffer()).byteLength).toBe(7);
    // Only members of a shared workspace see it; nobody without a photo has one.
    expect((await as(carol).get(`/api/ws/${wsId}/members/${alice.uuid}/avatar`)).status).toBe(403);
    expect((await as(alice).get(`/api/ws/${wsId}/members/${bob.uuid}/avatar`)).status).toBe(404);
    // Bounds.
    const big = new FormData();
    big.append('file', new File([new Uint8Array(LIMITS.avatarBytes + 1)], 'big.png', { type: 'image/png' }));
    expect((await as(alice).post('/api/me/avatar', big)).status).toBe(413);
    const svg = new FormData();
    svg.append('file', new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }));
    expect((await as(alice).post('/api/me/avatar', svg)).status).toBe(400);
    // Removing clears the card and the bytes.
    expect((await as(alice).del('/api/me/avatar')).data.avatar).toBeNull();
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.workspace.members[alice.uuid].avatar).toBeNull();
    expect((await as(bob).get(`/api/ws/${wsId}/members/${alice.uuid}/avatar`)).status).toBe(404);
  });

  it('lets admins set a workspace icon that every member can fetch', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const png = () => { const fd = new FormData(); fd.append('file', new File([new Uint8Array([137, 80, 78, 71, 9, 8, 7, 6])], 'logo.png', { type: 'image/png' })); return fd; };
    // Members who are not admins neither set nor clear it.
    expect((await as(bob).post(`/api/ws/${wsId}/icon`, png())).status).toBe(403);
    expect((await as(bob).del(`/api/ws/${wsId}/icon`)).status).toBe(403);
    expect((await as(bob).get(`/api/ws/${wsId}/icon`)).status).toBe(404);
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.icon).toBeNull();

    const up = await as(alice).post(`/api/ws/${wsId}/icon`, png());
    expect(up.ok).toBe(true);
    expect(up.data.icon).toBeGreaterThan(0);
    // The version is on the workspace document and on the switcher's list.
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.workspace.icon).toBe(up.data.icon);
    expect((await as(bob).get('/api/me')).data.workspaces.find((w) => w.id === wsId).icon).toBe(up.data.icon);
    const img = await as(bob).get(`/api/ws/${wsId}/icon`);
    expect(img.status).toBe(200);
    expect(img.data.headers.get('content-type')).toBe('image/png');
    expect((await img.data.arrayBuffer()).byteLength).toBe(8);
    // Only members see it.
    expect((await as(carol).get(`/api/ws/${wsId}/icon`)).status).toBe(403);
    // Bounds.
    const big = new FormData();
    big.append('file', new File([new Uint8Array(LIMITS.workspaceIconBytes + 1)], 'big.png', { type: 'image/png' }));
    expect((await as(alice).post(`/api/ws/${wsId}/icon`, big)).status).toBe(413);
    const svg = new FormData();
    svg.append('file', new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }));
    expect((await as(alice).post(`/api/ws/${wsId}/icon`, svg)).status).toBe(400);
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.workspace.icon).toBe(up.data.icon);
    // Removing clears the document and the bytes.
    expect((await as(alice).del(`/api/ws/${wsId}/icon`)).data.icon).toBeNull();
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.workspace.icon).toBeNull();
    expect((await as(bob).get('/api/me')).data.workspaces.find((w) => w.id === wsId).icon).toBeUndefined();
    expect((await as(bob).get(`/api/ws/${wsId}/icon`)).status).toBe(404);
    expect(rt.fs._files.has(`teamchat-icons/${wsId}`)).toBe(false);
    // Deleting the workspace takes the icon's bytes with it.
    expect((await as(alice).post(`/api/ws/${wsId}/icon`, png())).ok).toBe(true);
    expect(rt.fs._files.has(`teamchat-icons/${wsId}`)).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}`)).ok).toBe(true);
    expect(rt.fs._files.has(`teamchat-icons/${wsId}`)).toBe(false);
  });

  it('carries a status on the card, validated and cleared on demand', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const until = Date.now() + 3600_000;
    const r = await as(bob).put('/api/me', { status: { emoji: '🎯', text: '  Focusing  ', until, junk: 1 } });
    expect(r.data.profile.status).toEqual({ emoji: '🎯', text: 'Focusing', until });
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.members[bob.uuid].status).toEqual({ emoji: '🎯', text: 'Focusing', until });
    expect((await as(bob).put('/api/me', { status: { text: 'x'.repeat(100) } })).data.profile.status.text).toHaveLength(LIMITS.statusText);
    expect((await as(bob).put('/api/me', { status: null })).data.profile.status).toBeNull();
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.members[bob.uuid].status).toBeNull();
    // Joining carries the status along like the rest of the card.
    const { code } = await workspaceWith(alice, [], 'Other');
    await as(carol).post('/api/join', { code, profile: { name: 'Carol', status: { emoji: '🌴', text: 'Away' } } });
    const ws2 = (await as(carol).get('/api/me')).data.workspaces.find((w) => w.name === 'Other').id;
    expect((await as(alice).get(`/api/ws/${ws2}`)).data.workspace.members[carol.uuid].status).toMatchObject({ emoji: '🌴', text: 'Away' });
  });

  it('carries a do-not-disturb flag with the heartbeat', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    await as(bob).get(`/api/ws/${wsId}/sync?since=0&hb=1&st=dnd`);
    let seen = await as(alice).get(`/api/ws/${wsId}/sync?since=0`);
    expect(seen.data.ps).toEqual({ [bob.uuid]: 'dnd' });
    await as(bob).get(`/api/ws/${wsId}/sync?since=0&hb=1`);
    seen = await as(alice).get(`/api/ws/${wsId}/sync?since=0`);
    expect(seen.data.ps).toBeUndefined();
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0&hb=1&st=weird`)).ok).toBe(true);
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).data.ps).toBeUndefined();
  });
});

describe('inherited names', () => {
  it('never takes constructor or __proto__ for a channel, conversation, member, or token', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    for (const bad of ['constructor', '__proto__', 'hasOwnProperty']) {
      expect((await as(bob).get(`/api/ws/${wsId}/conv/${bad}/messages`)).status).toBe(404);
      expect((await as(bob).post(`/api/ws/${wsId}/channels/${bad}/join`)).status).toBe(404);
      expect((await as(bob).post(`/api/ws/${wsId}/conv/${bad}/messages`, { text: 'hi' })).status).toBe(404);
      expect((await as(bob).get(`/api/ws/${wsId}/conv/${bad}_t1/messages`)).status).toBe(404);
      expect((await as(bob).post(`/api/ws/${wsId}/dms`, { members: [bad] })).status).toBe(400);
      expect((await as(alice).post(`/api/ws/${wsId}/members/${bad}/role`, { role: 'admin' })).status).toBe(404);
      expect((await as(alice).del(`/api/ws/${wsId}/members/${bad}`)).status).toBe(404);
      expect((await as(alice).put(`/api/ws/${wsId}/channels/${bad}`, { topic: 'x' })).status).toBe(404);
      expect((await as(alice).post(`/api/ws/${wsId}/channels/${bad}/members`, { uuids: [bob.uuid] })).status).toBe(404);
      expect((await as(alice).post(`/api/ws/${wsId}/webhooks`, { name: 'w', channel: bad })).status).toBe(404);
      expect((await as(alice).post(`/api/ws/${wsId}/webhooks/${bad}/rotate`)).status).toBe(404);
      expect((await as(alice).del(`/api/ws/${wsId}/bots/${bad}`)).status).toBe(404);
      expect((await as(alice).put(`/api/ws/${wsId}/scheduled/${bad}`, { text: 'x' })).status).toBe(404);
      expect((await as(alice).get(`/api/ws/${wsId}/search?q=hello&in=${bad}`)).status).toBe(404);
      expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { to: bad })).status).toBe(400);
    }
    expect(await rt.kv.get(KEYS.block('constructor', 0))).toBeFalsy();
    expect(Object.keys((await rt.kv.get(KEYS.ws(wsId))).channels)).toEqual([general.id]);
    expect(Object.prototype.count).toBeUndefined();
    // The word itself is indexed and found like any other.
    await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'the constructor pattern is handy' });
    expect((await as(alice).get(`/api/ws/${wsId}/search?q=constructor`)).data.results).toHaveLength(1);
    expect((await as(alice).get(`/api/ws/${wsId}/search?q=handy`)).data.results).toHaveLength(1);
  });
});

describe('files', () => {
  it('uploads through the worker and serves them back to members only', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const fd = new FormData();
    fd.append('file', new File(['hello world'], 'notes.txt', { type: 'text/plain' }));
    const up = await as(alice).post(`/api/ws/${wsId}/files`, fd);
    expect(up.ok).toBe(true);
    expect(up.data).toMatchObject({ name: 'notes.txt', size: 11, type: 'text/plain' });

    const m = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: '', attachments: [{ id: up.data.id }, { id: 'forged00' }] });
    expect(m.ok).toBe(true);
    expect(m.data.message.attachments).toEqual([{ id: up.data.id, name: 'notes.txt', size: 11, type: 'text/plain' }]);

    const dl = await as(bob).get(`/api/ws/${wsId}/files/${up.data.id}`);
    expect(dl.status).toBe(200);
    expect(await dl.data.text()).toBe('hello world');
    expect(dl.data.headers.get('content-type')).toBe('text/plain');
    expect((await as(carol).get(`/api/ws/${wsId}/files/${up.data.id}`)).status).toBe(403);
    expect((await as(bob).get(`/api/ws/${wsId}/files/doesnotexist`)).status).toBe(404);

    // Deleting the message removes the file.
    await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${m.data.message.seq}`);
    expect((await as(bob).get(`/api/ws/${wsId}/files/${up.data.id}`)).status).toBe(404);
  });

  it('go with the workspace when it is deleted, another workspace\'s files untouched', async () => {
    const one = await workspaceWith(alice, [bob], 'One');
    const two = await workspaceWith(alice, [bob], 'Two');
    const upload = async (wsId, name) => {
      const fd = new FormData();
      fd.append('file', new File(['bytes'], name, { type: 'text/plain' }));
      return (await as(alice).post(`/api/ws/${wsId}/files`, fd)).data.id;
    };
    const f1 = await upload(one.wsId, 'a.txt');
    const f2 = await upload(two.wsId, 'b.txt');
    await as(alice).post(`/api/ws/${one.wsId}/conv/${one.general.id}/messages`, { text: 'here', attachments: [{ id: f1 }] });
    expect(rt.fs._files.has(`teamchat-files/${one.wsId}/${f1}`)).toBe(true);
    await as(alice).del(`/api/ws/${one.wsId}`);
    // The owner's drive no longer pays for what the workspace attached.
    expect([...rt.fs._files.keys()].some((k) => k.startsWith(`teamchat-files/${one.wsId}/`))).toBe(false);
    expect(rt.fs._files.has(`teamchat-files/${two.wsId}/${f2}`)).toBe(true);
    expect((await as(bob).get(`/api/ws/${two.wsId}/files/${f2}`)).status).toBe(200);
  });

  it('lets anyone forward a file of the workspace, and keeps the bytes until the last message holding it goes', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const fd = new FormData();
    fd.append('file', new File(['plan'], 'plan.txt', { type: 'text/plain' }));
    const up = await as(alice).post(`/api/ws/${wsId}/files`, fd);
    const original = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'the plan', attachments: [{ id: up.data.id }] });
    // Bob forwards it (a quote with the attachment by reference), and the file comes along.
    const fwd = await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: '> the plan', attachments: [{ id: up.data.id }] });
    expect(fwd.data.message.attachments).toEqual([{ id: up.data.id, name: 'plan.txt', size: 4, type: 'text/plain' }]);
    // A file from another workspace never attaches, whoever uploaded it.
    const other = await workspaceWith(alice, [], 'Other');
    const stray = await as(alice).post(`/api/ws/${other.wsId}/conv/${other.general.id}/messages`, { text: 'x', attachments: [{ id: up.data.id }] });
    expect(stray.data.message.attachments).toEqual([]);
    // Deleting the original leaves the forwarded copy intact; deleting that too removes the file.
    await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${original.data.message.seq}`);
    expect((await as(bob).get(`/api/ws/${wsId}/files/${up.data.id}`)).status).toBe(200);
    await as(bob).del(`/api/ws/${wsId}/conv/${general.id}/messages/${fwd.data.message.seq}`);
    expect((await as(bob).get(`/api/ws/${wsId}/files/${up.data.id}`)).status).toBe(404);
  });
});

describe('sample workspace', () => {
  it('builds a complete, readable demo', async () => {
    const r = await as(alice).post('/api/workspaces/sample');
    expect(r.ok).toBe(true);
    const wsId = r.data.workspace.id;
    const b = await as(alice).get(`/api/ws/${wsId}`);
    expect(b.data.workspace.sample).toBe(true);
    expect(b.data.workspace.owner).toBe(alice.uuid);
    const channels = Object.values(b.data.workspace.channels);
    expect(channels.map((c) => c.name).sort()).toEqual(['announcements', 'design', 'engineering', 'general', 'launch-q3', 'random']);
    expect(Object.keys(b.data.workspace.members)).toHaveLength(7);
    expect(Object.keys(b.data.me.dms)).toHaveLength(2);

    const general = channels.find((c) => c.name === 'general');
    const page = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    // Long enough to span two blocks; a short head block is merged with the
    // previous one, so the first page already holds the whole history.
    expect(page.data.seq).toBeGreaterThan(BLOCK_SIZE);
    expect(page.data.messages).toHaveLength(page.data.seq);
    expect(page.data.hasMore).toBe(false);
    const mention = page.data.messages.find((m) => m.mentions.includes(alice.uuid));
    expect(mention.text).toContain('@alice');
    expect(b.data.me.mentions[general.id]).toBe(1);
    expect(b.data.activity.c[general.id].s).toBe(page.data.seq);

    const threaded = page.data.messages.find((m) => m.replyCount > 0);
    const replies = await as(alice).get(`/api/ws/${wsId}/conv/${threadConvId(general.id, threaded.seq)}/messages`);
    expect(replies.data.messages).toHaveLength(threaded.replyCount);

    // The demo is a normal workspace: posting works and the owner can delete it.
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'hello' })).ok).toBe(true);
    expect((await as(alice).get('/api/me')).data.workspaces[0].sample).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}`)).ok).toBe(true);
  });
});

describe('search', () => {
  const post = (u, wsId, conv, text, extra = {}) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text, ...extra });
  const find = (u, wsId, params) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') q.set(k, String(v));
    return as(u).get(`/api/ws/${wsId}/search?${q}`);
  };
  const seqsOf = (res) => res.data.results.map((m) => m.seq);

  it('finds posted messages by word, newest first, with the message itself', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const a = await post(alice, wsId, general.id, 'The deploy went out last night');
    await post(bob, wsId, general.id, 'Nothing to do with it');
    const b = await post(bob, wsId, general.id, 'Deploy again tomorrow, café time');
    const r = await find(bob, wsId, { q: 'deploy' });
    expect(r.ok).toBe(true);
    expect(seqsOf(r)).toEqual([b.data.message.seq, a.data.message.seq]);
    expect(r.data.results[0]).toMatchObject({ conv: general.id, user: bob.uuid, text: 'Deploy again tomorrow, café time' });
    // Everything one person sent, with no word at all: their own posting list.
    const mine = await find(bob, wsId, { from: bob.uuid });
    expect(mine.ok).toBe(true);
    expect(mine.data.results.map((m) => m.text)).toEqual(['Deploy again tomorrow, café time', 'Nothing to do with it']);
    expect(seqsOf(await find(bob, wsId, { from: alice.uuid, q: 'deploy' }))).toEqual([a.data.message.seq]);
    expect(r.data.hasMore).toBe(false);
    expect(r.data.indexed).toMatchObject({ v: SEARCH_VERSION });
    // Accents and case do not matter; every word must be present.
    expect(seqsOf(await find(alice, wsId, { q: 'CAFE deploy' }))).toEqual([b.data.message.seq]);
    expect(seqsOf(await find(alice, wsId, { q: 'deploy nowhere' }))).toEqual([]);
    // System lines are never indexed.
    expect(seqsOf(await find(alice, wsId, { q: 'created general' }))).toEqual([]);
    // Nothing indexable in the query: empty, and it says so.
    const none = await find(alice, wsId, { q: 'the a' });
    expect(none.data.results).toEqual([]);
    expect(none.data.terms).toEqual([]);
  });

  it('never returns what the caller may not read', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const priv = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    await as(alice).post(`/api/ws/${wsId}/channels/${priv}/members`, { uuids: [carol.uuid] });
    const dm = (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [carol.uuid] })).data.conv;
    await post(alice, wsId, priv, 'secret budget numbers');
    await post(alice, wsId, dm, 'private budget chat');
    await post(alice, wsId, general.id, 'public budget update');

    const asBob = await find(bob, wsId, { q: 'budget' });
    expect(asBob.data.results.map((m) => m.conv)).toEqual([general.id]);
    const asCarol = await find(carol, wsId, { q: 'budget' });
    expect(asCarol.data.results.map((m) => m.conv).sort()).toEqual([general.id, priv, dm].sort());
    // Asking to search inside a conversation you cannot read is a 404, like reading it.
    expect((await find(bob, wsId, { q: 'budget', in: priv })).status).toBe(404);
    expect((await find(bob, wsId, { q: 'budget', in: dm })).status).toBe(404);
    expect((await find(dave, wsId, { q: 'budget' })).status).toBe(403);
  });

  it('applies in:, from:, has: and date filters', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    await as(bob).post(`/api/ws/${wsId}/channels/${ops}/join`);
    const fd = new FormData();
    fd.append('file', new File(['x'], 'plan.txt', { type: 'text/plain' }));
    const file = (await as(alice).post(`/api/ws/${wsId}/files`, fd)).data;
    const tick = () => new Promise((r) => setTimeout(r, 3)); // distinct timestamps for the date filters
    const a = await post(alice, wsId, general.id, 'status report attached', { attachments: [{ id: file.id }] });
    await tick();
    const b = await post(bob, wsId, general.id, 'status report at https://example.com/report');
    await tick();
    const c = await post(bob, wsId, ops, 'status report for ops');
    const t = threadConvId(general.id, a.data.message.seq);
    const d = await post(alice, wsId, t, 'status report reply in thread');

    const all = await find(alice, wsId, { q: 'status report' });
    expect(seqsOf(all).length).toBe(4);
    expect(all.data.results.find((m) => m.conv === t).seq).toBe(d.data.message.seq);
    // in: a channel includes its threads, not other channels.
    const inGeneral = await find(alice, wsId, { q: 'status', in: general.id });
    expect(inGeneral.data.results.map((m) => m.conv).sort()).toEqual([general.id, general.id, t].sort());
    expect(seqsOf(await find(alice, wsId, { q: 'status', in: ops }))).toEqual([c.data.message.seq]);
    expect(seqsOf(await find(alice, wsId, { q: 'status', from: bob.uuid })).sort()).toEqual([b.data.message.seq, c.data.message.seq].sort());
    expect(seqsOf(await find(alice, wsId, { q: 'status', has: 'file' }))).toEqual([a.data.message.seq]);
    expect(seqsOf(await find(alice, wsId, { q: 'status', has: 'link' }))).toEqual([b.data.message.seq]);
    // has: alone works too, and the attachment comes along.
    const files = await find(alice, wsId, { has: 'file' });
    expect(files.data.results[0].attachments[0].name).toBe('plan.txt');
    const cutoff = b.data.message.ts;
    expect(seqsOf(await find(alice, wsId, { q: 'status', in: general.id, before: cutoff - 1 }))).toEqual([a.data.message.seq]);
    expect(seqsOf(await find(alice, wsId, { q: 'status', in: general.id, after: cutoff })).sort()).toEqual([b.data.message.seq, d.data.message.seq].sort());
    expect((await find(alice, wsId, { q: 'status', from: 'not a uuid!' })).status).toBe(400);
  });

  it('follows edits and deletes: stale postings never surface', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const m = (await post(alice, wsId, general.id, 'first draft of the roadmap')).data.message;
    const path = `/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}`;
    await as(alice).put(path, { text: 'final version of the roadmap' });
    expect(seqsOf(await find(alice, wsId, { q: 'draft' }))).toEqual([]);
    expect(seqsOf(await find(alice, wsId, { q: 'final roadmap' }))).toEqual([m.seq]);
    expect((await find(alice, wsId, { q: 'roadmap' })).data.results[0].text).toBe('final version of the roadmap');
    await as(alice).del(path);
    expect(seqsOf(await find(alice, wsId, { q: 'roadmap' }))).toEqual([]);
    expect(seqsOf(await find(alice, wsId, { q: 'final' }))).toEqual([]);
  });

  it('reads a bounded number of documents per query, and never lists', async () => {
    const { wsId, general } = await workspaceWith(alice);
    for (let i = 0; i < BLOCK_SIZE * 2; i++) await post(alice, wsId, general.id, `report number ${i} ${i % 2 ? 'even' : 'odd'} filler`);
    const before = rt.kv._calls.ops;
    const r = await find(alice, wsId, { q: 'report number filler odd even nothing more words' });
    const used = rt.kv._calls.ops - before;
    // workspace + member doc + index meta, the unfolded log, one shard per
    // query word (capped), then blocks: never the whole history.
    expect(used).toBeLessThanOrEqual(3 + SEARCH_LOG_TAIL + SEARCH_QUERY_TOKENS + 24);
    expect(r.data.results).toEqual([]);
    const before2 = rt.kv._calls.ops;
    const page = await find(alice, wsId, { q: 'report' });
    expect(page.data.results).toHaveLength(SEARCH_PAGE);
    expect(rt.kv._calls.ops - before2).toBeLessThanOrEqual(3 + SEARCH_LOG_TAIL + 1 + 24);
  });

  it('pages through many hits without gaps or repeats', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const total = SEARCH_PAGE * 2 + 5;
    const seqs = [];
    for (let i = 0; i < total; i++) seqs.push((await post(alice, wsId, general.id, `needle ${i}`)).data.message.seq);
    const seen = [];
    let cursor = null;
    let guard = 0;
    do {
      const r = await find(alice, wsId, { q: 'needle', cursor });
      seen.push(...seqsOf(r));
      cursor = r.data.hasMore ? r.data.cursor : null;
    } while (cursor && guard++ < 10);
    expect(seen).toEqual([...seqs].sort((a, b) => b - a));
  });

  it('does not return a hit again after a page that examined nothing', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const m = (await post(alice, wsId, general.id, 'needle in the log')).data.message;
    // Sixteen older months on record, none holding a posting for the word:
    // paging spends whole calls reading empty months, and the hit, which
    // comes from the unfolded log every call, must be excluded on each.
    const months = {};
    for (let i = 1; i <= 16; i++) {
      const d = new Date(Date.now());
      d.setUTCMonth(d.getUTCMonth() - i);
      months[`months.${bucketOf(d.getTime())}`] = 1;
    }
    await rt.kv.update(KEYS.searchMeta(wsId), months);
    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const r = await find(alice, wsId, { q: 'needle', cursor });
      seen.push(...seqsOf(r));
      cursor = r.data.hasMore ? r.data.cursor : null;
    } while (cursor && ++pages < 12);
    expect(seen).toEqual([m.seq]);
    expect(cursor).toBeNull();
  });

  it('writes a shard once per log segment, not per message, and caps a token\'s postings per month', async () => {
    const { wsId, general } = await workspaceWith(alice);
    // Every message shares one word; its list in this month's shard is seeded full.
    const word = 'zebra';
    const month = bucketOf(Date.now());
    const shard = KEYS.searchBucket(wsId, month, shardOf(word));
    await rt.kv.set(shard, { [word]: Array.from({ length: SEARCH_POSTINGS_PER_TOKEN }, (_, i) => `oldconv:${i + 1}:1`) });
    // A segment's worth of messages touches the log alone, and is found from it.
    for (let i = 0; i < SEARCH_FOLD_EVERY; i++) await post(alice, wsId, general.id, `${word} crossing ${i}`);
    expect((await rt.kv.get(shard))[word]).toHaveLength(SEARCH_POSTINGS_PER_TOKEN);
    expect((await rt.kv.get(shard))[word].at(-1)).toBe(`oldconv:${SEARCH_POSTINGS_PER_TOKEN}:1`);
    expect((await rt.kv.get(KEYS.searchLog(wsId, 0))).p).toHaveLength(SEARCH_FOLD_EVERY);
    expect(await rt.kv.get(KEYS.searchLog(wsId, 1))).toEqual({ p: [] }); // created ahead
    expect((await rt.kv.get(KEYS.searchMeta(wsId))).months).toBeUndefined();
    expect(seqsOf(await find(alice, wsId, { q: word }))).toHaveLength(SEARCH_PAGE);
    // Two segments on, the first is folded into the month's shard and dropped;
    // the list stays at its cap with the newest postings last.
    for (let i = 0; i < SEARCH_FOLD_EVERY + 1; i++) await post(alice, wsId, general.id, `${word} crossing again ${i}`);
    const meta = await rt.kv.get(KEYS.searchMeta(wsId));
    expect(meta).toMatchObject({ c: 2 * SEARCH_FOLD_EVERY + 1, folded: 0 });
    expect(Object.keys(meta.months)).toEqual([month]);
    expect(await rt.kv.get(KEYS.searchLog(wsId, 0))).toBeNull();
    expect((await rt.kv.get(KEYS.searchLog(wsId, 1))).p).toHaveLength(SEARCH_FOLD_EVERY);
    const doc = await rt.kv.get(shard);
    expect(doc[word]).toHaveLength(SEARCH_POSTINGS_PER_TOKEN);
    expect(doc[word][0]).toBe(`oldconv:${SEARCH_FOLD_EVERY + 1}:1`);
    expect(doc[word].at(-1)).toMatch(new RegExp(`^${general.id}:`));
    // Folded and unfolded messages are found alike, newest first, without gaps or repeats.
    const seen = [];
    let cursor = null;
    do {
      const r = await find(alice, wsId, { q: word, cursor });
      seen.push(...seqsOf(r));
      cursor = r.data.hasMore ? r.data.cursor : null;
    } while (cursor);
    expect(seen).toHaveLength(2 * SEARCH_FOLD_EVERY + 1);
    expect(seen).toEqual([...seen].sort((a, b) => b - a));
    // Lost index writes are counted and reported, so a stuck index is not silent.
    expect((await find(alice, wsId, { q: word })).data.failed).toBe(0);
    await rt.kv.update(KEYS.searchMeta(wsId), { failed: 3 });
    expect((await find(alice, wsId, { q: word })).data.failed).toBe(3);
  });

  it('recovers when the fold pointer is ahead of the counter, as after a rebuild reset it under a fold', async () => {
    const { wsId, general } = await workspaceWith(alice);
    // A rebuild's first step drops the meta document; a fold in flight wrote
    // `folded` back into the empty one. The counter starts over at the first
    // segment, which the pointer now claims is folded.
    await rt.kv.set(KEYS.searchMeta(wsId), { folded: 5, months: {} });
    const a = await post(alice, wsId, general.id, 'quince marmalade');
    expect(seqsOf(await find(alice, wsId, { q: 'quince' }))).toEqual([a.data.message.seq]);
    expect((await rt.kv.get(KEYS.searchMeta(wsId))).folded).toBe(-1);
  });

  it('counts a log append the store refused, and the message is still posted', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const { add, set } = rt.kv;
    const refuse = (fn) => async (k, ...rest) => {
      if (String(k).includes(':idx:log:')) throw new Error('store unavailable');
      return fn.call(rt.kv, k, ...rest);
    };
    rt.kv.add = refuse(add);
    rt.kv.set = refuse(set);
    try {
      const r = await post(alice, wsId, general.id, 'quince marmalade');
      expect(r.ok).toBe(true);
    } finally {
      rt.kv.add = add;
      rt.kv.set = set;
    }
    expect((await rt.kv.get(KEYS.searchMeta(wsId))).failed).toBe(1);
    const lost = await find(alice, wsId, { q: 'quince' });
    expect(seqsOf(lost)).toEqual([]);
    expect(lost.data.failed).toBe(1);
    // The store back, the next message is indexed as usual.
    const ok = await post(alice, wsId, general.id, 'quince jelly');
    expect(seqsOf(await find(alice, wsId, { q: 'quince' }))).toEqual([ok.data.message.seq]);
  });

  it('scopes files, links, and authors to a conversation with their own posting lists', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    await as(bob).post(`/api/ws/${wsId}/channels/${ops}/join`);
    const a = await post(alice, wsId, general.id, 'see https://example.com/a');
    await post(alice, wsId, ops, 'see https://example.com/b');
    const t = threadConvId(general.id, a.data.message.seq);
    const d = await post(bob, wsId, t, 'and https://example.com/c in the thread');
    // Inside a conversation the query asks for the list about it alone, threads included.
    const inGeneral = await find(bob, wsId, { has: 'link', in: general.id });
    expect(inGeneral.data.terms).toEqual([scopedToken('_link', general.id)]);
    expect(seqsOf(inGeneral).sort()).toEqual([a.data.message.seq, d.data.message.seq].sort());
    expect(seqsOf(await find(bob, wsId, { has: 'link', in: ops }))).toHaveLength(1);
    const mine = await find(bob, wsId, { from: bob.uuid, in: general.id });
    expect(mine.data.terms).toEqual([scopedToken(authorToken(bob.uuid), general.id)]);
    expect(mine.data.results.map((m) => m.conv)).toEqual([t]);
    // Across the workspace the plain lists still answer.
    expect((await find(bob, wsId, { has: 'link' })).data.terms).toEqual(['_link']);
    expect(seqsOf(await find(bob, wsId, { has: 'link' }))).toHaveLength(3);
  });

  it('rebuilds the index over existing history, admins only', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const dm = (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] })).data.conv;
    for (let i = 0; i < BLOCK_SIZE + 5; i++) await post(alice, wsId, general.id, `history item ${i}`);
    const parent = (await post(alice, wsId, general.id, 'parent of a thread')).data.message;
    const reply = await post(bob, wsId, threadConvId(general.id, parent.seq), 'history inside a thread');
    const inDm = await post(bob, wsId, dm, 'history in a direct message');
    const posted = [{ ...reply.data.message, conv: threadConvId(general.id, parent.seq) }, { ...inDm.data.message, conv: dm }];
    // Simulate a workspace from before month buckets: some postings in the
    // old one-shard-set index, no meta, no log, an older stamp. The old
    // index keeps answering, as the oldest source, and scoped pseudo-tokens
    // fall back to its workspace-wide ones.
    await deleteIndex(wsId);
    for (const m of posted) {
      for (const t of indexTokens(m.text, { author: m.user })) await rt.kv.add(KEYS.searchShard(wsId, shardOf(t)), { [t]: [encodePosting(m.conv, m.seq, m.ts)] });
    }
    await rt.kv.update(KEYS.ws(wsId), { search: { v: 2, built: 1 } });
    expect(seqsOf(await find(bob, wsId, { q: 'history' })).sort()).toEqual(posted.map((m) => m.seq).sort());
    expect((await find(bob, wsId, { q: 'history' })).data.indexed).toMatchObject({ v: 2 });
    expect((await find(bob, wsId, { from: bob.uuid, in: general.id })).data.results.map((m) => m.text)).toEqual(['history inside a thread']);
    // And one with no index at all: nothing found, and it says so.
    await deleteIndex(wsId);
    await rt.kv.remove(KEYS.ws(wsId), 'search');
    expect(seqsOf(await find(bob, wsId, { q: 'history' }))).toEqual([]);
    expect((await find(bob, wsId, { q: 'history' })).data.indexed).toBeNull();

    expect((await as(bob).post(`/api/ws/${wsId}/search/reindex`, {})).status).toBe(403);
    expect((await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state: { convs: ['../etc'], i: 0, n: 0 } })).status).toBe(400);
    expect((await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state: { convs: [], i: 0, n: 0, drop: ['../etc'] } })).status).toBe(400);
    let state = null;
    let steps = 0;
    let res;
    do {
      res = await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state });
      expect(res.ok).toBe(true);
      state = res.data.state;
    } while (!res.data.done && steps++ < 20);
    expect(res.data.done).toBe(true);
    expect(res.data.progress.messages).toBe(BLOCK_SIZE + 5 + 3);
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.search).toMatchObject({ v: SEARCH_VERSION });
    // The rebuilt index lives in month buckets; nothing was written to the old shards.
    expect(Object.keys((await rt.kv.get(KEYS.searchMeta(wsId))).months)).toEqual([bucketOf(Date.now())]);
    expect(await rt.kv.get(KEYS.searchShard(wsId, shardOf('history')))).toBeNull();

    const all = await find(bob, wsId, { q: 'history' });
    expect(all.data.hasMore).toBe(true);
    const convs = new Set();
    let cursor = null;
    let count = 0;
    do {
      const r = await find(bob, wsId, { q: 'history', cursor });
      for (const m of r.data.results) convs.add(m.conv);
      count += r.data.results.length;
      cursor = r.data.hasMore ? r.data.cursor : null;
    } while (cursor);
    expect(count).toBe(BLOCK_SIZE + 5 + 2);
    expect([...convs].sort()).toEqual([general.id, threadConvId(general.id, parent.seq), dm].sort());
    // Running it again drops the months first and does not double anything.
    state = null;
    do {
      res = await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state });
      state = res.data.state;
    } while (!res.data.done);
    expect(seqsOf(await find(bob, wsId, { q: 'thread inside' }))).toHaveLength(1);
    let again = 0;
    cursor = null;
    do {
      const r = await find(bob, wsId, { q: 'history', cursor });
      again += r.data.results.length;
      cursor = r.data.hasMore ? r.data.cursor : null;
    } while (cursor);
    expect(again).toBe(count);
  });

  /** Posts `n` messages saying `word` on the tenth of each of `months` (UTC, 2026), a minute apart; seqs in post order. */
  async function postAcrossMonths(wsId, conv, word, months, n = 3) {
    const seqs = [];
    for (const mo of months) {
      for (let i = 0; i < n; i++) {
        vi.setSystemTime(Date.UTC(2026, mo, 10, 12, i));
        seqs.push((await post(alice, wsId, conv, `${word} ${mo} ${i}`)).data.message.seq);
      }
    }
    return seqs;
  }
  async function rebuild(wsId) {
    const steps = [];
    let state = null;
    let res;
    do {
      res = await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state });
      steps.push(res.data);
      state = res.data.state;
    } while (!res.data.done);
    return steps;
  }
  async function pageThrough(u, wsId, params) {
    const seen = [];
    let cursor = null;
    let calls = 0;
    do {
      const r = await find(u, wsId, { ...params, cursor });
      calls++;
      seen.push(...seqsOf(r));
      cursor = r.data.hasMore ? r.data.cursor : null;
    } while (cursor && calls < 50);
    return { seen, calls };
  }

  it('pages in time order when the log holds an edit of a message from months ago', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.UTC(2026, 0, 1));
      const { wsId, general } = await workspaceWith(alice);
      const old = (await post(alice, wsId, general.id, 'apple one')).data.message.seq;
      const seqs = await postAcrossMonths(wsId, general.id, 'kiwi', [0, 1, 2, 3, 4, 5]);
      // Every posting in its month's shard, the log empty.
      await rebuild(wsId);
      expect(Object.keys((await rt.kv.get(KEYS.searchMeta(wsId))).months)).toHaveLength(6);
      // Editing the January message logs its new word under its January timestamp.
      vi.setSystemTime(Date.UTC(2026, 5, 20));
      expect((await as(alice).put(`/api/ws/${wsId}/conv/${general.id}/messages/${old}`, { text: 'apple one kiwi' })).ok).toBe(true);
      const { seen } = await pageThrough(alice, wsId, { q: 'kiwi' });
      expect(seen).toEqual([...seqs, old].sort((a, b) => b - a));
      // Its old word sits in January's shard and its new one in the log; a query for both still finds it.
      expect(seqsOf(await find(alice, wsId, { q: 'apple kiwi' }))).toEqual([old]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps every hit when the old index and a month bucket overlap in time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.UTC(2026, 0, 1));
      const { wsId, general } = await workspaceWith(alice);
      const old = (await post(alice, wsId, general.id, 'apple one')).data.message;
      const early = await postAcrossMonths(wsId, general.id, 'kiwi', [0, 1, 2], 8);
      const late = await postAcrossMonths(wsId, general.id, 'kiwi', [3, 4, 5], 8);
      // A workspace from before month buckets, whose owner's worker updated
      // in April: January to March live in the old index, April on in month
      // buckets, and the January message, edited since, has its new word in
      // January's bucket.
      const block = await rt.kv.get(KEYS.block(general.id, 0));
      const byCond = (pick) => block.m.filter(pick);
      await deleteIndex(wsId);
      for (const m of byCond((x) => early.includes(x.s) || x.s === old.seq)) {
        for (const t of indexTokens(m.t, { author: m.u })) await rt.kv.add(KEYS.searchShard(wsId, shardOf(t)), { [t]: [encodePosting(general.id, m.s, m.ts)] });
      }
      for (const m of byCond((x) => late.includes(x.s))) {
        for (const t of indexTokens(m.t, { author: m.u, conv: general.id })) await rt.kv.add(KEYS.searchBucket(wsId, bucketOf(m.ts), shardOf(t)), { [t]: [encodePosting(general.id, m.s, m.ts)] });
        await rt.kv.update(KEYS.searchMeta(wsId), { [`months.${bucketOf(m.ts)}`]: 1 });
      }
      await rt.kv.update(KEYS.block(general.id, 0), { [`x.${overlayKey(old.seq)}.t`]: 'apple one kiwi', [`x.${overlayKey(old.seq)}.e`]: Date.UTC(2026, 5, 20) });
      await rt.kv.add(KEYS.searchBucket(wsId, '202601', shardOf('kiwi')), { kiwi: [encodePosting(general.id, old.seq, old.ts)] });
      await rt.kv.update(KEYS.searchMeta(wsId), { 'months.202601': 1 });
      await rt.kv.update(KEYS.ws(wsId), { search: { v: 2, built: 1 } });
      const { seen, calls } = await pageThrough(alice, wsId, { q: 'kiwi' });
      expect(calls).toBeGreaterThan(1);
      expect(seen).toEqual([...early, ...late, old.seq].sort((a, b) => b - a));
      // A cursor from when the old index was read as the last month names no
      // month to resume at; it carries on from its posting all the same, so
      // the old index's hits in the months behind it are not skipped.
      const first = await find(alice, wsId, { q: 'kiwi' });
      const named = await find(alice, wsId, { q: 'kiwi', cursor: first.data.cursor });
      const unnamed = await find(alice, wsId, { q: 'kiwi', cursor: `${first.data.cursor.split('|')[0]}|legacy` });
      expect(seqsOf(named)).toHaveLength(SEARCH_PAGE);
      expect(seqsOf(unnamed)).toEqual(seqsOf(named));
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips the months a date filter rules out instead of spending its hops on them', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.UTC(2025, 0, 1));
      const { wsId, general } = await workspaceWith(alice);
      const seqs = await postAcrossMonths(wsId, general.id, 'kiwi', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 2);
      await rebuild(wsId);
      // Rebuilding again first drops the twelve months, a couple per step, and says so.
      const again = await rebuild(wsId);
      expect(again[0].progress).toMatchObject({ clearing: 10, done: 0, messages: 0 });
      expect(again.filter((r) => r.progress.clearing > 0)).toHaveLength(5);
      expect(again.at(-1).progress).toMatchObject({ clearing: 0, messages: 24 });
      vi.setSystemTime(Date.UTC(2026, 7, 28));
      // Only February and March can hold a hit: one call, and it says nothing older is left.
      const before = rt.kv._calls.ops;
      const r = await find(alice, wsId, { q: 'kiwi', after: Date.UTC(2026, 1, 1), before: Date.UTC(2026, 2, 31) });
      expect(seqsOf(r)).toEqual(seqs.slice(2, 6).reverse());
      expect(r.data.hasMore).toBe(false);
      expect(rt.kv._calls.ops - before).toBeLessThanOrEqual(3 + SEARCH_LOG_TAIL + 2 + 1);
      // A filter that lands where nothing was posted is answered in one call too.
      const none = await find(alice, wsId, { q: 'kiwi', before: Date.UTC(2025, 6, 1) });
      expect(seqsOf(none)).toEqual([]);
      expect(none.data.hasMore).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops every month of the previous index on a later rebuild when an earlier one was abandoned', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.UTC(2026, 0, 1));
      const { wsId, general } = await workspaceWith(alice);
      await postAcrossMonths(wsId, general.id, 'kiwi', [0, 1, 2, 3], 1);
      await rebuild(wsId);
      // A month the walk will never write again: postings for messages that
      // are gone, as after a conversation was deleted.
      const stale = KEYS.searchBucket(wsId, '202612', shardOf('kiwi'));
      await rt.kv.set(stale, { kiwi: ['gone:1:1'] });
      await rt.kv.update(KEYS.searchMeta(wsId), { 'months.202612': 1 });
      // One step of a rebuild, then the admin closes the dialog. The first
      // step drops two months; the other three are still there, and still
      // listed, so the index keeps answering from them meanwhile.
      const first = await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state: null });
      expect(first.data.done).toBe(false);
      expect(first.data.progress.clearing).toBe(3);
      expect(Object.keys((await rt.kv.get(KEYS.searchMeta(wsId))).months).sort()).toEqual(['202603', '202604', '202612']);
      expect(await rt.kv.get(stale)).not.toBeNull();
      // The next rebuild, started from scratch, finds and drops them: no
      // orphaned shards, and no stale postings doubling the rebuilt ones.
      const again = await rebuild(wsId);
      expect(again[0].progress.clearing).toBe(1);
      expect(await rt.kv.get(stale)).toBeNull();
      expect(Object.keys((await rt.kv.get(KEYS.searchMeta(wsId))).months).sort()).toEqual(['202601', '202602', '202603', '202604']);
      const doc = await rt.kv.get(KEYS.searchBucket(wsId, '202603', shardOf('kiwi')));
      expect(doc.kiwi).toHaveLength(1);
      vi.setSystemTime(Date.UTC(2026, 7, 28));
      const { seen } = await pageThrough(alice, wsId, { q: 'kiwi' });
      expect(seen).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('indexes the sample workspace as it is built', async () => {
    const wsId = (await as(alice).post('/api/workspaces/sample')).data.workspace.id;
    const r = await find(alice, wsId, { q: 'pagination deployed' });
    expect(r.data.results).toHaveLength(1);
    expect(r.data.results[0].text).toMatch(/pagination is deployed/);
    expect((await find(alice, wsId, { q: 'panel width sessions' })).data.results[0].conv).toMatch(/_t\d+$/);
    expect((await find(alice, wsId, { q: 'sample workspace precious' })).data.results[0].conv).toMatch(/^dm_/);
  });

  it('answers 404 for an unknown route so older workers degrade in the client', async () => {
    const { wsId } = await workspaceWith(alice);
    expect((await as(alice).get(`/api/ws/${wsId}/nothing-here`)).status).toBe(404);
  });
});

describe('presence', () => {
  it('marks a tab in view present as the workspace opens, and a plain bootstrap writes nothing', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const before = (await rt.kv.get(KEYS.activity(wsId))) || {};
    expect(before.p?.[bob.uuid]).toBeUndefined();
    const plain = await as(bob).get(`/api/ws/${wsId}`);
    expect(plain.ok).toBe(true);
    expect(((await rt.kv.get(KEYS.activity(wsId))) || {}).p?.[bob.uuid]).toBeUndefined();
    const t0 = Date.now();
    const b = await as(bob).get(`/api/ws/${wsId}?hb=1&st=dnd`);
    expect(b.ok).toBe(true);
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.p[bob.uuid]).toBeGreaterThanOrEqual(t0);
    expect(act.ps[bob.uuid]).toBe('dnd');
    // Alice's next poll sees him arrive, paused.
    const seen = await as(alice).get(`/api/ws/${wsId}/sync?since=${t0 - 1}`);
    expect(seen.data.p[bob.uuid]).toBe(act.p[bob.uuid]);
    expect(seen.data.ps).toEqual({ [bob.uuid]: 'dnd' });
    // Opening again without the state clears it, as a heartbeat does.
    await as(bob).get(`/api/ws/${wsId}?hb=1`);
    expect((await rt.kv.get(KEYS.activity(wsId))).ps?.[bob.uuid]).toBeUndefined();
  });

  it('takes a closing tab\'s word: away at once for pollers and for @here, until the next heartbeat', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    await as(bob).get(`/api/ws/${wsId}/sync?since=0&hb=1`);
    const t0 = Date.now();
    expect((await as(bob).del(`/api/ws/${wsId}/presence`)).ok).toBe(true);
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.p[bob.uuid]).toBeGreaterThanOrEqual(t0);
    expect(act.ps[bob.uuid]).toBe('off');
    const seen = await as(alice).get(`/api/ws/${wsId}/sync?since=${t0 - 1}`);
    expect(seen.data.ps).toEqual({ [bob.uuid]: 'off' });
    // @here skips him, though his heartbeat is seconds old; carol, here, is reached.
    await as(carol).get(`/api/ws/${wsId}/sync?since=0&hb=1`);
    const here = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: '@here now' });
    expect(here.data.notified).toBe(1);
    // Back (a new tab, or the same one restored): the heartbeat clears the word.
    await as(bob).get(`/api/ws/${wsId}/sync?since=0&hb=1`);
    expect((await rt.kv.get(KEYS.activity(wsId))).ps?.[bob.uuid]).toBeUndefined();
    // Not for outsiders.
    expect((await as(dave).del(`/api/ws/${wsId}/presence`)).status).toBe(403);
  });

  it('forgets the heartbeat of someone removed', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    await as(bob).get(`/api/ws/${wsId}/sync?since=0&hb=1&st=dnd`);
    expect((await rt.kv.get(KEYS.activity(wsId))).p[bob.uuid]).toBeTruthy();
    expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.p[bob.uuid]).toBeUndefined();
    expect(act.ps?.[bob.uuid]).toBeUndefined();
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.activity.p[bob.uuid]).toBeUndefined();
  });

  it('has the heartbeat on the store before it answers, however slow the write', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    // Work left running after a worker has answered has no promise of
    // finishing: the write is slowed here and must still have landed when
    // the answer arrives, for the poll and for the bootstrap.
    const orig = rt.kv.update.bind(rt.kv);
    rt.kv.update = (k, v) => new Promise((r) => setTimeout(() => r(orig(k, v)), 30));
    try {
      const t0 = Date.now();
      await as(bob).get(`/api/ws/${wsId}/sync?since=0&hb=1`);
      expect((await rt.kv.get(KEYS.activity(wsId))).p[bob.uuid]).toBeGreaterThanOrEqual(t0);
      const t1 = Date.now();
      await as(bob).get(`/api/ws/${wsId}?hb=1`);
      expect((await rt.kv.get(KEYS.activity(wsId))).p[bob.uuid]).toBeGreaterThanOrEqual(t1);
    } finally {
      rt.kv.update = orig;
    }
  });
});
