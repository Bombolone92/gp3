/**
 * Identity, membership, notification and invite routes: what the thirteenth
 * review pass found.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS, threadConvId } from '../src/shared/blocks.js';

const { alice, bob, carol, dave } = USERS;
const SERVER = 'teamchat-api.test';
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

const mdoc = (wsId, u) => rt.kv.get(KEYS.member(wsId, u));
const latest = async (conv) => Number(await rt.kv.get(KEYS.seq(conv))) || 0;

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

describe('a mention counted for someone before they entered the channel', () => {
  async function mentionedOutside(text = 'hey @bob, come over') {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'design' })).data.channel.id;
    const p = await as(alice).post(`/api/ws/${wsId}/conv/${ch}/messages`, { text });
    expect(p.data.notified).toBe(1);
    // A public channel's messages are bob's to read, so the mention counts and lands in his Activity.
    expect((await mdoc(wsId, bob.uuid)).mentions[ch]).toBe(1);
    expect((await as(bob).get(`/api/ws/${wsId}/inbox`)).data.items.map((e) => e.k)).toEqual(['mention']);
    return { wsId, ch };
  }

  /** Caught up at the channel's present and carrying no mention badge over it. */
  async function caughtUp(wsId, ch, at) {
    const doc = await mdoc(wsId, bob.uuid);
    expect(doc.channels).toContain(ch);
    expect(doc.reads[ch]).toBe(at);
    expect(doc.mentions[ch]).toBe(0);
    // Activity keeps the entry: it is a log of what happened, not a badge.
    expect((await as(bob).get(`/api/ws/${wsId}/inbox`)).data.items.map((e) => e.k)).toEqual(['mention']);
  }

  it('is not a badge when they join the channel themselves', async () => {
    const { wsId, ch } = await mentionedOutside();
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`)).ok).toBe(true);
    await caughtUp(wsId, ch, await latest(ch));
  });

  it('is not a badge when someone adds them', async () => {
    const { wsId, ch } = await mentionedOutside("let's add @bob");
    const before = await latest(ch);
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${ch}/members`, { uuids: [bob.uuid] })).data.added).toEqual([bob.uuid]);
    // The "added" line is news to them and stays unread, as before; the mention behind their cursor is not.
    await caughtUp(wsId, ch, before);
  });

  it('is not a badge when they come in through the channel\'s guest link', async () => {
    const { wsId, ch } = await mentionedOutside();
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${ch}/invites`, {});
    const j = await as(bob).post('/api/join', { code: inv.data.code });
    expect(j.data.joined).toBe(true);
    await caughtUp(wsId, ch, await latest(ch));
  });

  it('is not a badge when they rejoin a channel they left with mentions unread in it', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'design' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`)).ok).toBe(true);
    await as(alice).post(`/api/ws/${wsId}/conv/${ch}/messages`, { text: '@bob one' });
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/leave`)).ok).toBe(true);
    await as(alice).post(`/api/ws/${wsId}/conv/${ch}/messages`, { text: '@bob two, while away' });
    expect((await mdoc(wsId, bob.uuid)).mentions[ch]).toBe(2);
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`)).ok).toBe(true);
    const doc = await mdoc(wsId, bob.uuid);
    expect(doc.reads[ch]).toBe(await latest(ch));
    expect(doc.mentions[ch]).toBe(0);
  });

  it('is not a badge for a member of both workspaces entering the shared channel from the partner side', async () => {
    // Acme (alice, bob) hosts #design, which bob is not in; Globex (alice, bob admin, dave) is the partner.
    const acme = await workspaceWith(alice, [bob], 'Acme');
    const globex = await workspaceWith(alice, [bob, dave], 'Globex');
    expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const design = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'design' })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/connect/invites`, { inviteTtl: '7d' });
    const acc = await as(bob).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' }, profile: { name: 'Bob B.' } });
    expect(acc.ok).toBe(true);
    const local = (await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, {
      ref: `${acme.wsId}@${SERVER}`, ch: design, conn: acc.data.conn, secret: acc.data.secret, name: 'design-with-acme', host: 'Acme',
    })).data.channel.id;
    // Named on the host before he is in the channel there.
    expect((await as(alice).post(`/api/ws/${acme.wsId}/conv/${design}/messages`, { text: '@bob, the Globex side of this' })).data.notified).toBe(1);
    expect((await mdoc(acme.wsId, bob.uuid)).mentions[design]).toBe(1);
    // He joins from Globex: the entry there, then the channel on Acme with the attestation.
    const j = await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/join`);
    expect(j.ok).toBe(true);
    const cj = await as(bob).post('/api/connect/join', { conn: j.data.shared.conn, token: j.data.shared.token, profile: { name: 'Bob B.' } });
    expect(cj.ok && cj.data.member).toBe(true);
    const doc = await mdoc(acme.wsId, bob.uuid);
    expect(doc.channels).toContain(design);
    expect(doc.reads[design]).toBe(await latest(design));
    expect(doc.mentions[design]).toBe(0);
    // Not a member of the host: a plain "joined" line, and the workspace is still theirs as it was.
    expect((await rt.kv.get(KEYS.ws(acme.wsId))).members[bob.uuid].role).toBe('member');
  });

  it('writes nothing for someone who carried no count, and leaves a count in another channel alone', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'design' })).data.channel.id;
    await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: '@bob in general' });
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`)).ok).toBe(true);
    const doc = await mdoc(wsId, bob.uuid);
    expect(doc.mentions).toEqual({ [general.id]: 1 });
    expect(Object.hasOwn(doc.mentions, ch)).toBe(false);
  });
});

describe('a file two scheduled messages waited with', () => {
  const MIN = 60_000;
  async function upload(u, wsId, name = 'a.txt') {
    const fd = new FormData();
    fd.append('file', new Blob(['hello'], { type: 'text/plain' }), name);
    const r = await as(u).post(`/api/ws/${wsId}/files`, fd);
    expect(r.ok).toBe(true);
    return r.data.id;
  }
  const schedule = async (u, wsId, conv, ids) => (await as(u).post(`/api/ws/${wsId}/scheduled`, { conv, text: 'later', attachments: ids.map((id) => ({ id })), dueAt: Date.now() + 5 * MIN })).data.scheduled.id;
  const due = async (wsId, id) => {
    await rt.kv.update(KEYS.sched(wsId), { [`m.${id}.dueAt`]: Date.now() - 1 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
  };
  async function twoRefused() {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'temp' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`)).ok).toBe(true);
    const shared = await upload(bob, wsId, 'shared.txt');
    const kept = await upload(bob, wsId, 'kept.txt');
    const a = await schedule(bob, wsId, ch, [shared]);
    const b = await schedule(bob, wsId, ch, [shared, kept]);
    // A third, not due, goes on waiting with the second file.
    const c = await schedule(bob, wsId, ch, [kept]);
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ch}`, { archived: true })).ok).toBe(true);
    await due(wsId, a);
    await due(wsId, b);
    return { wsId, shared, kept, a, b, c };
  }
  const there = (wsId, id) => rt.fs._files.has(`teamchat-files/${wsId}/${id}`);

  it('stays while both wait marked as not sent, refused by two polls at once, and leaves the owner\'s drive with the last of them deleted', async () => {
    const { wsId, shared, kept, a, b, c } = await twoRefused();
    const polls = await Promise.all([as(alice).get(`/api/ws/${wsId}/sync?since=0`), as(bob).get(`/api/ws/${wsId}/sync?since=0`)]);
    expect(polls.every((p) => p.ok)).toBe(true);
    const queue = (await rt.kv.get(KEYS.sched(wsId))).m;
    expect(queue[a].failed.code).toBe('archived');
    expect(queue[b].failed.code).toBe('archived');
    expect(queue[c].failed).toBeUndefined();
    expect(there(wsId, shared)).toBe(true);
    expect((await as(bob).del(`/api/ws/${wsId}/scheduled/${a}`)).ok).toBe(true);
    expect(there(wsId, shared)).toBe(true); // the other still waits with it
    expect((await as(bob).del(`/api/ws/${wsId}/scheduled/${b}`)).ok).toBe(true);
    expect(await rt.kv.get(KEYS.file(shared))).toBeFalsy();
    expect(there(wsId, shared)).toBe(false);
    // Still waited with by the third entry.
    expect(await rt.kv.get(KEYS.file(kept))).toBeTruthy();
    expect(there(wsId, kept)).toBe(true);
  });

  it('goes the same way when one poll refuses both', async () => {
    const { wsId, shared, kept, a, b } = await twoRefused();
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect(there(wsId, shared)).toBe(true);
    for (const id of [a, b]) expect((await as(bob).del(`/api/ws/${wsId}/scheduled/${id}`)).ok).toBe(true);
    expect(there(wsId, shared)).toBe(false);
    expect(there(wsId, kept)).toBe(true);
  });
});

describe('a scheduled message refused at its time', () => {
  const MIN = 60_000;
  async function upload(u, wsId, name = 'a.txt') {
    const fd = new FormData();
    fd.append('file', new Blob(['hello'], { type: 'text/plain' }), name);
    const r = await as(u).post(`/api/ws/${wsId}/files`, fd);
    expect(r.ok).toBe(true);
    return r.data.id;
  }
  const due = async (wsId, id, at = Date.now() - 1) => {
    await rt.kv.update(KEYS.sched(wsId), { [`m.${id}.dueAt`]: at });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
  };
  const poll = (wsId) => as(alice).get(`/api/ws/${wsId}/sync?since=0`);
  const queueOf = async (wsId) => (await rt.kv.get(KEYS.sched(wsId))).m;
  const texts = async (wsId, ch) => (await as(alice).get(`/api/ws/${wsId}/conv/${ch}/messages`)).data.messages.map((m) => m.text);
  const there = (wsId, id) => rt.fs._files.has(`teamchat-files/${wsId}/${id}`);

  async function archivedRefusal() {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'temp' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`)).ok).toBe(true);
    const file = await upload(bob, wsId, 'draft.txt');
    const id = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: ch, text: 'the words', attachments: [{ id: file }], dueAt: Date.now() + 5 * MIN })).data.scheduled.id;
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ch}`, { archived: true })).ok).toBe(true);
    await due(wsId, id);
    expect((await poll(wsId)).ok).toBe(true);
    return { wsId, ch, file, id };
  }

  it('stays in the queue marked with the reason, its words and file kept, and is not tried again on its own', async () => {
    const { wsId, ch, file, id } = await archivedRefusal();
    const e = (await queueOf(wsId))[id];
    expect(e).toMatchObject({ text: 'the words', failed: { code: 'archived', message: 'This channel is archived' } });
    expect(e.failed.at).toBeGreaterThan(0);
    expect(e.claims).toBeUndefined();
    expect(await rt.kv.get(KEYS.file(file))).toBeTruthy();
    expect(there(wsId, file)).toBe(true);
    // Listed to its author with the mark, counted among their scheduled messages; nothing is due for the poll.
    const list = (await as(bob).get(`/api/ws/${wsId}/scheduled`)).data.scheduled;
    expect(list.map((s) => [s.id, s.failed.code])).toEqual([[id, 'archived']]);
    expect((await rt.kv.get(KEYS.activity(wsId))).nd).toBeUndefined();
    // A poll made to look again leaves it, even with the channel open again: it is the author's to send.
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ch}`, { archived: false })).ok).toBe(true);
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
    expect((await poll(wsId)).ok).toBe(true);
    expect((await queueOf(wsId))[id].failed.code).toBe('archived');
    expect(await texts(wsId, ch)).not.toContain('the words');
  });

  it('is due again once edited or moved, the mark cleared, and goes out when the channel takes it, held by the message it became', async () => {
    const { wsId, ch, file, id } = await archivedRefusal();
    // Moved to a new time: the mark goes, and the poll's next due time is that time.
    const at = Date.now() + 5 * MIN;
    expect((await as(bob).put(`/api/ws/${wsId}/scheduled/${id}`, { dueAt: at })).ok).toBe(true);
    let e = (await queueOf(wsId))[id];
    expect(e.failed).toBeUndefined();
    expect(e.dueAt).toBe(at);
    expect((await rt.kv.get(KEYS.activity(wsId))).nd).toBe(at);
    // Due while the channel is still archived: refused again, marked again, the edit kept.
    expect((await as(bob).put(`/api/ws/${wsId}/scheduled/${id}`, { text: 'the words, edited' })).ok).toBe(true);
    await due(wsId, id);
    expect((await poll(wsId)).ok).toBe(true);
    e = (await queueOf(wsId))[id];
    expect(e.failed.code).toBe('archived');
    expect(e.text).toBe('the words, edited');
    // The channel open again and the message edited: the next poll sends the new words.
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ch}`, { archived: false })).ok).toBe(true);
    expect((await as(bob).put(`/api/ws/${wsId}/scheduled/${id}`, { text: 'the words, sent' })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.activity(wsId))).nd).toBeLessThanOrEqual(Date.now());
    expect((await poll(wsId)).ok).toBe(true);
    expect((await queueOf(wsId))[id]).toBeUndefined();
    expect(await texts(wsId, ch)).toContain('the words, sent');
    expect((await rt.kv.get(KEYS.file(file))).refs).toBe(1);
    expect(there(wsId, file)).toBe(true);
  });

  it('is tried at once by "Send now": marked again with the refusal it is answered with, and gone once it goes', async () => {
    const { wsId, ch, id } = await archivedRefusal();
    const before = (await queueOf(wsId))[id].failed.at;
    await new Promise((r) => setTimeout(r, 3));
    const again = await as(bob).put(`/api/ws/${wsId}/scheduled/${id}`, { sendNow: true });
    expect(again.status).toBe(403);
    expect(again.data.code).toBe('archived');
    const e = (await queueOf(wsId))[id];
    expect(e.failed.code).toBe('archived');
    expect(e.failed.at).toBeGreaterThan(before);
    expect(e.claims).toBeUndefined();
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ch}`, { archived: false })).ok).toBe(true);
    const sent = await as(bob).put(`/api/ws/${wsId}/scheduled/${id}`, { sendNow: true });
    expect(sent.data).toEqual({ ok: true, sent: true });
    expect((await queueOf(wsId))[id]).toBeUndefined();
    expect(await texts(wsId, ch)).toContain('the words');
  });

  it('lets its file go when deleted', async () => {
    const { wsId, file, id } = await archivedRefusal();
    expect((await as(bob).del(`/api/ws/${wsId}/scheduled/${id}`)).ok).toBe(true);
    expect(await rt.kv.get(KEYS.file(file))).toBeFalsy();
    expect(there(wsId, file)).toBe(false);
  });

  it('is kept twenty at a time per member: the oldest goes, with its file, when another fails', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'temp' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`)).ok).toBe(true);
    const oldest = await upload(bob, wsId, 'oldest.txt');
    const ids = [];
    for (let i = 0; i < 21; i++) {
      const r = await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: ch, text: `m${i}`, attachments: i === 0 ? [{ id: oldest }] : [], dueAt: Date.now() + 5 * MIN + i * 1000 });
      ids.push(r.data.scheduled.id);
    }
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ch}`, { archived: true })).ok).toBe(true);
    for (let i = 0; i < 21; i++) await due(wsId, ids[i], Date.now() - 60_000 + i * 100);
    expect((await poll(wsId)).ok).toBe(true);
    const q = await queueOf(wsId);
    expect(Object.keys(q)).toHaveLength(20);
    expect(q[ids[0]]).toBeUndefined();
    for (const id of ids.slice(1)) expect(q[id].failed.code).toBe('archived');
    expect(await rt.kv.get(KEYS.file(oldest))).toBeFalsy();
    expect(there(wsId, oldest)).toBe(false);
    // "Send now" on one of them, refused: marked again, and the count holds.
    expect((await as(bob).put(`/api/ws/${wsId}/scheduled/${ids[20]}`, { sendNow: true })).status).toBe(403);
    const q2 = await queueOf(wsId);
    expect(Object.keys(q2)).toHaveLength(20);
    expect(q2[ids[1]]).toBeTruthy();
  });

  it('waits, marked, for someone from a connected workspace whose standing has run out, as a live post refuses them', async () => {
    const { acme, design } = await shared();
    const id = (await as(bob).post(`/api/ws/${acme.wsId}/scheduled`, { conv: design, text: 'from Globex, later', dueAt: Date.now() + 5 * MIN })).data.scheduled.id;
    await rt.kv.update(KEYS.ws(acme.wsId), { [`members.${bob.uuid}.exp`]: Date.now() - 1 });
    await due(acme.wsId, id);
    expect((await poll(acme.wsId)).ok).toBe(true);
    const e = (await queueOf(acme.wsId))[id];
    expect(e.failed.code).toBe('reattest');
    expect(e.text).toBe('from Globex, later');
    expect(await texts(acme.wsId, design)).not.toContain('from Globex, later');
  });
});

