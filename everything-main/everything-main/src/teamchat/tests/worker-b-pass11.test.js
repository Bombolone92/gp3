/**
 * Review pass 11, channels, shared channels, and the message plane: each
 * test here is a hole that was found in the worker's routes and closed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The pruning tests here post a few hundred messages each through the whole
// worker. Alone that is well under a second; under several test runs at once
// (six review gates on one machine) the same work took eight to eleven
// seconds and fell over the default five. Room, not a weaker check.
vi.setConfig({ testTimeout: 20_000 });
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS, threadConvId } from '../src/shared/blocks.js';
import { signAttestation, ATTEST_TTL_MS } from '../worker/connect.js';

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
const me = async (u, wsId) => (await as(u).get(`/api/ws/${wsId}`)).data.me;

describe('threads', () => {
  it('replying to a thread one had unfollowed follows it again on both records, so its replies are listed where they are counted', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const root = (await post(alice, wsId, general.id, 'root')).data.message;
    const tid = threadConvId(general.id, root.seq);
    expect((await post(bob, wsId, tid, 'first')).ok).toBe(true);
    // Bob opts out, then comes back to the thread with another reply.
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${tid}/notify`, { follow: false })).ok).toBe(true);
    const stamp = async () => (await rt.kv.get(KEYS.activity(wsId))).u?.[bob.uuid];
    const before = await stamp();
    expect((await post(bob, wsId, tid, 'second thoughts')).ok).toBe(true);
    // His other tabs are told their document changed: they draw the thread's
    // header and their Threads list from it, and it said otherwise.
    expect(await stamp()).not.toBe(before);
    // A reply while following is not that: nothing of theirs changed.
    const settled = await stamp();
    expect((await post(bob, wsId, tid, 'and another')).ok).toBe(true);
    expect(await stamp()).toBe(settled);
    expect((await post(alice, wsId, tid, 'welcome back')).ok).toBe(true);
    // Alice's reply is counted for bob as a follower's unread...
    const mine = await me(bob, wsId);
    expect(mine.threads[tid]).toBe(1);
    // ...so the thread must be on his list: the badge is the sum of these
    // counters, and a thread hidden as unfollowed left a badge nothing shown
    // could clear.
    expect(mine.notify[tid]?.follow).toBe(true);
    const list = await as(bob).get(`/api/ws/${wsId}/threads`);
    expect(list.data.threads.map((t) => t.id)).toContain(tid);
    expect(list.data.threads.find((t) => t.id === tid).unread).toBe(1);
  });

  it('lists every thread on the page with its root, however many channels the page spans', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    // A thread in each of sixteen channels: sixteen distinct blocks hold the roots.
    const tids = [];
    for (let i = 0; i < 16; i++) {
      const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: `room-${i}` })).data.channel;
      await as(bob).post(`/api/ws/${wsId}/channels/${ch.id}/join`);
      const root = (await post(alice, wsId, ch.id, `root ${i}`)).data.message;
      await post(bob, wsId, threadConvId(ch.id, root.seq), 'reply');
      tids.push(threadConvId(ch.id, root.seq));
    }
    const list = await as(bob).get(`/api/ws/${wsId}/threads`);
    expect(list.ok).toBe(true);
    expect(list.data.threads.map((t) => t.id).sort()).toEqual(tids.sort());
    // The card draws the root, and shows "Loading message" until it has
    // one: a root left out here was never going to arrive.
    expect(list.data.threads.filter((t) => !t.root)).toEqual([]);
  });

  it('zeroes the unread counter of a thread pruned off the list, as it does for one that can no longer be read', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const first = (await post(alice, wsId, general.id, 'oldest')).data.message;
    const oldest = threadConvId(general.id, first.seq);
    await post(bob, wsId, oldest, 'following');
    await post(alice, wsId, oldest, 'one for bob');
    expect((await me(bob, wsId)).threads[oldest]).toBe(1);
    // Three hundred newer threads bob is in push the oldest off the list he is shown.
    // Their activity must come later by the clock than the oldest's: the list
    // is ranked by the millisecond, and the in-memory worker answers several
    // requests within one, which left the oldest tied with the first of them
    // and, ties standing in insertion order, the first pruned instead.
    await new Promise((r) => setTimeout(r, 5));
    for (let i = 0; i < 300; i++) {
      const root = (await post(alice, wsId, general.id, `root ${i}`)).data.message;
      await post(bob, wsId, threadConvId(general.id, root.seq), 'here too');
    }
    const list = await as(bob).get(`/api/ws/${wsId}/threads`);
    expect(list.data.threads.map((t) => t.id)).not.toContain(oldest);
    // Pruned off the record itself, not merely past the page of sixty.
    expect(Object.keys((await rt.kv.get(KEYS.threads(wsId, bob.uuid))).t)).not.toContain(oldest);
    // The badge is the sum of these counters: one for a thread the list no
    // longer shows could not be cleared from it.
    expect((await me(bob, wsId)).threads[oldest] || 0).toBe(0);
  });
});

describe('deleting a channel', () => {
  const schedule = (u, wsId, conv, text) => as(u).post(`/api/ws/${wsId}/scheduled`, { conv, text, dueAt: Date.now() + 3_600_000 });

  it('takes what was waiting to be sent into it, and reminders about its messages, out of the queue', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const side = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'side' })).data.channel;
    await as(bob).post(`/api/ws/${wsId}/channels/${side.id}/join`);
    const root = (await post(alice, wsId, side.id, 'root')).data.message;
    expect((await schedule(alice, wsId, side.id, 'later, in side')).ok).toBe(true);
    expect((await schedule(bob, wsId, threadConvId(side.id, root.seq), 'later, in its thread')).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/reminders`, { conv: side.id, seq: root.seq, dueAt: Date.now() + 3_600_000 })).ok).toBe(true);
    const kept = (await schedule(bob, wsId, general.id, 'later, in general')).data.scheduled;
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${side.id}`)).ok).toBe(true);
    // Nothing of the channel's is left waiting: an entry for a conversation
    // that is gone showed in its author's list of scheduled messages until
    // its time, could not be sent now, and held room in the queue every
    // member's drafts share.
    const queue = await rt.kv.get(KEYS.sched(wsId));
    expect(Object.values(queue.m).map((e) => e.id)).toEqual([kept.id]);
    const mine = await as(bob).get(`/api/ws/${wsId}/scheduled`);
    expect(mine.data.scheduled.map((e) => e.id)).toEqual([kept.id]);
    expect(mine.data.reminders).toEqual([]);
    expect((await as(alice).get(`/api/ws/${wsId}/scheduled`)).data.scheduled).toEqual([]);
  });
});

describe('saved messages', () => {
  const save = (u, wsId, conv, seq, extra = {}) => as(u).post(`/api/ws/${wsId}/saved`, { conv, seq, ...extra });
  const savedDoc = async (wsId, u) => ((await rt.kv.get(KEYS.saved(wsId, u.uuid))) || { items: [] }).items;

  it('drops what was saved in a channel since deleted, and keeps what was saved in one merely left until they are back', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const side = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'side' })).data.channel;
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel;
    await as(bob).post(`/api/ws/${wsId}/channels/${side.id}/join`);
    await as(alice).post(`/api/ws/${wsId}/channels/${secret.id}/members`, { uuids: [bob.uuid] });
    const inSide = (await post(alice, wsId, side.id, 'in side')).data.message;
    const inSecret = (await post(alice, wsId, secret.id, 'in secret')).data.message;
    const inGeneral = (await post(alice, wsId, general.id, 'in general')).data.message;
    const sideRoot = (await post(alice, wsId, side.id, 'side root')).data.message;
    const inSideThread = (await post(alice, wsId, threadConvId(side.id, sideRoot.seq), 'in a thread of side')).data.message;
    for (const [c, m] of [[side.id, inSide], [secret.id, inSecret], [general.id, inGeneral], [threadConvId(side.id, sideRoot.seq), inSideThread]]) {
      expect((await save(bob, wsId, c, m.seq)).ok).toBe(true);
    }
    expect((await savedDoc(wsId, bob)).length).toBe(4);
    // Out of the private channel: its entry is hidden, and kept for their return.
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${secret.id}/leave`)).ok).toBe(true);
    let list = await as(bob).get(`/api/ws/${wsId}/saved`);
    expect(list.data.items.map((e) => e.message.text).sort()).toEqual(['in a thread of side', 'in general', 'in side']);
    expect((await savedDoc(wsId, bob)).length).toBe(4);
    // The channel deleted: its entries, the thread's with them, are gone from the record too.
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${side.id}`)).ok).toBe(true);
    list = await as(bob).get(`/api/ws/${wsId}/saved`);
    expect(list.data.items.map((e) => e.message.text)).toEqual(['in general']);
    expect((await savedDoc(wsId, bob)).map((e) => e.c).sort()).toEqual([general.id, secret.id].sort());
    // Back in the private channel, what they saved there is theirs again.
    await as(alice).post(`/api/ws/${wsId}/channels/${secret.id}/members`, { uuids: [bob.uuid] });
    list = await as(bob).get(`/api/ws/${wsId}/saved`);
    expect(list.data.items.map((e) => e.message.text).sort()).toEqual(['in general', 'in secret']);
  });

  it('lets an entry be removed once its conversation is gone, and takes nothing that is not a message', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const side = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'side' })).data.channel;
    await as(bob).post(`/api/ws/${wsId}/channels/${side.id}/join`);
    const m = (await post(alice, wsId, side.id, 'in side')).data.message;
    expect((await save(bob, wsId, side.id, m.seq)).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${side.id}`)).ok).toBe(true);
    // Removal is from one's own list and needs nothing of the conversation.
    const removed = await save(bob, wsId, side.id, m.seq, { remove: true });
    expect(removed.ok).toBe(true);
    expect(await savedDoc(wsId, bob)).toEqual([]);
    // A number nobody posted, a deleted message, or a conversation that is not there: none of them is kept.
    expect((await save(bob, wsId, general.id, 999)).status).toBe(404);
    const gone = (await post(alice, wsId, general.id, 'soon deleted')).data.message;
    await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${gone.seq}`);
    expect((await save(bob, wsId, general.id, gone.seq)).status).toBe(404);
    expect((await save(bob, wsId, 'nosuchconv', 1)).status).toBe(404);
    expect(await savedDoc(wsId, bob)).toEqual([]);
    // A message that stands is.
    const live = (await post(alice, wsId, general.id, 'keep this')).data.message;
    expect((await save(bob, wsId, general.id, live.seq)).ok).toBe(true);
    expect((await savedDoc(wsId, bob)).length).toBe(1);
  });
});

/**
 * Acme (alice, carol) hosts #design; Globex (alice owns it too, bob is its
 * admin, dave a member) accepts the share link and records the connection.
 */
