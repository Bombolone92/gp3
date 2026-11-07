/**
 * Identity, membership, notification and invite routes: what the twelfth
 * review pass found.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS, threadConvId } from '../src/shared/blocks.js';
import { b64url } from '../worker/push.js';

const { alice, bob, carol, dave } = USERS;
const SERVER = 'teamchat-api.test';
let rt;

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

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

describe('an admin who is not in a private channel', () => {
  async function setup() {
    const { wsId } = await workspaceWith(alice, [bob]);
    expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    // Hidden from bob everywhere else already.
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.workspace.channels[secret]).toBeUndefined();
    expect((await as(bob).put(`/api/ws/${wsId}/channels/${secret}`, { topic: 'x' })).status).toBe(404);
    return { wsId, secret };
  }

  it('cannot mint or revoke its guest link, so the link is no way in for them', async () => {
    const { wsId, secret } = await setup();
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${secret}/invites`, {})).status).toBe(404);
    expect((await as(bob).del(`/api/ws/${wsId}/channels/${secret}/invites`)).status).toBe(404);
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.channels[secret].guestInvite).toBeUndefined();
    expect(ws.channels[secret].members).toEqual([alice.uuid]);
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).channels).not.toContain(secret);
    // Someone in it can, as before.
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${secret}/invites`, {});
    expect(inv.ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${secret}/invites`)).ok).toBe(true);
  });

  it('cannot mint or revoke its share link either', async () => {
    const { wsId, secret } = await setup();
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${secret}/connect/invites`, {})).status).toBe(404);
    expect((await as(bob).del(`/api/ws/${wsId}/channels/${secret}/connect/invites`)).status).toBe(404);
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[secret].connectInvite).toBeUndefined();
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${secret}/connect/invites`, {})).ok).toBe(true);
  });

  it('cannot delete it, nor end a connection of it, while someone in it can', async () => {
    const { wsId, secret } = await setup();
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${secret}/messages`, { text: 'kept' })).ok).toBe(true);
    // Shared with Globex (alice is an admin there too); bob, an admin here but not in #secret, tries to end it.
    const globex = await workspaceWith(alice, [carol], 'Globex');
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${secret}/connect/invites`, {});
    const acc = await as(alice).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' } });
    expect(acc.ok).toBe(true);
    expect((await as(bob).del(`/api/ws/${wsId}/channels/${secret}/connections/${acc.data.conn}`)).status).toBe(404);
    expect((await as(bob).del(`/api/ws/${wsId}/channels/${secret}`)).status).toBe(404);
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.channels[secret]).toBeTruthy();
    expect(ws.channels[secret].connections[acc.data.conn]).toBeTruthy();
    expect(await rt.kv.get(KEYS.seq(secret))).toBeGreaterThan(0);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${secret}/connections/${acc.data.conn}`)).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${secret}`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[secret]).toBeUndefined();
  });

  it('may still delete one nobody is left in, whose last member was removed from the workspace', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${secret}/members`, { uuids: [bob.uuid] })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${secret}/messages`, { text: 'history' })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${secret}/leave`)).ok).toBe(true);
    // With bob still in it, it is his alone: alice cannot delete it.
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${secret}`)).status).toBe(404);
    expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[secret].members).toEqual([]);
    // Nobody left in it, nobody who could open it: the owner may delete it, history and all.
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${secret}`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[secret]).toBeUndefined();
    expect(await rt.kv.get(KEYS.seq(secret))).toBeFalsy();
  });
});

describe('a reminder or an Activity entry about a message deleted since', () => {
  const HOUR = 3_600_000;
  const text = (u, wsId, conv, t) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text: t });

  it('leaves the reminders list, and the queue, while one for a live message and one merely out of reach stay', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const gone = (await text(alice, wsId, general.id, 'to be deleted')).data.message.seq;
    const live = (await text(alice, wsId, general.id, 'stays')).data.message.seq;
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${secret}/members`, { uuids: [bob.uuid] })).ok).toBe(true);
    const hidden = (await text(alice, wsId, secret, 'in secret')).data.message.seq;
    const remind = async (conv, seq, dueAt) => (await as(bob).post(`/api/ws/${wsId}/reminders`, { conv, seq, dueAt })).data.reminder.id;
    const rGone = await remind(general.id, gone, Date.now() + HOUR);
    const rLive = await remind(general.id, live, Date.now() + 2 * HOUR);
    const rHidden = await remind(secret, hidden, Date.now() + 3 * HOUR);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${gone}`)).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${secret}/leave`)).ok).toBe(true);
    const list = (await as(bob).get(`/api/ws/${wsId}/scheduled`)).data.reminders;
    expect(list.map((r) => r.id)).toEqual([rLive]);
    expect(list[0].message.text).toBe('stays');
    const queue = (await rt.kv.get(KEYS.sched(wsId))).m;
    expect(queue[rGone]).toBeUndefined(); // gone for good
    expect(queue[rLive]).toBeTruthy();
    expect(queue[rHidden]).toBeTruthy(); // out of reach for now, kept
    // The next due time follows what is left.
    expect((await rt.kv.get(KEYS.activity(wsId))).nd).toBe(queue[rLive].dueAt);
  });

  it('is left alone while the workspace is still being imported, its message being on its way', async () => {
    const conv = 'impconv001';
    const header = {
      format: 'teamchat-export', version: 1, workspace: { id: 'impremind1', name: 'Old' },
      channels: { [conv]: { name: 'general', def: true } },
      members: { [alice.uuid]: { name: 'alice', username: 'alice', role: 'owner' } },
      memberDocs: { [alice.uuid]: { channels: [conv], dms: {}, reads: {}, notify: {} } },
      sched: [{ id: 'remimp0001', kind: 'reminder', u: alice.uuid, conv, seq: 2, note: 'follow up', dueAt: Date.now() + HOUR, createdAt: Date.now() - HOUR }],
    };
    const created = await as(alice).post('/api/workspaces/import', { header });
    expect(created.ok).toBe(true);
    const wsId = created.data.workspace.id;
    expect((await rt.kv.get(KEYS.sched(wsId))).m.remimp0001).toBeTruthy();
    // An Activity entry about a message of the archive, as a moved workspace's members carry.
    await rt.kv.set(KEYS.inbox(wsId, alice.uuid), { items: [{ k: 'mention', c: conv, s: 2, by: alice.uuid, ts: Date.now() - HOUR }] });
    // Opened before the pages arrive: nothing is let go of, nothing left out.
    const during = await as(alice).get(`/api/ws/${wsId}/scheduled`);
    expect(during.ok).toBe(true);
    expect(during.data.reminders.map((r) => r.id)).toEqual(['remimp0001']);
    expect((await rt.kv.get(KEYS.sched(wsId))).m.remimp0001).toBeTruthy();
    expect((await as(alice).get(`/api/ws/${wsId}/inbox`)).data.items).toHaveLength(1);
    // The page lands and the import finishes: both read as they stand.
    expect((await as(alice).post(`/api/ws/${wsId}/import`, { conv, seq: 2, messages: [{ seq: 1, user: alice.uuid, text: 'first', ts: 1000 }, { seq: 2, user: alice.uuid, text: 'second', ts: 2000 }] })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/import/finish`)).ok).toBe(true);
    const after = await as(alice).get(`/api/ws/${wsId}/scheduled`);
    expect(after.data.reminders.map((r) => r.message?.text)).toEqual(['second']);
    expect((await as(alice).get(`/api/ws/${wsId}/inbox`)).data.items.map((e) => e.message?.text)).toEqual(['second']);
  });

  it('is not shown in Activity, while the ring itself is left as it is', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const first = (await text(alice, wsId, general.id, 'hey @bob one')).data.message.seq;
    expect((await text(alice, wsId, general.id, 'hey @bob two')).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${first}`)).ok).toBe(true);
    const inbox = (await as(bob).get(`/api/ws/${wsId}/inbox`)).data;
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0].message.text).toBe('hey @bob two');
    expect(inbox.unread).toBe(2);
    expect((await rt.kv.get(KEYS.inbox(wsId, bob.uuid))).items).toHaveLength(2);
  });
});

describe('a request body', () => {
  const MB = 1024 * 1024;

  /**
   * A body that declares no length at all — sent chunked, as a hand-built
   * client may. The cap cannot be read off a header that is not there, so it
   * is measured on the bytes as they arrive, and the reader is cancelled the
   * moment they run past it: the whole body is never held and then refused.
   */
  it('that never says how long it is is refused on its bytes, and not read past the cap', async () => {
    await workspaceWith(alice, [bob]);
    const CHUNK = 256 * 1024;
    let sent = 0;
    let cancelled = false;
    const body = new ReadableStream({
      pull(c) {
        // Well past the cap if anything reads it all, but bounded, so a
        // regression here fails the test rather than the machine.
        if (sent >= 24 * MB) { c.close(); return; }
        sent += CHUNK;
        c.enqueue(new Uint8Array(CHUNK));
      },
      cancel() { cancelled = true; },
    });
    const res = await rt.dispatch('https://teamchat-api.test/api/me', {
      method: 'PUT', body, duplex: 'half', headers: { 'Content-Type': 'application/json' },
    }, bob);
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('too_large');
    // Stopped at the cap rather than swallowing everything on offer.
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThanOrEqual(17 * MB);
    // And nothing of the caller's was written on the way.
    expect((await rt.kv.get(KEYS.user(bob.uuid))).name).toBe('bob');
  });

  it('is refused past sixteen megabytes, while an import page of a few megabytes goes through', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    // A member's request carrying far more than any route could use.
    const huge = await as(bob).put('/api/me', { name: 'Bob', pad: 'x'.repeat(17 * MB) });
    expect(huge.status).toBe(413);
    expect(huge.data.code).toBe('too_large');
    expect(huge.data.message).toBe('That request is too large');
    expect((await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid].name).toBe('bob');
    // Import pages are the largest bodies the app sends: five hundred
    // messages, each up to its cap, comes to a few megabytes and is taken.
    const conv = 'bigpage001';
    const header = {
      format: 'teamchat-export', version: 1, workspace: { id: 'bigimport1', name: 'Old' },
      channels: { [conv]: { name: 'general', def: true } },
      members: { [alice.uuid]: { name: 'alice', username: 'alice', role: 'owner' } },
      memberDocs: { [alice.uuid]: { channels: [conv], dms: {}, reads: {}, notify: {} } },
    };
    const created = await as(alice).post('/api/workspaces/import', { header });
    expect(created.ok).toBe(true);
    const newId = created.data.workspace.id;
    const messages = Array.from({ length: 500 }, (_, i) => ({ seq: i + 1, user: alice.uuid, text: `m${i + 1} ` + 'y'.repeat(7000), ts: 1000 + i }));
    const body = { conv, seq: 500, messages };
    expect(JSON.stringify(body).length).toBeGreaterThan(3 * MB);
    const page = await as(alice).post(`/api/ws/${newId}/import`, body);
    expect(page.ok).toBe(true);
    expect(await rt.kv.get(KEYS.seq(conv))).toBe(500);
  });
});