describe('someone from a connected workspace whose standing here ran out long ago', () => {
  const DAY = 86400_000;

  it('is let go of by the host on a bootstrap, counted out and remembered by name, while one lapsed for a day is kept', async () => {
    const { acme, globex, design, local, conn } = await shared();
    // Dave in too, then made a guest on Globex: his standing on Acme is never renewed.
    const j = await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/join`);
    expect((await as(dave).post('/api/connect/join', { conn, token: j.data.shared.token, profile: { name: 'Dave' } })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${dave.uuid}/role`, { role: 'guest' })).ok).toBe(true);
    let ws = await rt.kv.get(KEYS.ws(acme.wsId));
    expect(ws.channels[design].count).toBe(4);
    expect(ws.channels[design].connections[conn].count).toBe(2);
    // Days past: shut out, kept (his workspace may vouch again).
    await rt.kv.update(KEYS.ws(acme.wsId), { [`members.${dave.uuid}.exp`]: Date.now() - DAY, [`members.${bob.uuid}.exp`]: Date.now() - 2 * DAY });
    let boot = await as(alice).get(`/api/ws/${acme.wsId}`);
    expect(boot.data.workspace.members[dave.uuid]).toBeTruthy();
    expect(boot.data.workspace.channels[design].count).toBe(4);
    // A month past: gone, and the channel says who is left.
    await rt.kv.update(KEYS.ws(acme.wsId), { [`members.${dave.uuid}.exp`]: Date.now() - 31 * DAY });
    boot = await as(alice).get(`/api/ws/${acme.wsId}`);
    expect(boot.ok).toBe(true);
    expect(boot.data.workspace.members[dave.uuid]).toBeUndefined();
    expect(boot.data.workspace.members[bob.uuid]).toBeTruthy();
    expect(boot.data.workspace.channels[design].count).toBe(3);
    expect(boot.data.workspace.channels[design].connections[conn].count).toBe(1);
    expect(boot.data.workspace.former[dave.uuid]).toMatchObject({ name: 'Dave', org: { name: 'Globex' } });
    ws = await rt.kv.get(KEYS.ws(acme.wsId));
    expect(ws.members[dave.uuid]).toBeUndefined();
    expect(await rt.kv.get(KEYS.member(acme.wsId, dave.uuid))).toBeFalsy();
    expect((await rt.kv.get(KEYS.user(dave.uuid))).workspaces).not.toContain(acme.wsId);
    // Nothing more comes off on the next bootstrap.
    const again = await as(alice).get(`/api/ws/${acme.wsId}`);
    expect(again.data.workspace.channels[design].count).toBe(3);
    expect(again.data.workspace.channels[design].connections[conn].count).toBe(1);
  });

  it('is counted out once when two bootstraps find the card together, and comes back through a fresh attestation', async () => {
    const { acme, globex, design, local, conn } = await shared();
    await rt.kv.update(KEYS.ws(acme.wsId), { [`members.${bob.uuid}.exp`]: Date.now() - 40 * DAY });
    const boots = await Promise.all([as(alice).get(`/api/ws/${acme.wsId}`), as(carol).get(`/api/ws/${acme.wsId}`)]);
    expect(boots.every((b) => b.ok)).toBe(true);
    const ws = await rt.kv.get(KEYS.ws(acme.wsId));
    expect(ws.members[bob.uuid]).toBeUndefined();
    expect(ws.channels[design].count).toBe(2);
    expect(ws.channels[design].connections[conn].count).toBe(0);
    expect(ws.former[bob.uuid]).toMatchObject({ name: 'Bob B.' });
    // Bob's workspace vouches for him again: in as he first came, counted once.
    const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
    expect((await as(bob).post('/api/connect/join', { conn: att.data.conn, token: att.data.token, profile: { name: 'Bob B.' } })).ok).toBe(true);
    const after = await rt.kv.get(KEYS.ws(acme.wsId));
    expect(after.members[bob.uuid].role).toBe('external');
    expect(after.channels[design].count).toBe(3);
    expect(after.channels[design].connections[conn].count).toBe(1);
    expect(after.former?.[bob.uuid]).toBeUndefined();
  });

  it('is left alone on a copy that moved', async () => {
    const { acme, design, conn } = await shared();
    await rt.kv.update(KEYS.ws(acme.wsId), { [`members.${bob.uuid}.exp`]: Date.now() - 40 * DAY, movedTo: `zzzzzzzzzz@${SERVER}` });
    const boot = await as(alice).get(`/api/ws/${acme.wsId}`);
    expect(boot.ok).toBe(true);
    expect(boot.data.workspace.members[bob.uuid]).toBeTruthy();
    expect(boot.data.workspace.channels[design].connections[conn].count).toBe(1);
  });
});

