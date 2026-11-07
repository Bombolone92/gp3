/**
 * Review pass 15, the message plane: channels, messages, threads, reactions,
 * pins, saved messages, direct messages, huddles, shared channels, transfer.
 * Each test here is a hole that was found in the worker's routes and closed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS, threadConvId } from '../src/shared/blocks.js';
import { signAttestation } from '../worker/connect.js';

const { alice, bob, carol, dave } = USERS;
const SERVER = 'teamchat-api.test';
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

const post = (u, wsId, conv, text, extra = {}) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text, ...extra });

describe('a thread whose root was deleted while replies stood', () => {
  it('can still be unfollowed, so it comes off the Threads list, and followed again; a thread of a message nobody posted still cannot', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const root = (await post(alice, wsId, general.id, 'root')).data.message;
    const tid = threadConvId(general.id, root.seq);
    expect((await post(bob, wsId, tid, 'reply')).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${root.seq}`)).ok).toBe(true);
    // The thread stands in bob's Threads view around the root's tombstone.
    let threads = (await as(bob).get(`/api/ws/${wsId}/threads`)).data.threads;
    expect(threads.map((t) => t.id)).toEqual([tid]);
    expect(threads[0].root.deleted).toBe(true);
    // Unfollowing it used to be refused as "Message not found".
    const un = await as(bob).put(`/api/ws/${wsId}/conv/${tid}/notify`, { follow: false });
    expect(un.status).toBe(200);
    expect(un.data.notify.follow).toBe(false);
    expect((await rt.kv.get(KEYS.block(general.id, 0))).x[`s${root.seq}`].f[bob.uuid]).toBe(0);
    threads = (await as(bob).get(`/api/ws/${wsId}/threads`)).data.threads;
    expect(threads).toEqual([]);
    // Following it again is taken too: the record the flag lives on is there.
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${tid}/notify`, { follow: true })).status).toBe(200);
    expect((await rt.kv.get(KEYS.block(general.id, 0))).x[`s${root.seq}`].f[bob.uuid]).toBe(1);
    // A thread of a message nobody ever posted is still refused: a flag written for it would mint a block.
    const none = await as(bob).put(`/api/ws/${wsId}/conv/${threadConvId(general.id, 999)}/notify`, { follow: false });
    expect(none.status).toBe(404);
    expect(await rt.kv.get(KEYS.block(general.id, 19))).toBeFalsy();
  });
});

describe('a channel deleted in the same moment a newcomer accepts its guest invite', () => {
  it('leaves no guest of nothing: the link is answered as no longer valid, and nothing of the join stays behind', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'guests-here' })).data.channel;
    const inv = (await as(alice).post(`/api/ws/${wsId}/channels/${ch.id}/invites`, {})).data;
    // The deletion lands inside the join's window: after it read the invite and the workspace, as it writes the card.
    const realUpdate = rt.kv.update.bind(rt.kv);
    let deleted = null;
    rt.kv.update = async (k, patch) => {
      if (!deleted && k === KEYS.ws(wsId) && Object.hasOwn(patch || {}, `members.${carol.uuid}`)) {
        deleted = await as(alice).del(`/api/ws/${wsId}/channels/${ch.id}`);
      }
      return realUpdate(k, patch);
    };
    let join;
    try {
      join = await as(carol).post('/api/join', { code: inv.code });
    } finally {
      rt.kv.update = realUpdate;
    }
    expect(deleted.data).toEqual({ ok: true });
    expect(join.status).toBe(404);
    expect(join.data.code).toBe('invite_not_found');
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.members[carol.uuid]).toBeUndefined();
    expect(ws.channels[ch.id]).toBeUndefined();
    expect(await rt.kv.get(KEYS.member(wsId, carol.uuid))).toBeFalsy();
    // No "joined as a guest" line brought the deleted channel's history back.
    expect(await rt.kv.get(KEYS.seq(ch.id))).toBeFalsy();
    expect(await rt.kv.get(KEYS.block(ch.id, 0))).toBeFalsy();
    expect((await as(alice).get(`/api/ws/${wsId}/guests`)).data.guests).toEqual([]);
    expect((await as(carol).get(`/api/ws/${wsId}`)).status).toBe(403);
    expect((await as(carol).get('/api/me')).data.workspaces).toEqual([]);
    // A guest invite accepted with nothing racing it still joins as before.
    const other = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'also-here' })).data.channel;
    const inv2 = (await as(alice).post(`/api/ws/${wsId}/channels/${other.id}/invites`, {})).data;
    const ok = await as(carol).post('/api/join', { code: inv2.code });
    expect(ok.data).toMatchObject({ guest: true, channel: { id: other.id, name: 'also-here' } });
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[other.id]).toMatchObject({ count: 2, guests: 1 });
    expect((await as(carol).get(`/api/ws/${wsId}`)).data.me.channels).toEqual([other.id]);
  });
});

describe('a mention or a broadcast written inside code', () => {
  it('rings nobody and is refused to nobody, as it draws as plain code; one outside code beside it still counts', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const conv = general.id;
    // #general notifies everyone only at an admin's word; a member's snippet holding @channel is no such notice.
    const snippet = await post(bob, wsId, conv, 'to ring everyone, write `@channel` at the start');
    expect(snippet.status).toBe(200);
    expect(snippet.data.message.broadcast).toBeNull();
    expect(snippet.data.notified).toBe(0);
    // A name in an inline span, or in a fenced block, badges nobody.
    const inline = await post(bob, wsId, conv, 'the old handle was `@carol`');
    expect(inline.data.message.mentions).toEqual([]);
    expect(inline.data.notified).toBe(0);
    const fenced = await post(bob, wsId, conv, 'like so:\n```\nping @carol\n```\ndone');
    expect(fenced.data.message.mentions).toEqual([]);
    expect(fenced.data.notified).toBe(0);
    expect((await rt.kv.get(KEYS.member(wsId, carol.uuid))).mentions?.[conv] || 0).toBe(0);
    // Outside code the mention stands; the one inside does not.
    const mixed = await post(bob, wsId, conv, 'real @carol and `@alice` in code');
    expect(mixed.data.message.mentions).toEqual([carol.uuid]);
    expect(mixed.data.notified).toBe(1);
    expect((await rt.kv.get(KEYS.member(wsId, carol.uuid))).mentions[conv]).toBe(1);
    expect((await rt.kv.get(KEYS.member(wsId, alice.uuid))).mentions?.[conv] || 0).toBe(0);
    // A fence left open is no code to the renderer, so a name after it is a mention there and here alike.
    const open = await post(bob, wsId, conv, '```\n@carol never closed');
    expect(open.data.message.mentions).toEqual([carol.uuid]);
    // An admin's @channel in code is not a broadcast either.
    const admin = await post(alice, wsId, conv, 'see `@channel`');
    expect(admin.data.message.broadcast).toBeNull();
    expect(admin.data.notified).toBe(0);
  });
});

describe('a guest leaving the last channel they are in', () => {
  it('is refused with what to do instead, and stays in it; out of one of several, they leave as anyone does', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const first = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'first' })).data.channel;
    const inv = (await as(alice).post(`/api/ws/${wsId}/channels/${first.id}/invites`, {})).data;
    expect((await as(carol).post('/api/join', { code: inv.code })).data.guest).toBe(true);
    const refused = await as(carol).post(`/api/ws/${wsId}/channels/${first.id}/leave`);
    expect(refused.status).toBe(400);
    expect(refused.data.code).toBe('last_channel');
    expect(refused.data.message).toMatch(/guest of #first alone/);
    // Still in it, still counted, and the channel took no "left" line.
    expect((await as(carol).get(`/api/ws/${wsId}`)).data.me.channels).toEqual([first.id]);
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[first.id]).toMatchObject({ count: 2, guests: 1 });
    expect((await as(alice).get(`/api/ws/${wsId}/conv/${first.id}/messages`)).data.messages.filter((m) => m.kind === 'sys' && /left/.test(m.text))).toEqual([]);
    // Added to a second channel, they may leave the first; the second is then their last.
    const second = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'second' })).data.channel;
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${second.id}/members`, { uuids: [carol.uuid] })).data.added).toEqual([carol.uuid]);
    expect((await as(carol).post(`/api/ws/${wsId}/channels/${first.id}/leave`)).data).toEqual({ ok: true });
    expect((await as(carol).get(`/api/ws/${wsId}`)).data.me.channels).toEqual([second.id]);
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[first.id]).toMatchObject({ count: 1, guests: 0 });
    expect((await as(carol).post(`/api/ws/${wsId}/channels/${second.id}/leave`)).data.code).toBe('last_channel');
    // A channel of theirs since deleted does not count as somewhere left to be.
    const third = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'third' })).data.channel;
    await as(alice).post(`/api/ws/${wsId}/channels/${third.id}/members`, { uuids: [carol.uuid] });
    await as(alice).del(`/api/ws/${wsId}/channels/${third.id}`);
    expect((await as(carol).post(`/api/ws/${wsId}/channels/${second.id}/leave`)).data.code).toBe('last_channel');
    // A member leaving their last non-default channel is not held: the default channels are theirs.
    await as(bob).post(`/api/ws/${wsId}/channels/${second.id}/join`);
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${second.id}/leave`)).data).toEqual({ ok: true });
    // And a guest may still leave the workspace itself.
    expect((await as(carol).del(`/api/ws/${wsId}/members/${carol.uuid}`)).data).toEqual({ ok: true });
    expect((await as(carol).get(`/api/ws/${wsId}`)).status).toBe(403);
  });
});

describe('a guest who is the last one left in a private channel', () => {
  it('may leave it, and the channel is then an orphan admins can delete; a member is still held in', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel;
    const inv = (await as(alice).post(`/api/ws/${wsId}/channels/${secret.id}/invites`, {})).data;
    expect((await as(carol).post('/api/join', { code: inv.code })).data.guest).toBe(true);
    // Carol is a guest of two channels, so leaving one is hers to do.
    const other = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'other' })).data.channel;
    await as(alice).post(`/api/ws/${wsId}/channels/${other.id}/members`, { uuids: [carol.uuid] });
    // Alice, a member with someone else on the list, leaves; carol is the last one.
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${secret.id}/leave`)).data).toEqual({ ok: true });
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[secret.id].members).toEqual([carol.uuid]);
    // She used to be told to add someone or delete the channel, neither of which a guest can do.
    expect((await as(carol).post(`/api/ws/${wsId}/channels/${secret.id}/members`, { uuids: [bob.uuid] })).status).toBe(403);
    expect((await as(carol).del(`/api/ws/${wsId}/channels/${secret.id}`)).status).toBe(403);
    expect((await as(carol).post(`/api/ws/${wsId}/channels/${secret.id}/leave`)).data).toEqual({ ok: true });
    expect((await as(carol).get(`/api/ws/${wsId}`)).data.me.channels).toEqual([other.id]);
    const ch = (await rt.kv.get(KEYS.ws(wsId))).channels[secret.id];
    expect(ch.members).toEqual([]);
    expect(ch.count).toBe(0);
    expect(ch.guests).toBe(0);
    // Nobody is left in it: admins are shown it as an orphan and may delete it.
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.channels[secret.id]).toMatchObject({ orphan: true, members: [] });
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.workspace.channels[secret.id]).toBeUndefined();
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${secret.id}`)).data).toEqual({ ok: true });
    // A member who is the last one in a private channel is held in, as before.
    const mine = (await as(bob).post(`/api/ws/${wsId}/channels`, { name: 'mine', private: true })).data.channel;
    const held = await as(bob).post(`/api/ws/${wsId}/channels/${mine.id}/leave`);
    expect(held.status).toBe(400);
    expect(held.data.code).toBe('last_member');
  });
});

describe('pinning a reply in a thread the channel\'s reply rules close to the caller', () => {
  it('is refused with the rule that stands in the way, not with "join the conversation"', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const root = (await post(alice, wsId, general.id, 'root')).data.message;
    const tid = threadConvId(general.id, root.seq);
    const reply = (await post(bob, wsId, tid, 'reply')).data.message;
    // Replies to admins: bob may not pin in the thread, and is told why; alice may.
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { threadPolicy: 'admins' })).ok).toBe(true);
    const admins = await as(bob).post(`/api/ws/${wsId}/conv/${tid}/pins`, { seq: reply.seq });
    expect(admins.status).toBe(403);
    expect(admins.data.code).toBe('threads_admins');
    expect(admins.data.message).toBe('Only admins can pin in threads in #general');
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${tid}/pins`, { seq: reply.seq })).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${tid}/pins/${reply.seq}`)).ok).toBe(true);
    // Replies off: nobody pins in the thread, and the words say so.
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { threadPolicy: 'off' })).ok).toBe(true);
    const off = await as(alice).post(`/api/ws/${wsId}/conv/${tid}/pins`, { seq: reply.seq });
    expect(off.status).toBe(403);
    expect(off.data.code).toBe('threads_off');
    expect(off.data.message).toBe('Replies are turned off in #general, and so is pinning in its threads');
    // Pinning the root in the channel itself is untouched by the thread rules.
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/pins`, { seq: root.seq })).ok).toBe(true);
    // Someone merely previewing a public channel is still told to join.
    const other = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'other' })).data.channel;
    const m = (await post(alice, wsId, other.id, 'hi')).data.message;
    const outside = await as(bob).post(`/api/ws/${wsId}/conv/${other.id}/pins`, { seq: m.seq });
    expect(outside.status).toBe(403);
    expect(outside.data.message).toBe('Join the conversation to pin messages');
  });
});

/**
 * Acme (alice, carol) hosts #design; Globex (alice owns it, bob is its admin,
 * dave a member) is the partner, and bob is in #design on Acme as an external.
 */