describe('a one-line field of characters that show as nothing, or that turn a line around', () => {
  it('is refused as a display name, and cleared as a title or a status; joiners and marks inside a real name stay', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    for (const bad of ['\u0007', '\u0000 ', '\u200d\u200d', '\u0085', '\u202e', '\u200b \u200b']) {
      expect((await as(bob).put('/api/me', { name: bad })).status, JSON.stringify(bad)).toBe(400);
    }
    const r = await as(bob).put('/api/me', { name: '\u202eecilA\u202c', title: '\u0007', status: { emoji: '', text: '\u200b\u200b' } });
    expect(r.ok).toBe(true);
    expect(r.data.profile.name).toBe('ecilA');
    expect(r.data.profile.title).toBe('');
    expect(r.data.profile.status).toBeNull();
    expect((await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid].name).toBe('ecilA');
    const real = 'می\u200cخواهم 👨\u200d👩\u200d👧 \u200fعلي O’Neil';
    const ok = await as(bob).put('/api/me', { name: real, title: 'Lead\tdev' });
    expect(ok.ok).toBe(true);
    expect(ok.data.profile.name).toBe(real);
    expect(ok.data.profile.title).toBe('Lead\tdev');
  });

  it('is refused as a workspace name, and cleared as a reminder note', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await as(alice).put(`/api/ws/${wsId}`, { name: '\u0001\u0002' })).status).toBe(400);
    expect((await as(alice).post('/api/workspaces', { name: '\u202e' })).status).toBe(400);
    const named = await as(alice).put(`/api/ws/${wsId}`, { name: 'Acme\u202e Inc' });
    expect(named.ok).toBe(true);
    expect(named.data.workspace.name).toBe('Acme Inc');
    const r = await as(bob).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq: 1, note: '\u0007call\u202e', dueAt: Date.now() + 3_600_000 });
    expect(r.ok).toBe(true);
    expect(r.data.reminder.note).toBe('call');
    // Edited afterwards, the note is cleaned the same way.
    const edited = await as(bob).put(`/api/ws/${wsId}/scheduled/${r.data.reminder.id}`, { text: 'call back\u202e' });
    expect(edited.ok).toBe(true);
    expect((await rt.kv.get(KEYS.sched(wsId))).m[r.data.reminder.id].note).toBe('call back');
    expect((await as(bob).put(`/api/ws/${wsId}/scheduled/${r.data.reminder.id}`, { text: '\u0007' })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.sched(wsId))).m[r.data.reminder.id].note).toBe('');
  });
});