async function shared() {
  const acme = await workspaceWith(alice, [carol], 'Acme');
  const globex = await workspaceWith(alice, [bob, dave], 'Globex');
  expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
  const design = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'design' })).data.channel.id;
  const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/connect/invites`, {});
  const acc = await as(bob).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' } });
  expect(acc.ok).toBe(true);
  const added = await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, {
    ref: `${acme.wsId}@${SERVER}`, ch: design, conn: acc.data.conn, secret: acc.data.secret, name: 'design-with-acme', host: 'Acme',
  });
  expect(added.ok).toBe(true);
  return { acme, globex, design, local: added.data.channel.id, conn: acc.data.conn, secret: acc.data.secret };
}

/** A token signed with the connection's secret but with a payload of the signer's choosing, as a partner's worker of its own making could sign. */
async function forge(secret, payload) {
  const text = JSON.stringify(payload);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.${sig}`;
}

describe('attestations from a partner', () => {
  it('are good for their few minutes and no longer, whatever expiry the signer wrote into them', async () => {
    const { acme, design, conn, secret } = await shared();
    const now = Date.now();
    // A genuine one, exactly as the partner's worker signs it.
    const good = await signAttestation(secret, { conn, uuid: dave.uuid, kind: 'join' });
    // One a partner worker of its own making could sign: dated now, valid
    // for a year. Someone Globex removes tomorrow would hold the shared
    // channel on Acme until then, with nobody vouching for them.
    const longLived = await forge(secret, { c: conn, u: dave.uuid, k: 'join', iat: now, exp: now + 365 * 86400_000 });
    const overByAMinute = await forge(secret, { c: conn, u: dave.uuid, k: 'join', iat: now, exp: now + ATTEST_TTL_MS + 60_000 });
    for (const token of [longLived, overByAMinute]) {
      const refused = await as(dave).post('/api/connect/join', { conn, token, profile: { name: 'Dave' } });
      expect(refused.status).toBe(401);
      expect(refused.data.code).toBe('bad_attestation');
    }
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.members[dave.uuid]).toBeUndefined();
    const ok = await as(dave).post('/api/connect/join', { conn, token: good, profile: { name: 'Dave' } });
    expect(ok.ok).toBe(true);
    expect(ok.data.channel).toBe(design);
  });
});