describe('an admin trying to remove the owner', () => {
  it('is told the owner cannot be removed, not what the owner is told about leaving', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const r = await as(bob).del(`/api/ws/${wsId}/members/${alice.uuid}`);
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/cannot be removed/);
    expect(r.data.message).not.toMatch(/leave|delete the workspace/);
    const own = await as(alice).del(`/api/ws/${wsId}/members/${alice.uuid}`);
    expect(own.status).toBe(400);
    expect(own.data.message).toMatch(/cannot leave; delete the workspace/);
    expect((await rt.kv.get(KEYS.ws(wsId))).members[alice.uuid].role).toBe('owner');
  });
});

describe('a member\'s document', () => {
  const size = (d) => JSON.stringify(d).length;

  it('lets go of what it kept for a channel deleted since, and tells the member\'s other tabs when a reply count went with it', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'x' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`)).ok).toBe(true);
    const root = (await as(bob).post(`/api/ws/${wsId}/conv/${ch}/messages`, { text: 'root' })).data.message.seq;
    const tid = threadConvId(ch, root);
    await as(alice).post(`/api/ws/${wsId}/conv/${tid}/messages`, { text: 'reply, unread' });
    await as(alice).post(`/api/ws/${wsId}/conv/${ch}/messages`, { text: '@bob hi' });
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${ch}/notify`, { level: 'all' })).ok).toBe(true);
    // And the same in a channel that stays, and one bob merely left.
    const kept = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'kept' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${kept}/join`)).ok).toBe(true);
    await as(alice).post(`/api/ws/${wsId}/conv/${kept}/messages`, { text: '@bob kept' });
    const left = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'left', private: true })).data.channel.id;
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${left}/members`, { uuids: [bob.uuid] })).ok).toBe(true);
    await as(alice).post(`/api/ws/${wsId}/conv/${left}/messages`, { text: '@bob left' });
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${left}/leave`)).ok).toBe(true);
    let d = await mdoc(wsId, bob.uuid);
    expect(d.threads[tid]).toBe(1);
    expect(d.mentions[ch]).toBe(1);
    expect(d.notify[ch]).toEqual({ level: 'all' });
    expect(d.reads[ch]).toBeGreaterThan(0);
    const before = (await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).data.u;
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${ch}`)).ok).toBe(true);
    expect((await as(bob).get(`/api/ws/${wsId}/threads`)).ok).toBe(true);
    d = await mdoc(wsId, bob.uuid);
    for (const map of ['reads', 'mentions', 'notify', 'threads']) expect(Object.hasOwn(d[map], ch), map).toBe(false);
    expect(Object.hasOwn(d.reads, tid)).toBe(false);
    expect(Object.hasOwn(d.threads, tid)).toBe(false);
    // A reply count that stood for something went: the other tabs are told.
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).data.u).toBeGreaterThan(before);
    // What is kept for channels still here stays, the one merely left included.
    expect(d.mentions[kept]).toBe(1);
    expect(d.mentions[left]).toBe(1);
    expect(d.reads[kept]).toBeGreaterThan(0);
    expect(d.reads[left]).toBeGreaterThan(0);
    expect(d.reads[general.id]).toBeGreaterThan(0);
  });

  it('keeps the newest thousand thread cursors and those of listed threads, letting the oldest go a few hundred at a time', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    // A thread bob follows, opened before every other: its cursor is a row's to keep.
    const root = (await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root' })).data.message.seq;
    const followed = threadConvId(general.id, root);
    await as(alice).post(`/api/ws/${wsId}/conv/${followed}/messages`, { text: 'reply' });
    const reads = { [general.id]: 1, [followed]: 1 };
    for (let i = 10; i < 1410; i++) reads[threadConvId(general.id, i)] = 1; // 1400 threads merely opened, oldest first
    await rt.kv.update(KEYS.member(wsId, bob.uuid), { reads });
    const grown = size(await mdoc(wsId, bob.uuid));
    expect((await as(bob).get(`/api/ws/${wsId}/threads`)).data.threads.map((t) => t.id)).toEqual([followed]);
    let d = await mdoc(wsId, bob.uuid);
    // Three hundred went this visit, the oldest; a second visit takes the rest past the thousand.
    let cursors = Object.keys(d.reads).filter((c) => c !== general.id && c !== followed);
    expect(cursors).toHaveLength(1100);
    expect(cursors[0]).toBe(threadConvId(general.id, 310));
    expect((await as(bob).get(`/api/ws/${wsId}/threads`)).ok).toBe(true);
    d = await mdoc(wsId, bob.uuid);
    cursors = Object.keys(d.reads).filter((c) => c !== general.id && c !== followed);
    expect(cursors).toHaveLength(1000);
    expect(cursors[0]).toBe(threadConvId(general.id, 410));
    expect(cursors[999]).toBe(threadConvId(general.id, 1409));
    expect(d.reads[followed]).toBe(1);
    expect(d.reads[general.id]).toBe(1);
    expect(size(d)).toBeLessThan(grown);
    // At the cap, a visit changes nothing more.
    expect((await as(bob).get(`/api/ws/${wsId}/threads`)).ok).toBe(true);
    expect(Object.keys((await mdoc(wsId, bob.uuid)).reads)).toHaveLength(1002);
  });
});