describe('someone from a connected workspace handed a guest link of the host', () => {
  it('is refused, with the reason, for a channel other than the one shared with them', async () => {
    const { acme, design } = await shared();
    const other = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'other' })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${other}/invites`, {});
    const r = await as(bob).post('/api/join', { code: inv.data.code });
    expect(r.status).toBe(403);
    expect(r.data.code).toBe('external');
    expect(r.data.message).toMatch(/workspace invite/);
    expect(r.data.already).toBeUndefined();
    expect((await rt.kv.get(KEYS.member(acme.wsId, bob.uuid))).channels).toEqual([design]);
    expect((await rt.kv.get(KEYS.ws(acme.wsId))).members[bob.uuid].role).toBe('external');
    // The code was good: nothing is counted against them.
    expect(await rt.kv.get(`tc:joinfail:${bob.uuid}`)).toBeFalsy();
  });

  it('is told they are in the channel already when the link is for the shared channel itself', async () => {
    const { acme, design } = await shared();
    const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/invites`, {});
    const r = await as(bob).post('/api/join', { code: inv.data.code });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ already: true, channel: { id: design, name: 'design' } });
    expect(r.data.joined).toBeUndefined();
    expect((await rt.kv.get(KEYS.ws(acme.wsId))).channels[design].count).toBe(3);
  });
});

