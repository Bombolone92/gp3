/**
 * Identity, membership, notification and scheduling routes: what the
 * twenty-first review pass found.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';

const { alice, bob } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

describe('a profile handed over with a join, on a server whose cards had not heard of the change', () => {
  it('reaches the caller\'s cards in the workspaces they are in here, not only the new one', async () => {
    const a = await workspaceWith(alice, [bob]);
    expect((await rt.kv.get(KEYS.ws(a.wsId))).members[bob.uuid].name).toBe('bob');
    // Bob renamed himself while this server was out of reach (the app's
    // PUT /api/me never landed here), then joins a second workspace on it,
    // his profile travelling with the join as it always does.
    const b = await workspaceWith(alice, [], 'Beta');
    const joined = await as(bob).post('/api/join', { code: b.code, profile: { name: 'Robert', title: 'Ops', color: 3, status: { emoji: '🌴', text: 'Away', until: null } } });
    expect(joined.ok).toBe(true);
    const cardB = (await rt.kv.get(KEYS.ws(b.wsId))).members[bob.uuid];
    expect(cardB.name).toBe('Robert');
    const cardA = (await rt.kv.get(KEYS.ws(a.wsId))).members[bob.uuid];
    expect(cardA.name).toBe('Robert');
    expect(cardA.title).toBe('Ops');
    expect(cardA.color).toBe(3);
    expect(cardA.status).toEqual({ emoji: '🌴', text: 'Away', until: null });
    expect(cardA.role).toBe('member');
    expect((await rt.kv.get(KEYS.user(bob.uuid))).name).toBe('Robert');
  });

  it('writes nothing when the profile handed over is the one the server holds already', async () => {
    const { wsId, code } = await workspaceWith(alice, [bob]);
    await as(bob).put('/api/me', { name: 'Robert', status: { emoji: '🌴', text: 'Away' } });
    const w = (await rt.kv.get(KEYS.activity(wsId))).w;
    const ops = rt.kv._calls.ops;
    // The same profile again, the status as an object of its own: a
    // renewal's seed, or a link opened again.
    const again = await as(bob).post('/api/join', { code, profile: { name: 'Robert', title: '', color: 1, status: { emoji: '🌴', text: 'Away', until: null } } });
    expect(again.data.already).toBe(true);
    // Reads only: the profile, the budget, the invite, the workspace; no card synced, no stamp moved.
    expect((await rt.kv.get(KEYS.activity(wsId))).w).toBe(w);
    expect(rt.kv._calls.ops - ops).toBeLessThanOrEqual(6);
    expect((await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid].name).toBe('Robert');
  });
});

const upload = async (u, wsId, name = 'notes.txt') => {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(24)], name, { type: 'text/plain' }), name);
  const r = await as(u).post(`/api/ws/${wsId}/files`, form);
  expect(r.ok).toBe(true);
  return r.data.id;
};

describe('the files a scheduled message names', () => {
  it('are judged at scheduling as the post judges them, so a file that is not theirs is refused or dropped to the author\'s face, not at the due time', async () => {
    const { wsId, general } = await workspaceWith(alice, [USERS.carol]);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    const code = (await as(alice).post(`/api/ws/${wsId}/channels/${ops}/invites`, {})).data.code;
    expect((await as(bob).post('/api/join', { code })).data.guest).toBe(true);
    const due = Date.now() + 3600_000;
    // Alice's upload, shared nowhere: not a guest's to send, at once or later.
    const alices = await upload(alice, wsId);
    const live = await as(bob).post(`/api/ws/${wsId}/conv/${ops}/messages`, { attachments: [{ id: alices }] });
    const later = await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: ops, attachments: [{ id: alices }], dueAt: due });
    expect(later.status).toBe(400);
    expect(later.data).toMatchObject({ code: live.data.code, message: live.data.message });
    expect(later.data.message).toBe('Those files are not in this workspace');
    // Beside words, the file is dropped as the post drops it, and the words wait.
    const words = await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: ops, text: 'see attached', attachments: [{ id: alices }], dueAt: due });
    expect(words.ok).toBe(true);
    expect(words.data.scheduled.attachments).toEqual([]);
    // An id of nothing, from a member: refused as the post refuses it.
    const unknown = await as(USERS.carol).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, attachments: [{ id: 'zzzzzzzzzzzz' }], dueAt: due });
    expect(unknown.status).toBe(400);
    expect(unknown.data.message).toBe('Those files are not in this workspace');
    // The guest's own upload, and a file shared where they can read, go through whole.
    const own = await upload(bob, wsId, 'mine.txt');
    const shared = await upload(alice, wsId, 'shared.txt');
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${ops}/messages`, { attachments: [{ id: shared }] })).ok).toBe(true);
    const fine = await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: ops, attachments: [{ id: own }, { id: shared }, { id: alices }], dueAt: due });
    expect(fine.ok).toBe(true);
    expect(fine.data.scheduled.attachments).toEqual([{ id: own }, { id: shared }]);
    // A member may name any file of the workspace, as a forward does.
    const forward = await as(USERS.carol).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, attachments: [{ id: alices }], dueAt: due });
    expect(forward.ok).toBe(true);
    expect(forward.data.scheduled.attachments).toEqual([{ id: alices }]);
    // Nothing of the refused ones reached the queue.
    const queue = await rt.kv.get(KEYS.sched(wsId));
    expect(Object.values(queue.m).map((e) => e.u).sort()).toEqual([bob.uuid, bob.uuid, USERS.carol.uuid].sort());
  });
});

describe('an Activity entry for a reaction put on, taken back and put on again', () => {
  it('is listed once, the newest, while the other entries stand; the unread count still counts each notice and clears on opening Activity', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, USERS.carol]);
    const seq = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'ship it' })).data.message.seq;
    const react = (u, reaction, on) => as(u).post(`/api/ws/${wsId}/conv/${general.id}/messages/${seq}/reactions`, { reaction, on });
    await react(bob, 'thumbsup', true);
    await new Promise((r) => setTimeout(r, 3));
    await react(bob, 'thumbsup', false);
    await react(bob, 'thumbsup', true);
    await react(bob, 'tada', true);
    await react(USERS.carol, 'thumbsup', true);
    const ring = await rt.kv.get(KEYS.inbox(wsId, alice.uuid));
    expect(ring.items.filter((e) => e.by === bob.uuid && e.r === 'thumbsup')).toHaveLength(2);
    const inbox = await as(alice).get(`/api/ws/${wsId}/inbox`);
    const rows = inbox.data.items.map((e) => [e.by, e.r]);
    expect(rows).toEqual([[USERS.carol.uuid, 'thumbsup'], [bob.uuid, 'tada'], [bob.uuid, 'thumbsup']]);
    const kept = inbox.data.items.find((e) => e.by === bob.uuid && e.r === 'thumbsup');
    expect(kept.ts).toBe(Math.max(...ring.items.filter((e) => e.by === bob.uuid && e.r === 'thumbsup').map((e) => e.ts)));
    // Told four times; the badge counts each, as it counts entries no longer shown, and clears on opening.
    expect(inbox.data.unread).toBe(4);
    await as(alice).post(`/api/ws/${wsId}/inbox/read`);
    expect((await as(alice).get(`/api/ws/${wsId}/inbox`)).data.unread).toBe(0);
    // Taken back for good, the folded entry goes as any taken-back reaction does.
    await react(bob, 'thumbsup', false);
    expect((await as(alice).get(`/api/ws/${wsId}/inbox`)).data.items.map((e) => [e.by, e.r])).toEqual([[USERS.carol.uuid, 'thumbsup'], [bob.uuid, 'tada']]);
    // Filtered to reactions alone, the same fold.
    await react(bob, 'thumbsup', true);
    expect((await as(alice).get(`/api/ws/${wsId}/inbox?kind=reaction`)).data.items).toHaveLength(3);
  });
});

describe('the number of workspaces one may be in on a server', () => {
  it('no longer counts the copy a workspace left behind when it was moved to another server', async () => {
    const ids = [];
    for (let i = 0; i < 20; i++) ids.push((await as(alice).post('/api/workspaces', { name: `W${i}` })).data.workspace.id);
    const full = await as(alice).post('/api/workspaces', { name: 'One more' });
    expect(full.status).toBe(400);
    expect(full.data.message).toBe('You are in the maximum number of workspaces');
    // One of them moves to another server: the copy here is read-only from
    // now on, and not a workspace she is in any more.
    const moved = await as(alice).post(`/api/ws/${ids[3]}/transfer/complete`, { to: `${ids[3]}@teamchat-elsewhere.puter.work` });
    expect(moved.data).toMatchObject({ ok: true, movedTo: `${ids[3]}@teamchat-elsewhere.puter.work` });
    expect((await rt.kv.get(KEYS.ws(ids[3]))).members[alice.uuid]).toBeTruthy();
    const made = await as(alice).post('/api/workspaces', { name: 'One more' });
    expect(made.ok).toBe(true);
    // The moved copy is still listed, with where it went, for the app to follow.
    const me = await as(alice).get('/api/me');
    expect(me.data.workspaces.find((w) => w.id === ids[3])?.movedTo).toBe(`${ids[3]}@teamchat-elsewhere.puter.work`);
    expect(me.data.workspaces.length).toBe(21);
    // And the cap stands again once she is in twenty live ones.
    expect((await as(alice).post('/api/workspaces', { name: 'Yet another' })).status).toBe(400);
  });
});