async function sharedPair() {
  const acme = await workspaceWith(alice, [carol], 'Acme');
  const globex = await workspaceWith(alice, [bob, dave], 'Globex');
  expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
  const design = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'design' })).data.channel.id;
  await as(carol).post(`/api/ws/${acme.wsId}/channels/${design}/join`);
  const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/connect/invites`, {});
  const acc = await as(bob).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' }, profile: { name: 'Bob B.' } });
  expect(acc.ok).toBe(true);
  const added = await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, { ref: `${acme.wsId}@${SERVER}`, ch: design, conn: acc.data.conn, secret: acc.data.secret, name: 'design-with-acme', host: 'Acme' });
  const local = added.data.channel.id;
  const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
  expect((await as(bob).post('/api/connect/join', { conn: att.data.conn, token: att.data.token, profile: { name: 'Bob B.' } })).ok).toBe(true);
  return { acme, globex, design, local, conn: acc.data.conn, secret: acc.data.secret, code: inv.data.code };
}

describe('someone removed from the partner workspace while holding a seat in a channel shared with it', () => {
  it('loses the seat on the host at once, through a revocation the partner signs and the admin\'s app carries; stale, repeated and forged words change nothing', async () => {
    const { acme, globex, design, conn, secret } = await sharedPair();
    const designOn = async () => (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.channels[design];
    expect(await designOn()).toMatchObject({ count: 3, connections: { [conn]: { count: 1 } } });
    // Globex removes bob. The answer carries Globex's word for Acme.
    const removed = await as(alice).del(`/api/ws/${globex.wsId}/members/${bob.uuid}`);
    expect(removed.data.ok).toBe(true);
    expect(removed.data.revocations).toHaveLength(1);
    const [rev] = removed.data.revocations;
    expect(rev).toMatchObject({ ref: `${acme.wsId}@${SERVER}`, ch: design, conn, host: 'Acme' });
    // Until the word reaches Acme, bob keeps his seat there: the gap that used to last a day.
    expect((await as(bob).get(`/api/ws/${acme.wsId}`)).ok).toBe(true);
    // The admin's app carries it, and the seat ends.
    expect((await as(alice).post('/api/connect/revoke', { conn, token: rev.token })).data).toEqual({ ok: true });
    expect((await as(bob).get(`/api/ws/${acme.wsId}`)).status).toBe(403);
    expect(await designOn()).toMatchObject({ count: 2, connections: { [conn]: { count: 0 } } });
    const a = (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace;
    expect(a.members[bob.uuid]).toBeUndefined();
    expect(a.former[bob.uuid]).toMatchObject({ name: 'Bob B.', org: { name: 'Globex' } });
    expect((await as(alice).get(`/api/ws/${acme.wsId}/conv/${design}/messages`)).data.messages.at(-1).text).toBe('Bob B. left');
    expect(await rt.kv.get(KEYS.member(acme.wsId, bob.uuid))).toBeFalsy();
    // Said again (a retry): nothing more happens.
    expect((await as(alice).post('/api/connect/revoke', { conn, token: rev.token })).data).toEqual({ ok: true, already: true });
    expect((await designOn()).count).toBe(2);
    // A join token signed before the removal, presented after it, seats nobody...
    const before = await signAttestation(secret, { conn, uuid: bob.uuid, kind: 'join', now: Date.now() - 60_000 });
    const stale = await as(bob).post('/api/connect/join', { conn, token: before, profile: { name: 'Bob B.' } });
    expect(stale.status).toBe(403);
    expect(stale.data.code).toBe('revoked');
    expect((await designOn()).count).toBe(2);
    // ...while one signed since (Globex let him back in) does.
    await new Promise((r) => setTimeout(r, 5));
    const fresh = await signAttestation(secret, { conn, uuid: bob.uuid, kind: 'join' });
    expect((await as(bob).post('/api/connect/join', { conn, token: fresh, profile: { name: 'Bob B.' } })).ok).toBe(true);
    expect(await designOn()).toMatchObject({ count: 3, connections: { [conn]: { count: 1 } } });
    // The old word arriving late (the admin's app had been offline) is older than the fresh vouching, and changes nothing.
    expect((await as(alice).post('/api/connect/revoke', { conn, token: rev.token })).data).toEqual({ ok: true, already: true });
    expect((await as(bob).get(`/api/ws/${acme.wsId}`)).ok).toBe(true);
    // A word about one of Acme's own people is not Globex's to give; a forged one, or a join token passed off as one, is refused.
    const aboutCarol = await signAttestation(secret, { conn, uuid: carol.uuid, kind: 'revoke' });
    expect((await as(alice).post('/api/connect/revoke', { conn, token: aboutCarol })).data).toEqual({ ok: true, already: true });
    expect((await as(carol).get(`/api/ws/${acme.wsId}`)).ok).toBe(true);
    const forged = await signAttestation('x'.repeat(32), { conn, uuid: bob.uuid, kind: 'revoke' });
    expect((await as(alice).post('/api/connect/revoke', { conn, token: forged })).status).toBe(401);
    expect((await as(alice).post('/api/connect/revoke', { conn, token: fresh })).status).toBe(401);
    // A connection that no longer exists has nobody to revoke.
    expect((await as(alice).post('/api/connect/revoke', { conn: 'abcdefghij', token: rev.token })).data).toEqual({ ok: true, already: true });
  });

  it('is handed the same word when made a guest of the partner, and when leaving it themselves; a role change that takes no shared channel away carries none', async () => {
    const { acme, globex, design, local, conn } = await sharedPair();
    // Dave, a member of Globex, joins #design on Acme through Globex's entry.
    const j = await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/join`);
    expect((await as(dave).post('/api/connect/join', { conn, token: j.data.shared.token, profile: { name: 'Dave' } })).ok).toBe(true);
    const designOn = async () => (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.channels[design];
    expect(await designOn()).toMatchObject({ count: 4, connections: { [conn]: { count: 2 } } });
    // Made a guest of Globex: the entry leaves his sidebar there, and the answer carries the word for Acme.
    await new Promise((r) => setTimeout(r, 5)); // the word is signed after the vouching, by the clock as well
    const demoted = await as(alice).post(`/api/ws/${globex.wsId}/members/${dave.uuid}/role`, { role: 'guest' });
    expect(demoted.data.ok).toBe(true);
    expect(demoted.data.revocations).toHaveLength(1);
    expect(demoted.data.revocations[0]).toMatchObject({ ref: `${acme.wsId}@${SERVER}`, ch: design, conn });
    expect((await as(dave).get(`/api/ws/${globex.wsId}`)).data.me.channels).not.toContain(local);
    expect((await as(alice).post('/api/connect/revoke', { conn, token: demoted.data.revocations[0].token })).data).toEqual({ ok: true });
    expect((await as(dave).get(`/api/ws/${acme.wsId}`)).status).toBe(403);
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.members[dave.uuid]).toBeUndefined();
    expect(await designOn()).toMatchObject({ count: 3, connections: { [conn]: { count: 1 } } });
    // Bob, untouched, keeps his seat; making dave a member again takes no channel away and carries no word.
    expect((await as(bob).get(`/api/ws/${acme.wsId}`)).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${dave.uuid}/role`, { role: 'member' })).data).toEqual({ ok: true });
    // Someone leaving Globex themselves is handed the word for their own app to carry.
    await new Promise((r) => setTimeout(r, 5));
    const self = await as(bob).del(`/api/ws/${globex.wsId}/members/${bob.uuid}`);
    expect(self.data.ok).toBe(true);
    expect(self.data.revocations).toHaveLength(1);
    expect((await as(bob).post('/api/connect/revoke', { conn, token: self.data.revocations[0].token })).data).toEqual({ ok: true });
    expect(await designOn()).toMatchObject({ count: 2, connections: { [conn]: { count: 0 } } });
    // Removing a member who holds no seat anywhere carries no word.
    expect((await as(alice).del(`/api/ws/${globex.wsId}/members/${dave.uuid}`)).data).toEqual({ ok: true });
  });

  it('keeps the seat of someone in the channel through two workspaces while the other still vouches for them, as a disconnect does', async () => {
    const { acme, globex, design, local, conn, code } = await sharedPair();
    // Dave, a member of Globex and of Initech, both connected to #design: in through Globex first...
    const j = await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/join`);
    expect((await as(dave).post('/api/connect/join', { conn, token: j.data.shared.token, profile: { name: 'Dave' } })).ok).toBe(true);
    const initech = await workspaceWith(alice, [dave], 'Initech');
    const acc2 = await as(alice).post('/api/connect/accept', { code, partner: { ref: `${initech.wsId}@${SERVER}`, name: 'Initech' }, profile: { name: 'Alice' } });
    expect(acc2.ok).toBe(true);
    const conn2 = acc2.data.conn;
    const added = await as(alice).post(`/api/ws/${initech.wsId}/channels/shared`, { ref: `${acme.wsId}@${SERVER}`, ch: design, conn: conn2, secret: acc2.data.secret, name: 'design-with-acme', host: 'Acme' });
    const local2 = added.data.channel.id;
    // ...then vouched for through Initech as well: his card names Initech now.
    await new Promise((r) => setTimeout(r, 5));
    const j2 = await as(dave).post(`/api/ws/${initech.wsId}/channels/${local2}/join`);
    expect((await as(dave).post('/api/connect/join', { conn: conn2, token: j2.data.shared.token, profile: { name: 'Dave' } })).ok).toBe(true);
    const designOn = async () => (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace;
    expect((await designOn()).members[dave.uuid]).toMatchObject({ role: 'external', org: { name: 'Initech', ref: `${initech.wsId}@${SERVER}` } });
    const count = (await designOn()).channels[design].count;
    // Globex removes him: Initech still stands behind him, and Globex's word leaves him to it.
    await new Promise((r) => setTimeout(r, 5));
    const fromGlobex = await as(alice).del(`/api/ws/${globex.wsId}/members/${dave.uuid}`);
    expect(fromGlobex.data.revocations).toHaveLength(1);
    expect((await as(alice).post('/api/connect/revoke', { conn, token: fromGlobex.data.revocations[0].token })).data).toEqual({ ok: true, already: true });
    expect((await as(dave).get(`/api/ws/${acme.wsId}`)).ok).toBe(true);
    expect((await designOn()).channels[design].count).toBe(count);
    // Initech, the workspace his card names, removes him: the seat ends.
    await new Promise((r) => setTimeout(r, 5));
    const fromInitech = await as(alice).del(`/api/ws/${initech.wsId}/members/${dave.uuid}`);
    expect(fromInitech.data.revocations).toHaveLength(1);
    expect((await as(alice).post('/api/connect/revoke', { conn: conn2, token: fromInitech.data.revocations[0].token })).data).toEqual({ ok: true });
    expect((await as(dave).get(`/api/ws/${acme.wsId}`)).status).toBe(403);
    expect((await designOn()).members[dave.uuid]).toBeUndefined();
    expect((await designOn()).channels[design].count).toBe(count - 1);
    // Bob, in through Globex alone, is still let go of on Globex's word.
    await new Promise((r) => setTimeout(r, 5));
    const bobOut = await as(bob).del(`/api/ws/${globex.wsId}/members/${bob.uuid}`);
    expect((await as(bob).post('/api/connect/revoke', { conn, token: bobOut.data.revocations[0].token })).data).toEqual({ ok: true });
    expect((await designOn()).members[bob.uuid]).toBeUndefined();
  });
});