const post = (u, wsId, conv, text) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text });
const stampOf = async (wsId, u) => (await rt.kv.get(KEYS.activity(wsId))).u?.[u] || 0;

describe('a badge cleared on one tab', () => {
  it('is cleared on the others when a thread with replies waiting is unfollowed', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const root = await post(alice, wsId, general.id, 'root');
    const tid = threadConvId(general.id, root.data.message.seq);
    expect((await post(bob, wsId, tid, 'reply from bob')).ok).toBe(true);
    expect((await post(alice, wsId, tid, 'reply from alice')).ok).toBe(true);
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).threads[tid]).toBe(1);
    const before = await stampOf(wsId, bob.uuid);
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${tid}/notify`, { follow: false })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).threads[tid]).toBe(0);
    // The stamp bob's other tabs watch has moved: they fetch the document again.
    expect(await stampOf(wsId, bob.uuid)).toBeGreaterThan(before);
    // A setting changed moves it as well, each being one deliberate act the
    // other tabs judge their chimes, banners and Threads list by.
    const quiet = await stampOf(wsId, bob.uuid);
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${tid}/notify`, { follow: true })).ok).toBe(true);
    const followed = await stampOf(wsId, bob.uuid);
    expect(followed).toBeGreaterThan(quiet);
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${general.id}/notify`, { mute: true })).ok).toBe(true);
    expect(await stampOf(wsId, bob.uuid)).toBeGreaterThan(followed);
  });

  it('is cleared on the others when Activity is opened with something new in it', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await post(alice, wsId, general.id, 'hey @bob')).ok).toBe(true);
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).inbox).toBe(1);
    const before = await stampOf(wsId, bob.uuid);
    expect((await as(bob).post(`/api/ws/${wsId}/inbox/read`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).inbox).toBe(0);
    expect(await stampOf(wsId, bob.uuid)).toBeGreaterThan(before);
    // Opening it again with nothing new moves nothing.
    const quiet = await stampOf(wsId, bob.uuid);
    expect((await as(bob).post(`/api/ws/${wsId}/inbox/read`)).ok).toBe(true);
    expect(await stampOf(wsId, bob.uuid)).toBe(quiet);
  });
});

const MIN = 60_000;

describe('deleting a scheduled message a poll is delivering this moment', () => {
  it('is refused with the word for it, rather than answered as deleted while the message goes out', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const key = KEYS.sched(wsId);
    const r = await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'going out', dueAt: Date.now() + 5 * MIN });
    const id = r.data.scheduled.id;
    // What a poll leaves on an entry it has claimed, while it posts.
    await rt.kv.update(key, { [`m.${id}.claims`]: 1, [`m.${id}.claimedAt`]: Date.now() });
    const d = await as(bob).del(`/api/ws/${wsId}/scheduled/${id}`);
    expect(d.status).toBe(409);
    expect(d.data.code).toBe('sending');
    expect((await rt.kv.get(key)).m[id]).toMatchObject({ text: 'going out', claims: 1 });
    // A claim gone stale is a delivery that died: the entry is the author's again.
    await rt.kv.update(key, { [`m.${id}.claimedAt`]: Date.now() - 6 * MIN });
    expect((await as(bob).del(`/api/ws/${wsId}/scheduled/${id}`)).ok).toBe(true);
    expect((await rt.kv.get(key)).m[id]).toBeUndefined();
  });

  it('says so for a reminder too', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const key = KEYS.sched(wsId);
    const r = await as(bob).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq: 1, dueAt: Date.now() + 5 * MIN });
    const id = r.data.reminder.id;
    await rt.kv.update(key, { [`m.${id}.claims`]: 1, [`m.${id}.claimedAt`]: Date.now() });
    const d = await as(bob).del(`/api/ws/${wsId}/scheduled/${id}`);
    expect(d.status).toBe(409);
    expect(d.data.message).toMatch(/reminder/);
  });
});

async function upload(u, wsId, name = 'a.txt') {
  const fd = new FormData();
  fd.append('file', new Blob(['hello'], { type: 'text/plain' }), name);
  const r = await as(u).post(`/api/ws/${wsId}/files`, fd);
  expect(r.ok).toBe(true);
  return r.data.id;
}
const fileThere = async (u, wsId, id) => (await as(u).get(`/api/ws/${wsId}/files/${id}`)).status === 200;
const schedule = async (u, wsId, conv, ids) => (await as(u).post(`/api/ws/${wsId}/scheduled`, { conv, text: 'later', attachments: ids.map((id) => ({ id })), dueAt: Date.now() + 5 * MIN })).data.scheduled.id;
const due = async (wsId, id) => {
  await rt.kv.update(KEYS.sched(wsId), { [`m.${id}.dueAt`]: Date.now() - 1 });
  await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
};

describe('the file a scheduled message waited with', () => {
  it('leaves the owner\'s drive when the message is deleted, unless a posted message or another entry still carries it', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const own = await upload(bob, wsId, 'draft.txt');
    const twice = await upload(bob, wsId, 'twice.txt');
    const posted = await upload(bob, wsId, 'posted.txt');
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'here', attachments: [{ id: posted }] })).ok).toBe(true);
    const a = await schedule(bob, wsId, general.id, [own, twice, posted]);
    const b = await schedule(bob, wsId, general.id, [twice]);
    expect((await as(bob).del(`/api/ws/${wsId}/scheduled/${a}`)).ok).toBe(true);
    expect(await rt.kv.get(KEYS.file(own))).toBeFalsy();
    expect(await fileThere(bob, wsId, own)).toBe(false);
    expect(await fileThere(bob, wsId, twice)).toBe(true); // the other entry still waits with it
    expect(await fileThere(bob, wsId, posted)).toBe(true); // a message carries it
    expect((await rt.kv.get(KEYS.file(posted))).refs).toBe(1);
    expect((await as(bob).del(`/api/ws/${wsId}/scheduled/${b}`)).ok).toBe(true);
    expect(await fileThere(bob, wsId, twice)).toBe(false);
  });

  it('stays with the message when the post is refused at its time (the message waits, marked, for its author), and stays held by the message when it is posted', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'temp' })).data.channel.id;
    await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`);
    const refused = await upload(bob, wsId, 'refused.txt');
    const sent = await upload(bob, wsId, 'sent.txt');
    const r = await schedule(bob, wsId, ch, [refused]);
    const s = await schedule(bob, wsId, general.id, [sent]);
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ch}`, { archived: true })).ok).toBe(true);
    await due(wsId, r);
    await due(wsId, s);
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    const queue = (await rt.kv.get(KEYS.sched(wsId))).m;
    // Refused, the message is kept for its author, marked, and its file with it (pass 13); deleted, the file goes.
    expect(queue[r].failed.code).toBe('archived');
    expect(queue[s]).toBeUndefined();
    expect(await rt.kv.get(KEYS.file(refused))).toBeTruthy();
    expect(await fileThere(bob, wsId, refused)).toBe(true);
    expect((await as(bob).del(`/api/ws/${wsId}/scheduled/${r}`)).ok).toBe(true);
    expect(await rt.kv.get(KEYS.file(refused))).toBeFalsy();
    expect((await rt.kv.get(KEYS.file(sent))).refs).toBe(1);
    expect(await fileThere(alice, wsId, sent)).toBe(true);
  });

  it('leaves with its author when they are removed, and with its channel when that is deleted', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'temp' })).data.channel.id;
    await as(carol).post(`/api/ws/${wsId}/channels/${ch}/join`);
    const bobs = await upload(bob, wsId, 'bobs.txt');
    const carols = await upload(carol, wsId, 'carols.txt');
    await schedule(bob, wsId, general.id, [bobs]);
    await schedule(carol, wsId, ch, [carols]);
    expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    expect(await rt.kv.get(KEYS.file(bobs))).toBeFalsy();
    expect(await fileThere(carol, wsId, carols)).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${ch}`)).ok).toBe(true);
    expect(await rt.kv.get(KEYS.file(carols))).toBeFalsy();
  });
});