describe('leaving a channel', () => {
  it('gives up one\'s seat in its huddle and one\'s typing there at once, and nothing of one\'s standing elsewhere', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const side = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'side' })).data.channel;
    await as(bob).post(`/api/ws/${wsId}/channels/${side.id}/join`);
    const root = (await post(alice, wsId, side.id, 'root')).data.message;
    const tid = threadConvId(side.id, root.seq);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${side.id}/huddle`, { invite: 'peer-bob-1', sid: 'tab1' })).ok).toBe(true);
    for (const conv of [side.id, tid, general.id]) expect((await as(bob).post(`/api/ws/${wsId}/conv/${conv}/typing`, {})).ok).toBe(true);
    await rt.kv.update(KEYS.activity(wsId), { [`p.${bob.uuid}`]: Date.now() });
    let act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.h[side.id].m[bob.uuid]).toBeTruthy();
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${side.id}/leave`)).ok).toBe(true);
    act = await rt.kv.get(KEYS.activity(wsId));
    // The seat used to stand for a minute and a half: the roster named
    // someone gone, every tab in the call went on dialling their peer, and a
    // huddle they were alone in stayed "in progress" with nobody in it.
    expect(act.h[side.id]?.m?.[bob.uuid]).toBeUndefined();
    expect(act.t[side.id]?.[bob.uuid]).toBeUndefined();
    expect(act.t[tid]?.[bob.uuid]).toBeUndefined();
    // Still a member of the workspace, typing in #general, with a heartbeat.
    expect(act.t[general.id][bob.uuid]).toBeTruthy();
    expect(act.p[bob.uuid]).toBeTruthy();
  });
});