describe('a status emoji', () => {
  it('is cleaned of control and bidi characters like the text beside it, and a real emoji stays', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    // An override alone is no status; one wrapped around an emoji leaves the emoji.
    let r = await as(bob).put('/api/me', { status: { emoji: '\u202e', text: '' } });
    expect(r.ok).toBe(true);
    expect(r.data.profile.status).toBeNull();
    r = await as(bob).put('/api/me', { status: { emoji: '\u202e🎯\u202c', text: 'Focusing' } });
    expect(r.ok).toBe(true);
    expect(r.data.profile.status).toMatchObject({ emoji: '🎯', text: 'Focusing' });
    expect((await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid].status).toMatchObject({ emoji: '🎯', text: 'Focusing' });
    // Emoji written as sequences keep their joiners, modifiers and keycaps.
    for (const real of ['👨‍👩‍👧', '👍🏽', '1️⃣', '🇳🇴']) {
      r = await as(bob).put('/api/me', { status: { emoji: real, text: '' } });
      expect(r.data.profile.status.emoji, JSON.stringify(real)).toBe(real);
    }
    // A control character alone, with text, leaves the text standing on its own.
    r = await as(bob).put('/api/me', { status: { emoji: '\u0000', text: 'Away' } });
    expect(r.data.profile.status).toMatchObject({ emoji: '', text: 'Away' });
  });
});