/* What a browser does with a push: a subscription's keys, and the aes128gcm decryption (as tests/push.test.js). */
const subtle = crypto.subtle;
const enc = new TextEncoder();
async function subscriber() {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    pair, auth,
    subscription: { endpoint: `https://push.example.com/send/${b64url(crypto.getRandomValues(new Uint8Array(8)))}`, keys: { p256dh: b64url(await subtle.exportKey('raw', pair.publicKey)), auth: b64url(auth) } },
  };
}
async function hkdf(salt, ikm, info, length) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0)); let o = 0; for (const p of parts) { out.set(new Uint8Array(p), o); o += p.byteLength; } return out; };
async function decrypt(sub, body) {
  const buf = new Uint8Array(body);
  const salt = buf.slice(0, 16);
  const idlen = buf[20];
  const asPub = buf.slice(21, 21 + idlen);
  const cipher = buf.slice(21 + idlen);
  const uaPub = new Uint8Array(await subtle.exportKey('raw', sub.pair.publicKey));
  const asKey = await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, sub.pair.privateKey, 256));
  const ikm = await hkdf(sub.auth, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, cipher));
  return new TextDecoder().decode(plain.slice(0, plain.lastIndexOf(2)));
}

describe('a member\'s push devices', () => {
  it('never exceed the cap, even when two subscribe in the same instant', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const subscribe = async (dev) => as(bob).post(`/api/ws/${wsId}/push`, { subscription: dev.subscription });
    const devices = [];
    for (let i = 0; i < 4; i++) {
      const dev = await subscriber();
      devices.push(dev);
      expect((await subscribe(dev)).ok).toBe(true);
      await new Promise((r) => setTimeout(r, 2)); // stamps that order
    }
    const [e, f] = [await subscriber(), await subscriber()];
    const [re, rf] = await Promise.all([subscribe(e), subscribe(f)]);
    expect(re.ok && rf.ok).toBe(true);
    const push = (await rt.kv.get(KEYS.member(wsId, bob.uuid))).push;
    expect(Object.keys(push)).toHaveLength(5);
    expect(push[re.data.id]).toBeTruthy();
    expect(push[rf.data.id]).toBeTruthy();
    // The oldest made room; the rest of the earlier devices stay.
    expect(Object.values(push).map((s) => s.endpoint)).not.toContain(devices[0].subscription.endpoint);
    for (const dev of devices.slice(1)) expect(Object.values(push).map((s) => s.endpoint)).toContain(dev.subscription.endpoint);
    // With the cap reached, a further device is refused as before; a device already registered refreshes.
    expect((await subscribe(await subscriber())).status).toBe(400);
    expect((await subscribe(f)).ok).toBe(true);
    expect(Object.keys((await rt.kv.get(KEYS.member(wsId, bob.uuid))).push)).toHaveLength(5);
  });
});