describe('opening a direct message from both sides at once', () => {
  it('keeps the first message when the slower request comes to create a conversation the other already opened and posted into', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const kv = rt.kv;
    const origGet = kv.get.bind(kv);
    let release;
    const gate = new Promise((r) => { release = r; });
    let held = false;
    // Bob's request has read alice's document (no conversation yet) and is
    // held there; alice's goes through in the meantime.
    kv.get = async (k) => {
      const v = await origGet(k);
      if (k === KEYS.member(wsId, alice.uuid) && !held) {
        held = true;
        await gate;
      }
      return v;
    };
    try {
      const slow = as(bob).post(`/api/ws/${wsId}/dms`, { members: [alice.uuid] });
      while (!held) await new Promise((r) => setTimeout(r, 0));
      kv.get = origGet;
      const fast = await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] });
      expect(fast.ok).toBe(true);
      const dm = fast.data.conv;
      expect((await post(alice, wsId, dm, 'hi')).ok).toBe(true);
      release();
      const late = await slow;
      expect(late.ok).toBe(true);
      expect(late.data.conv).toBe(dm);
      // The slower request found the same conversation; what was said in it
      // before it arrived is still there, and the counter still counts it.
      const page = await as(bob).get(`/api/ws/${wsId}/conv/${dm}/messages`);
      expect(page.data.messages.map((m) => m.text)).toEqual(['hi']);
      expect(page.data.seq).toBe(1);
    } finally {
      kv.get = origGet;
    }
  });
});