describe('the person on the other side of a guest\'s direct message', () => {
  async function guestWithDm() {
    const { wsId } = await workspaceWith(alice, [bob, dave]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'proj' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`)).ok).toBe(true);
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${ch}/invites`, {});
    expect((await as(carol).post('/api/join', { code: inv.data.code })).ok).toBe(true);
    const dm = (await as(bob).post(`/api/ws/${wsId}/dms`, { members: [carol.uuid] })).data.conv;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${dm}/messages`, { text: 'hi carol' })).ok).toBe(true);
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(64)], { type: 'image/png' }), 'me.png');
    expect((await as(bob).post('/api/me/avatar', fd)).ok).toBe(true);
    return { wsId, ch, dm };
  }

  it('keeps their card, presence and photo when they leave the channel the two shared, the conversation being still theirs', async () => {
    const { wsId, ch, dm } = await guestWithDm();
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/leave`)).ok).toBe(true);
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0&hb=1`)).ok).toBe(true);
    const boot = await as(carol).get(`/api/ws/${wsId}`);
    expect(Object.keys(boot.data.workspace.members).sort()).toEqual([alice.uuid, bob.uuid, carol.uuid].sort());
    expect(boot.data.activity.p[bob.uuid]).toBeGreaterThan(0);
    expect((await as(carol).get(`/api/ws/${wsId}/sync?since=0`)).data.p[bob.uuid]).toBeGreaterThan(0);
    expect((await as(carol).get(`/api/ws/${wsId}/members/${bob.uuid}/avatar`)).status).toBe(200);
    // The conversation goes on both ways, and either side may open it again
    // (the app asks the route for it whenever the other's card is there).
    expect((await as(carol).post(`/api/ws/${wsId}/conv/${dm}/messages`, { text: 'hi bob' })).ok).toBe(true);
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${dm}/messages`)).data.messages.map((m) => m.text)).toEqual(['hi carol', 'hi bob']);
    expect((await as(carol).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] })).data).toMatchObject({ conv: dm, already: true });
    expect((await as(bob).post(`/api/ws/${wsId}/dms`, { members: [carol.uuid] })).data).toMatchObject({ conv: dm, already: true });
    // Someone they share nothing with is still not shown, and cannot be written to.
    expect(boot.data.workspace.members[dave.uuid]).toBeUndefined();
    expect((await as(carol).post(`/api/ws/${wsId}/dms`, { members: [dave.uuid] })).status).toBe(403);
    expect((await as(carol).get(`/api/ws/${wsId}/members/${dave.uuid}/avatar`)).status).toBe(404);
  });

  it('is gone from the guest\'s view with their membership, as before', async () => {
    const { wsId, dm } = await guestWithDm();
    expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    const boot = await as(carol).get(`/api/ws/${wsId}`);
    expect(boot.data.workspace.members[bob.uuid]).toBeUndefined();
    expect(boot.data.me.dms[dm]).toBeTruthy();
    expect((await as(carol).get(`/api/ws/${wsId}/members/${bob.uuid}/avatar`)).status).toBe(404);
  });

  it('does not let the guest start a conversation with someone they merely once shared a channel with', async () => {
    const { wsId, ch } = await guestWithDm();
    // dave in the channel, then out of it, with no direct message between the two.
    expect((await as(dave).post(`/api/ws/${wsId}/channels/${ch}/join`)).ok).toBe(true);
    expect((await as(dave).post(`/api/ws/${wsId}/channels/${ch}/leave`)).ok).toBe(true);
    expect((await as(carol).post(`/api/ws/${wsId}/dms`, { members: [dave.uuid] })).status).toBe(403);
  });
});