describe('a push for a message of files alone', () => {
  it('says what happened beneath the sender\'s name, rather than nothing', async () => {
    const realFetch = globalThis.fetch;
    const received = [];
    globalThis.fetch = async (url, init) => {
      received.push({ url: String(url), body: new Uint8Array(await new Response(init.body).arrayBuffer()) });
      return new Response('', { status: 201 });
    };
    try {
      const { wsId, general } = await workspaceWith(alice, [bob]);
      const dev = await subscriber();
      expect((await as(bob).post(`/api/ws/${wsId}/push`, { subscription: dev.subscription })).ok).toBe(true);
      const dm = (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] })).data.conv;
      const photo = await upload(alice, wsId, 'photo.jpg');
      expect((await as(alice).post(`/api/ws/${wsId}/conv/${dm}/messages`, { text: '', attachments: [{ id: photo }] })).ok).toBe(true);
      expect(received).toHaveLength(1);
      const payload = JSON.parse(await decrypt(dev, received[0].body));
      expect(payload.title).toBe('alice');
      expect(payload.body).toBe('New message');
      // A mention with only a file cannot be (a mention is text); text still previews as before.
      expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'hey @bob', attachments: [{ id: photo }] })).ok).toBe(true);
      expect(received).toHaveLength(2);
      expect(JSON.parse(await decrypt(dev, received[1].body)).body).toBe('hey @bob');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