describe('a store that answers a write to a member document with the part that changed, or the list alone, rather than the document', () => {
  /** Member-document writes answer with the changed part alone (`update`) and with what `add` appended, shaped as `shape` says. */
  function partialAnswers(shape) {
    const isMemberDoc = (k) => /^tc:ws:[a-z0-9]+:u:[^:]+$/.test(k);
    const realAdd = rt.kv.add.bind(rt.kv);
    const realUpdate = rt.kv.update.bind(rt.kv);
    rt.kv.add = async (k, v) => {
      const doc = await realAdd(k, v);
      if (!isMemberDoc(k) || !v?.channels) return doc;
      return shape === 'list' ? doc.channels : { channels: doc.channels };
    };
    rt.kv.update = async (k, patch) => {
      const doc = await realUpdate(k, patch);
      return isMemberDoc(k) ? JSON.parse(JSON.stringify(patch)) : doc;
    };
    return () => { rt.kv.add = realAdd; rt.kv.update = realUpdate; };
  }

  for (const shape of ['part', 'list']) {
    it(`does not have a channel join delete the joiner's document, still tells a second join apart, and still counts a removed member out (${shape})`, async () => {
      const { wsId, general } = await workspaceWith(alice, [bob]);
      const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel;
      await as(bob).post(`/api/ws/${wsId}/dms`, { members: [alice.uuid] });
      const before = await rt.kv.get(KEYS.member(wsId, bob.uuid));
      expect(Object.keys(before.dms)).toHaveLength(1);
      const restore = partialAnswers(shape);
      try {
        // The join used to read the answer as bob's document with nothing of his on it, delete the document, and refuse him.
        expect((await as(bob).post(`/api/ws/${wsId}/channels/${ops.id}/join`)).data).toEqual({ ok: true });
        const after = await rt.kv.get(KEYS.member(wsId, bob.uuid));
        expect(after.joinedAt).toBe(before.joinedAt);
        expect(Object.keys(after.dms)).toEqual(Object.keys(before.dms));
        expect(after.channels).toEqual([...before.channels, ops.id]);
        expect((await rt.kv.get(KEYS.ws(wsId))).channels[ops.id].count).toBe(2);
        // A second join is told apart from the first, and the channel stays on the document once.
        expect((await as(bob).post(`/api/ws/${wsId}/channels/${ops.id}/join`)).data).toEqual({ ok: true, already: true });
        expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).channels.filter((c) => c === ops.id)).toEqual([ops.id]);
        expect((await rt.kv.get(KEYS.ws(wsId))).channels[ops.id].count).toBe(2);
        // Adding someone likewise, and a guest counted as one.
        const inv = (await as(alice).post(`/api/ws/${wsId}/channels/${ops.id}/invites`, {})).data;
        expect((await as(carol).post('/api/join', { code: inv.code })).data.guest).toBe(true);
        const more = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'more' })).data.channel;
        expect((await as(alice).post(`/api/ws/${wsId}/channels/${more.id}/members`, { uuids: [carol.uuid] })).data.added).toEqual([carol.uuid]);
        expect((await rt.kv.get(KEYS.ws(wsId))).channels[more.id]).toMatchObject({ count: 2, guests: 1 });
        // Removing bob counts him out of every channel he was in: the closing stamp's answer, the stamp alone, is not counted from.
        expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).data).toEqual({ ok: true });
        const ws = await rt.kv.get(KEYS.ws(wsId));
        expect(ws.channels[ops.id]).toMatchObject({ count: 2, guests: 1 }); // alice and carol the guest stay
        expect(ws.channels[general.id].count).toBe(1);
        expect(await rt.kv.get(KEYS.member(wsId, bob.uuid))).toBeFalsy();
      } finally {
        restore();
      }
      // On a store that hands the document back, a document deleted while someone joins is still told apart, and taken off again.
      const gone = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'gone' })).data.channel;
      const realAdd = rt.kv.add.bind(rt.kv);
      rt.kv.add = async (k, v) => {
        if (k === KEYS.member(wsId, carol.uuid) && v?.channels) await rt.kv.del(k);
        return realAdd(k, v);
      };
      try {
        expect((await as(alice).post(`/api/ws/${wsId}/channels/${gone.id}/members`, { uuids: [carol.uuid] })).data.added).toEqual([]);
      } finally {
        rt.kv.add = realAdd;
      }
      expect(await rt.kv.get(KEYS.member(wsId, carol.uuid))).toBeFalsy();
      expect((await rt.kv.get(KEYS.ws(wsId))).channels[gone.id].count).toBe(1);
    });
  }
});
