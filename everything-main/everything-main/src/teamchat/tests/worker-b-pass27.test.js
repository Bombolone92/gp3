/**
 * Review pass 27, the workspace lifecycle: joins, roles, guests and
 * externals, channels' states, invites, scheduled messages, push, webhooks.
 * Each test here is a hole that was found in the worker's routes and closed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';

const { alice, bob, carol, dave } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

describe('an old invite link to a workspace that has moved to another server', () => {
  it('sends a member carried across to the new copy, and tells someone new the invite is no longer valid', async () => {
    const { wsId, code } = await workspaceWith(alice, [bob]);
    await rt.kv.update(KEYS.ws(wsId), { movedTo: `${wsId}@other.puter.work` });
    // Bob has a card on this copy, so he has one on the new copy too: sent on.
    const member = await as(bob).post('/api/join', { code });
    expect(member.ok).toBe(true);
    expect(member.data).toEqual({ workspace: { id: wsId, name: 'Acme' }, movedTo: `${wsId}@other.puter.work` });
    // Carol was never here: the new copy has an invite of its own, and this
    // code opens nothing there. Answered as a dead code, not as a workspace
    // to follow; nothing written or counted for her.
    const stranger = await as(carol).post('/api/join', { code });
    expect(stranger.status).toBe(404);
    expect(stranger.data.code).toBe('invite_not_found');
    expect(stranger.data.message).toMatch(/moved to another server/);
    expect(await rt.kv.get(`tc:joinfail:${carol.uuid}`)).toBeNull();
    expect((await rt.kv.get(KEYS.ws(wsId))).members[carol.uuid]).toBeUndefined();
    expect((await rt.kv.get(KEYS.user(carol.uuid)))?.workspaces || []).not.toContain(wsId);
    // A channel invite of the copy's is answered the same way for a stranger.
    await rt.kv.remove(KEYS.ws(wsId), 'movedTo');
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'design' })).data.channel;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${ch.id}/invites`, {});
    expect(inv.ok).toBe(true);
    await rt.kv.update(KEYS.ws(wsId), { movedTo: `${wsId}@other.puter.work` });
    const guest = await as(dave).post('/api/join', { code: inv.data.code });
    expect(guest.status).toBe(404);
    expect(guest.data.code).toBe('invite_not_found');
  });

  it('answers someone from a connected workspace as it answers a stranger: their card does not travel with a move', async () => {
    const { wsId, code } = await workspaceWith(alice, [bob]);
    await rt.kv.update(KEYS.ws(wsId), {
      [`members.${carol.uuid}`]: { username: 'carol', name: 'Carol', role: 'external', org: { ref: 'p@x', name: 'Partner' }, exp: Date.now() + 3600_000, joinedAt: Date.now() },
      movedTo: `${wsId}@other.puter.work`,
    });
    const r = await as(carol).post('/api/join', { code });
    expect(r.status).toBe(404);
    expect(r.data.code).toBe('invite_not_found');
  });
});

describe('an invite code that does not hold', () => {
  it('writes nothing of the caller into the owner\'s store but the count against them; a code that holds still seeds their card', async () => {
    const { wsId, code } = await workspaceWith(alice, [bob]);
    const bad = await as(carol).post('/api/join', { code: 'AAAA-BBBB-CCCC', profile: { name: 'Carol C.', title: 'Intruder' } });
    expect(bad.status).toBe(404);
    expect(await rt.kv.get(KEYS.user(carol.uuid))).toBeNull();
    expect(Number(await rt.kv.get(`tc:joinfail:${carol.uuid}`))).toBe(1);
    // A revoked code the same: refused before anything of theirs is written.
    expect((await as(alice).put(`/api/ws/${wsId}`, { rotateInvite: true })).ok).toBe(true);
    expect((await as(carol).post('/api/join', { code, profile: { name: 'Carol C.' } })).status).toBe(404);
    expect(await rt.kv.get(KEYS.user(carol.uuid))).toBeNull();
    // The live code: the record is written, the seed on it and on the card, as before.
    const fresh = (await as(alice).get(`/api/ws/${wsId}`)).data.workspace.invite;
    const ok = await as(carol).post('/api/join', { code: fresh, profile: { name: 'Carol C.', title: 'Design' } });
    expect(ok.ok).toBe(true);
    const rec = await rt.kv.get(KEYS.user(carol.uuid));
    expect(rec).toMatchObject({ name: 'Carol C.', title: 'Design', workspaces: [wsId] });
    expect((await rt.kv.get(KEYS.ws(wsId))).members[carol.uuid]).toMatchObject({ name: 'Carol C.', title: 'Design', role: 'member' });
  });
});

describe('a direct message naming someone no longer in the workspace', () => {
  it('is refused with who is gone, rather than made of the rest', async () => {
    const { wsId } = await workspaceWith(alice, [bob, carol, dave]);
    // Alice and bob already have a conversation of their own.
    const pair = await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] });
    expect(pair.ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/members/${carol.uuid}`)).ok).toBe(true);
    // A group of three named with carol: not the pair's conversation under a new name.
    const group = await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid, carol.uuid] });
    expect(group.status).toBe(400);
    expect(group.data.message).toBe('carol is no longer in this workspace');
    expect(Object.keys((await rt.kv.get(KEYS.member(wsId, bob.uuid))).dms)).toEqual([pair.data.conv]);
    // Carol alone, and a stranger nobody remembers.
    expect((await as(alice).post(`/api/ws/${wsId}/dms`, { members: [carol.uuid] })).data.message).toBe('carol is no longer in this workspace');
    expect((await as(alice).post(`/api/ws/${wsId}/dms`, { members: ['u-nobody-0000'] })).data.message).toBe('They are no longer in this workspace');
    expect((await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid, 'u-nobody-0000'] })).data.message).toBe('Someone you picked is no longer in this workspace');
    // Nobody named at all, or oneself alone, still says to pick someone.
    expect((await as(alice).post(`/api/ws/${wsId}/dms`, { members: [alice.uuid] })).data.message).toBe('Pick at least one person');
    // A guest is told what a guest is told, whoever they name.
    const x = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'xray' })).data.channel;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${x.id}/invites`, {});
    const guest = { uuid: 'u-guest-0000', username: 'guest' };
    expect((await as(guest).post('/api/join', { code: inv.data.code })).ok).toBe(true);
    const g = await as(guest).post(`/api/ws/${wsId}/dms`, { members: [carol.uuid] });
    expect([g.status, g.data.code]).toEqual([403, 'forbidden']);
    // The group that stands still opens.
    expect((await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid, dave.uuid] })).ok).toBe(true);
  });
});

describe('an admin demoting themselves to guest through the API', () => {
  it('is counted among the guests of every channel of theirs and out again when promoted back; the owner stays untouchable', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const x = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'xray' })).data.channel;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${x.id}/join`)).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'guest' })).ok).toBe(true);
    let w = await rt.kv.get(KEYS.ws(wsId));
    expect(w.members[bob.uuid].role).toBe('guest');
    expect([w.channels[general.id].guests, w.channels[x.id].guests, w.channels[general.id].count]).toEqual([1, 1, 3]);
    // No admin rights now, and the bootstrap of a guest, channels kept.
    expect((await as(bob).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' })).status).toBe(403);
    const b = await as(bob).get(`/api/ws/${wsId}`);
    expect(b.data.me.role).toBe('guest');
    expect(Object.keys(b.data.workspace.channels).sort()).toEqual([general.id, x.id].sort());
    expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    w = await rt.kv.get(KEYS.ws(wsId));
    expect([w.channels[general.id].guests, w.channels[x.id].guests, w.channels[general.id].count]).toEqual([0, 0, 3]);
    // An admin's word about the owner's card is refused with the owner named as the reason.
    const role = await as(bob).post(`/api/ws/${wsId}/members/${alice.uuid}/role`, { role: 'member' });
    expect([role.status, role.data.code, role.data.message]).toEqual([400, 'invalid', 'The owner role cannot be changed']);
    const rm = await as(bob).del(`/api/ws/${wsId}/members/${alice.uuid}`);
    expect([rm.status, rm.data.code, rm.data.message]).toEqual([400, 'invalid', 'The owner cannot be removed from their own workspace']);
  });
});

/** A channel hosted by alice's workspace and shared with a second workspace of hers, carol in it as an external. */
async function sharedSetup() {
  const host = await workspaceWith(alice, [bob]);
  const sh = (await as(alice).post(`/api/ws/${host.wsId}/channels`, { name: 'shared' })).data.channel;
  const inv = await as(alice).post(`/api/ws/${host.wsId}/channels/${sh.id}/connect/invites`, {});
  const partner = await workspaceWith(alice, [carol, dave], 'Partner');
  const accept = await as(alice).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${partner.wsId}@teamchat-api`, name: 'Partner' } });
  expect(accept.ok).toBe(true);
  const shared = await as(alice).post(`/api/ws/${partner.wsId}/channels/shared`, { ref: `${host.wsId}@teamchat-api`, ch: sh.id, conn: accept.data.conn, secret: accept.data.secret, name: 'shared', host: 'Acme' });
  expect(shared.ok).toBe(true);
  const entry = shared.data.channel;
  const j = await as(carol).post(`/api/ws/${partner.wsId}/channels/${entry.id}/join`);
  expect(j.ok).toBe(true);
  expect((await as(carol).post('/api/connect/join', { conn: accept.data.conn, token: j.data.shared.token })).ok).toBe(true);
  return { host, sh, partner, entry, conn: accept.data.conn };
}

describe('every refusal for an archived channel', () => {
  it('answers 403 archived, whichever route meets it', async () => {
    const { host, sh, partner, entry } = await sharedSetup();
    const { wsId } = host;
    const said = (await as(alice).post(`/api/ws/${wsId}/conv/${sh.id}/messages`, { text: 'before' })).data.message;
    const hook = await as(alice).post(`/api/ws/${wsId}/webhooks`, { name: 'CI', channel: sh.id });
    const bot = await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Bot', channels: [sh.id], scopes: ['post', 'react'] });
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${sh.id}`, { archived: true })).ok).toBe(true);
    // Dave, of the partner, presents his word for a channel archived meanwhile.
    expect((await as(dave).post(`/api/ws/${partner.wsId}/channels/${entry.id}/join`)).ok).toBe(true);
    const daveWord = (await as(dave).post(`/api/ws/${partner.wsId}/channels/${entry.id}/attest`, { kind: 'join' })).data;
    const token = (url, body) => rt.dispatch(`https://teamchat-api.test${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, null)
      .then(async (r) => ({ status: r.status, data: await r.json() }));
    const attempts = {
      post: as(alice).post(`/api/ws/${wsId}/conv/${sh.id}/messages`, { text: 'x' }),
      reply: as(alice).post(`/api/ws/${wsId}/conv/${sh.id}_t${said.seq}/messages`, { text: 'x' }),
      edit: as(alice).put(`/api/ws/${wsId}/conv/${sh.id}/messages/${said.seq}`, { text: 'y' }),
      react: as(alice).post(`/api/ws/${wsId}/conv/${sh.id}/messages/${said.seq}/reactions`, { reaction: '+1' }),
      pin: as(alice).post(`/api/ws/${wsId}/conv/${sh.id}/pins`, { seq: said.seq }),
      huddle: as(alice).post(`/api/ws/${wsId}/conv/${sh.id}/huddle`, { invite: 'NJ-7F3A9C', sid: 'tab1' }),
      schedule: as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: sh.id, text: 'later', dueAt: Date.now() + 3600_000 }),
      unfurl: as(alice).post(`/api/ws/${wsId}/conv/${sh.id}/messages/${said.seq}/unfurl`, { url: 'https://example.com/' }),
      join: as(bob).post(`/api/ws/${wsId}/channels/${sh.id}/join`),
      addPeople: as(alice).post(`/api/ws/${wsId}/channels/${sh.id}/members`, { uuids: [bob.uuid] }),
      guestInvite: as(alice).post(`/api/ws/${wsId}/channels/${sh.id}/invites`, {}),
      shareInvite: as(alice).post(`/api/ws/${wsId}/channels/${sh.id}/connect/invites`, {}),
      edit_channel: as(alice).put(`/api/ws/${wsId}/channels/${sh.id}`, { topic: 'new' }),
      webhookCreate: as(alice).post(`/api/ws/${wsId}/webhooks`, { name: 'CI2', channel: sh.id }),
      connectJoin: as(dave).post('/api/connect/join', { conn: daveWord.conn, token: daveWord.token }),
      webhookPost: token(hook.data.url, { text: 'x' }),
      botPost: token(`/bot/${bot.data.token}/channels/${sh.id}/messages`, { text: 'x' }),
      botReact: token(`/bot/${bot.data.token}/channels/${sh.id}/messages/${said.seq}/reactions`, { reaction: '+1' }),
    };
    for (const [name, attempt] of Object.entries(attempts)) {
      const r = await attempt;
      expect([name, r.status, r.data.code]).toEqual([name, 403, 'archived']);
      expect(r.data.message, name).toMatch(/^This channel is archived/);
    }
    // Pinning where one has not joined still says so, under its own code.
    const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel;
    const m = (await as(alice).post(`/api/ws/${wsId}/conv/${open.id}/messages`, { text: 'x' })).data.message;
    const notIn = await as(bob).post(`/api/ws/${wsId}/conv/${open.id}/pins`, { seq: m.seq });
    expect([notIn.status, notIn.data.code]).toEqual([403, 'forbidden']);
  });
});

describe('a webhook or bot token posting into a workspace being moved', () => {
  const post = (url, body = { text: 'build ok' }) => rt.dispatch(`https://teamchat-api.test${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, null);

  it('is told how long to wait in Retry-After: the freeze that is left, a few minutes at most', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const hook = await as(alice).post(`/api/ws/${wsId}/webhooks`, { name: 'CI', channel: general.id });
    const bot = await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Bot', channels: [general.id], scopes: ['post', 'read', 'react'] });
    const said = await post(`/bot/${bot.data.token}/channels/${general.id}/messages`, { text: 'before' });
    expect(said.status).toBe(200);
    const seq = (await said.json()).seq;
    // A freeze begun a minute ago: 29 minutes left, told as five.
    await rt.kv.update(KEYS.ws(wsId), { transferring: { at: Date.now() - 60_000, by: bob.uuid, sid: 's1' } });
    for (const url of [hook.data.url, `/bot/${bot.data.token}/channels/${general.id}/messages`, `/bot/${bot.data.token}/channels/${general.id}/messages/${seq}/reactions`]) {
      const r = await post(url, url.endsWith('/reactions') ? { reaction: '+1' } : { text: 'x' });
      expect(r.status).toBe(423);
      expect((await r.json()).code).toBe('transferring');
      expect(r.headers.get('Retry-After')).toBe('300');
    }
    // A freeze about to lapse: what is left of it, never less than a second.
    await rt.kv.update(KEYS.ws(wsId), { transferring: { at: Date.now() - 30 * 60_000 + 40_000, by: bob.uuid, sid: 's1' } });
    const soon = await post(hook.data.url);
    expect(soon.status).toBe(423);
    expect(Number(soon.headers.get('Retry-After'))).toBeGreaterThanOrEqual(38);
    expect(Number(soon.headers.get('Retry-After'))).toBeLessThanOrEqual(40);
    // Reading is not a write: the bot still reads during the move, and a
    // moved copy carries no Retry-After (nothing to wait for).
    expect((await rt.dispatch(`https://teamchat-api.test/bot/${bot.data.token}/channels/${general.id}/messages`, { method: 'GET' }, null)).status).toBe(200);
    await rt.kv.remove(KEYS.ws(wsId), 'transferring');
    await rt.kv.update(KEYS.ws(wsId), { movedTo: `${wsId}@other.puter.work` });
    const moved = await post(hook.data.url);
    expect(moved.status).toBe(423);
    expect((await moved.json()).code).toBe('moved');
    expect(moved.headers.get('Retry-After')).toBeNull();
  });
});