/**
 * Run `action` once the store is handed the first write of `pathPrefix`
 * under the workspace document, before that write lands: what a second
 * caller does between a request's read of the workspace and its write.
 */
function between(wsId, pathPrefix, action) {
  const kv = rt.kv;
  const origUpdate = kv.update.bind(kv);
  let raced = false;
  kv.update = async (k, paths) => {
    if (k === KEYS.ws(wsId) && paths && Object.keys(paths).some((p) => p.startsWith(pathPrefix)) && !raced) {
      raced = true;
      kv.update = origUpdate;
      await action();
    }
    return origUpdate(k, paths);
  };
  return () => raced;
}

describe('a write to one field of a member\'s card, landing after the member is gone', () => {
  it('does not bring back someone who left as an admin gave them a role, let alone as an admin', async () => {
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    const raced = between(wsId, `members.${bob.uuid}.role`, async () => {
      expect((await as(bob).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    });
    const r = await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    expect(raced()).toBe(true);
    expect(r.status).toBe(404);
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.members[bob.uuid]).toBeUndefined();
    expect(ws.former[bob.uuid]).toBeTruthy();
    expect((await as(bob).get(`/api/ws/${wsId}`)).status).toBe(403);
    expect((await as(bob).del(`/api/ws/${wsId}/members/${carol.uuid}`)).status).toBe(403);
    expect(Object.keys((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.members)).toHaveLength(2);
  });

  it('does not bring back someone removed as their new display name reached their cards', async () => {
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    const raced = between(wsId, `members.${bob.uuid}.name`, async () => {
      expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    });
    const r = await as(bob).put('/api/me', { name: 'Robert' });
    expect(raced()).toBe(true);
    expect(r.ok).toBe(true); // their profile is theirs to rename, wherever they are
    expect(r.data.profile.name).toBe('Robert');
    expect((await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid]).toBeUndefined();
    expect((await as(bob).get(`/api/ws/${wsId}`)).status).toBe(403);
  });

  it('does not let someone from a connected workspace, just removed by an admin, renew their way back in', async () => {
    const { acme, globex, local } = await shared();
    const raced = between(acme.wsId, `members.${bob.uuid}.`, async () => {
      expect((await as(alice).del(`/api/ws/${acme.wsId}/members/${bob.uuid}`)).ok).toBe(true);
    });
    const renew = async (name) => {
      const att = (await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {})).data;
      return as(bob).post('/api/connect/join', { conn: att.conn, token: att.token, profile: { name } });
    };
    const r = await renew('Bob Renamed');
    expect(raced()).toBe(true);
    expect(r.status).toBe(409);
    const ws = await rt.kv.get(KEYS.ws(acme.wsId));
    expect(ws.members[bob.uuid]).toBeUndefined();
    expect(ws.removed[bob.uuid]).toBeTruthy();
    expect((await as(bob).get(`/api/ws/${acme.wsId}`)).status).toBe(403);
    // The next attempt is answered for what they are now: kept out.
    const again = await renew('Bob Renamed');
    expect(again.status).toBe(403);
    expect(again.data.code).toBe('removed');
  });

  it('still tells a leftover from a real card that carries no username, as one written by an old build might', async () => {
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    // A card from before every card carried a username: only what the old build wrote.
    await rt.kv.remove(KEYS.ws(wsId), `members.${bob.uuid}.username`, `members.${bob.uuid}.joinedAt`, `members.${bob.uuid}.status`, `members.${bob.uuid}.avatar`);
    expect(Object.keys((await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid]).sort()).toEqual(['color', 'name', 'role', 'title']);
    expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid]).toMatchObject({ name: 'bob', role: 'admin' });
    expect((await as(bob).put('/api/me', { name: 'Robert', title: 'Ops', color: 3 })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid]).toMatchObject({ name: 'Robert', title: 'Ops', color: 3, role: 'admin' });
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.me.role).toBe('admin');
    // The leftover a write leaves behind for someone gone is still told apart: it is the written fields alone.
    const raced = between(wsId, `members.${carol.uuid}.role`, async () => {
      expect((await as(carol).del(`/api/ws/${wsId}/members/${carol.uuid}`)).ok).toBe(true);
    });
    expect((await as(alice).post(`/api/ws/${wsId}/members/${carol.uuid}/role`, { role: 'admin' })).status).toBe(404);
    expect(raced()).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).members[carol.uuid]).toBeUndefined();
  });

  it('does not make a member of a guest removed as they accepted the workspace invite', async () => {
    const { wsId, code, general } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ext' })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${ch}/invites`, {});
    expect((await as(carol).post('/api/join', { code: inv.data.code })).ok).toBe(true);
    const raced = between(wsId, `members.${carol.uuid}.role`, async () => {
      expect((await as(alice).del(`/api/ws/${wsId}/members/${carol.uuid}`)).ok).toBe(true);
    });
    const r = await as(carol).post('/api/join', { code });
    expect(raced()).toBe(true);
    expect(r.status).toBe(409);
    expect(r.data.code).toBe('retry');
    let ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.members[carol.uuid]).toBeUndefined();
    expect(ws.channels[general.id].count).toBe(2); // not counted into the defaults
    expect(await rt.kv.get(KEYS.member(wsId, carol.uuid))).toBeFalsy();
    // Opening the link again, as told, joins them afresh while it holds.
    const again = await as(carol).post('/api/join', { code });
    expect(again.ok).toBe(true);
    expect(again.data.promoted).toBeUndefined();
    ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.members[carol.uuid]).toMatchObject({ role: 'member', username: 'carol' });
    expect(ws.channels[general.id].count).toBe(3);
  });
});
